import { Router } from 'express';
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  updateTransactions,
  deleteTransaction,
  createTransactions,
} from '../ynab/client.js';
import { getActiveBudgetId } from '../ynab/poller.js';

const router = Router();

const getBudgetId = (req) => req.query.budgetId || getActiveBudgetId();

// ── Category-assignment memo stamp ────────────────────────────────────────────
// Every transaction whose category is assigned through this app gets a memo note
// so it's traceable. Enforced HERE (the single choke point every write passes
// through) rather than at each frontend call site, so no caller can forget it.
// Keep ASSIGNED_NOTE in sync with frontend/src/utils/format.js.
const ASSIGNED_NOTE = 'Assigned in Budget App';

function stampAssignedMemo(memo) {
  if (memo && memo.includes(ASSIGNED_NOTE)) return memo; // don't double-stamp
  return memo ? `${memo} · ${ASSIGNED_NOTE}` : ASSIGNED_NOTE;
}

router.get('/', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });
    const { transactions, serverKnowledge } = await getTransactions(budgetId);
    res.json({ transactions, serverKnowledge });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });
    const { stampAssigned, ...body } = req.body;
    // Stamp when creating a transaction with a category via the app.
    if (stampAssigned && body.category_id) body.memo = stampAssignedMemo(body.memo);
    const txn = await createTransaction(budgetId, body);
    res.json(txn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });
    const txns = await createTransactions(budgetId, req.body.transactions);
    res.json(txns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update — categorize/approve many transactions with ONE YNAB API call.
// PATCH accepts partial objects: only id + the fields being changed.
router.patch('/bulk', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });

    const WRITABLE = ['id', 'category_id', 'approved', 'memo', 'cleared', 'flag_color'];
    const txns = (req.body.transactions || [])
      .map((t) => {
        const out = {};
        for (const key of WRITABLE) {
          if (t[key] !== undefined) out[key] = t[key];
        }
        // This endpoint exists to assign categories — any row that sets one gets
        // the memo stamp automatically (callers can't forget it). The frontend
        // sends the row's current memo so we append rather than overwrite.
        if (out.category_id) out.memo = stampAssignedMemo(out.memo);
        return out;
      })
      .filter((t) => t.id);

    if (!txns.length) return res.status(400).json({ error: 'transactions array with ids required' });

    const updated = await updateTransactions(budgetId, txns);
    res.json({ transactions: updated });
  } catch (err) {
    const ynabError = err.response?.data?.error;
    const message   = ynabError ? `YNAB: ${ynabError.name} — ${ynabError.detail}` : err.message;
    console.error(`[transactions PATCH /bulk]: ${message}`);
    res.status(500).json({ error: message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });

    // YNAB PUT requires account_id, date, amount, cleared plus any fields being changed.
    // The frontend must send the full transaction object merged with the updates.
    const WRITABLE = [
      'account_id', 'date', 'amount', 'payee_id', 'payee_name',
      'category_id', 'memo', 'cleared', 'approved', 'flag_color',
    ];
    const sanitized = {};
    for (const key of WRITABLE) {
      if (req.body[key] !== undefined) sanitized[key] = req.body[key];
    }

    // Stamp the memo when this write assigns a category. The frontend sets
    // stampAssigned only on real category-assignment actions (inline category
    // edit, modal category change) — not on unrelated edits like an amount fix,
    // which also carry category_id in the full-transaction body.
    if (req.body.stampAssigned && sanitized.category_id) {
      sanitized.memo = stampAssignedMemo(sanitized.memo);
    }

    // Guard: YNAB will 422 without the required fields
    if (!sanitized.account_id || !sanitized.date || sanitized.amount === undefined) {
      return res.status(400).json({
        error: 'Missing required YNAB fields: account_id, date, amount must be included in the request body.',
      });
    }

    const txn = await updateTransaction(budgetId, req.params.id, sanitized);
    res.json(txn);
  } catch (err) {
    // Surface the actual YNAB error body so the frontend can show it
    const ynabError = err.response?.data?.error;
    const message   = ynabError ? `YNAB: ${ynabError.name} — ${ynabError.detail}` : err.message;
    console.error(`[transactions PUT] ${req.params.id}: ${message}`);
    res.status(500).json({ error: message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const budgetId = getBudgetId(req);
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });
    const txn = await deleteTransaction(budgetId, req.params.id);
    res.json(txn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
