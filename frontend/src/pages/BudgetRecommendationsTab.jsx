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

// Category groups that never represent real discretionary spending — same
// exclusion list the Budget vs Actual report and Dashboard pie use.
const EXCLUDED_GROUPS = new Set([
  'Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments',
]);

// Only surface a recommendation when the monthly gap is at least this many
// dollars AND the spend is at least this fraction over budget — avoids noise
// from tiny overages.
const MIN_GAP_DOLLARS = 10;
const OVER_FACTOR      = 1.10; // spending >10% over budget

const fmt = (n) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BudgetRecommendationsTab() {
  const { flatCategories, budgetOverrides } = useYNAB();
  const [windowDays, setWindowDays] = useState('30'); // '30' | '60' | '90'

  const spendByCat = useCategorySpend();

  // Current monthly budget for a category: local override first, else YNAB's
  // current-month budgeted amount. Returned in dollars.
  const currentMonthlyDollars = (cat) =>
    budgetOverrides[cat.id] != null
      ? Math.abs(budgetOverrides[cat.id]) / 1000
      : Math.abs(cat.budgeted || 0) / 1000;

  const analysis = useMemo(() => {
    const months = Number(windowDays) / 30; // 1, 2 or 3
    const key    = windowDays === '30' ? 's30' : windowDays === '60' ? 's60' : 's90';

    const rows = (flatCategories ?? [])
      .filter((c) => !c.hidden && !c.deleted && !EXCLUDED_GROUPS.has(c.groupName))
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

    // Over-budgeted with real budget and low spend — a funding source.
    const reallocate = rows
      .filter((r) => r.current >= 20 && r.avgSel < r.current * 0.6 && (r.current - r.avgSel) >= MIN_GAP_DOLLARS)
      .map((r) => ({ ...r, slack: r.current - r.avgSel }))
      .sort((a, b) => b.slack - a.slack);

    const totalIncrease = increases.reduce((s, r) => s + r.gap, 0);
    const totalSlack    = reallocate.reduce((s, r) => s + r.slack, 0);

    return { increases, reallocate, totalIncrease, totalSlack };
  }, [flatCategories, spendByCat, budgetOverrides, windowDays]);

  const windowLabel = `${windowDays} days`;

  const TrendBadge = ({ trend }) => {
    if (trend === 'rising')
      return <Tooltip label="Spending faster recently than the 90-day pace" withArrow><Badge size="xs" color="red" variant="light" leftSection={<IconArrowUpRight size={10} />}>rising</Badge></Tooltip>;
    if (trend === 'falling')
      return <Tooltip label="Spending slower recently than the 90-day pace" withArrow><Badge size="xs" color="teal" variant="light" leftSection={<IconArrowDownRight size={10} />}>falling</Badge></Tooltip>;
    return <Badge size="xs" color="gray" variant="light" leftSection={<IconArrowRight size={10} />}>steady</Badge>;
  };

  return (
    <Stack gap="md">
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
              ]}
            />
          </Group>
          <Group gap="lg">
            <Box>
              <Text size="xs" c="dimmed">Suggested monthly increase</Text>
              <Text fw={800} c="red" size="lg">{fmt(analysis.totalIncrease)}/mo</Text>
            </Box>
            {analysis.totalSlack > 0 && (
              <Box>
                <Text size="xs" c="dimmed">Reallocatable slack</Text>
                <Text fw={800} c="teal" size="lg">{fmt(analysis.totalSlack)}/mo</Text>
              </Box>
            )}
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Based on your actual transactions over the last {windowLabel}. "Avg/mo" is spend in that window
          divided by {Number(windowDays) / 30} month{Number(windowDays) / 30 !== 1 ? 's' : ''}, compared to your
          current monthly budget (local override where set, otherwise YNAB's budgeted amount).
        </Text>
      </Card>

      {/* Increase recommendations */}
      <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
        <Group px="md" py="sm" gap="xs" style={{ background: 'var(--mantine-color-default-hover)' }}>
          <ThemeIcon color="orange" variant="light" size="md"><IconBulb size={15} /></ThemeIcon>
          <Text fw={600}>Consider increasing these budgets</Text>
          <Badge color="orange" variant="light" size="sm" ml="auto">{analysis.increases.length}</Badge>
        </Group>

        {analysis.increases.length === 0 ? (
          <Alert color="teal" icon={<IconCircleCheck size={16} />} radius={0} variant="light">
            Nothing to increase — every tracked category is spending within its current budget over the last {windowLabel}. 🎉
          </Alert>
        ) : (
          <ScrollArea>
            <Box style={{ minWidth: 620 }}>
              {/* Header */}
              <Group px="md" py="xs" gap={0} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Text size="xs" fw={700} style={{ flex: 3 }}>Category</Text>
                <Text size="xs" fw={700} ta="right" style={{ flex: 1.4 }}>Budget/mo</Text>
                <Text size="xs" fw={700} ta="right" style={{ flex: 1.4 }}>Avg spend/mo</Text>
                <Text size="xs" fw={700} ta="right" style={{ flex: 1.4 }}>Over by</Text>
                <Text size="xs" fw={700} ta="right" style={{ flex: 1.4 }}>Suggested</Text>
              </Group>

              {analysis.increases.map((r) => {
                const pct = r.current > 0 ? Math.min(200, Math.round((r.avgSel / r.current) * 100)) : null;
                return (
                  <Box key={r.id} px="md" py={8} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                    <Group gap={0} wrap="nowrap">
                      <Box style={{ flex: 3, minWidth: 0 }}>
                        <Group gap={6} wrap="wrap">
                          <Text size="sm" fw={500} lineClamp={1}>{r.name}</Text>
                          {r.noBudget
                            ? <Badge size="xs" color="red" variant="filled">no budget set</Badge>
                            : <TrendBadge trend={r.trend} />}
                        </Group>
                        <Text size="xs" c="dimmed">{r.group}</Text>
                      </Box>
                      <Text size="sm" ta="right" c="dimmed" style={{ flex: 1.4 }}>
                        {r.current > 0 ? fmt(r.current) : '—'}
                      </Text>
                      <Text size="sm" ta="right" fw={500} style={{ flex: 1.4 }}>{fmt(r.avgSel)}</Text>
                      <Text size="sm" ta="right" fw={600} c="red" style={{ flex: 1.4 }}>
                        +{fmt(r.gap)}
                        {pct != null && <Text span size="xs" c="dimmed"> ({pct}%)</Text>}
                      </Text>
                      <Text size="sm" ta="right" fw={700} c="teal" style={{ flex: 1.4 }}>{fmt(r.suggested)}</Text>
                    </Group>
                    {r.current > 0 && (
                      <Progress
                        mt={6}
                        value={Math.min(100, (r.avgSel / r.current) * 100)}
                        color={r.avgSel > r.current ? 'red' : 'orange'}
                        size="xs" radius="xl"
                      />
                    )}
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
            <Text fw={600}>Where to pull the money from</Text>
            <Tooltip label="Categories budgeted well above recent spending — slack you could move to the increases above" withArrow>
              <ThemeIcon color="gray" variant="subtle" size="sm"><IconInfoCircle size={13} /></ThemeIcon>
            </Tooltip>
            <Badge color="teal" variant="light" size="sm" ml="auto">{analysis.reallocate.length}</Badge>
          </Group>
          <ScrollArea>
            <Box style={{ minWidth: 480 }}>
              {analysis.reallocate.map((r) => (
                <Group key={r.id} px="md" py={8} gap={0} wrap="nowrap"
                  style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                  <Box style={{ flex: 3, minWidth: 0 }}>
                    <Text size="sm" fw={500} lineClamp={1}>{r.name}</Text>
                    <Text size="xs" c="dimmed">{r.group}</Text>
                  </Box>
                  <Text size="sm" ta="right" c="dimmed" style={{ flex: 1.4 }}>{fmt(r.current)}</Text>
                  <Text size="sm" ta="right" style={{ flex: 1.4 }}>{fmt(r.avgSel)}</Text>
                  <Text size="sm" ta="right" fw={600} c="teal" style={{ flex: 1.4 }}>{fmt(r.slack)} free</Text>
                </Group>
              ))}
            </Box>
          </ScrollArea>
        </Card>
      )}

      <Alert color="blue" variant="light" icon={<IconInfoCircle size={14} />}>
        This report only reads your data — it doesn't change any budgets. Adjust monthly amounts on the
        Income page's <strong>Monthly Budgets</strong> card, or allocate income from the Income page.
      </Alert>
    </Stack>
  );
}
