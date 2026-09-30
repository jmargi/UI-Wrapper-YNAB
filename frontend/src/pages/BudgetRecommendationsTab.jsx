import { useState, useMemo } from 'react';
import {
  Stack, Card, Group, Text, Badge, ThemeIcon, SegmentedControl,
  Progress, Alert, Box, Tooltip, ScrollArea,
} from '@mantine/core';
import {
  IconBulb, IconArrowUpRight, IconArrowDownRight, IconArrowRight,
  IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconCoin,
} from '@tabler/icons-react';
import { useYNAB } from '../context/YNABContext';
import { useCategorySpend, suggestBudget } from '../utils/categorySpend';
import AdjustBudgetButton from '../components/AdjustBudgetButton';
import ColumnHeader from '../components/ColumnHeader';

// Category groups that never represent real discretionary spending — same
// exclusion list the Budget vs Actual report and Dashboard pie use. "Saving"
// is this app's actual group name for savings goals — excluded outright,
// never just flagged, per user preference: no savings categories here at all.
const EXCLUDED_GROUPS = new Set([
  'Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments', 'Saving',
]);

// Only surface a recommendation when the monthly gap is at least this many
// dollars AND the spend is at least this fraction over budget — avoids noise
// from tiny overages.
const MIN_GAP_DOLLARS = 10;

// Individually-named savings/goal categories that might live outside the
// "Saving" group (e.g. filed under "Other Expenses"). Excluded the same way.
const SAVINGS_RE = /sav(e|ing)|invest|emergency|fund\b|goal|retire/i;
const OVER_FACTOR      = 1.10; // spending >10% over budget
// A category counts as a rebalance-from candidate once it's using less than
// this share of its budget — loosened from a stricter 60% so mild
// underspenders show up too, not just categories barely touched.
const UNDERSPEND_FACTOR = 0.85;

