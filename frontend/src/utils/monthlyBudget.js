import { notifications } from '@mantine/notifications';
import { api } from '../context/YNABContext';

const CHECKS_PER_SOURCE = 2;

// Dollar amount of one split on a check of the given size.
const splitDollars = (split, checkAmount) =>
  !split.value ? 0
  : split.type === 'percent' ? (split.value / 100) * (checkAmount || 0)
  : split.value;

// Per-check amount a monthly budget turns into: spread evenly across every
// income source's two checks a month.
export const perCheckFor = (dollars, profiles) =>
  parseFloat((dollars / (((profiles?.length ?? 1) || 1) * CHECKS_PER_SOURCE)).toFixed(2));

const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Can the paychecks actually pay for this category at `dollars`/mo?
//   • Category funded by paycheck splits → every check that funds it must still
//     have its splits add up to no more than the check amount.
//   • Category not funded by any split → the increase must fit within the
//     paychecks' unassigned money for the month.
//   • An income source with no check amount can't be verified → blocked.
// Lowering a budget is always allowed. Returns { perCheck, problems } where
// each problem is { name, message }.
export function checkPaycheckRoom({ cat, dollars, currentDollars = 0, profiles }) {
  const perCheck = perCheckFor(dollars, profiles);
  const problems = [];
  if (dollars <= currentDollars + 0.005) return { perCheck, problems };

  const funding = (profiles ?? []).filter((p) =>
    (p.defaultSplits ?? []).some((s) => s.categoryId === cat.id));

  const totals = (p, overrideCat) => {
    const check = p.checkAmount || 0;
    return (p.defaultSplits ?? []).reduce((sum, s) =>
      sum + (overrideCat && s.categoryId === cat.id ? perCheck : splitDollars(s, check)), 0);
  };

  if (funding.length) {
    for (const p of funding) {
      const check = p.checkAmount || 0;
      if (check <= 0) {
        problems.push({ name: p.name, message: 'no paycheck amount is set, so there is no way to confirm the money is there. Set it on the Income page first.' });
        continue;
      }
      const oldTotal = totals(p, false);
      const newTotal = totals(p, true);
      if (newTotal > check + 0.005 && newTotal > oldTotal + 0.005) {
        const free = Math.max(0, check - oldTotal);
        problems.push({
          name: p.name,
          message: `only ${money(free)} of the ${money(check)} check is unassigned, but this needs ${money(newTotal - oldTotal)} more per check (${money(newTotal - check)} short).`,
        });
      }
    }
    return { perCheck, problems };
  }

  // Not split from any paycheck — must come out of unassigned paycheck money.
  const missing = (profiles ?? []).filter((p) => !(p.checkAmount > 0));
  if (!profiles?.length || missing.length) {
    problems.push({
      name: missing.length ? missing.map((p) => p.name).join(', ') : 'Income',
      message: missing.length
        ? 'no paycheck amount is set, so there is no way to confirm the money is there. Set it on the Income page first.'
        : 'no income sources are set up, so there is no paycheck money to budget from.',
    });
    return { perCheck, problems };
  }
  const freePerMonth = profiles.reduce((sum, p) =>
    sum + Math.max(0, (p.checkAmount - totals(p, false))) * CHECKS_PER_SOURCE, 0);
  const increase = dollars - currentDollars;
  if (increase > freePerMonth + 0.005) {
    problems.push({
      name: 'All paychecks',
      message: `only ${money(freePerMonth)}/mo is unassigned across your paychecks, but this raises the budget by ${money(increase)}/mo (${money(increase - freePerMonth)} short).`,
    });
  }
  return { perCheck, problems };
}

// One-line description of paycheck problems, for notifications.
export const describePaycheckProblems = (problems) =>
  problems.map((x) => `${x.name}: ${x.message}`).join(' ');

// Save a category's monthly budget (local SQLite override — YNAB is NOT
// written to) and auto-recalculate the per-check splits of every income
// profile that funds it. Shared by the Budget page editor and the reports.
//   cat     — { id, name }
//   dollars        — new monthly amount
//   currentDollars — monthly amount before the change
// Refuses (returns false, nothing saved) if the new amount won't fit in every
// paycheck that funds the category.
export async function applyMonthlyBudget({ cat, dollars, currentDollars, profiles, saveBudgetOverride, onReload }) {
  const { problems } = checkPaycheckRoom({ cat, dollars, currentDollars, profiles });
  if (problems.length) {
    notifications.show({
      title: `Not enough room in the paycheck for ${cat.name}`,
      message: `${describePaycheckProblems(problems)} Lower this amount or free up other splits first. Nothing was saved.`,
      color: 'red',
      autoClose: 8000,
    });
    return false;
  }

  // Persist to SQLite via API — YNAB is NOT written to.
  await saveBudgetOverride(cat.id, Math.round(dollars * 1000));

  // ── Auto-recalculate per-check splits in all profiles that use this category ──
  // SAFETY: never overwrite a good split value with $0 — skip if new monthly is 0
  try {
    if (dollars <= 0) throw new Error('skip — $0 monthly would zero out splits');

    const newPerCheck = perCheckFor(dollars, profiles);

    if (newPerCheck <= 0) throw new Error('skip — per-check would be $0');

    const affected = (profiles ?? []).filter((p) =>
      (p.defaultSplits ?? []).some((s) => s.categoryId === cat.id)
    );

    for (const p of affected) {
      const updatedSplits = (p.defaultSplits ?? []).map((s) =>
        // newPerCheck is dollars, so the split becomes a fixed amount
        s.categoryId === cat.id ? { ...s, type: 'amount', value: newPerCheck } : s
      );
      // Safety: never add or remove splits
      if (updatedSplits.length !== (p.defaultSplits ?? []).length) continue;
      console.log('[auto-recalc]', p.name, 'before:', p.defaultSplits, 'after:', updatedSplits);
      await api.put(`/rules/profiles/${p.id}`, { ...p, defaultSplits: updatedSplits });
    }

    if (affected.length > 0) {
      notifications.show({
        title: 'Splits auto-updated',
        message: `${cat.name} → $${newPerCheck.toFixed(2)}/check across ${affected.length} source${affected.length !== 1 ? 's' : ''}: ${affected.map((p) => p.name).join(', ')}`,
        color: 'blue',
        autoClose: 4000,
      });
      onReload?.();
    }
  } catch (recalcErr) {
    console.error('[auto-recalc] Error:', recalcErr);
    notifications.show({
      title: 'Budget saved, but split recalc failed',
      message: recalcErr.message,
      color: 'orange',
    });
  }

  notifications.show({
    title: `${cat.name} saved`,
    message: `Monthly reference set to $${dollars.toFixed(2)}/mo — saved to database, not sent to YNAB`,
    color: 'teal',
    autoClose: 3000,
  });
  return true;
}
