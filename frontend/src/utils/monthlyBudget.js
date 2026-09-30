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

// Given a monthly amount to place across a category's current funding
// sources, and each source's monthly headroom (free room excluding this
// category's own existing split), find a per-source monthly allocation:
//   1. Try splitting evenly — if every source has room for its even share,
//      keep the even split (least surprise, matches current behavior).
//   2. Otherwise fall back to a greedy pack: give the sources with the most
//      headroom as much as they can take first, so one source with enough
//      room alone can cover the whole thing even if an even split wouldn't
//      fit everywhere.
// Returns an array of { id, monthly } (one entry per source, in `sources`
// order) on success, or null if total headroom across the sources is too
// small no matter how it's divided.
export function allocateAcrossSources(neededMonthly, sources) {
  if (!sources.length) return neededMonthly <= 0.005 ? [] : null;
  const evenShare = neededMonthly / sources.length;
  if (sources.every((s) => evenShare <= s.headroomMonthly + 0.005)) {
    return sources.map((s) => ({ id: s.id, monthly: evenShare }));
  }
  const totalHeadroom = sources.reduce((sum, s) => sum + s.headroomMonthly, 0);
  if (neededMonthly > totalHeadroom + 0.005) return null;
  const byRoom = [...sources].sort((a, b) => b.headroomMonthly - a.headroomMonthly);
  let remaining = neededMonthly;
  const give = new Map();
  for (const s of byRoom) {
    const amt = Math.max(0, Math.min(remaining, s.headroomMonthly));
    give.set(s.id, amt);
    remaining -= amt;
  }
  return sources.map((s) => ({ id: s.id, monthly: give.get(s.id) ?? 0 }));
}

// Can the paychecks actually pay for this category at `dollars`/mo?
//   • Category funded by paycheck splits → the new monthly amount must fit
//     somewhere across those sources' headroom — evenly if possible, or with
//     one source covering more than the others if that's what it takes. A
//     source with no check amount set can't be verified, so it's only a
//     blocker if the verified sources' room isn't enough on their own.
//   • Category not funded by any split → the increase must fit within the
//     paychecks' unassigned money for the month.
// Lowering a budget is always allowed. Returns { perCheck, problems,
// allocation } where each problem is { name, message } and `allocation` (only
// set when there are no problems and the category is split-funded) is
// [{ id, monthly }] — the per-source monthly amount to save.
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
    const verified = funding.filter((p) => (p.checkAmount || 0) > 0);
    const unverified = funding.filter((p) => !((p.checkAmount || 0) > 0));

    // Headroom per source, excluding this category's own current split.
    const sources = verified.map((p) => {
      const check = p.checkAmount;
      const otherSplits = (p.defaultSplits ?? [])
        .filter((s) => s.categoryId !== cat.id)
        .reduce((sum, s) => sum + splitDollars(s, check), 0);
      const headroomPerCheck = Math.max(0, check - otherSplits);
      return { id: p.id, name: p.name, headroomMonthly: headroomPerCheck * CHECKS_PER_SOURCE };
    });

    const allocation = allocateAcrossSources(dollars, sources);

    if (allocation) {
      // Verified sources alone can cover it — unverified sources aren't needed,
      // so they're not a blocker even though we can't confirm their money.
      return { perCheck, problems, allocation };
    }

    if (unverified.length) {
      for (const p of unverified) {
        problems.push({ name: p.name, message: 'no paycheck amount is set, so there is no way to confirm the money is there. Set it on the Income page first.' });
      }
      return { perCheck, problems };
    }

    // Verified sources exist but their combined headroom isn't enough.
    const totalHeadroom = sources.reduce((sum, s) => sum + s.headroomMonthly, 0);
    const oldTotal = verified.reduce((sum, p) => sum + totals(p, false), 0);
    problems.push({
      name: verified.length > 1 ? 'All paychecks that fund this' : verified[0].name,
      message: `only ${money(totalHeadroom)}/mo is free across the paycheck${verified.length > 1 ? 's' : ''} that fund this, but this needs ${money(dollars - oldTotal)}/mo more (${money(dollars - oldTotal - totalHeadroom)} short).`,
    });
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

