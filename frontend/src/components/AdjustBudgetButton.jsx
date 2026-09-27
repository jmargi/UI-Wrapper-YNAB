import { useState } from 'react';
import {
  Popover, Button, Stack, Group, Text, NumberInput, Badge, UnstyledButton, Tooltip, Alert,
} from '@mantine/core';
import { IconAdjustmentsDollar, IconSparkles, IconAlertTriangle } from '@tabler/icons-react';
import { api, useYNAB } from '../context/YNABContext';
import { useCategorySpend, suggestBudget } from '../utils/categorySpend';
import { applyMonthlyBudget, checkPaycheckRoom, previewSplitAllocation } from '../utils/monthlyBudget';

const fmt = (n) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Pick the single best monthly budget for a category from its recent spend.
// Uses the steadier 90-day average, unless the last 30 days are running
// clearly hotter — then the 30-day pace wins so the budget keeps up.
export function recommendMonthly(spend) {
  const avg30 = (spend?.s30 ?? 0) / 1000;
  const avg90 = (spend?.s90 ?? 0) / 1000 / 3;
  if (avg30 === 0 && avg90 === 0) return { amount: null, avg30, avg90, reason: 'No spending in the last 90 days' };
  const rising = avg30 > avg90 * 1.15;
  return {
    amount: suggestBudget(rising ? avg30 : avg90),
    avg30, avg90,
    reason: rising
      ? `Spending is rising — matches your last-30-day pace (${fmt(avg30)}/mo)`
      : `Matches your 90-day average (${fmt(avg90)}/mo), rounded up`,
  };
}

// Is the recommendation far enough from the current budget to be worth acting on?
const worthChanging = (rec, current) =>
  rec != null && Math.abs(rec - current) >= 10 && Math.abs(rec - current) >= current * 0.1;

/**
 * "Adjust" button + popover for one category's monthly budget.
 *   cat            — { id, name }
 *   currentMonthly — current monthly budget in dollars
 *   rangeAvg       — optional avg spend/month over the report's date range
 *   rangeMonths    — number of months that avg covers
 *   primary        — optional { label, amount, hint } that overrides the
 *                    built-in recommendation (e.g. a report's own suggestion)
 *   quiet          — never highlight the button as a suggestion (e.g. savings
 *                    categories, where low spending is expected)
 */
