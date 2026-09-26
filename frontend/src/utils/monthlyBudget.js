import { notifications } from '@mantine/notifications';
import { api } from '../context/YNABContext';

// Save a category's monthly budget (local SQLite override — YNAB is NOT
// written to) and auto-recalculate the per-check splits of every income
// profile that funds it. Shared by the Budget page editor and the reports.
//   cat     — { id, name }
//   dollars — new monthly amount
export async function applyMonthlyBudget({ cat, dollars, profiles, saveBudgetOverride, onReload }) {
  // Persist to SQLite via API — YNAB is NOT written to.
  await saveBudgetOverride(cat.id, Math.round(dollars * 1000));

  // ── Auto-recalculate per-check splits in all profiles that use this category ──
  // SAFETY: never overwrite a good split value with $0 — skip if new monthly is 0
  try {
    if (dollars <= 0) throw new Error('skip — $0 monthly would zero out splits');

    const CHECKS_PER_SOURCE = 2;
    const numSources = (profiles?.length ?? 1) || 1;
    const perCheckDivisor = numSources * CHECKS_PER_SOURCE;
    const newPerCheck = parseFloat((dollars / perCheckDivisor).toFixed(2));

    if (newPerCheck <= 0) throw new Error('skip — per-check would be $0');

    const affected = (profiles ?? []).filter((p) =>
      (p.defaultSplits ?? []).some((s) => s.categoryId === cat.id)
    );

    for (const p of affected) {
      const updatedSplits = (p.defaultSplits ?? []).map((s) =>
        s.categoryId === cat.id ? { ...s, value: newPerCheck } : s
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
}
