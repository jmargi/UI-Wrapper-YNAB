import { Router } from 'express';
import { getAccounts } from '../ynab/client.js';
import { getActiveBudgetId } from '../ynab/poller.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const budgetId = req.query.budgetId || getActiveBudgetId();
    if (!budgetId) return res.status(400).json({ error: 'No budget selected' });
    const accounts = await getAccounts(budgetId);
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