const fmt = (n) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BudgetRecommendationsTab() {
  const { flatCategories, budgetOverrides } = useYNAB();
  const [windowDays, setWindowDays] = useState('30'); // '30' | '60' | '90' | '180' | '365'

  const spendByCat = useCategorySpend();

  // Current monthly budget for a category: local override first, else YNAB's
  // current-month budgeted amount. Returned in dollars.
  const currentMonthlyDollars = (cat) =>
    budgetOverrides[cat.id] != null
      ? Math.abs(budgetOverrides[cat.id]) / 1000
      : Math.abs(cat.budgeted || 0) / 1000;

  const analysis = useMemo(() => {
    const months = Number(windowDays) / 30; // 1, 2, 3, 6 or 12
    const key    = `s${windowDays}`;

    const rows = (flatCategories ?? [])
      .filter((c) => !c.hidden && !c.deleted && !EXCLUDED_GROUPS.has(c.groupName)
        && !SAVINGS_RE.test(`${c.groupName} ${c.name}`))
      .map((c) => {
        const s          = spendByCat[c.id] ?? { s30: 0, s60: 0, s90: 0 };
        const spentSel   = (s[key] ?? 0) / 1000;         // total spend in selected window ($)
        const avgSel     = spentSel / months;            // avg spend per month ($)
        const avg30      = (s.s30 ?? 0) / 1000;          // per-month (30d window = 1 mo)
        const avg90      = ((s.s90 ?? 0) / 1000) / 3;    // per-month over 90d
        const current    = currentMonthlyDollars(c);
        const gap        = avgSel - current;             // +$ = under-budgeted

        // Trend: is recent pace higher than the 90-day pace?
        let trend = 'steady';
        if (avg90 > 0 || avg30 > 0) {
          if (avg30 > avg90 * 1.15)      trend = 'rising';
          else if (avg30 < avg90 * 0.85) trend = 'falling';
        }

        return {
          id: c.id, name: c.name, group: c.groupName,
          current, avgSel, spentSel, gap, trend,
          noBudget: current < 1 && avgSel >= MIN_GAP_DOLLARS,
          suggested: suggestBudget(avgSel),
        };
      });

    const increases = rows
      .filter((r) => r.avgSel > 0 && (r.noBudget || (r.avgSel > r.current * OVER_FACTOR && r.gap >= MIN_GAP_DOLLARS)))
      .sort((a, b) => b.gap - a.gap);

    // Over-budgeted with real budget and low spend — a funding source to
    // rebalance from into the categories above.
    const reallocate = rows
      .filter((r) => r.current >= 20 && r.avgSel < r.current * UNDERSPEND_FACTOR
        && (r.current - r.avgSel) >= MIN_GAP_DOLLARS)
      .map((r) => ({ ...r, slack: r.current - r.avgSel }))
      .sort((a, b) => b.slack - a.slack);

    const totalIncrease = increases.reduce((s, r) => s + r.gap, 0);
    const totalSlack    = reallocate.reduce((s, r) => s + r.slack, 0);

    return { increases, reallocate, totalIncrease, totalSlack };
  }, [flatCategories, spendByCat, budgetOverrides, windowDays]);

  const WINDOW_LABELS = { 30: '30 days', 60: '60 days', 90: '90 days', 180: '6 months', 365: '1 year' };
  const windowLabel = WINDOW_LABELS[windowDays] ?? `${windowDays} days`;
  const monthsN      = Number(windowDays) / 30;
  const monthsLabel  = `${monthsN} month${monthsN !== 1 ? 's' : ''}`;

  const TrendBadge = ({ trend }) => {
    if (trend === 'rising')
      return <Tooltip label="Spending faster in the last 30 days than your 90-day pace" withArrow><Badge size="xs" color="red" variant="light" leftSection={<IconArrowUpRight size={10} />}>rising</Badge></Tooltip>;
    if (trend === 'falling')
      return <Tooltip label="Spending slower in the last 30 days than your 90-day pace" withArrow><Badge size="xs" color="teal" variant="light" leftSection={<IconArrowDownRight size={10} />}>falling</Badge></Tooltip>;
    return <Tooltip label="Last 30 days are in line with your 90-day pace" withArrow><Badge size="xs" color="gray" variant="light" leftSection={<IconArrowRight size={10} />}>steady</Badge></Tooltip>;
  };

  const TIPS = {
    budget: 'Your monthly budget today (set on the Budget page, or YNAB\'s assigned amount if none is set)',
    avg:    `What you actually spent per month on average over the last ${windowLabel}`,
    short:  'How much more you spend each month than you budget',
    sugg:   'A monthly budget that covers your average spend, rounded up to the nearest $5',
    unused: 'Budget you haven\'t been using each month. You could move it to the categories above',
  };

  const headerStyle = { borderBottom: '1px solid var(--mantine-color-default-border)' };
  const rowStyle    = { borderBottom: '1px solid var(--mantine-color-default-border)' };
  const BTN_W = 104;

  return (
    <Stack gap="md">
      {/* What am I looking at? */}
      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} p="sm">
        <Text size="sm">
          Are your monthly budgets realistic? This compares each category's <b>monthly budget</b> with
          what you've <b>actually been spending per month</b> over the last {windowLabel}.
          The top list shows budgets that are too small. The bottom list shows budgets you aren't using,
          where you could free up money to cover them.
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          The bar shows average spending as a share of the budget. Use the button at the end of a row
          to change that category's monthly budget; it starts on the suggested amount.
        </Text>
      </Alert>

      {/* Controls + summary */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm" wrap="wrap">
            <Text size="sm" fw={600}>Look back over</Text>
            <SegmentedControl
              size="sm"
              value={windowDays}
              onChange={setWindowDays}
              data={[
                { value: '30', label: '30 days' },
                { value: '60', label: '60 days' },
                { value: '90', label: '90 days' },
                { value: '180', label: '6 months' },
                { value: '365', label: '1 year' },
              ]}
            />
          </Group>
          <Group gap="lg">
            <Tooltip label="Total extra per month needed to cover the categories below at their current spending" multiline w={240} withArrow>
              <Box style={{ cursor: 'help' }}>
                <Text size="xs" c="dimmed">You're short each month</Text>
                <Text fw={800} c="red" size="lg">{fmt(analysis.totalIncrease)}/mo</Text>
              </Box>
            </Tooltip>
            {analysis.totalSlack > 0 && (
              <Tooltip label="Total budget per month you aren't using in over-budgeted categories" multiline w={240} withArrow>
                <Box style={{ cursor: 'help' }}>
                  <Text size="xs" c="dimmed">Unused budget you could move</Text>
                  <Text fw={800} c="teal" size="lg">{fmt(analysis.totalSlack)}/mo</Text>
                </Box>
              </Tooltip>
            )}
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          "Avg spent/mo" is everything spent in the last {windowLabel} divided by {monthsLabel}.
        </Text>
      </Card>

      {/* Increase recommendations */}
      <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
        <Group px="md" py="sm" gap="xs" style={{ background: 'var(--mantine-color-default-hover)' }}>
          <ThemeIcon color="orange" variant="light" size="md"><IconBulb size={15} /></ThemeIcon>
          <div>
            <Text fw={600}>Budgets that are too small</Text>
            <Text size="xs" c="dimmed">You regularly spend more than you budget in these categories</Text>
          </div>
          <Badge color="orange" variant="light" size="sm" ml="auto">{analysis.increases.length}</Badge>
        </Group>

        {analysis.increases.length === 0 ? (
          <Alert color="teal" icon={<IconCircleCheck size={16} />} radius={0} variant="light">
            Nothing to increase — every tracked category is spending within its current budget over the last {windowLabel}. 🎉
          </Alert>
        ) : (
          <ScrollArea>
            <Box style={{ minWidth: 780 }}>
              {/* Header */}
              <Group px="md" py="xs" gap={0} wrap="nowrap" style={headerStyle}>
                <Text size="xs" fw={700} style={{ flex: 3 }}>Category</Text>
                <ColumnHeader label="Avg spent/mo" tip={TIPS.avg} flex={1.4} />
                <ColumnHeader label="Short by" tip={TIPS.short} flex={1.4} />
                <ColumnHeader label="Budget now" tip={TIPS.budget} flex={1.4} />
                <ColumnHeader label="Suggested" tip={TIPS.sugg} flex={1.4} />
                <Text size="xs" fw={700} ta="right" style={{ width: BTN_W, flexShrink: 0 }}>Update</Text>
              </Group>

              {analysis.increases.map((r) => {
                const pct = r.current > 0 ? Math.round((r.avgSel / r.current) * 100) : null;
                return (
                  <Box key={r.id} px="md" py={8} style={rowStyle}>
                    <Group gap={0} wrap="nowrap" align="flex-start">
                      <Box style={{ flex: 3, minWidth: 0 }} pr="md">
                        <Group gap={6} wrap="wrap">
                          <Text size="sm" fw={500} lineClamp={1}>{r.name}</Text>
                          {r.noBudget
                            ? <Badge size="xs" color="red" variant="filled">no budget set</Badge>
                            : <TrendBadge trend={r.trend} />}
                        </Group>
                        <Text size="xs" c="dimmed">{r.group}</Text>
                        <Progress
                          mt={4}
                          value={r.current > 0 ? Math.min(100, (r.avgSel / r.current) * 100) : 100}
                          color={r.current > 0 && r.avgSel <= r.current ? 'orange' : 'red'}
                          size="xs" radius="xl"
                          aria-label={`${r.name}: spending ${pct ?? 'with no'}% of budget`}
                        />
                        <Text size="10px" c="red" mt={2}>
                          {pct != null
                            ? `Spending ${pct}% of budget each month`
                            : `Spending ${fmt(r.avgSel)}/mo with nothing budgeted`}
                        </Text>
                      </Box>
                      <Text size="sm" ta="right" fw={500} style={{ flex: 1.4 }}>{fmt(r.avgSel)}</Text>
                      <Text size="sm" ta="right" fw={600} c="red" style={{ flex: 1.4, whiteSpace: 'nowrap' }}>
                        {fmt(r.gap)}/mo
                      </Text>
                      <Text size="sm" ta="right" c="dimmed" style={{ flex: 1.4 }}>
                        {r.current > 0 ? fmt(r.current) : '—'}
                      </Text>
                      <Text size="sm" ta="right" fw={700} c="teal" style={{ flex: 1.4 }}>{fmt(r.suggested)}</Text>
                      <Group justify="flex-end" style={{ width: BTN_W, flexShrink: 0 }}>
                        <AdjustBudgetButton
                          cat={r}
                          currentMonthly={r.current}
                          primary={{
                            label: 'Suggested',
                            amount: r.suggested,
                            hint: `Covers your ${fmt(r.avgSel)}/mo average over the last ${windowLabel}`,
                          }}
                        />
                      </Group>
                    </Group>
                  </Box>
                );
              })}
            </Box>
          </ScrollArea>
        )}
      </Card>

      {/* Reallocate-from (funding source) */}
      {analysis.reallocate.length > 0 && (
        <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
          <Group px="md" py="sm" gap="xs" style={{ background: 'var(--mantine-color-default-hover)' }}>
            <ThemeIcon color="teal" variant="light" size="md"><IconCoin size={15} /></ThemeIcon>
            <div>
              <Text fw={600}>Budgets you aren't using</Text>
              <Text size="xs" c="dimmed">You spend well under budget here. Lower these to free up money for the list above</Text>
            </div>
            <Badge color="teal" variant="light" size="sm" ml="auto">{analysis.reallocate.length}</Badge>
          </Group>
          <ScrollArea>
            <Box style={{ minWidth: 640 }}>
              <Group px="md" py="xs" gap={0} wrap="nowrap" style={headerStyle}>
                <Text size="xs" fw={700} style={{ flex: 3 }}>Category</Text>
                <ColumnHeader label="Budget now" tip={TIPS.budget} flex={1.4} />
                <ColumnHeader label="Avg spent/mo" tip={TIPS.avg} flex={1.4} />
                <ColumnHeader label="Unused" tip={TIPS.unused} flex={1.4} />
                <Text size="xs" fw={700} ta="right" style={{ width: BTN_W, flexShrink: 0 }}>Update</Text>
              </Group>
              {analysis.reallocate.map((r) => {
                const pct = Math.round((r.avgSel / r.current) * 100);
                // Nothing spent at all — could be a category that's just not due yet
                // this window (e.g. an annual bill), so don't push a "cut it" suggestion.
                const unspent = r.avgSel === 0;
                return (
                  <Box key={r.id} px="md" py={8} style={rowStyle}>
                    <Group gap={0} wrap="nowrap" align="flex-start">
                      <Box style={{ flex: 3, minWidth: 0 }} pr="md">
                        <Group gap={6} wrap="wrap">
                          <Text size="sm" fw={500} lineClamp={1}>{r.name}</Text>
                          {unspent && (
                            <Tooltip label="Nothing spent here in this window — might just not be due yet (e.g. an annual bill)" multiline w={240} withArrow>
                              <Badge size="xs" color="blue" variant="light">unspent</Badge>
                            </Tooltip>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">{r.group}</Text>
                        <Progress
                          mt={4} value={pct} color="teal" size="xs" radius="xl"
                          aria-label={`${r.name}: using ${pct}% of budget`}
                        />
                        <Text size="10px" c="dimmed" mt={2}>
                          {r.avgSel === 0
                            ? `Nothing spent in the last ${windowLabel}`
                            : `Using only ${pct}% of budget each month`}
                        </Text>
                      </Box>
                      <Text size="sm" ta="right" c="dimmed" style={{ flex: 1.4 }}>{fmt(r.current)}</Text>
                      <Text size="sm" ta="right" style={{ flex: 1.4 }}>{fmt(r.avgSel)}</Text>
                      <Text size="sm" ta="right" fw={600} c="teal" style={{ flex: 1.4, whiteSpace: 'nowrap' }}>{fmt(r.slack)}/mo</Text>
                      <Group justify="flex-end" style={{ width: BTN_W, flexShrink: 0 }}>
                        <AdjustBudgetButton
                          cat={r}
                          currentMonthly={r.current}
                          quiet={unspent}
                          primary={unspent ? undefined : {
                            label: 'Match spending',
                            amount: suggestBudget(r.avgSel),
                            hint: `Your ${fmt(r.avgSel)}/mo average over the last ${windowLabel}, rounded up`,
                          }}
                        />
                      </Group>
                    </Group>
                  </Box>
                );
              })}
            </Box>
          </ScrollArea>
        </Card>
      )}

      <Alert color="blue" variant="light" icon={<IconInfoCircle size={14} />}>
        Changes you make here update your monthly budget in this app (the same one on the Budget page)
        and re-split any paychecks that fund that category. Nothing is changed in YNAB.
      </Alert>
    </Stack>
  );
}
