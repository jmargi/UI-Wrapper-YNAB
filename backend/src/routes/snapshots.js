import express from 'express';
import { getDb } from '../services/db.js';
import { getActiveBudgetId } from '../ynab/poller.js';
import client from '../ynab/client.js';

const router = express.Router();

// GET /api/snapshots — list months that have snapshots
router.get('/', (req, res) => {
  try {
    const rows = getDb()
      .prepare('SELECT DISTINCT month FROM budget_snapshots ORDER BY month DESC')
      .all();
    res.json(rows.map(r => r.month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/snapshots/:month — get snapshot data for a month (YYYY-MM)
router.get('/:month', (req, res) => {
  try {
    const rows = getDb()
      .prepare('SELECT * FROM budget_snapshots WHERE month = ? ORDER BY group_name, category_name')
      .all(req.params.month);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/snapshots — save a snapshot for a given month
// Body: { month: 'YYYY-MM', overrides: { categoryId: milliunits } }
router.post('/', async (req, res) => {
  try {
    const budgetId = getActiveBudgetId();
    const { month } = req.body; // e.g. '2026-03'
    const overrides = req.body.overrides ?? {};
    const monthStr = `${month}-01`;

    const ynabRes = await client.get(`/budgets/${budgetId}/months/${monthStr}`);
    const categories = ynabRes.data.data.month.categories;

    const EXCLUDED = new Set(['Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments']);
    const now = new Date().toISOString();

    const upsert = getDb().prepare(`
      INSERT INTO budget_snapshots
        (month, category_id, category_name, group_name, budgeted, activity, balance, override_milliunits, snapshotted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(month, category_id) DO UPDATE SET
        budgeted = excluded.budgeted,
        activity = excluded.activity,
        balance  = excluded.balance,
        override_milliunits = excluded.override_milliunits,
        snapshotted_at = excluded.snapshotted_at
    `);

    const insertMany = getDb().transaction((cats) => {
      for (const cat of cats) {
        if (cat.hidden || cat.deleted || EXCLUDED.has(cat.category_group_name)) continue;
        upsert.run(
          month,
          cat.id,
          cat.name,
          cat.category_group_name,
          cat.budgeted,
          cat.activity,
          cat.balance,
          overrides[cat.id] ?? null,
          now
        );
      }
    });

    insertMany(categories);

    const saved = getDb()
      .prepare('SELECT COUNT(*) as cnt FROM budget_snapshots WHERE month = ?')
      .get(month);

    res.json({ ok: true, month, count: saved.cnt });
  } catch (err) {
    console.error('[snapshots POST]', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.response?.data?.error?.detail ?? err.message });
  }
});

export default router;
