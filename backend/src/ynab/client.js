import axios from 'axios';

const BASE_URL = 'https://api.ynab.com/v1';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.YNAB_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

export const getBudgets = async () => {
  const res = await client.get('/budgets');
  return res.data.data.budgets;
};

export const getBudget = async (budgetId) => {
  const res = await client.get(`/budgets/${budgetId}`);
  return res.data.data.budget;
};

export const getAccounts = async (budgetId) => {
  const res = await client.get(`/budgets/${budgetId}/accounts`);
  return res.data.data.accounts;
};

export const getCategories = async (budgetId) => {
  const res = await client.get(`/budgets/${budgetId}/categories`);
  return res.data.data.category_groups;
};

export const getTransactions = async (budgetId, serverKnowledge = null) => {
  const params = {};
  if (serverKnowledge !== null) params.last_knowledge_of_server = serverKnowledge;
  const res = await client.get(`/budgets/${budgetId}/transactions`, { params });
  return {
    transactions: res.data.data.transactions,
    serverKnowledge: res.data.data.server_knowledge,
  };
};

export const createTransaction = async (budgetId, transaction) => {
  const res = await client.post(`/budgets/${budgetId}/transactions`, {
    transaction,
  });
  return res.data.data.transaction;
};

export const updateTransaction = async (budgetId, transactionId, transaction) => {
  const res = await client.put(`/budgets/${budgetId}/transactions/${transactionId}`, {
    transaction,
  });
  return res.data.data.transaction;
};

export const deleteTransaction = async (budgetId, transactionId) => {
  const res = await client.delete(`/budgets/${budgetId}/transactions/${transactionId}`);
  return res.data.data.transaction;
};

// Bulk-update many transactions in ONE YNAB API call. Unlike single PUT,
// PATCH accepts partial objects — just id + the fields being changed.
export const updateTransactions = async (budgetId, transactions) => {
  const res = await client.patch(`/budgets/${budgetId}/transactions`, { transactions });
  return res.data.data.transactions;
};

export const createTransactions = async (budgetId, transactions) => {
  const res = await client.post(`/budgets/${budgetId}/transactions`, {
    transactions,
  });
  return res.data.data.transactions;
};

export const getPayees = async (budgetId) => {
  const res = await client.get(`/budgets/${budgetId}/payees`);
  return res.data.data.payees;
};

export const getBudgetMonth = async (budgetId, month = 'current') => {
  const res = await client.get(`/budgets/${budgetId}/months/${month}`);
  return res.data.data.month;
};

// Create a new category in a group
export const createCategory = async (budgetId, categoryGroupId, name, note = null) => {
  const body = { category: { category_group_id: categoryGroupId, name } };
  if (note) body.category.note = note;
  const res = await client.post(`/budgets/${budgetId}/categories`, body);
  return res.data.data.category;
};

// Update a category's budgeted amount for a given month
export const updateCategoryMonth = async (budgetId, month, categoryId, budgeted) => {
  const res = await client.patch(
    `/budgets/${budgetId}/months/${month}/categories/${categoryId}`,
    { category: { budgeted } }
  );
  return res.data.data.category;
};

export default client;
