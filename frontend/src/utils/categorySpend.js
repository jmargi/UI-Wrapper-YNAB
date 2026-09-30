import { useMemo } from 'react';
import { useYNAB } from '../context/YNABContext';

// Suggested new monthly budget: cover the average spend with a small buffer,
// rounded up to the nearest $5 so the number is easy to act on.
export const suggestBudget = (avgMonthly) => Math.max(5, Math.ceil(avgMonthly / 5) * 5);

// Outflow totals per category over the last 30 / 60 / 90 / 180 / 365 days,
// computed from the synced transaction list. Returns
// { [categoryId]: { s30, s60, s90, s180, s365 } } in milliunits (positive =
// money spent).
const WINDOWS = [30, 60, 90, 180, 365];

export function useCategorySpend() {
  const { transactions } = useYNAB();
  // Spend per category across all windows, in one pass over transactions.
  // YNAB outflows are negative milliunits; income/transfers are excluded.
  return useMemo(() => {
    const now = new Date();
    const dayMs = 86_400_000;
    const cuts = WINDOWS.map((d) => new Date(now.getTime() - d * dayMs).toISOString().slice(0, 10));
    const furthestCut = cuts[cuts.length - 1];

    const map = {}; // categoryId → { s30, s60, s90, s180, s365 } in milliunits
    const bucketFor = (catId) => {
      if (!map[catId]) map[catId] = Object.fromEntries(WINDOWS.map((d) => [`s${d}`, 0]));
      return map[catId];
    };

    for (const t of transactions) {
      if (t.deleted || t.transfer_account_id) continue;
      if (!t.date || t.date < furthestCut) continue;

      // Handle split transactions: a parent with subtransactions carries no
      // category itself — attribute each child to its own category.
      const legs = Array.isArray(t.subtransactions) && t.subtransactions.length
        ? t.subtransactions
        : [t];

      for (const leg of legs) {
        const catId = leg.category_id;
        const amt   = leg.amount ?? 0;
        if (!catId || amt >= 0) continue; // outflows only
        const spend = Math.abs(amt);
        const bucket = bucketFor(catId);
        // A transaction within window N is also within every wider window.
        for (let i = 0; i < WINDOWS.length; i++) {
          if (t.date < cuts[i]) continue;
          bucket[`s${WINDOWS[i]}`] += spend;
        }
      }
    }
    return map;
  }, [transactions]);
}
