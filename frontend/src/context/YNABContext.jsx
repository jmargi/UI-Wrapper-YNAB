import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { notifications } from '@mantine/notifications';

const YNABContext = createContext(null);

// Use relative URLs so the app works from any host (localhost, LAN, Tailscale).
// Vite's dev proxy forwards /api and /socket.io to the backend on the same machine.
const API_URL = import.meta.env.VITE_API_URL ?? '';
const WS_URL  = import.meta.env.VITE_WS_URL  ?? '';

export const api = axios.create({ baseURL: `${API_URL}/api` });

export function YNABProvider({ children }) {
  const [budgets, setBudgets] = useState([]);
  const [activeBudgetId, setActiveBudgetId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [budgetOverrides, setBudgetOverrides] = useState({}); // { [categoryId]: milliunits } — SQLite, never YNAB
  const socketRef = useRef(null);

  // Load budget overrides from SQLite on startup
  useEffect(() => {
    api.get('/rules/budget-overrides')
      .then((res) => setBudgetOverrides(res.data ?? {}))
      .catch((err) => console.error('[budgetOverrides] Failed to load:', err.message));
  }, []);

  const saveBudgetOverride = useCallback(async (categoryId, milliunits) => {
    setBudgetOverrides((prev) => ({ ...prev, [categoryId]: milliunits }));
    try {
      await api.put(`/rules/budget-overrides/${categoryId}`, { milliunits });
    } catch (err) {
      console.error('[budgetOverrides] Failed to save:', err.message);
    }
  }, []);

  // Merge delta transactions into existing list
  const mergeTransactions = useCallback((delta) => {
    if (!delta || delta.length === 0) return;
    setTransactions((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]));
      delta.forEach((t) => {
        if (t.deleted) {
          map.delete(t.id);
        } else {
          map.set(t.id, t);
        }
      });
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
    });
    setLastSync(new Date());
  }, []);

  // Initial data load
  const loadInitialData = useCallback(async (budgetId) => {
    if (!budgetId) return;
    setLoading(true);
    try {
      const [txnRes, catRes, accRes] = await Promise.all([
        api.get('/transactions', { params: { budgetId } }),
        api.get('/categories', { params: { budgetId } }),
        api.get('/accounts', { params: { budgetId } }),
      ]);
      setTransactions(
        (txnRes.data.transactions || []).sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        )
      );
      setCategories(txnRes.data.categories || catRes.data);
      setAccounts(accRes.data);
    } catch (err) {
      notifications.show({
        title: 'Error loading data',
        message: err.message,
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch budgets on mount – default to the most-recently-modified one (i.e. 2025)
  // Also tell the backend which budget is active so PUT/DELETE calls use the right one.
  useEffect(() => {
    api.get('/budgets').then((res) => {
      const sorted = [...res.data].sort(
        (a, b) => new Date(b.last_modified_on) - new Date(a.last_modified_on)
      );
      setBudgets(sorted);
      if (sorted.length > 0) {
        const defaultId = sorted[0].id;
        setActiveBudgetId(defaultId);
        // Sync backend active budget so unauthenticated PUT/DELETE routes work correctly
        api.post(`/budgets/select/${defaultId}`).catch(console.error);
      }
    }).catch(console.error);
  }, []);

  // Load data when active budget changes
  useEffect(() => {
    if (activeBudgetId) {
      loadInitialData(activeBudgetId);
    }
  }, [activeBudgetId, loadInitialData]);

  // Also load categories separately
  useEffect(() => {
    if (!activeBudgetId) return;
    api.get('/categories', { params: { budgetId: activeBudgetId } })
      .then((res) => setCategories(res.data))
      .catch(console.error);
  }, [activeBudgetId]);

  // Socket.io
  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      notifications.show({ title: 'Live sync active', message: 'Connected to YNAB poller', color: 'teal', autoClose: 2000 });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('transactions:delta', ({ transactions: delta, autoActions }) => {
      mergeTransactions(delta);
      if (autoActions && autoActions.length > 0) {
        autoActions.forEach((action) => {
          notifications.show({
            title: `Rule applied: ${action.ruleName}`,
            message: `Auto-split applied to transaction`,
            color: 'blue',
          });
        });
      }
    });

    socket.on('rules:applied', (actions) => {
      console.log('Rules auto-applied:', actions);
    });

    socket.on('poller:error', ({ message }) => {
      notifications.show({ title: 'Sync error', message, color: 'orange' });
    });

    return () => socket.disconnect();
  }, [mergeTransactions]);

  const triggerSync = useCallback(() => {
    socketRef.current?.emit('poll:trigger');
  }, []);

  // Optimistically update a single category's budgeted amount in context
  const mergeCategoryBudget = useCallback((categoryId, newBudgetedMilliunits) => {
    setCategories((prev) =>
      prev.map((group) => ({
        ...group,
        categories: (group.categories || []).map((cat) =>
          cat.id === categoryId ? { ...cat, budgeted: newBudgetedMilliunits } : cat
        ),
      }))
    );
  }, []);

  const selectBudget = useCallback((budgetId) => {
    setActiveBudgetId(budgetId);
    socketRef.current?.emit('budget:select', budgetId);
    api.post(`/budgets/select/${budgetId}`);
  }, []);

  // Flatten categories – strip hidden groups, internal system groups, and hidden/deleted categories
  const HIDDEN_GROUPS = ['Internal Master Category', 'Hidden Categories', 'Credit Card Payments'];
  const flatCategories = categories
    .filter(
      (group) =>
        !group.hidden &&
        !group.deleted &&
        !HIDDEN_GROUPS.includes(group.name)
    )
    .flatMap((group) =>
      (group.categories || [])
        .filter((cat) => !cat.hidden && !cat.deleted)
        .map((cat) => ({ ...cat, groupName: group.name }))
    );

  return (
    <YNABContext.Provider
      value={{
        budgets,
        activeBudgetId,
        selectBudget,
        transactions,
        setTransactions,
        mergeTransactions,
        categories,
        flatCategories,
        mergeCategoryBudget,
        accounts,
        connected,
        lastSync,
        loading,
        triggerSync,
        loadInitialData,
        budgetOverrides,
        saveBudgetOverride,
      }}
    >
      {children}
    </YNABContext.Provider>
  );
}

export const useYNAB = () => {
  const ctx = useContext(YNABContext);
  if (!ctx) throw new Error('useYNAB must be used within YNABProvider');
  return ctx;
};