// Is this income source currently over-allocated (its splits add up to more
// than its paycheck)? { total, overage } in dollars/check; overage <= 0 means
// it's fine.
export function profileOverage(profile) {
  const check = profile?.checkAmount || 0;
  const total = (profile?.defaultSplits ?? []).reduce((sum, s) => sum + splitDollars(s, check), 0);
  return { total, overage: total - check };
}

// Build a plan to fix an over-allocated income source by moving money on its
// SHARED categories (ones also split on another source) to wherever there's
// room — the same even-then-greedy allocation used for a category budget
// raise, applied per category until the overage is gone or there's nothing
// left to try. Never invents a split on a source that doesn't already have
// one for that category (same rule as everywhere else in this file) — a
// category funded ONLY by the over-allocated source can't be moved
// automatically and is left alone.
//
// Returns { overage, resolved, remaining, moves, updatedProfiles } where:
//   overage          — how over the source was per check, in dollars
//   resolved         — true if the plan eliminates the overage entirely
//   remaining        — per-check overage still left after the plan (0 if resolved)
//   moves            — [{ categoryId, categoryName, changes: [{ id, name, before, after }] }]
//   updatedProfiles  — [{ id, defaultSplits }] ready to PUT, one per touched profile
export function planRebalanceOverage(profileId, profiles) {
  const target = (profiles ?? []).find((p) => p.id === profileId);
  if (!target) return null;

  const { overage } = profileOverage(target);
  if (overage <= 0.005) return { overage: 0, resolved: true, remaining: 0, moves: [], updatedProfiles: [] };

  // Working copy of every profile's splits — mutated as moves are found, so
  // later categories see the room freed up (or used) by earlier ones.
  const work   = new Map((profiles ?? []).map((p) => [p.id, (p.defaultSplits ?? []).map((s) => ({ ...s }))]));
  const checkOf = new Map((profiles ?? []).map((p) => [p.id, p.checkAmount || 0]));
  const nameOf  = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  const targetCats = (work.get(profileId) ?? [])
    .filter((s) => s.categoryId)
    .sort((a, b) => splitDollars(b, checkOf.get(profileId)) - splitDollars(a, checkOf.get(profileId)));

  const moves = [];

  const currentTargetOverage = () => {
    const total = (work.get(profileId) ?? []).reduce((sum, s) => sum + splitDollars(s, checkOf.get(profileId)), 0);
    return total - checkOf.get(profileId);
  };

  for (const s of targetCats) {
    if (currentTargetOverage() <= 0.005) break;
    const catId = s.categoryId;
    const funding = (profiles ?? []).filter((p) => (work.get(p.id) ?? []).some((x) => x.categoryId === catId));
    if (funding.length < 2) continue; // not shared with any other source — nowhere to move it

    const totalMonthly = funding.reduce((sum, p) => {
      const sp = (work.get(p.id) ?? []).find((x) => x.categoryId === catId);
      return sum + splitDollars(sp, checkOf.get(p.id)) * CHECKS_PER_SOURCE;
    }, 0);

    const sources = funding.map((p) => {
      const otherTotal = (work.get(p.id) ?? [])
        .filter((x) => x.categoryId !== catId)
        .reduce((sum, x) => sum + splitDollars(x, checkOf.get(p.id)), 0);
      const headroomPerCheck = Math.max(0, checkOf.get(p.id) - otherTotal);
      return { id: p.id, headroomMonthly: headroomPerCheck * CHECKS_PER_SOURCE };
    });

    const allocation = allocateAcrossSources(totalMonthly, sources);
    if (!allocation) continue; // can't even keep this category fully funded elsewhere — leave it

    const changes = [];
    for (const a of allocation) {
      const perCheck = parseFloat((a.monthly / CHECKS_PER_SOURCE).toFixed(2));
      const list = work.get(a.id);
      const idx  = list.findIndex((x) => x.categoryId === catId);
      const before = list[idx].value ?? 0;
      if (Math.abs(before - perCheck) < 0.005) continue;
      list[idx] = { ...list[idx], type: 'amount', value: perCheck };
      changes.push({ id: a.id, name: nameOf.get(a.id), before, after: perCheck });
    }
    // Only count it as a move if it actually reduced the target's share.
    const targetChange = changes.find((c) => c.id === profileId);
    if (!changes.length || !targetChange || targetChange.after >= targetChange.before - 0.005) continue;

    moves.push({ categoryId: catId, categoryName: s.name || catId, changes });
  }

  const remaining = Math.max(0, currentTargetOverage());
  const updatedProfiles = [...new Set(moves.flatMap((m) => m.changes.map((c) => c.id)))]
    .map((id) => ({ id, defaultSplits: work.get(id) }));

  return { overage, resolved: remaining <= 0.005, remaining, moves, updatedProfiles };
}

