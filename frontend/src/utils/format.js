export const formatCurrency = (milliunits) => {
  if (milliunits === null || milliunits === undefined) return '$0.00';
  const value = milliunits / 1000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    signDisplay: 'auto',
  }).format(value);
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// Memo stamp added whenever a category is assigned to a transaction through
// this app. The backend enforces the same stamp (see backend/src/routes/
// transactions.js) — this copy is only for optimistic UI so the memo shows the
// stamp immediately. Keep the note text in sync with the backend constant.
export const ASSIGNED_NOTE = 'Assigned in Budget App';

export const stampAssignedMemo = (memo) => {
  if (memo && memo.includes(ASSIGNED_NOTE)) return memo;
  return memo ? `${memo} · ${ASSIGNED_NOTE}` : ASSIGNED_NOTE;
};
