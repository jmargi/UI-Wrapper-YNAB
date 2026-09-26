import { useMemo } from 'react';
import { useYNAB } from '../context/YNABContext';

// Suggested new monthly budget: cover the average spend with a small buffer,
// rounded up to the nearest $5 so the number is easy to act on.
export const suggestBudget = (avgMonthly) => Math.max(5, Math.ceil(avgMonthly / 5) * 5);

// Outflow totals per category over the last 30 / 60 / 90 days, computed from
// the synced transaction list. Returns { [categoryId]: { s30, s60, s90 } } in
// milliunits (positive = money spent).
export function useCategorySpend() {
  const { transactions } = useYNAB();
  // Spend per category across all three windows, in one pass over transactions.
  // YNAB outflows are negative milliunits; income/transfers are excluded.
  return useMemo(() => {
    const now = new Date();
    const dayMs = 86_400_000;
    const cut30 = new Date(now.getTime() - 30 * dayMs).toISOString().slice(0, 10);
    const cut60 = new Date(now.getTime() - 60 * dayMs).toISOString().slice(0, 10);
    const cut90 = new Date(now.getTime() - 90 * dayMs).toISOString().slice(0, 10);

    const map = {}; // categoryId → { s30, s60, s90 } in milliunits
    const bucketFor = (catId) => {
      if (!map[catId]) map[catId] = { s30: 0, s60: 0, s90: 0 };
      return map[catId];
    };

    for (const t of transactions) {
      if (t.deleted || t.transfer_account_id) continue;
      if (!t.date || t.date < cut90) continue;

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
        if (t.date >= cut30)      { bucket.s30 += spend; bucket.s60 += spend; bucket.s90 += spend; }
        else if (t.date >= cut60) {                      bucket.s60 += spend; bucket.s90 += spend; }
        else                      {                                           bucket.s90 += spend; }
      }
    }
    return map;
  }, [transactions]);
}
