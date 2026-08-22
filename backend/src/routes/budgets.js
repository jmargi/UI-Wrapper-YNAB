import { Router } from 'express';
import { getBudgets, getBudget, getBudgetMonth } from '../ynab/client.js';
import { setActiveBudgetId, getActiveBudgetId } from '../ynab/poller.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const budgets = await getBudgets();
    res.json(budgets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Specific named routes MUST come before /:id to avoid being swallowed by the param route
// GET /api/budgets/month?budgetId=xxx&month=2026-03  (defaults to current month)
router.get('/month', async (req, res) => {
  try {
    const budgetId = req.query.budgetId || getActiveBudgetId();
    const month = req.query.month || 'current';
    const data = await getBudgetMonth(budgetId, month);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/select/:id', (req, res) => {
  setActiveBudgetId(req.params.id);
  res.json({ success: true, budgetId: req.params.id });
});

router.get('/:id', async (req, res) => {
  try {
    const budget = await getBudget(req.params.id);
    res.json(budget);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
