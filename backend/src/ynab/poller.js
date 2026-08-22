import { getTransactions, getBudgets } from './client.js';
import { getRules, applyRulesToTransaction } from '../services/rules.js';
import { getSetting, setSetting } from '../services/db.js';

let serverKnowledge = null;
let activeBudgetId = null;
let pollerInterval = null;

export const getActiveBudgetId = () => activeBudgetId;
export const setActiveBudgetId = (id) => {
  activeBudgetId = id;
  serverKnowledge = null; // reset knowledge on budget change
  try { setSetting('active_budget_id', id); } catch {}
};

export const startPoller = async (io) => {
  // Startup budget selection:
  // 1. Use last user-selected budget from DB
  // 2. Fall back to first non-archived budget
  // 3. Last resort: first budget regardless
  try {
    const budgets = await getBudgets();
    const stored  = getSetting('active_budget_id');
    const storedBudget = stored ? budgets.find((b) => b.id === stored) : null;

    let chosen;
    if (storedBudget) {
      chosen = storedBudget;
      console.log(`[poller] Restored last-used budget: ${chosen.name}`);
    } else {
      // Skip archived budgets (name contains 'archived', case-insensitive)
      const active = budgets.find((b) => !b.name.toLowerCase().includes('archived'));
      chosen = active ?? budgets[0];
      console.log(`[poller] Auto-selected budget: ${chosen?.name}`);
    }

    if (chosen) {
      activeBudgetId = chosen.id;
      console.log(`Active budget: ${chosen.name} (${activeBudgetId})`);
    }
  } catch (err) {
    console.error('Failed to fetch budgets on startup:', err.message);
  }

  const poll = async () => {
    if (!activeBudgetId) return;
    try {
      const { transactions, serverKnowledge: newKnowledge } = await getTransactions(
        activeBudgetId,
        serverKnowledge
      );

      if (transactions && transactions.length > 0) {
        // Check rules for unapproved/uncategorized inbound transactions
        const rules = await getRules();
        const autoActions = [];

        for (const txn of transactions) {
          const action = await applyRulesToTransaction(txn, rules, activeBudgetId);
          if (action) autoActions.push(action);
        }

        io.emit('transactions:delta', {
          transactions,
          serverKnowledge: newKnowledge,
          autoActions,
        });

        if (autoActions.length > 0) {
          io.emit('rules:applied', autoActions);
        }
      }

      serverKnowledge = newKnowledge;
    } catch (err) {
      console.error('Poller error:', err.message);
      io.emit('poller:error', { message: err.message });
    }
  };

  // Default 120s — YNAB allows 200 req/hr; polling every 30s burns 120/hr leaving only 80 for actions
  const interval = parseInt(process.env.YNAB_POLL_INTERVAL || '120000', 10);
  await poll(); // immediate first poll
  pollerInterval = setInterval(poll, interval);
  console.log(`Poller started: every ${interval / 1000}s`);
};

export const triggerPoll = async (io) => {
  if (!activeBudgetId) return;
  try {
    const { transactions, serverKnowledge: newKnowledge } = await getTransactions(
      activeBudgetId,
      serverKnowledge
    );
    serverKnowledge = newKnowledge;
    io.emit('transactions:delta', { transactions, serverKnowledge: newKnowledge, autoActions: [] });
  } catch (err) {
    console.error('Manual poll error:', err.message);
  }
};