// Persist a planRebalanceOverage() plan — writes each touched profile's full
// updated defaultSplits (other fields unchanged).
export async function applyRebalance(plan, profiles) {
  for (const { id, defaultSplits } of plan.updatedProfiles) {
    const p = (profiles ?? []).find((x) => x.id === id);
    if (!p) continue;
    await api.put(`/rules/profiles/${id}`, { ...p, defaultSplits });
  }
}

// What applyMonthlyBudget would actually write to each funding profile's
// split for this category, without saving anything. Same allocation logic
// the save path uses (checkPaycheckRoom's uneven-if-needed allocation on a
// raise, plain even split on a lower or an unchanged amount) — shared so the
// preview can never drift from what a commit actually does. Returns null if
// the category isn't funded by any paycheck split, else
// [{ id, name, perCheck }] in `profiles` order.
export function previewSplitAllocation({ cat, dollars, currentDollars, profiles }) {
  const affected = (profiles ?? []).filter((p) =>
    (p.defaultSplits ?? []).some((s) => s.categoryId === cat.id));
  if (!affected.length) return null;

  const { allocation } = checkPaycheckRoom({ cat, dollars, currentDollars, profiles });
  const perCheck = perCheckFor(dollars, profiles);
  const monthlyById = new Map(
    (allocation ?? affected.map((p) => ({ id: p.id, monthly: perCheck * CHECKS_PER_SOURCE })))
      .map((a) => [a.id, a.monthly])
  );
  return affected.map((p) => ({
    id: p.id,
    name: p.name,
    perCheck: parseFloat(((monthlyById.get(p.id) ?? 0) / CHECKS_PER_SOURCE).toFixed(2)),
  }));
}

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
  // SAFETY: never overwrite a good split value with $0 for the whole category
  // — skip if the new monthly total itself is 0. Per-source amounts within a
  // nonzero category CAN land on $0 (e.g. one source covers all of it) —
  // that's intentional, not the thing this guard protects against.
  try {
    if (dollars <= 0) throw new Error('skip — $0 monthly would zero out splits');

    const preview = previewSplitAllocation({ cat, dollars, currentDollars, profiles }) ?? [];

    const summary = [];
    for (const { id, name, perCheck: perCheckDollars } of preview) {
      const p = profiles.find((x) => x.id === id);
      const updatedSplits = (p.defaultSplits ?? []).map((s) =>
        s.categoryId === cat.id ? { ...s, type: 'amount', value: perCheckDollars } : s
      );
      // Safety: never add or remove splits
      if (updatedSplits.length !== (p.defaultSplits ?? []).length) continue;
      console.log('[auto-recalc]', name, 'before:', p.defaultSplits, 'after:', updatedSplits);
      await api.put(`/rules/profiles/${id}`, { ...p, defaultSplits: updatedSplits });
      summary.push(`${name} $${perCheckDollars.toFixed(2)}/check`);
    }

    if (preview.length > 0) {
      notifications.show({
        title: 'Splits auto-updated',
        message: `${cat.name} → ${summary.join(', ')}`,
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
