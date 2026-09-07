import { Router } from 'express';
import {
  getRules, saveRule, updateRule, deleteRule,
  getProfiles, saveProfile, updateProfile, deleteProfile,
  getBudgetOverrides, setBudgetOverride,
  getSplitHistory, saveSplitHistory,
} from '../services/rules.js';
import { getDb } from '../services/db.js';

const router = Router();

// Budget overrides (local monthly reference amounts — never written to YNAB)
router.get('/budget-overrides', async (req, res) => {
  try {
    const overrides = await getBudgetOverrides();
    res.json(overrides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/budget-overrides/:categoryId', async (req, res) => {
  try {
    const { milliunits } = req.body;
    if (milliunits === undefined) return res.status(400).json({ error: 'milliunits required' });
    await setBudgetOverride(req.params.categoryId, Math.round(milliunits));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/budget-overrides/:categoryId', (req, res) => {
  try {
    const db = getDb();
    const { categoryId } = req.params;
    db.prepare('DELETE FROM budget_overrides WHERE category_id = ?').run(categoryId);
    db.prepare('DELETE FROM bva_tracking   WHERE category_id = ?').run(categoryId);
    db.prepare(`INSERT OR REPLACE INTO hidden_categories (category_id, hidden_at)
                VALUES (?, datetime('now'))`).run(categoryId);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/hidden-categories', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT category_id FROM hidden_categories').all();
    res.json(rows.map(r => r.category_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a hidden category (un-delete)
router.delete('/hidden-categories/:categoryId', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM hidden_categories WHERE category_id = ?').run(req.params.categoryId);
    res.json({ restored: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual income assignments — mark an income transaction "assigned" locally
// without allocating any money. Never written to YNAB.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/manual-assignments', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT transaction_id FROM manual_income_assignments').all();
    res.json(rows.map(r => r.transaction_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/manual-assignments/:txnId', (req, res) => {
  try {
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO manual_income_assignments (transaction_id, assigned_at)
                VALUES (?, datetime('now'))`).run(req.params.txnId);
    res.json({ transaction_id: req.params.txnId, assigned: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/manual-assignments/:txnId', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM manual_income_assignments WHERE transaction_id = ?').run(req.params.txnId);
    res.json({ transaction_id: req.params.txnId, assigned: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Split History (must be declared BEFORE /:id to avoid route collisions)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/split-history', async (req, res) => {
  try {
    res.json(await getSplitHistory());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/split-history', async (req, res) => {
  try {
    const { transactionId, profileId, profileName, totalAmount, splits } = req.body;
    if (!transactionId || !profileId || !splits) {
      return res.status(400).json({ error: 'transactionId, profileId, and splits are required' });
    }
    const result = await saveSplitHistory(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Paycheck Profiles  (must be declared BEFORE /:id to avoid route collisions)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profiles', async (req, res) => {
  try {
    res.json(await getProfiles());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profiles', async (req, res) => {
  try {
    res.json(await saveProfile(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profiles/:id', async (req, res) => {
  try {
    res.json(await updateProfile(req.params.id, req.body));
  } catch (err) {
    res.status(err.message === 'Profile not found' ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/profiles/:id', async (req, res) => {
  try {
    await deleteProfile(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BvA tracking — which categories appear on Budget vs Actual report
// (must be declared BEFORE /:id to avoid route collisions)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bva-tracking', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT category_id, enabled FROM bva_tracking').all();
    // Return as { categoryId: boolean } map
    const map  = {};
    rows.forEach(r => { map[r.category_id] = r.enabled === 1; });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/bva-tracking/:categoryId', (req, res) => {
  try {
    const db      = getDb();
    const catId   = req.params.categoryId;
    const enabled = req.body.enabled === true ? 1 : 0;
    db.prepare(`
      INSERT INTO bva_tracking (category_id, enabled, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(category_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(catId, enabled);
    res.json({ category_id: catId, enabled: enabled === 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Rules CRUD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    res.json(await getRules());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    res.json(await saveRule(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    res.json(await updateRule(req.params.id, req.body));
  } catch (err) {
    res.status(err.message === 'Rule not found' ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
