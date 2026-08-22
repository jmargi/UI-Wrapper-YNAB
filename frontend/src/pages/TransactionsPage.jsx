import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Stack, Title, Group, Button, TextInput, Select, Badge,
  Table, Text, ActionIcon, Tooltip, Modal, NumberInput,
  Textarea, Checkbox, Skeleton, Pagination, SegmentedControl,
  Box, HoverCard, Divider, ThemeIcon, Paper,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import DateRangeFilter from '../components/DateRangeFilter';
import CategoryPicker from '../components/CategoryPicker';
import usePersistentState from '../utils/usePersistentState';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconEdit, IconTrash, IconPlus, IconCheck, IconSearch, IconX,
  IconCircleCheck, IconClock, IconLock, IconInfoCircle,
} from '@tabler/icons-react';
import { useYNAB, api } from '../context/YNABContext';
import { formatCurrency, formatDate } from '../utils/format';

const PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Transaction modal  (create or edit via a full form)
// ─────────────────────────────────────────────────────────────────────────────
function TransactionModal({ opened, onClose, transaction, onSaved }) {
  const { accounts, flatCategories, mergeTransactions } = useYNAB();
  const isEdit = !!transaction;

  const [form, setForm] = useState({
    account_id:  '',
    date:        new Date(),
    payee_name:  '',
    category_id: null,
    memo:        '',
    amount:      0,
    cleared:     'uncleared',
    approved:    false,
  });

  // Re-populate the form every time `transaction` changes (fixes autofill on edit)
  useEffect(() => {
    setForm({
      account_id:  transaction?.account_id  || '',
      date:        transaction?.date
                     ? new Date(transaction.date + 'T12:00:00')
                     : new Date(),
      payee_name:  transaction?.payee_name  || '',
      category_id: transaction?.category_id || null,
      memo:        transaction?.memo        || '',
      amount:      transaction ? transaction.amount / 1000 : 0,
      cleared:     transaction?.cleared     || 'uncleared',
      approved:    transaction?.approved    || false,
    });
  }, [transaction, opened]);

  const handleSave = async () => {
    if (!form.account_id)
      return notifications.show({ title: 'Account required', color: 'red' });
    try {
      const payload = {
        ...form,
        date:   form.date instanceof Date
                  ? form.date.toISOString().split('T')[0]
                  : form.date,
        amount: Math.round(form.amount * 1000),
      };
      if (isEdit) {
        // Optimistic update — reflect in UI immediately
        mergeTransactions([{ ...transaction, ...payload }]);
        await api.put(`/transactions/${transaction.id}`, payload);
        notifications.show({ title: 'Transaction updated', color: 'teal' });
      } else {
        const res = await api.post('/transactions', payload);
        // Add new transaction to context immediately (no page refresh needed)
        if (res.data?.transaction) mergeTransactions([res.data.transaction]);
        else onSaved(); // fallback re-fetch if API doesn't return the new txn
        notifications.show({ title: 'Transaction created', color: 'teal' });
      }
      onClose();
    } catch (err) {
      // Roll back optimistic edit
      if (isEdit) mergeTransactions([transaction]);
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? 'Edit Transaction' : 'New Transaction'}
      size="md"
    >
      <Stack>
        <Select
          label="Account"
          required
          data={accounts.map((a) => ({ value: a.id, label: a.name }))}
          value={form.account_id}
          onChange={(v) => setForm((f) => ({ ...f, account_id: v }))}
          searchable
        />
        <DatePickerInput
          label="Date"
          required
          value={form.date}
          onChange={(v) => setForm((f) => ({ ...f, date: v }))}
        />
        <TextInput
          label="Payee"
          value={form.payee_name}
          onChange={(e) => setForm((f) => ({ ...f, payee_name: e.target.value }))}
        />
        <CategoryPicker
          label="Category"
          categories={flatCategories}
          value={form.category_id}
          onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
        />
        <NumberInput
          label="Amount  (negative = outflow)"
          value={form.amount}
          onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
          decimalScale={2}
          prefix="$"
        />
        <Textarea
          label="Memo"
          value={form.memo}
          onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
          rows={2}
        />
        <Select
          label="Cleared status"
          data={[
            { value: 'uncleared',   label: 'Uncleared'   },
            { value: 'cleared',     label: 'Cleared'      },
            { value: 'reconciled',  label: 'Reconciled'   },
          ]}
          value={form.cleared}
          onChange={(v) => setForm((f) => ({ ...f, cleared: v }))}
        />
        <Checkbox
          label="Approved"
          checked={form.approved}
          onChange={(e) => setForm((f) => ({ ...f, approved: e.currentTarget.checked }))}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover detail card shown when mousing over a transaction row
// ─────────────────────────────────────────────────────────────────────────────
function ClearedIcon({ status }) {
  if (status === 'reconciled')
    return <ThemeIcon size="xs" color="teal"  variant="light" radius="xl"><IconLock         size={10} /></ThemeIcon>;
  if (status === 'cleared')
    return <ThemeIcon size="xs" color="green" variant="light" radius="xl"><IconCircleCheck  size={10} /></ThemeIcon>;
  return   <ThemeIcon size="xs" color="orange" variant="light" radius="xl"><IconClock       size={10} /></ThemeIcon>;
}

function TransactionDetailCard({ txn, accountName, categoryLabel }) {
  const clearedLabel = { reconciled: 'Reconciled', cleared: 'Cleared', uncleared: 'Uncleared' }[txn.cleared] ?? txn.cleared;

  return (
    <Stack gap={6} style={{ minWidth: 240, maxWidth: 320 }}>
      <Group gap={6}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">Transaction Details</Text>
      </Group>
      <Divider />

      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">Account</Text>
        <Text size="xs" fw={500}>{accountName || '—'}</Text>
      </Group>

      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">Category</Text>
        <Text size="xs" fw={500} ta="right" style={{ maxWidth: 180 }}>{categoryLabel || '—'}</Text>
      </Group>

      {txn.memo && (
        <Group justify="space-between" gap="xs" align="flex-start">
          <Text size="xs" c="dimmed">Memo</Text>
          <Text size="xs" ta="right" style={{ maxWidth: 180 }}>{txn.memo}</Text>
        </Group>
      )}

      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">Cleared</Text>
        <Group gap={4}>
          <ClearedIcon status={txn.cleared} />
          <Text size="xs">{clearedLabel}</Text>
        </Group>
      </Group>

      {/* Raw bank/credit-card descriptor — the original text as the bank sent it */}
      {txn.import_payee_name_original && txn.import_payee_name_original !== txn.payee_name && (
        <Group justify="space-between" gap="xs" align="flex-start">
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>Bank text</Text>
          <Text size="xs" ff="monospace" ta="right" style={{ maxWidth: 190, wordBreak: 'break-word' }}>
            {txn.import_payee_name_original}
          </Text>
        </Group>
      )}

      {txn.flag_color && (
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed">Flag</Text>
          <Group gap={4}>
            <Box style={{
              width: 10, height: 10, borderRadius: '50%',
              background: `var(--mantine-color-${txn.flag_color}-6)`,
            }} />
            <Text size="xs" tt="capitalize">{txn.flag_name || txn.flag_color}</Text>
          </Group>
        </Group>
      )}

      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">Amount</Text>
        <Text size="xs" fw={600} c={txn.amount >= 0 ? 'teal' : 'red'}>
          {formatCurrency(txn.amount)}
        </Text>
      </Group>

      {txn.subtransactions?.length > 0 && (
        <>
          <Divider label="Split" labelPosition="left" />
          {txn.subtransactions.map((s, i) => (
            <Group key={i} justify="space-between" gap="xs">
              <Text size="xs" c="dimmed" style={{ maxWidth: 160 }} lineClamp={1}>
                {s.category_name || s.memo || `Split ${i + 1}`}
              </Text>
              <Text size="xs" fw={500} c={s.amount >= 0 ? 'teal' : 'red'}>
                {formatCurrency(s.amount)}
              </Text>
            </Group>
          ))}
        </>
      )}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline-editable cell helpers
// ─────────────────────────────────────────────────────────────────────────────

// Wraps any cell value: click → activate inline editor
function EditableCell({ isEditing, onActivate, display, children }) {
  if (isEditing) return <>{children}</>;
  return (
    <Box
      style={{ cursor: 'pointer', borderRadius: 4, padding: '2px 4px' }}
      onClick={onActivate}
      title="Click to edit"
    >
      {display}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const {
    transactions, flatCategories, accounts, loading,
    activeBudgetId, mergeTransactions,
  } = useYNAB();

  // Filters survive the app being backgrounded/killed on iOS
  const [search,         setSearch]         = usePersistentState('txn-search', '');
  const [filterApproved, setFilterApproved] = usePersistentState('txn-filter', 'unapproved');
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    return [new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)];
  }); // null = all time
  const [page,           setPage]           = useState(1);
  const [editTxn,        setEditTxn]        = useState(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const isMobile = useMediaQuery('(max-width: 48em)');

  // Inline editing state
  const [inlineEdit, setInlineEdit] = useState(null); // { txnId, field }
  const [inlineVal,  setInlineVal]  = useState(null);

  // ── Filter & paginate ────────────────────────────────────────────────────
  // Internal YNAB transfers — same logic as income card
  const isTransfer = (t) =>
    !!t.transfer_account_id ||
    /^transfer\s*:\s*/i.test(t.payee_name ?? '');

  const filtered = useMemo(() => {
    const startStr = dateRange?.[0]?.toISOString().slice(0, 10) ?? null;
    const endStr   = dateRange?.[1]?.toISOString().slice(0, 10) ?? null;
    return transactions.filter((t) => {
      if (t.deleted)     return false;
      if (isTransfer(t)) return false;
      // Income and inflows (incl. refunds) live on the Income page — this
      // page is for spending only.
      if (t.amount > 0)  return false;
      if (filterApproved === 'unapproved' && t.approved)  return false;
      if (filterApproved === 'approved'   && !t.approved) return false;
      if (startStr && t.date < startStr) return false;
      if (endStr   && t.date > endStr)   return false;
      const q = search.toLowerCase();
      if (!q) return true;
      return (
        t.payee_name?.toLowerCase().includes(q) ||
        t.memo?.toLowerCase().includes(q) ||
        t.category_name?.toLowerCase().includes(q) ||
        String(Math.abs(t.amount / 1000)).includes(q)
      );
    });
  }, [transactions, search, filterApproved, dateRange]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getCategoryLabel = (txn) => {
    if (txn.category_name) return txn.category_name;
    return flatCategories.find((c) => c.id === txn.category_id)?.name ?? '—';
  };

  const getFullCategoryLabel = (txn) => {
    const cat = flatCategories.find((c) => c.id === txn.category_id);
    if (cat) return `${cat.groupName} → ${cat.name}`;
    return txn.category_name ?? '—';
  };

  const getAccountName = (txn) => {
    if (txn.account_name) return txn.account_name;
    return accounts.find((a) => a.id === txn.account_id)?.name ?? '—';
  };

  // ── Inline edit ──────────────────────────────────────────────────────────
  const startInline = (txn, field, currentValue) => {
    setInlineEdit({ txnId: txn.id, field });
    setInlineVal(currentValue ?? '');
  };

  const cancelInline = () => { setInlineEdit(null); setInlineVal(null); };

  const commitInline = useCallback(async (txn, field, value) => {
    setInlineEdit(null);
    setInlineVal(null);

    let update;
    if (field === 'amount') {
      update = { amount: Math.round(parseFloat(value) * 1000) };
    } else if (field === 'category_id') {
      // Also update category_name so the display is immediately correct
      const cat = flatCategories.find((c) => c.id === value);
      update = { category_id: value, category_name: cat?.name ?? null };
    } else {
      update = { [field]: value };
    }

    // Optimistic local update
    mergeTransactions([{ ...txn, ...update }]);

    try {
      const res = await api.put(`/transactions/${txn.id}`, {
        ...txn,
        ...update,
        amount: update.amount ?? txn.amount,
      });
      // Prefer the server's full transaction (has correct category_name, etc.)
      if (res.data?.transaction) {
        mergeTransactions([res.data.transaction]);
      }
      notifications.show({ title: 'Saved', color: 'teal', autoClose: 1200 });
    } catch (err) {
      mergeTransactions([txn]);
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  }, [mergeTransactions, flatCategories]);

  const isEditing = (txnId, field) =>
    inlineEdit?.txnId === txnId && inlineEdit?.field === field;

  // ── Row actions ──────────────────────────────────────────────────────────
  const APPROVAL_NOTE = 'Approved in Budget App';

  const handleApprove = async (txn) => {
    // Stamp the memo so it's clear the approval came from this app (no double-stamp)
    const stampedMemo = txn.memo?.includes(APPROVAL_NOTE)
      ? txn.memo
      : `${txn.memo ? `${txn.memo} · ` : ''}${APPROVAL_NOTE}`;

    // Optimistic update — remove from "Needs Approval" view instantly
    mergeTransactions([{ ...txn, approved: true, memo: stampedMemo }]);
    try {
      await api.put(`/transactions/${txn.id}`, { ...txn, approved: true, memo: stampedMemo });
      notifications.show({ title: 'Approved', color: 'teal', autoClose: 1500 });
    } catch (err) {
      // Roll back
      mergeTransactions([{ ...txn, approved: false, memo: txn.memo }]);
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleDelete = async (txn) => {
    // Optimistic update — remove from list instantly
    mergeTransactions([{ id: txn.id, deleted: true }]);
    try {
      await api.delete(`/transactions/${txn.id}`);
      notifications.show({ title: 'Deleted', color: 'orange', autoClose: 1500 });
    } catch (err) {
      // Roll back
      mergeTransactions([{ ...txn, deleted: false }]);
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleEdit = (txn) => {
    setEditTxn(txn);
    openModal();
  };

  const handleNew = () => { setEditTxn(null); openModal(); };

  // No-op: modal now handles real-time updates via mergeTransactions directly
  const onSaved = () => {};

  // Key handler for text/number inline inputs
  const inlineKeyDown = (e, txn, field, value) => {
    if (e.key === 'Enter')  commitInline(txn, field, value);
    if (e.key === 'Escape') cancelInline();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Transactions</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={handleNew}>
          New Transaction
        </Button>
      </Group>

      <Group wrap="wrap">
        <DateRangeFilter
          value={dateRange}
          onChange={(r) => { setDateRange(r); setPage(1); }}
        />
        <TextInput
          placeholder="Search payee, memo, category…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <SegmentedControl
          fullWidth={isMobile}
          value={filterApproved}
          onChange={(v) => { setFilterApproved(v); setPage(1); }}
          data={[
            { value: 'all',        label: 'All'            },
            { value: 'unapproved', label: 'Needs Approval' },
            { value: 'approved',   label: 'Approved'       },
          ]}
          style={isMobile ? { width: '100%' } : undefined}
        />
      </Group>

      <Text size="sm" c="dimmed">
        {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        {dateRange ? ` from ${dateRange[0].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} – ${dateRange[1].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` : ' (all time)'}
        {!isMobile && ' — click any cell to edit inline'}
      </Text>

      {loading ? (
        <Stack>
          {[...Array(8)].map((_, i) => <Skeleton key={i} h={40} />)}
        </Stack>
      ) : isMobile ? (
        /* ── Mobile: card list — no horizontal scrolling, big touch targets ── */
        <Stack gap="xs">
          {paginated.length === 0 && (
            <Text c="dimmed" ta="center" py="lg">No transactions match.</Text>
          )}
          {paginated.map((txn) => (
            <Paper key={txn.id} withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                <Box style={{ minWidth: 0, flex: 1 }}>
                  <Text size="sm" fw={600} lineClamp={1}>{txn.payee_name || '—'}</Text>
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{formatDate(txn.date)}</Text>
                    <Badge size="xs" color={txn.approved ? 'teal' : 'orange'} variant="light">
                      {txn.approved ? 'Approved' : 'Pending'}
                    </Badge>
                  </Group>
                  {txn.memo && <Text size="xs" c="dimmed" lineClamp={1} mt={2}>{txn.memo}</Text>}
                </Box>
                <Text size="sm" fw={700} c={txn.amount >= 0 ? 'teal' : 'red'} style={{ whiteSpace: 'nowrap' }}>
                  {formatCurrency(txn.amount)}
                </Text>
              </Group>

              <Group mt="xs" gap="xs" wrap="nowrap">
                <CategoryPicker
                  size="sm"
                  categories={flatCategories}
                  value={txn.category_id}
                  onChange={(v) => commitInline(txn, 'category_id', v)}
                  placeholder="Pick category"
                  style={{ flex: 1, minWidth: 0 }}
                />
                {!txn.approved && (
                  <ActionIcon size="lg" color="teal" variant="light" onClick={() => handleApprove(txn)} aria-label="Approve">
                    <IconCheck size={18} />
                  </ActionIcon>
                )}
                <ActionIcon size="lg" color="blue" variant="light" onClick={() => handleEdit(txn)} aria-label="Edit">
                  <IconEdit size={18} />
                </ActionIcon>
                <ActionIcon size="lg" color="red" variant="light" onClick={() => handleDelete(txn)} aria-label="Delete">
                  <IconTrash size={18} />
                </ActionIcon>
              </Group>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Payee</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Memo</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>

            <Table.Tbody>
              {paginated.map((txn) => (
                <Table.Tr key={txn.id}>

                  {/* ── Date ─────────────────────────────────────── */}
                  <Table.Td style={{ minWidth: 110 }}>
                    <EditableCell
                      isEditing={isEditing(txn.id, 'date')}
                      onActivate={() => startInline(txn, 'date', txn.date)}
                      display={<Text size="sm">{formatDate(txn.date)}</Text>}
                    >
                      <DatePickerInput
                        size="xs"
                        value={inlineVal ? new Date(inlineVal + 'T12:00:00') : new Date()}
                        onChange={(v) => {
                          const iso = v instanceof Date ? v.toISOString().split('T')[0] : v;
                          commitInline(txn, 'date', iso);
                        }}
                        autoFocus
                        onKeyDown={(e) => e.key === 'Escape' && cancelInline()}
                        style={{ minWidth: 130 }}
                      />
                    </EditableCell>
                  </Table.Td>

                  {/* ── Payee (hover for details) ────────────────── */}
                  <Table.Td style={{ minWidth: 140 }}>
                    <EditableCell
                      isEditing={isEditing(txn.id, 'payee_name')}
                      onActivate={() => startInline(txn, 'payee_name', txn.payee_name || '')}
                      display={
                        <HoverCard width={320} shadow="md" openDelay={300} closeDelay={100} withinPortal>
                          <HoverCard.Target>
                            <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }}>
                              <Text size="sm" lineClamp={1}>{txn.payee_name || '—'}</Text>
                              <IconInfoCircle size={12} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                            </Group>
                          </HoverCard.Target>
                          <HoverCard.Dropdown>
                            <TransactionDetailCard
                              txn={txn}
                              accountName={getAccountName(txn)}
                              categoryLabel={getFullCategoryLabel(txn)}
                            />
                          </HoverCard.Dropdown>
                        </HoverCard>
                      }
                    >
                      <TextInput
                        size="xs"
                        value={inlineVal ?? ''}
                        onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={() => commitInline(txn, 'payee_name', inlineVal)}
                        onKeyDown={(e) => inlineKeyDown(e, txn, 'payee_name', inlineVal)}
                        autoFocus
                        style={{ minWidth: 140 }}
                      />
                    </EditableCell>
                  </Table.Td>

                  {/* ── Category (dropdown) ───────────────────────── */}
                  <Table.Td style={{ minWidth: 180 }}>
                    <EditableCell
                      isEditing={isEditing(txn.id, 'category_id')}
                      onActivate={() => startInline(txn, 'category_id', txn.category_id)}
                      display={
                        <Text size="sm" c="dimmed" lineClamp={1}>
                          {getCategoryLabel(txn)}
                        </Text>
                      }
                    >
                      <Select
                        size="xs"
                        searchable
                        clearable
                        autoFocus
                        data={flatCategories.map((c) => ({
                          value: c.id,
                          label: `${c.groupName} → ${c.name}`,
                        }))}
                        value={inlineVal}
                        onChange={(v) => commitInline(txn, 'category_id', v)}
                        onKeyDown={(e) => e.key === 'Escape' && cancelInline()}
                        style={{ minWidth: 220 }}
                      />
                    </EditableCell>
                  </Table.Td>

                  {/* ── Memo ─────────────────────────────────────── */}
                  <Table.Td style={{ minWidth: 140 }}>
                    <EditableCell
                      isEditing={isEditing(txn.id, 'memo')}
                      onActivate={() => startInline(txn, 'memo', txn.memo || '')}
                      display={<Text size="sm" c="dimmed" lineClamp={1}>{txn.memo || ''}</Text>}
                    >
                      <TextInput
                        size="xs"
                        value={inlineVal ?? ''}
                        onChange={(e) => setInlineVal(e.target.value)}
                        onBlur={() => commitInline(txn, 'memo', inlineVal)}
                        onKeyDown={(e) => inlineKeyDown(e, txn, 'memo', inlineVal)}
                        autoFocus
                        style={{ minWidth: 160 }}
                      />
                    </EditableCell>
                  </Table.Td>

                  {/* ── Amount ───────────────────────────────────── */}
                  <Table.Td ta="right" style={{ minWidth: 100 }}>
                    <EditableCell
                      isEditing={isEditing(txn.id, 'amount')}
                      onActivate={() =>
                        startInline(txn, 'amount', txn.amount / 1000)
                      }
                      display={
                        <Text
                          size="sm"
                          fw={600}
                          c={txn.amount >= 0 ? 'teal' : 'red'}
                          style={{ textAlign: 'right' }}
                        >
                          {formatCurrency(txn.amount)}
                        </Text>
                      }
                    >
                      <NumberInput
                        size="xs"
                        value={inlineVal ?? 0}
                        onChange={(v) => setInlineVal(v)}
                        onBlur={() => commitInline(txn, 'amount', inlineVal)}
                        onKeyDown={(e) => inlineKeyDown(e, txn, 'amount', inlineVal)}
                        decimalScale={2}
                        prefix="$"
                        autoFocus
                        style={{ width: 110 }}
                      />
                    </EditableCell>
                  </Table.Td>

                  {/* ── Status ───────────────────────────────────── */}
                  <Table.Td>
                    <Badge
                      size="sm"
                      color={txn.approved ? 'teal' : 'orange'}
                      variant="light"
                    >
                      {txn.approved ? 'Approved' : 'Pending'}
                    </Badge>
                  </Table.Td>

                  {/* ── Actions ──────────────────────────────────── */}
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      {!txn.approved && (
                        <Tooltip label="Approve">
                          <ActionIcon
                            size="sm"
                            color="teal"
                            variant="subtle"
                            onClick={() => handleApprove(txn)}
                          >
                            <IconCheck size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Edit in form">
                        <ActionIcon
                          size="sm"
                          color="blue"
                          variant="subtle"
                          onClick={() => handleEdit(txn)}
                        >
                          <IconEdit size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <ActionIcon
                          size="sm"
                          color="red"
                          variant="subtle"
                          onClick={() => handleDelete(txn)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      {filtered.length > PAGE_SIZE && (
        <Group justify="center">
          <Pagination
            value={page}
            onChange={setPage}
            total={Math.ceil(filtered.length / PAGE_SIZE)}
            siblings={isMobile ? 0 : 1}
            size={isMobile ? 'sm' : 'md'}
          />
        </Group>
      )}

      <TransactionModal
        opened={modalOpened}
        onClose={closeModal}
        transaction={editTxn}
        onSaved={onSaved}
      />
    </Stack>
  );
}
