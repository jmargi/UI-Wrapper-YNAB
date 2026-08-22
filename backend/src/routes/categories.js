import { Router } from 'express';
import { getCategories, updateCategoryMonth, createCategory } from '../ynab/client.js';
import { getActiveBudgetId } from '../ynab/poller.js';

const router = Router();

const HIDDEN_GROUP_NAMES = ['Internal Master Category', 'Hidden Categories', 'Credit Card Payments'];

router.get('/', async (req, res) => {
  try {
    const budgetId = req.query.budgetId || getActiveBudgetId();
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });

    const groups = await getCategories(budgetId);

    // Strip hidden/deleted groups and their hidden/deleted categories
    const visible = groups
      .filter(
        (g) =>
          !g.hidden &&
          !g.deleted &&
          !HIDDEN_GROUP_NAMES.includes(g.name)
      )
      .map((g) => ({
        ...g,
        categories: (g.categories || []).filter((c) => !c.hidden && !c.deleted),
      }))
      .filter((g) => g.categories.length > 0); // drop groups with no visible categories

    res.json(visible);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/categories — create a new category in YNAB
// Body: { categoryGroupId: string, name: string, note?: string }
router.post('/', async (req, res) => {
  try {
    const budgetId = req.query.budgetId || getActiveBudgetId();
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });

    const { categoryGroupId, name, note } = req.body;
    if (!categoryGroupId || !name?.trim()) {
      return res.status(400).json({ error: 'categoryGroupId and name are required' });
    }

    const category = await createCategory(budgetId, categoryGroupId, name.trim(), note?.trim() || null);
    res.status(201).json(category);
  } catch (err) {
    const ynabError = err.response?.data?.error;
    const status    = err.response?.status;
    const message   = ynabError ? `YNAB: ${ynabError.name} — ${ynabError.detail}` : err.message;
    console.error(`[categories POST] ${message}`);
    res.status(status ?? 500).json({ error: message });
  }
});

// PATCH /api/categories/:categoryId/budget
// Body: { budgeted: <milliunits>, month: 'YYYY-MM' (optional, defaults to current) }
router.patch('/:categoryId/budget', async (req, res) => {
  try {
    const budgetId  = req.query.budgetId || getActiveBudgetId();
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });

    const { categoryId } = req.params;
    const { budgeted, month } = req.body;

    // month format YNAB expects: YYYY-MM-01
    const now       = new Date();
    const monthStr  = month
      ? `${month}-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const updated = await updateCategoryMonth(budgetId, monthStr, categoryId, Math.round(budgeted));
    res.json(updated);
  } catch (err) {
    const ynabError = err.response?.data?.error;
    const status    = err.response?.status;
    const message   = ynabError ? `YNAB: ${ynabError.name} — ${ynabError.detail}` : err.message;
    console.error(`[categories PATCH budget] ${req.params.categoryId}: ${message}`);
    // Pass 429 through so the frontend can show a helpful message
    res.status(status === 429 ? 429 : 500).json({ error: message });
  }
});

export default router;
