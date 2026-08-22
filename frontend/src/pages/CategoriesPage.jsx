import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Stack, Title, Accordion, Group, Text, Progress, Badge,
  Skeleton, TextInput, NumberInput, Button, Modal, Select,
  Textarea, Menu, ActionIcon, Alert, Divider,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import DateRangeFilter from '../components/DateRangeFilter';
import {
  IconSearch, IconPlus, IconDotsVertical,
  IconArrowsTransferUpDown, IconTrash, IconAlertTriangle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useYNAB, api } from '../context/YNABContext';
import { formatCurrency } from '../utils/format';

const HIDDEN_GROUPS = new Set(['Internal Master Category', 'Hidden Categories', 'Credit Card Payments', 'Inflow']);

export default function CategoriesPage() {
  const { activeBudgetId, loading: ctxLoading, saveBudgetOverride } = useYNAB();

  // ── Add modal ──────────────────────────────────────────────────────────────
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [addGroup,   setAddGroup]   = useState(null);
  const [addName,    setAddName]    = useState('');
  const [addNote,    setAddNote]    = useState('');
  const [addMonthly, setAddMonthly] = useState('');
  const [addSaving,  setAddSaving]  = useState(false);
  const [groupOptions, setGroupOptions] = useState([]);

  // ── Delete modal ───────────────────────────────────────────────────────────
  const [deleteTarget,  setDeleteTarget]  = useState(null); // { id, name }
  const [deleteSaving,  setDeleteSaving]  = useState(false);

  // ── Move-money modal (moves AVAILABLE BALANCE, not this month's budgeted) ────
  const [transferSource,  setTransferSource]  = useState(null); // { id, name, budgeted, balance }
  const [transferTarget,  setTransferTarget]  = useState(null); // category id
  const [transferAmount,  setTransferAmount]  = useState('');
  const [transferSaving,  setTransferSaving]  = useState(false);

  // ── Month / data ───────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('');
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)];
  }); // null = all time
  const [monthData,    setMonthData]    = useState(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [hiddenIds,    setHiddenIds]    = useState(new Set());

  // For YNAB month-based API: use the start of the selected date range
  const monthStr = dateRange?.[0]
    ? `${dateRange[0].getFullYear()}-${String(dateRange[0].getMonth() + 1).padStart(2, '0')}`
    : null;

  // Current month string for budget PATCHes (always current month, not the viewed month)
  const nowMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  // Fetch YNAB month-specific data
  const fetchMonthData = useCallback(async (budgetId, month) => {
    if (!budgetId || !month) return;
    setMonthLoading(true);
    try {
      const res = await api.get('/budgets/month', { params: { budgetId, month: `${month}-01` } });
      setMonthData(res.data?.categories ?? []);
    } catch (err) {
      console.error('[CategoriesPage] Failed to fetch month data:', err.message);
      setMonthData(null);
    } finally {
      setMonthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeBudgetId && monthStr) fetchMonthData(activeBudgetId, monthStr);
  }, [activeBudgetId, monthStr, fetchMonthData]);

  // Load hidden categories
  const loadHidden = useCallback(() => {
    api.get('/rules/hidden-categories')
      .then(r => setHiddenIds(new Set(r.data ?? [])))
      .catch(() => {});
  }, []);
  useEffect(() => { loadHidden(); }, [loadHidden]);

  // Load category groups for the add modal
  useEffect(() => {
    if (!activeBudgetId) return;
    api.get('/categories', { params: { budgetId: activeBudgetId } })
      .then((res) => setGroupOptions((res.data ?? []).map((g) => ({ value: g.id, label: g.name }))))
      .catch(() => {});
  }, [activeBudgetId]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleAddCategory = async () => {
    if (!addGroup || !addName.trim()) return;
    setAddSaving(true);
    try {
      const newCat = await api.post('/categories', {
        categoryGroupId: addGroup,
        name: addName.trim(),
        note: addNote.trim() || null,
      }, { params: { budgetId: activeBudgetId } });

      const monthlyDollars = parseFloat(addMonthly);
      if (!isNaN(monthlyDollars) && monthlyDollars > 0 && newCat.data?.id) {
        await saveBudgetOverride(newCat.data.id, Math.round(monthlyDollars * 1000));
      }

      notifications.show({
        title: 'Category created',
        message: `"${addName.trim()}" added to YNAB${monthlyDollars > 0 ? ` with $${monthlyDollars}/mo budget` : ''}`,
        color: 'teal', autoClose: 3000,
      });
      closeAdd();
      setAddName(''); setAddNote(''); setAddGroup(null); setAddMonthly('');
      fetchMonthData(activeBudgetId, monthStr);
    } catch (err) {
      notifications.show({ title: 'Failed to create category', message: err.response?.data?.error ?? err.message, color: 'red' });
    } finally { setAddSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await api.delete(`/rules/budget-overrides/${deleteTarget.id}`);
      notifications.show({
        title: 'Removed from budget tracking',
        message: `"${deleteTarget.name}" removed. It still exists in YNAB — delete it there if needed.`,
        color: 'orange', autoClose: 5000,
      });
      setDeleteTarget(null);
      loadHidden();
      fetchMonthData(activeBudgetId, monthStr);
    } catch (err) {
      notifications.show({ title: 'Failed to remove', message: err.response?.data?.error ?? err.message, color: 'red' });
    } finally { setDeleteSaving(false); }
  };

  const handleTransfer = async () => {
    const amt = parseFloat(transferAmount);
    if (!transferSource || !transferTarget || isNaN(amt) || amt <= 0) return;
    if (transferSource.id === transferTarget) {
      notifications.show({ title: 'Same category', message: 'Source and target must be different.', color: 'orange' });
      return;
    }
    setTransferSaving(true);
    try {
      // Fetch fresh YNAB values for current month. We move AVAILABLE BALANCE:
      // in YNAB, moving available money is done by adjusting the "budgeted"
      // (assigned) amount on both categories — reducing the source's assigned
      // lowers its balance, raising the target's assigned lifts its balance.
      const monthRes = await api.get('/budgets/month', {
        params: { budgetId: activeBudgetId, month: `${nowMonth}-01` },
      });
      const cats = monthRes.data?.categories ?? [];
      const srcCat = cats.find(c => c.id === transferSource.id);
      const tgtCat = cats.find(c => c.id === transferTarget);

      const srcBudgeted = srcCat?.budgeted ?? 0;
      const tgtBudgeted = tgtCat?.budgeted ?? 0;
      const srcBalance  = srcCat?.balance  ?? 0;
      const amtMilliunits = Math.round(amt * 1000);

      if (amtMilliunits - srcBalance > 1) { // 1 milliunit slack for rounding
        notifications.show({
          title: 'Not enough available',
          message: `${transferSource.name} only has ${formatCurrency(srcBalance)} available to move.`,
          color: 'red',
        });
        setTransferSaving(false);
        return;
      }

      // PATCH source (reduce assigned) then target (increase assigned)
      await api.patch(`/categories/${transferSource.id}/budget`, {
        budgeted: srcBudgeted - amtMilliunits,
        month: nowMonth,
      });
      await api.patch(`/categories/${transferTarget}/budget`, {
        budgeted: tgtBudgeted + amtMilliunits,
        month: nowMonth,
      });

      const tgtName = cats.find(c => c.id === transferTarget)?.name ?? transferTarget;
      notifications.show({
        title: 'Money moved',
        message: `$${amt.toFixed(2)} moved from ${transferSource.name} → ${tgtName}`,
        color: 'teal', autoClose: 4000,
      });
      setTransferSource(null); setTransferTarget(null); setTransferAmount('');
      fetchMonthData(activeBudgetId, monthStr);
    } catch (err) {
      notifications.show({ title: 'Move failed', message: err.response?.data?.error ?? err.message, color: 'red' });
    } finally { setTransferSaving(false); }
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    if (!monthData) return [];
    const map = {};
    monthData
      .filter((c) => !c.hidden && !c.deleted && !HIDDEN_GROUPS.has(c.category_group_name) && !hiddenIds.has(c.id))
      .forEach((c) => {
        const grp = c.category_group_name || 'Other';
        if (!map[grp]) map[grp] = { name: grp, id: c.category_group_id, categories: [] };
        map[grp].categories.push(c);
      });
    return Object.values(map)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, categories: g.categories.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [monthData, hiddenIds]);

  const filtered = grouped
    .map((group) => ({
      ...group,
      categories: group.categories.filter(
        (c) => !search || c.name.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((g) => g.categories.length > 0);

  // Flat list for transfer target dropdown — exclude source
  const categorySelectData = useMemo(() => {
    if (!monthData) return [];
    return monthData
      .filter((c) => !c.hidden && !c.deleted && !HIDDEN_GROUPS.has(c.category_group_name))
      .sort((a, b) => (a.category_group_name + a.name).localeCompare(b.category_group_name + b.name))
      .map((c) => ({
        value: c.id,
        label: `${c.category_group_name} › ${c.name}`,
      }));
  }, [monthData]);

  const isLoading = ctxLoading || monthLoading;
  if (isLoading && !monthData) {
    return (
      <Stack>
        <Title order={2}>Categories</Title>
        {[1, 2, 3].map((i) => <Skeleton key={i} h={80} radius="md" />)}
      </Stack>
    );
  }

  const monthLabel = dateRange?.[0]
    ? dateRange[0].toLocaleString('default', { month: 'long', year: 'numeric' })
    : 'all time';

  return (
    <Stack>
      {/* ── Add Category Modal ─────────────────────────────────────────── */}
      <Modal opened={addOpened} onClose={closeAdd} title="Add Category to YNAB" size="sm">
        <Stack gap="sm">
          <Select label="Category Group" placeholder="Select a group..." data={groupOptions}
            value={addGroup} onChange={setAddGroup} searchable required />
          <TextInput label="Category Name" placeholder="e.g. Property Tax"
            value={addName} onChange={(e) => setAddName(e.target.value)} required />
          <NumberInput label="Monthly Budget Amount (optional)" placeholder="e.g. 150"
            prefix="$" min={0} decimalScale={2} value={addMonthly} onChange={setAddMonthly}
            description="Sets the monthly target in your budget tracker" />
          <Textarea label="Note (optional)" placeholder="Any notes about this category..."
            value={addNote} onChange={(e) => setAddNote(e.target.value)} rows={2} />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={closeAdd}>Cancel</Button>
            <Button color="teal" leftSection={<IconPlus size={14} />} loading={addSaving}
              disabled={!addGroup || !addName.trim()} onClick={handleAddCategory}>
              Add to YNAB
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Delete Confirmation Modal ───────────────────────────────────── */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove from budget tracking"
        size="sm"
        centered
      >
        {deleteTarget && (
          <Stack gap="md">
            <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
              <Text size="sm" fw={600} mb={4}>YNAB API does not support deleting categories.</Text>
              <Text size="sm">
                You must delete <strong>{deleteTarget.name}</strong> manually in the YNAB app.
                This button will only remove it from this app's budget tracking and BvA report.
              </Text>
            </Alert>
            <Button
              variant="light"
              color="blue"
              component="a"
              href="https://app.ynab.com"
              target="_blank"
              size="xs"
            >
              Open YNAB app to delete it there →
            </Button>
            <Text size="xs" c="dimmed">
              Once deleted in YNAB, click below to also remove it from this app's tracking.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button color="red" leftSection={<IconTrash size={14} />}
                loading={deleteSaving} onClick={handleDelete}>
                Remove from App Tracking
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* ── Move Money Modal (moves available balance) ──────────────────── */}
      <Modal
        opened={!!transferSource}
        onClose={() => { setTransferSource(null); setTransferTarget(null); setTransferAmount(''); }}
        title="Move Available Money"
        size="sm"
        centered
      >
        {transferSource && (() => {
          const availDollars = (transferSource.balance ?? 0) / 1000;
          const amtNum = parseFloat(transferAmount);
          const overAvail = !isNaN(amtNum) && amtNum - availDollars > 0.005;
          return (
          <Stack gap="md">
            <Alert icon={<IconArrowsTransferUpDown size={16} />} color="blue" variant="light">
              Move <strong>available balance</strong> out of <strong>{transferSource.name}</strong> into
              another category for <strong>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</strong>.
              Available to move: <strong>{formatCurrency(transferSource.balance ?? 0)}</strong>.
            </Alert>
            <NumberInput
              label="Amount to Move"
              placeholder="e.g. 50.00"
              prefix="$"
              min={0.01}
              max={availDollars > 0 ? availDollars : undefined}
              decimalScale={2}
              value={transferAmount}
              onChange={setTransferAmount}
              error={overAvail ? `Only ${formatCurrency(transferSource.balance ?? 0)} available` : null}
              rightSectionWidth={72}
              rightSection={
                availDollars > 0 ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => setTransferAmount(parseFloat(availDollars.toFixed(2)))}
                  >
                    Move all
                  </Button>
                ) : null
              }
              required
            />
            <Select
              label="Move To"
              placeholder="Select destination category..."
              data={categorySelectData.filter(c => c.value !== transferSource.id)}
              value={transferTarget}
              onChange={setTransferTarget}
              searchable
              required
            />
            <Divider />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => { setTransferSource(null); setTransferTarget(null); setTransferAmount(''); }}>
                Cancel
              </Button>
              <Button
                color="blue"
                leftSection={<IconArrowsTransferUpDown size={14} />}
                loading={transferSaving}
                disabled={!transferTarget || !transferAmount || parseFloat(transferAmount) <= 0 || overAvail}
                onClick={handleTransfer}
              >
                Move Money
              </Button>
            </Group>
          </Stack>
          );
        })()}
      </Modal>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={2}>Categories</Title>
        <Group gap="xs" wrap="wrap">
          <Button size="sm" variant="light" color="teal" leftSection={<IconPlus size={14} />} onClick={openAdd}>
            Add Category
          </Button>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </Group>
      </Group>

      <TextInput placeholder="Search categories..." leftSection={<IconSearch size={16} />}
        value={search} onChange={(e) => setSearch(e.target.value)} />

      <Text size="xs" c="dimmed">
        Showing YNAB data for <strong>{dateRange ? dateRange[0].toLocaleString('default', { month: 'long', year: 'numeric' }) : 'all time'}</strong>
        {dateRange && ' (YNAB is month-based — showing the month containing your selected start date)'}
      </Text>

      {/* ── Category Accordion ──────────────────────────────────────────── */}
      <Accordion variant="separated" multiple>
        {filtered.map((group) => {
          const groupBudgeted = group.categories.reduce((s, c) => s + (c.budgeted ?? 0), 0);
          const groupActivity = group.categories.reduce((s, c) => s + (c.activity ?? 0), 0);
          const groupBalance  = group.categories.reduce((s, c) => s + (c.balance  ?? 0), 0);

          return (
            <Accordion.Item key={group.id || group.name} value={group.id || group.name}>
              <Accordion.Control>
                <Group justify="space-between" pr="md" wrap="nowrap" gap="xs">
                  <Text fw={600} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>{group.name}</Text>
                  <Group gap="md" wrap="nowrap" style={{ flexShrink: 0 }}>
                    <div>
                      <Text size="xs" c="dimmed">Budgeted</Text>
                      <Text size="sm" fw={500}>{formatCurrency(groupBudgeted)}</Text>
                    </div>
                    <div>
                      <Text size="xs" c="dimmed">Balance</Text>
                      <Text size="sm" fw={500} c={groupBalance >= 0 ? 'teal' : 'red'}>
                        {formatCurrency(groupBalance)}
                      </Text>
                    </div>
                  </Group>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {group.categories.map((cat) => {
                    const budgeted   = cat.budgeted ?? 0;
                    const activity   = cat.activity ?? 0;
                    const balance    = cat.balance  ?? 0;
                    const overBudget = balance < 0;
                    const pct = budgeted > 0
                      ? Math.min(100, Math.abs(activity / budgeted) * 100)
                      : 0;

                    return (
                      <div key={cat.id}>
                        <Group justify="space-between" mb={4} wrap="nowrap">
                          <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" lineClamp={1}>{cat.name}</Text>
                            {cat.goal_type && (
                              <Badge size="xs" variant="outline">{cat.goal_type}</Badge>
                            )}
                          </Group>
                          <Group gap="md" wrap="nowrap" style={{ flexShrink: 0 }}>
                            <Text size="xs" c="dimmed" ta="right">{formatCurrency(budgeted)}</Text>
                            <Text size="xs" fw={600} c={overBudget ? 'red' : 'teal'} ta="right" style={{ minWidth: 60 }}>
                              {formatCurrency(balance)}
                            </Text>

                            {/* Action menu */}
                            <Menu shadow="md" width={180} withinPortal position="bottom-end">
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="sm">
                                  <IconDotsVertical size={14} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  leftSection={<IconArrowsTransferUpDown size={14} />}
                                  disabled={balance <= 0}
                                  onClick={() => {
                                    setTransferSource({ id: cat.id, name: cat.name, budgeted, balance });
                                    setTransferTarget(null);
                                    setTransferAmount('');
                                  }}
                                >
                                  Move Money
                                </Menu.Item>
                                <Menu.Divider />
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconTrash size={14} />}
                                  onClick={() => setDeleteTarget({ id: cat.id, name: cat.name })}
                                >
                                  Remove from Tracking
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          </Group>
                        </Group>
                        <Progress
                          value={pct}
                          color={overBudget ? 'red' : pct > 80 ? 'orange' : 'teal'}
                          size="xs"
                        />
                      </div>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </Stack>
  );
}