export default function AdjustBudgetButton({ cat, currentMonthly, rangeAvg, rangeMonths, primary, quiet }) {
  const { saveBudgetOverride } = useYNAB();
  const spendByCat = useCategorySpend();
  const [opened, setOpened] = useState(false);
  const [value, setValue]   = useState(currentMonthly);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState(null); // income sources, loaded on open

  const auto = recommendMonthly(spendByCat[cat.id]);
  const rec  = primary ? { ...auto, amount: primary.amount, reason: primary.hint } : auto;
  const suggest = !quiet && worthChanging(rec.amount, currentMonthly);

  // Quick-pick options, deduped by amount. First one is the recommendation.
  const options = [];
  const add = (label, amount, hint, recommended = false) => {
    if (amount == null || options.some((o) => o.amount === amount)) return;
    options.push({ label, amount, hint, recommended });
  };
  if (rec.amount != null) add(primary?.label ?? 'Recommended', rec.amount, rec.reason, true);
  if (rec.avg30 > 0) add('Last 30 days', suggestBudget(rec.avg30), `You spent ${fmt(rec.avg30)}`);
  if (rec.avg90 > 0) add('Last 90 days', suggestBudget(rec.avg90), `Avg ${fmt(rec.avg90)}/mo`);
  if (rangeAvg > 0 && rangeMonths > 1)
    add('This report', suggestBudget(rangeAvg), `Avg ${fmt(rangeAvg)}/mo over ${rangeMonths} months`);
  if (rec.amount == null && currentMonthly > 0) add('Stop budgeting', 0, 'Nothing spent in 90 days');

  const loadProfiles = async () => {
    const data = (await api.get('/rules/profiles').catch(() => ({ data: null }))).data;
    setProfiles(data);
    return data;
  };

  const open = () => {
    setValue(rec.amount ?? currentMonthly);
    setOpened(true);
    loadProfiles();
  };

  const save = async () => {
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars < 0 || blocked) return;
    setSaving(true);
    try {
      // Re-read income sources so the paycheck check uses the latest splits.
      const fresh = await loadProfiles();
      if (!fresh) return; // couldn't verify paychecks — don't save blind
      const ok = await applyMonthlyBudget({ cat, dollars, currentDollars: currentMonthly, profiles: fresh, saveBudgetOverride });
      if (ok) setOpened(false);
    } finally {
      setSaving(false);
    }
  };

  const delta = Number(value) - currentMonthly;

  // Live paycheck-room check for the amount currently selected.
  const room = profiles
    ? checkPaycheckRoom({ cat, dollars: Number(value) || 0, currentDollars: currentMonthly, profiles })
    : null;
  const blocked = !profiles || room.problems.length > 0;

  // Exactly what Save will write to each funding paycheck's split, so the
  // recalculated splits are visible before the budget change is committed.
  const splitPreview = profiles && !blocked && delta !== 0
    ? previewSplitAllocation({ cat, dollars: Number(value) || 0, currentDollars: currentMonthly, profiles })
    : null;

  return (
    <Popover opened={opened} onChange={setOpened} width={300} position="bottom-end" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Tooltip
          label={suggest ? `Suggested: ${fmt(rec.amount)}/mo (now ${fmt(currentMonthly)})` : 'Change monthly budget'}
          withArrow
          disabled={opened}
        >
          <Button
            size="compact-xs"
            variant={suggest ? 'light' : 'subtle'}
            color={suggest ? 'orange' : 'gray'}
            leftSection={suggest ? <IconSparkles size={12} /> : <IconAdjustmentsDollar size={12} />}
            onClick={(e) => { e.stopPropagation(); opened ? setOpened(false) : open(); }}
          >
            {suggest ? fmt(rec.amount) : 'Adjust'}
          </Button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown onClick={(e) => e.stopPropagation()}>
        <Stack gap="xs">
          <div>
            <Text size="sm" fw={700}>{cat.name}</Text>
            <Text size="xs" c="dimmed">Monthly budget now: {fmt(currentMonthly)}/mo</Text>
          </div>

          {options.length > 0 ? (
            <Stack gap={4}>
              {options.map((o) => {
                const active = Number(value) === o.amount;
                return (
                  <UnstyledButton
                    key={o.label}
                    onClick={() => setValue(o.amount)}
                    p={6}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${active ? 'var(--mantine-color-teal-filled)' : 'var(--mantine-color-default-border)'}`,
                      background: active ? 'var(--mantine-color-teal-light)' : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" fw={600}>{o.label}</Text>
                        {o.recommended && <Badge size="xs" color="teal" variant="light">best fit</Badge>}
                      </Group>
                      <Text size="sm" fw={700}>{fmt(o.amount)}</Text>
                    </Group>
                    <Text size="10px" c="dimmed">{o.hint}</Text>
                  </UnstyledButton>
                );
              })}
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">{rec.reason}. Enter an amount below.</Text>
          )}

          <NumberInput
            label="Or enter your own"
            size="xs"
            prefix="$"
            min={0}
            step={5}
            decimalScale={2}
            thousandSeparator=","
            value={value}
            onChange={setValue}
            onKeyDown={(e) => e.key === 'Enter' && delta !== 0 && save()}
          />

          {profiles === null && opened && (
            <Text size="xs" c="dimmed">Checking paychecks…</Text>
          )}
          {room?.problems.length > 0 && (
            <Alert color="red" variant="light" p="xs" icon={<IconAlertTriangle size={14} />}
              title="Not enough room in the paycheck">
              <Stack gap={2}>
                {room.problems.map((x) => (
                  <Text key={x.name} size="xs"><b>{x.name}</b>: {x.message}</Text>
                ))}
                <Text size="xs" c="dimmed">
                  Pick a lower amount, or free up money in other splits on the Income page first.
                </Text>
              </Stack>
            </Alert>
          )}

          {splitPreview?.length > 0 && (
            <Alert color="blue" variant="light" p="xs" title="Splits after Save">
              <Stack gap={2}>
                {splitPreview.map((p) => (
                  <Group key={p.id} justify="space-between" gap="xs">
                    <Text size="xs">{p.name}</Text>
                    <Text size="xs" fw={600}>${p.perCheck.toFixed(2)}/check</Text>
                  </Group>
                ))}
              </Stack>
            </Alert>
          )}

          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c={delta > 0 ? 'orange' : delta < 0 ? 'teal' : 'dimmed'}>
              {delta === 0 || !Number.isFinite(delta)
                ? 'No change'
                : `${delta > 0 ? '+' : '−'}${fmt(delta)}/mo`}
            </Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setOpened(false)}>Cancel</Button>
              <Button size="xs" color="teal" loading={saving} disabled={delta === 0 || blocked} onClick={save}>
                Save
              </Button>
            </Group>
          </Group>
          <Text size="10px" c="dimmed">
            Updates your monthly budget in this app and re-splits paychecks that fund it. YNAB isn't changed.
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
