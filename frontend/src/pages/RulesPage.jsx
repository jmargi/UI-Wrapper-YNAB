import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Title, Button, Card, Group, Text, Badge,
  ActionIcon, Modal, TextInput, Select, NumberInput, Checkbox,
  Divider, Tooltip, Grid, ColorSwatch, Table, Box,
  Alert, ThemeIcon, ScrollArea, Textarea, Progress, SegmentedControl, Tabs,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconEdit, IconTrash, IconGitBranch,
  IconBuilding, IconShield, IconBriefcase, IconUser,
  IconUpload, IconCheck, IconX, IconAlertCircle,
  IconFileImport, IconClock, IconCurrencyDollar,
  IconAlertTriangle, IconChevronDown, IconChevronRight, IconRefresh,
  IconHistory, IconDeviceFloppy, IconChartBar, IconInfoCircle,
} from '@tabler/icons-react';
import { api, useYNAB } from '../context/YNABContext';
import DateRangeFilter from '../components/DateRangeFilter';
import CategoryPicker from '../components/CategoryPicker';
import { formatCurrency, formatDate } from '../utils/format';
import { applyMonthlyBudget } from '../utils/monthlyBudget';
import AdjustBudgetButton from '../components/AdjustBudgetButton';
import ColumnHeader from '../components/ColumnHeader';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────
const PROFILE_COLORS = {
  blue:   '#228be6', orange: '#fd7e14', red:    '#fa5252',
  green:  '#40c057', violet: '#7950f2', teal:   '#12b886',
  cyan:   '#15aabf', pink:   '#e64980', grape:  '#be4bdb',
  yellow: '#fab005', gray:   '#868e96',
};
const COLOR_OPTIONS = Object.keys(PROFILE_COLORS);

const ICON_OPTIONS = [
  { value: 'building',  label: 'Building',  Component: IconBuilding  },
  { value: 'shield',    label: 'Shield',    Component: IconShield    },
  { value: 'briefcase', label: 'Briefcase', Component: IconBriefcase },
  { value: 'user',      label: 'User',      Component: IconUser      },
];
function getIconComponent(name) {
  return ICON_OPTIONS.find((o) => o.value === name)?.Component ?? IconBriefcase;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV parsing utilities (handles quoted commas like "  4,000 ")
// ─────────────────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseAmount(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[\s,'"$]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (cleaned === '' || cleaned === '-' || cleaned === '-   ') return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
}

// Parse the family budget spreadsheet CSV format (complex multi-section layout).
// Returns { items, income } or null.
// income = { jonMonthly, jonPerCheck, kellyMonthly, kellyPerCheck }
function parseFamilyBudgetCSV(text, flatCategories) {
  const lines = text.split('\n');

  const headerIdx = lines.findIndex(
    (l) => l.includes('Estimate Amount') && l.includes('JON SHARE')
  );
  if (headerIdx === -1) return null;

  const headerCols     = parseCSVLine(lines[headerIdx]);
  const jonIdx         = headerCols.findIndex((h) => h.trim() === 'JON SHARE');
  const kellyIdx       = headerCols.findIndex((h) => h.trim() === 'KELLY SHARE');
  const monthlyCostIdx = headerCols.findIndex((h) => h.trim() === 'Monthly Cost');
  const perChkIdx      = headerCols.findIndex(
    (h) => h.toLowerCase().includes('4 paychecks') || h.toLowerCase().includes('divided')
  );

  if (jonIdx === -1 || kellyIdx === -1) return null;

  // Income defaults (user-confirmed amounts)
  const income = { jonMonthly: 5058, jonPerCheck: 2529, kellyMonthly: 6120, kellyPerCheck: 3060 };

  const items   = [];
  let section   = '';
  let salaryCtx = null; // 'jon' | 'kelly' | null

  const SKIP_EXPENSE = /^(total|total income|required|discretionary|don't delete)/i;

  for (const line of lines.slice(headerIdx + 1)) {
    const cols = parseCSVLine(line);
    if (!cols || cols.length < 5) continue;

    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();
    const col3 = (cols[3] || '').trim();

    // ── Section / salary headers ──────────────────────────────────────────
    if (col1 && !col2 && !col3) {
      if (/kelly salary/i.test(col1))   salaryCtx = 'kelly';
      else if (/jon salary/i.test(col1)) salaryCtx = 'jon';
      else                               { salaryCtx = null; section = col1; }
      continue;
    }

    // ── Income extraction: read "Net Cash" inside salary sections ─────────
    if (/^net cash$/i.test(col2) && salaryCtx) {
      const amt = parseAmount(cols[4]);
      if (amt > 0) {
        if (salaryCtx === 'jon') {
          income.jonMonthly  = amt;
          income.jonPerCheck = Math.round((amt / 2) * 100) / 100;
        } else {
          income.kellyMonthly  = amt;
          income.kellyPerCheck = Math.round((amt / 2) * 100) / 100;
        }
      }
      continue;
    }

    // ── Skip non-expense rows ─────────────────────────────────────────────
    if (!col2) continue;
    if (SKIP_EXPENSE.test(col2)) continue;
    if (/^(salary|net cash|total)/i.test(col2)) continue;
    if (salaryCtx) continue; // still inside a salary section

    const estimate   = parseAmount(cols[4]);
    const jonShare   = jonIdx   >= 0 ? parseAmount(cols[jonIdx])         : 0;
    const kellyShare = kellyIdx >= 0 ? parseAmount(cols[kellyIdx])       : 0;
    const monthly    = monthlyCostIdx >= 0 ? parseAmount(cols[monthlyCostIdx]) : estimate;

    if (estimate === 0 && jonShare === 0 && kellyShare === 0) continue;

    // Match by exact name first, then loose contains
    const matchedCat = flatCategories.find(
      (c) => c.name.toLowerCase() === col2.toLowerCase()
    ) ?? flatCategories.find(
      (c) => c.name.toLowerCase().includes(col2.toLowerCase())
    );

    items.push({
      id:           `${section}-${col2}`.replace(/\W+/g, '-').toLowerCase(),
      group:        section,
      name:         col2,
      frequency:    col3 || 'MONTHLY',
      monthly:      monthly || estimate,
      jonShare,     // Jon's monthly contribution to this expense
      kellyShare,   // Kelly's monthly contribution to this expense
      categoryId:   matchedCat?.id  ?? null,
      matched:      !!matchedCat,
      jonInclude:   jonShare   > 0,
      kellyInclude: kellyShare > 0,
    });
  }

  return items.length > 0 ? { items, income } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SplitRow (rule-modal helper)
// checkAmount: the per-paycheck dollar amount for the linked profile (optional)
//   → when set, shows "X% of check" annotation next to fixed-$ splits
// ─────────────────────────────────────────────────────────────────────────────
// Helper: resolve a split's dollar amount given a check size
function splitDollarAmount(split, checkAmount) {
  if (!split.value) return 0;
  if (split.type === 'percent') return (split.value / 100) * checkAmount;
  return split.value;
}

function SplitRow({ split, index, isFirst, flatCategories, onChange, onRemove, checkAmount }) {
  return (
    <Group align="flex-end" gap="sm" wrap="nowrap">
      {/* Category */}
      <CategoryPicker
        label={isFirst ? 'Category' : undefined}
        categories={flatCategories}
        value={split.categoryId}
        onChange={(v) => onChange(index, 'categoryId', v)}
        clearable={false}
        style={{ flex: 3, minWidth: 0 }}
        placeholder="Select category…"
      />

      {/* Type */}
      <Select
        label={isFirst ? 'Type' : undefined}
        data={[{ value: 'percent', label: '%' }, { value: 'amount', label: '$' }]}
        value={split.type}
        onChange={(v) => onChange(index, 'type', v)}
        w={76}
        style={{ flexShrink: 0 }}
      />

      {/* Value (per check) */}
      <NumberInput
        label={isFirst ? 'Per Check' : undefined}
        value={split.value}
        onChange={(v) => onChange(index, 'value', v)}
        min={0}
        decimalScale={2}
        w={100}
        style={{ flexShrink: 0 }}
      />

      {/* Label */}
      <TextInput
        label={isFirst ? 'Label' : undefined}
        value={split.name || ''}
        onChange={(e) => onChange(index, 'name', e.target.value)}
        placeholder="Optional"
        style={{ flex: 1, minWidth: 80 }}
      />

      {/* Remove */}
      <ActionIcon color="red" variant="subtle" onClick={() => onRemove(index)} mb={4} style={{ flexShrink: 0 }}>
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Budget Manager — Income page card to edit YNAB envelope budgets
// for all categories used across income source splits, grouped by category group
// ─────────────────────────────────────────────────────────────────────────────
export function MonthlyBudgetCard({ profiles, onReload }) {
  const { flatCategories, budgetOverrides, saveBudgetOverride } = useYNAB();
  const [editingId,       setEditingId]       = useState(null);
  const [draft,           setDraft]           = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(null); // null = not yet initialised
  const [addingTo,        setAddingTo]        = useState(null); // "profileId:categoryId" while saving
  const [bvaTracking,     setBvaTracking]     = useState({}); // { categoryId: boolean }
  const [hiddenIds,       setHiddenIds]       = useState(new Set());

  // Load BvA tracking state and hidden categories
  useEffect(() => {
    api.get('/rules/bva-tracking').then(r => setBvaTracking(r.data ?? {})).catch(() => {});
    api.get('/rules/hidden-categories').then(r => setHiddenIds(new Set(r.data ?? []))).catch(() => {});
  }, []);

  // Effective monthly dollars for a category: local override first, then YNAB value
  const effectiveMonthly = (cat) =>
    budgetOverrides[cat.id] != null
      ? Math.abs(budgetOverrides[cat.id]) / 1000
      : Math.abs(cat.budgeted || 0) / 1000;

  // System/internal groups to hide — same exclusion list as the Dashboard pie
  const EXCLUDED_GROUPS = useMemo(() => new Set([
    'Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments',
  ]), []);

  // Per-profile set of category IDs in that profile's splits
  const profileSplitIds = useMemo(() => {
    const map = {};
    (profiles ?? []).forEach((p) => {
      map[p.id] = new Set((p.defaultSplits ?? []).map((s) => s.categoryId).filter(Boolean));
    });
    return map;
  }, [profiles]);

  // Union — any profile has this category
  const splitCategoryIds = useMemo(() => {
    const ids = new Set();
    Object.values(profileSplitIds).forEach((s) => s.forEach((id) => ids.add(id)));
    return ids;
  }, [profileSplitIds]);

  // Quick-add: add a category to a specific profile's splits
  const handleQuickAdd = async (profile, cat) => {
    const key = `${profile.id}:${cat.id}`;
    setAddingTo(key);
    try {
      const CHECKS_PER_SOURCE = 2;
      const numSources        = (profiles?.length ?? 1) || 1;
      const perCheckDivisor   = numSources * CHECKS_PER_SOURCE;
      const monthlyDollars    = effectiveMonthly(cat);
      const perCheck          = perCheckDivisor > 0 ? parseFloat((monthlyDollars / perCheckDivisor).toFixed(2)) : 0;
      const newSplit          = { categoryId: cat.id, type: 'amount', value: perCheck, name: cat.name };
      const updatedSplits     = [...(profile.defaultSplits ?? []), newSplit];
      await api.put(`/rules/profiles/${profile.id}`, { ...profile, defaultSplits: updatedSplits });
      notifications.show({
        title: `Added to ${profile.name}`,
        message: `${cat.groupName} > ${cat.name} — $${perCheck.toFixed(2)}/check`,
        color: 'teal', autoClose: 3000,
      });
      onReload?.();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAddingTo(null);
    }
  };

  const handleBvaToggle = async (catId, newVal) => {
    setBvaTracking(prev => ({ ...prev, [catId]: newVal })); // optimistic
    try {
      await api.put(`/rules/bva-tracking/${catId}`, { enabled: newVal });
    } catch {
      setBvaTracking(prev => ({ ...prev, [catId]: !newVal })); // revert on error
    }
  };

  // ALL non-system, non-hidden categories from YNAB — grouped A→Z.
  // Each category carries `inSplit` (in any split) and `missingFrom` (profiles that lack it).
  const grouped = useMemo(() => {
    const map = {};
    (flatCategories ?? [])
      .filter((c) => !c.hidden && !c.deleted && !EXCLUDED_GROUPS.has(c.groupName) && !hiddenIds.has(c.id))
      .forEach((cat) => {
        if (!map[cat.groupName]) map[cat.groupName] = [];
        const missingFrom = (profiles ?? []).filter((p) => !profileSplitIds[p.id]?.has(cat.id));
        map[cat.groupName].push({ ...cat, inSplit: splitCategoryIds.has(cat.id), missingFrom });
      });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, cats]) => ({
        group,
        cats: cats.sort((a, b) => a.name.localeCompare(b.name)),
        hasGap: cats.some((c) => c.missingFrom.length > 0),
      }));
  }, [profiles, flatCategories, EXCLUDED_GROUPS, splitCategoryIds, profileSplitIds, hiddenIds]);

  // Initialise all groups as collapsed once we know the group names
  const collapsed = useMemo(() => {
    if (collapsedGroups !== null) return collapsedGroups;
    const init = new Set(grouped.map((g) => g.group));
    return init;
  }, [grouped, collapsedGroups]);

  const toggleGroup = (group) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev ?? collapsed);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setDraft(effectiveMonthly(cat).toFixed(2));
  };

  const commitEdit = async (cat) => {
    const dollars = parseFloat(draft);
    if (isNaN(dollars)) { setEditingId(null); return; }
    await applyMonthlyBudget({ cat, dollars, currentDollars: effectiveMonthly(cat), profiles, saveBudgetOverride, onReload });
    setEditingId(null);
  };

  // Gap count across all groups (categories not yet in any split)
  const totalGaps = grouped.reduce((n, g) => n + g.cats.filter((c) => !c.inSplit).length, 0);

  // Count how many categories have a non-zero effective value
  const nonZeroCount = grouped.reduce((n, g) => n + g.cats.filter((c) => effectiveMonthly(c) > 0).length, 0);

  const [loadingPrevMonth, setLoadingPrevMonth] = useState(false);

  const loadFromPreviousMonth = async () => {
    const now   = new Date();
    const prev  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`;
    const label = prev.toLocaleString('default', { month: 'long', year: 'numeric' });
    setLoadingPrevMonth(true);
    try {
      const res  = await api.get('/budgets/month', { params: { month } });
      const cats   = res.data?.categories ?? [];
      let saved    = 0;
      let skipped  = 0;
      for (const cat of cats) {
        if (cat.budgeted && cat.budgeted !== 0) {
          // Only seed categories that don't already have a manual override
          if (budgetOverrides[cat.id] == null) {
            await saveBudgetOverride(cat.id, Math.abs(cat.budgeted));
            saved++;
          } else {
            skipped++;
          }
        }
      }
      notifications.show({
        title: `Loaded from ${label}`,
        message: `${saved} budgets imported as permanent references${skipped > 0 ? ` · ${skipped} already set (kept)` : ''}`,
        color: 'blue', autoClose: 5000,
      });
    } catch (err) {
      notifications.show({ title: 'Error loading previous month', message: err.message, color: 'red' });
    } finally {
      setLoadingPrevMonth(false);
    }
  };

  if (grouped.length === 0) return null;

  return (
    <Card withBorder radius="md" p="md">
      <Group mb="sm" gap="xs" wrap="wrap">
        <ThemeIcon color="blue" variant="light" size="md">
          <IconCurrencyDollar size={14} />
        </ThemeIcon>
        <Text fw={600}>Monthly Budgets</Text>
        <Text size="xs" c="dimmed">Click any amount to set a local reference (not sent to YNAB)</Text>
        {nonZeroCount === 0 && (
          <Badge color="orange" variant="light" size="sm">All $0 — new month?</Badge>
        )}
        {totalGaps > 0 && (
          <Badge color="orange" variant="light" size="sm">
            {totalGaps} not in any split
          </Badge>
        )}
      </Group>
      <Stack gap={4}>
        {grouped.map(({ group, cats, hasGap }) => {
          const isCollapsed = collapsed.has(group);
          return (
            <Box key={group}>
              {/* Group header — click to collapse/expand */}
              <Group
                gap={6} px={6} py={5}
                onClick={() => toggleGroup(group)}
                style={{
                  cursor: 'pointer', borderRadius: 4,
                  background: 'var(--mantine-color-default-hover)',
                  userSelect: 'none',
                }}
              >
                {isCollapsed
                  ? <IconChevronRight size={13} color="var(--mantine-color-dimmed)" />
                  : <IconChevronDown  size={13} color="var(--mantine-color-dimmed)" />
                }
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">{group}</Text>
                {hasGap && (
                  <Tooltip label="Some categories in this group are not yet in any income split" withArrow position="right">
                    <Badge size="xs" color="orange" variant="dot" style={{ cursor: 'default' }}>gap</Badge>
                  </Tooltip>
                )}
                <Badge size="xs" variant="outline" color="gray" ml="auto">{cats.length}</Badge>
              </Group>

              {/* Category rows — hidden when collapsed */}
              {!isCollapsed && cats.map((cat) => {
                const monthlyDollars = effectiveMonthly(cat);
                const isOverridden   = budgetOverrides[cat.id] != null;
                const isEditing      = editingId === cat.id;
                const isZero         = monthlyDollars === 0;
                return (
                  <Group key={cat.id} justify="space-between" py={6} px={12}
                    style={{
                      borderBottom: '1px solid var(--mantine-color-default-border)',
                      opacity: isZero && !cat.inSplit ? 0.6 : 1,
                    }}
                  >
                    <Group gap={6} wrap="wrap">
                      <Text size="sm">{cat.name}</Text>
                      {cat.missingFrom.map((p) => {
                        const key     = `${p.id}:${cat.id}`;
                        const loading = addingTo === key;
                        const ProfileIcon = getIconComponent(p.icon);
                        return (
                          <Tooltip key={p.id} label={`Not in ${p.name}'s splits — click to add`} withArrow position="right">
                            <Badge
                              size="xs"
                              color={p.color}
                              variant="outline"
                              style={{ cursor: loading ? 'default' : 'pointer' }}
                              leftSection={loading ? null : <IconPlus size={8} />}
                              onClick={loading ? undefined : () => handleQuickAdd(p, cat)}
                            >
                              {loading ? '…' : `Add to ${p.name}`}
                            </Badge>
                          </Tooltip>
                        );
                      })}
                    </Group>
                    {isEditing ? (
                      <Group gap={4}>
                        <NumberInput
                          value={parseFloat(draft) || 0}
                          onChange={(v) => setDraft(v === '' ? '' : String(v))}
                          prefix="$"
                          decimalScale={2}
                          min={0}
                          w={120}
                          size="xs"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(cat); if (e.key === 'Escape') setEditingId(null); }}
                        />
                        <ActionIcon size="xs" color="teal" variant="filled" onClick={() => commitEdit(cat)}>
                          <IconCheck size={10} />
                        </ActionIcon>
                        <ActionIcon size="xs" color="gray" variant="subtle" onClick={() => setEditingId(null)}>
                          <IconX size={10} />
                        </ActionIcon>
                      </Group>
                    ) : (
                      <Group gap={4} wrap="nowrap">
                        {isOverridden && (
                          <Tooltip label="Locally saved override (not in YNAB)" withArrow>
                            <Badge size="xs" color="teal" variant="dot" style={{ cursor: 'default' }}>local</Badge>
                          </Tooltip>
                        )}
                        <Badge
                          size="md" variant="light"
                          color={isZero ? 'gray' : isOverridden ? 'teal' : 'blue'}
                          rightSection={<IconEdit size={10} />}
                          style={{ cursor: 'pointer' }}
                          onClick={() => startEdit(cat)}
                        >
                          {isZero ? '$0.00/mo' : `$${monthlyDollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`}
                        </Badge>
                      </Group>
                    )}
                    <Tooltip label="Include in Budget vs Actual report" withArrow position="left">
                      <Checkbox
                        size="xs"
                        label="Track BvA"
                        checked={bvaTracking[cat.id] !== false}
                        onChange={(e) => handleBvaToggle(cat.id, e.currentTarget.checked)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Tooltip>
                  </Group>
                );
              })}
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Delete Modal  (reusable for rules and profiles)
// ─────────────────────────────────────────────────────────────────────────────
export function ConfirmDeleteModal({ opened, onClose, title, description, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const handleConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); onClose(); }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="sm" centered>
      <Stack>
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>
          {description}
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="red" loading={busy} leftSection={<IconTrash size={14} />} onClick={handleConfirm}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocate Modal
// Budgets money from "Ready to Assign" to multiple YNAB category envelopes.
// Optionally tied to a specific transaction (approves it too).
// Can also be opened with just a totalDollars amount (no specific transaction).
// ─────────────────────────────────────────────────────────────────────────────
function AllocateModal({ opened, onClose, transaction, totalDollars, onApplied, profiles }) {
  const { mergeTransactions, flatCategories, mergeCategoryBudget, activeBudgetId } = useYNAB();
  const [rows,    setRows]    = useState([{ categoryId: null, amount: 0 }]);
  const [saving,  setSaving]  = useState(false);

  const sourceDollars = transaction
    ? (transaction.amount ?? 0) / 1000
    : (totalDollars ?? 0);

  useEffect(() => {
    if (opened) {
      setRows([{ categoryId: null, amount: parseFloat(sourceDollars.toFixed(2)) }]);
    }
  }, [opened]);

  // Load a profile's splits and spread sourceDollars proportionally across categories
  const loadProfileSplits = (profile) => {
    const splits = (profile.defaultSplits ?? []).filter((s) => s.categoryId && s.value > 0);
    if (splits.length === 0) return;
    const totalWeight = splits.reduce((s, sp) => s + sp.value, 0);
    const newRows = splits.map((sp) => ({
      categoryId: sp.categoryId,
      amount: parseFloat(((sp.value / totalWeight) * sourceDollars).toFixed(2)),
    }));
    // Adjust last row for rounding
    const allocated = newRows.reduce((s, r) => s + r.amount, 0);
    const diff = parseFloat((sourceDollars - allocated).toFixed(2));
    if (diff !== 0 && newRows.length > 0) newRows[newRows.length - 1].amount = parseFloat((newRows[newRows.length - 1].amount + diff).toFixed(2));
    setRows(newRows);
  };

  const totalAllocated   = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const remainder        = sourceDollars - totalAllocated;
  const isFullyAllocated = Math.abs(remainder) < 0.01;

  const addRow    = () => setRows((p) => [...p, { categoryId: null, amount: Math.max(0, parseFloat(remainder.toFixed(2))) }]);
  const updateRow = (i, field, val) => setRows((p) => p.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const removeRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  // Build YNAB month string for current month
  const nowMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  const handleApply = async () => {
    const valid = rows.filter((r) => r.categoryId && r.amount > 0);
    if (valid.length === 0) {
      notifications.show({ title: 'Nothing to allocate', message: 'Select at least one category with an amount.', color: 'orange' });
      return;
    }
    setSaving(true);
    try {
      // PATCH each category sequentially — avoids YNAB 429 rate limit from burst requests
      for (const r of valid) {
        const cat        = flatCategories.find((c) => c.id === r.categoryId);
        const currentBud = cat?.budgeted ?? 0;
        const newBud     = currentBud + Math.round(r.amount * 1000);
        mergeCategoryBudget(r.categoryId, newBud); // optimistic UI update
        await api.patch(`/categories/${r.categoryId}/budget`, { budgeted: newBud, month: nowMonth });
      }

      // If tied to a specific transaction, approve it and write a memo (no category_id — YNAB rejects it on income)
      if (transaction) {
        const today = new Date().toISOString().slice(0, 10);
        const leftover = sourceDollars - totalAllocated;
        const memo = `[Budget App] ${today} • $${totalAllocated.toFixed(2)} budgeted • $${Math.abs(leftover).toFixed(2)} ${leftover >= 0 ? 'unallocated' : 'over'}`;
        // YNAB PUT requires the full transaction — spread existing fields, override only memo + approved
        const putRes = await api.put(`/transactions/${transaction.id}`, {
          ...transaction,
          approved: true,
          memo,
        });
        // Use YNAB's authoritative response so a background poll can't overwrite with stale data
        mergeTransactions([putRes.data?.id ? putRes.data : { ...transaction, approved: true, memo }]);
      }

      notifications.show({
        title: 'Income allocated',
        message: `$${totalAllocated.toFixed(2)} budgeted across ${valid.length} categor${valid.length !== 1 ? 'ies' : 'y'}`,
        color: 'teal',
      });
      onApplied?.();
      onClose();
    } catch (err) {
      const is429 = err.response?.status === 429 || err.message?.includes('429');
      notifications.show({
        title: is429 ? 'YNAB Rate Limit Hit' : 'Error allocating income',
        message: is429
          ? 'YNAB allows 200 API requests/hour. Quota is exhausted — wait until the top of the next hour and try again.'
          : err.response?.data?.error ?? err.message,
        color: 'orange',
        autoClose: is429 ? 8000 : 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon size="md" radius="sm" color="teal" variant="light">
            <IconCurrencyDollar size={16} />
          </ThemeIcon>
          <div>
            <Text fw={700} size="sm">Allocate Income to Budget</Text>
            <Text size="xs" c="dimmed">
              {transaction
                ? `${transaction.payee_name || 'Deposit'} · ${formatDate(transaction.date)}`
                : 'Ready to Assign pool'}
            </Text>
          </div>
        </Group>
      }
      size="lg"
    >
      <Stack>
        {/* Source amount banner */}
        <Card withBorder p="sm" radius="md" style={{ borderLeft: '4px solid var(--mantine-color-teal-5)', background: 'var(--mantine-color-teal-0)' }}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Available to allocate</Text>
            <Text fw={800} c="teal" size="lg">
              ${sourceDollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </Group>
        </Card>

        {/* Profile split loader — shown when profiles are provided */}
        {profiles?.length > 0 && (
          <Card withBorder p="sm" radius="md">
            <Text size="xs" fw={600} mb={6} c="dimmed">LOAD FROM INCOME SOURCE</Text>
            <Group gap="xs" wrap="wrap">
              {profiles.map((p) => {
                const PIcon = getIconComponent(p.icon);
                return (
                  <Button
                    key={p.id}
                    size="xs"
                    variant="light"
                    color={p.color}
                    leftSection={<PIcon size={12} />}
                    onClick={() => loadProfileSplits(p)}
                  >
                    {p.name}
                    <Text span size="xs" c="dimmed" ml={4}>
                      ({p.defaultSplits?.length ?? 0} splits)
                    </Text>
                  </Button>
                );
              })}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Selecting a source spreads ${sourceDollars.toFixed(2)} proportionally across its splits
            </Text>
          </Card>
        )}

        {/* Category rows */}
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>Budget to categories</Text>
          <Button size="xs" variant="light" color="teal" leftSection={<IconPlus size={12} />} onClick={addRow}>
            Add Category
          </Button>
        </Group>

        <Stack gap="xs">
          {rows.map((r, i) => {
            const cat = flatCategories.find((c) => c.id === r.categoryId);
            const currentBudgetDollars = cat ? Math.abs((cat.budgeted || 0) / 1000) : null;
            return (
              <Stack key={i} gap={2}>
                <Group align="flex-end" gap="xs">
                  <CategoryPicker
                    style={{ flex: 2 }}
                    size="sm"
                    placeholder="Select category…"
                    categories={flatCategories}
                    value={r.categoryId}
                    onChange={(v) => updateRow(i, 'categoryId', v)}
                    label={i === 0 ? 'Category' : undefined}
                    clearable={false}
                  />
                  <NumberInput
                    size="sm"
                    w={130}
                    label={i === 0 ? 'Amount' : undefined}
                    prefix="$"
                    decimalScale={2}
                    min={0}
                    value={r.amount}
                    onChange={(v) => updateRow(i, 'amount', v || 0)}
                  />
                  {rows.length > 1 && (
                    <ActionIcon size="sm" color="red" variant="subtle" mb={4} onClick={() => removeRow(i)}>
                      <IconX size={12} />
                    </ActionIcon>
                  )}
                </Group>
                {cat && currentBudgetDollars !== null && (
                  <Text size="xs" c="dimmed" pl={4}>
                    Current monthly budget: <strong>${currentBudgetDollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    {r.amount > 0 && (
                      <> → will become <strong style={{ color: 'var(--mantine-color-teal-6)' }}>
                        ${(currentBudgetDollars + r.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </strong></>
                    )}
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>

        {/* Progress bar */}
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="xs" c="dimmed">
              {totalAllocated > 0
                ? `$${totalAllocated.toFixed(2)} of $${sourceDollars.toFixed(2)} allocated`
                : 'Nothing allocated yet'}
            </Text>
            <Text size="xs" fw={600} c={isFullyAllocated ? 'teal' : remainder < -0.01 ? 'red' : 'orange'}>
              {isFullyAllocated
                ? '✓ Fully allocated'
                : remainder > 0.01
                ? `$${remainder.toFixed(2)} remaining`
                : `$${Math.abs(remainder).toFixed(2)} over by`}
            </Text>
          </Group>
          <Progress
            value={sourceDollars > 0 ? Math.min(100, (totalAllocated / sourceDollars) * 100) : 0}
            color={isFullyAllocated ? 'teal' : remainder < -0.01 ? 'red' : 'orange'}
            size="md"
            radius="xl"
          />
        </div>

        <Alert color="blue" icon={<IconAlertCircle size={14} />}>
          Each category's <strong>monthly budget envelope</strong> will be increased by the amount you enter.
          {transaction && <> The deposit transaction will also be <strong>approved</strong>.</>}
        </Alert>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} leftSection={<IconCheck size={14} />} onClick={handleApply}>
            Allocate to Budget
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Last 30 Days Income Card
// Shows ALL positive, non-transfer income from the last 30 days.
// Classifies each transaction as Payroll (matches a profile's payeeMatch) or Deposit.
// ─────────────────────────────────────────────────────────────────────────────
function Last30IncomeCard({ profiles, onLoadRules, onAllocateTotal, onOpenSplits, onScrollToBudget }) {
  const { transactions, activeBudgetId } = useYNAB();
  const [typeFilter,          setTypeFilter]          = useState('all');
  const [assignFilter,        setAssignFilter]        = useState('all'); // 'all' | 'assigned' | 'unassigned'
  const [allocateTxn,         setAllocateTxn]         = useState(null);
  const [allocateTotalDollars, setAllocateTotalDollars] = useState(null);
  const [allocateOpen,  { open: openAllocate, close: closeAllocate }] = useDisclosure(false);
  const [applyOpen,     { open: openApply,    close: closeApply    }] = useDisclosure(false);
  const [selected,      setSelected]      = useState(null);
  const [applyProfile,  setApplyProfile]  = useState(null);
  const [toBeAssigned,  setToBeAssigned]  = useState(null);
  const [listCollapsed, setListCollapsed] = useState(false); // expanded by default
  // Profile picker — shown when a deposit has no auto-matched profile
  const [pickerOpen,    { open: openPicker, close: closePicker }] = useDisclosure(false);
  const [pendingTxn,    setPendingTxn]    = useState(null);
  // Income txns manually checked off as "assigned" with no allocation (local-only)
  const [manualAssigned, setManualAssigned] = useState(new Set());

  useEffect(() => {
    api.get('/rules/manual-assignments')
      .then(r => setManualAssigned(new Set(r.data ?? [])))
      .catch(() => {});
  }, []);

  // Toggle the local "assigned, no allocation" marker for a transaction.
  // Never touches YNAB — no money moved, deposit left as-is.
  const toggleManualAssigned = async (txnId, next) => {
    setManualAssigned(prev => {                 // optimistic
      const s = new Set(prev);
      next ? s.add(txnId) : s.delete(txnId);
      return s;
    });
    try {
      if (next) await api.put(`/rules/manual-assignments/${txnId}`);
      else      await api.delete(`/rules/manual-assignments/${txnId}`);
    } catch (err) {
      setManualAssigned(prev => {               // revert on error
        const s = new Set(prev);
        next ? s.delete(txnId) : s.add(txnId);
        return s;
      });
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const refreshToBeAssigned = () => {
    if (!activeBudgetId) return;
    api.get('/budgets/month', { params: { budgetId: activeBudgetId } })
      .then((res) => setToBeAssigned(res.data.to_be_budgeted ?? null))
      .catch(() => {});
  };
  useEffect(() => { refreshToBeAssigned(); }, [activeBudgetId]);

  // Only filter TRUE internal YNAB transfers:
  //   - transfer_account_id is set (definitive YNAB internal transfer flag)
  //   - OR payee is "Transfer : [Account]" format (YNAB's own naming convention)
  // Do NOT filter "Transfer from Venmo" etc — those are external income
  const isTransfer = (t) =>
    !!t.transfer_account_id ||
    /^transfer\s*:\s*/i.test(t.payee_name ?? '');

  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }, []);

  const last30Income = useMemo(() => {
    return transactions
      .filter((t) =>
        !t.deleted &&
        t.amount > 0 &&
        !isTransfer(t) &&
        t.date >= thirtyDaysAgo &&
        t.cleared !== 'uncleared'
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, thirtyDaysAgo]);

  const classifyTxn = (t) => {
    const isPayroll = profiles.some((p) =>
      p.payeeMatch && t.payee_name?.toLowerCase().includes(p.payeeMatch.toLowerCase())
    );
    return isPayroll ? 'payroll' : 'deposit';
  };

  const matchProfile = (txn) =>
    profiles.find(
      (p) => p.payeeMatch && txn.payee_name?.toLowerCase().includes(p.payeeMatch.toLowerCase())
    );

  // A transaction is "assigned" if the user manually checked it off (local marker),
  // OR this app applied splits ([Budget App] memo), OR it's approved with a real category
  const isAssigned = (t) =>
    manualAssigned.has(t.id) ||
    t.memo?.startsWith('[Budget App') ||
    (t.approved && t.category_id && !t.category_name?.toLowerCase().includes('ready to assign'));

  // Assigned specifically via money movement (allocation / splits / real category) —
  // i.e. NOT the local no-allocation checkmark. Used to lock the checkbox.
  const isAssignedByAllocation = (t) =>
    t.memo?.startsWith('[Budget App') ||
    (t.approved && t.category_id && !t.category_name?.toLowerCase().includes('ready to assign'));

  const filtered = useMemo(() => {
    return last30Income.filter((t) => {
      const typeOk   = typeFilter   === 'all' || classifyTxn(t) === typeFilter;
      const assignOk = assignFilter === 'all' ||
        (assignFilter === 'assigned'   &&  isAssigned(t)) ||
        (assignFilter === 'unassigned' && !isAssigned(t));
      return typeOk && assignOk;
    });
  }, [last30Income, typeFilter, assignFilter, profiles, manualAssigned]);

  const runningTotal = filtered.reduce((s, t) => s + t.amount, 0) / 1000;
  const ynabTotal    = toBeAssigned !== null ? toBeAssigned / 1000 : null;

  const openAllocateModal = (txn) => {
    setAllocateTxn(txn);
    setAllocateTotalDollars(null);
    openAllocate();
  };

  const openAllocateTotalModal = (dollars) => {
    setAllocateTxn(null);
    setAllocateTotalDollars(dollars);
    openAllocate();
  };

  const openSplitApply = (txn) => {
    const matched = matchProfile(txn);
    if (matched) {
      setSelected(txn);
      setApplyProfile(matched);
      openApply();
    } else {
      // No auto-match — let user pick which profile's splits to use
      setPendingTxn(txn);
      openPicker();
    }
  };

  const confirmProfilePick = (profile) => {
    closePicker();
    setSelected(pendingTxn);
    setApplyProfile(profile);
    setPendingTxn(null);
    openApply();
  };

  return (
    <>
      <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
        {/* Teal header with to_be_budgeted */}
        <Box
          px="md" py="sm"
          style={{
            background: 'linear-gradient(135deg, var(--mantine-color-teal-6), var(--mantine-color-cyan-5))',
          }}
        >
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="sm" wrap="nowrap" style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => setListCollapsed(v => !v)}>
              {listCollapsed ? <IconChevronRight size={16} color="white" style={{ flexShrink: 0 }} /> : <IconChevronDown size={16} color="white" style={{ flexShrink: 0 }} />}
              <IconCurrencyDollar size={18} color="white" style={{ flexShrink: 0 }} />
              <Text fw={700} c="white" style={{ whiteSpace: 'nowrap' }}>Last 30 Days Income</Text>
              <Badge size="sm" color="white" variant="filled" c="teal" style={{ flexShrink: 0 }}>
                {last30Income.length}
              </Badge>
            </Group>
            <Group gap="sm" wrap="nowrap" style={{ marginLeft: 'auto' }}>
              <Stack gap={0} align="flex-end">
                <Text fw={800} c="white" size="md">
                  ${Math.abs(ynabTotal ?? runningTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                {ynabTotal !== null && (
                  <Text size="xs" c="white" style={{ opacity: 0.8 }}>Ready to Assign in YNAB</Text>
                )}
              </Stack>
              <Button
                size="xs"
                variant="white"
                color="teal"
                leftSection={<IconCurrencyDollar size={12} />}
                onClick={() => openAllocateTotalModal(ynabTotal ?? runningTotal)}
              >
                Allocate All
              </Button>
            </Group>
          </Group>
        </Box>

        {/* Note + filter bar + transaction list — hidden when collapsed */}
        {!listCollapsed && (
          <>
        <Box px="md" pt="sm" pb={4}>
          <Group justify="space-between" wrap="nowrap" mb={8}>
            <Text size="xs" c="dimmed">Showing income from the last 30 days</Text>
            <Text size="xs" fw={700} c="teal">
              Total: ${runningTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {(typeFilter !== 'all' || assignFilter !== 'all') && ' (filtered)'}
            </Text>
          </Group>
          <Group gap="xs" wrap="wrap" mb={8}>
            <SegmentedControl
              size="xs"
              value={typeFilter}
              onChange={setTypeFilter}
              data={[
                { value: 'all',     label: 'All'      },
                { value: 'payroll', label: 'Payroll'  },
                { value: 'deposit', label: 'Deposits' },
              ]}
            />
            <SegmentedControl
              size="xs"
              value={assignFilter}
              onChange={setAssignFilter}
              data={[
                { value: 'all',        label: 'All Status'  },
                { value: 'unassigned', label: '⬤ Pending'   },
                { value: 'assigned',   label: '✓ Assigned'  },
              ]}
            />
          </Group>
        </Box>

        {filtered.length === 0 ? (
          <Box px="md" py="lg" style={{ textAlign: 'center' }}>
            <Stack gap={4} align="center">
              <Text size="sm" fw={500} c="teal">No transactions found</Text>
              <Text size="xs" c="dimmed">No cleared income in the last 30 days{typeFilter !== 'all' ? ` for filter "${typeFilter}"` : ''}.</Text>
            </Stack>
          </Box>
        ) : (
          <Stack gap={0}>
            {filtered.map((txn, i) => {
              const type       = classifyTxn(txn);
              const matched    = matchProfile(txn);
              const splitsApplied = txn.memo?.startsWith('[Budget App');
              const isUnallocated = !txn.approved || !txn.category_id;
              const assigned      = isAssigned(txn);
              const lockedByAllocation = isAssignedByAllocation(txn); // assigned via money movement
              const manuallyChecked    = manualAssigned.has(txn.id);  // local no-allocation marker

              return (
                <Box
                  key={txn.id}
                  px="md"
                  py="sm"
                  style={{
                    borderBottom: i < filtered.length - 1
                      ? '1px solid var(--mantine-color-gray-2)'
                      : 'none',
                  }}
                >
                  {/* Wraps on narrow screens: payee block keeps full width,
                      amount + actions drop to their own right-aligned line. */}
                  <Group justify="space-between" wrap="wrap" gap={6}>
                    {/* Left: payee, date, type badge */}
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: '1 1 180px' }}>
                      <ThemeIcon
                        size="md" radius="sm"
                        color={type === 'payroll' ? (matched?.color ?? 'blue') : 'gray'}
                        variant="light"
                      >
                        <IconCurrencyDollar size={14} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} lineClamp={1}>{txn.payee_name || 'Unknown Payee'}</Text>
                        <Group gap={6} wrap="wrap">
                          <Text size="xs" c="dimmed">{formatDate(txn.date)}</Text>
                          <Badge
                            size="xs"
                            color={type === 'payroll' ? 'blue' : 'gray'}
                            variant="light"
                          >
                            {type === 'payroll' ? 'Payroll' : 'Deposit'}
                          </Badge>
                          <Badge
                            size="xs"
                            color={assigned ? 'teal' : 'orange'}
                            variant="dot"
                          >
                            {assigned ? 'Assigned' : 'Pending'}
                          </Badge>
                        </Group>
                      </div>
                    </Group>

                    {/* Right: amount, status badge, action button */}
                    <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0, marginLeft: 'auto' }}>
                      <Text fw={700} c="teal" size="md">{formatCurrency(txn.amount)}</Text>

                      {/* Check off as assigned — no money moved, local marker only */}
                      <Tooltip
                        withArrow
                        label={lockedByAllocation
                          ? 'Assigned via allocation — undo from the Allocate / Apply Splits action'
                          : manuallyChecked
                            ? 'Checked off as assigned (no money allocated) — click to undo'
                            : 'Mark as assigned without allocating money'}
                      >
                        <Checkbox
                          size="xs"
                          color="teal"
                          checked={assigned}
                          disabled={lockedByAllocation}
                          onChange={(e) => toggleManualAssigned(txn.id, e.currentTarget.checked)}
                        />
                      </Tooltip>

                      {type === 'payroll' && (
                        splitsApplied
                          ? <Badge size="xs" color="green" variant="filled">Splits Applied</Badge>
                          : <Badge size="xs" color="orange" variant="filled">Pending</Badge>
                      )}

                      {type === 'payroll' && splitsApplied && (
                        <Tooltip label="Re-apply splits (corrects a previous application)" withArrow>
                          <Button
                            size="xs"
                            color="teal"
                            variant="subtle"
                            leftSection={<IconCurrencyDollar size={12} />}
                            onClick={() => openSplitApply(txn)}
                          >
                            Re-assign
                          </Button>
                        </Tooltip>
                      )}

                      {type === 'payroll' && !splitsApplied && (
                        <Button
                          size="xs"
                          color={matched?.color ?? 'blue'}
                          variant="light"
                          leftSection={<IconGitBranch size={12} />}
                          onClick={() => openSplitApply(txn)}
                        >
                          Apply Splits
                        </Button>
                      )}

                      {/* Deposit only — payroll handles its own assign/re-assign above */}
                      {type === 'deposit' && (
                        <Button
                          size="xs"
                          color="teal"
                          variant={!isUnallocated ? 'subtle' : 'light'}
                          leftSection={<IconCurrencyDollar size={12} />}
                          onClick={() => openAllocateModal(txn)}
                        >
                          {!isUnallocated ? 'Re-assign' : 'Assign'}
                        </Button>
                      )}
                    </Group>
                  </Group>
                </Box>
              );
            })}
          </Stack>
        )}
          </>
        )}
      </Card>

      <SplitApplyModal
        opened={applyOpen}
        onClose={closeApply}
        transaction={selected}
        profile={applyProfile}
        onApplied={() => { onLoadRules?.(); refreshToBeAssigned(); }}
        onOpenSplits={onOpenSplits}
        onScrollToBudget={onScrollToBudget}
      />

      <AllocateModal
        opened={allocateOpen}
        onClose={closeAllocate}
        transaction={allocateTxn}
        totalDollars={allocateTotalDollars}
        onApplied={() => { onLoadRules?.(); refreshToBeAssigned(); }}
        profiles={profiles}
      />

      {/* Profile picker — for deposits that don't auto-match a source */}
      <Modal
        opened={pickerOpen}
        onClose={closePicker}
        title="Choose an income source"
        size="sm"
        centered
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            This deposit doesn't match a payroll source. Which income source splits would you like to apply?
          </Text>
          {profiles.map((p) => {
            const PIcon = getIconComponent(p.icon);
            return (
              <Button
                key={p.id}
                variant="light"
                color={p.color}
                leftSection={<PIcon size={16} />}
                justify="flex-start"
                onClick={() => confirmProfilePick(p)}
              >
                {p.name}
                {p.defaultSplits?.length > 0 && (
                  <Text span size="xs" c="dimmed" ml={6}>
                    ({p.defaultSplits.length} splits)
                  </Text>
                )}
              </Button>
            );
          })}
        </Stack>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending Paychecks Panel
// Shows unapproved positive transactions so the user can apply profile splits
// ─────────────────────────────────────────────────────────────────────────────
function SplitApplyModal({ opened, onClose, transaction, profile, onApplied, onOpenSplits, onScrollToBudget }) {
  const { mergeTransactions, flatCategories, mergeCategoryBudget, activeBudgetId } = useYNAB();
  const splits = profile?.defaultSplits ?? [];

  // Two-step flow: 'review' (edit) → 'confirm' (preview) → apply
  const [step,        setStep]        = useState('review'); // 'review' | 'confirm'
  const [extraSplits, setExtraSplits] = useState([]);
  const [applying,    setApplying]    = useState(false);

  useEffect(() => {
    if (opened) { setExtraSplits([]); setStep('review'); }
  }, [opened, transaction]);

  // Calculate dollar amount per split based on transaction amount
  const calculated = splits.map((s) => {
    const txnDollars = (transaction?.amount ?? 0) / 1000;
    const amt = s.type === 'percent' ? (txnDollars * s.value) / 100 : s.value;
    const cat = flatCategories.find((c) => c.id === s.categoryId);
    return { ...s, dollarAmt: amt, categoryName: cat?.name ?? s.categoryId, groupName: cat?.groupName ?? '' };
  });

  const txnDollars       = (transaction?.amount ?? 0) / 1000;
  const mainTotal        = calculated.reduce((sum, s) => sum + s.dollarAmt, 0);
  const extraTotal       = extraSplits.reduce((sum, e) => sum + (e.amount || 0), 0);
  const total            = mainTotal + extraTotal;
  const remainder        = txnDollars - total;
  const isFullyAllocated = Math.abs(remainder) < 0.01;

  const addExtra = () =>
    setExtraSplits((prev) => [...prev, { categoryId: null, amount: Math.max(0, parseFloat(remainder.toFixed(2))) }]);
  const updateExtra = (idx, field, value) =>
    setExtraSplits((prev) => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  const removeExtra = (idx) =>
    setExtraSplits((prev) => prev.filter((_, i) => i !== idx));

  const allSplitsForMemo = [
    ...calculated,
    ...extraSplits
      .filter((e) => e.categoryId && e.amount > 0)
      .map((e) => {
        const cat = flatCategories.find((c) => c.id === e.categoryId);
        return { categoryName: cat?.name ?? e.categoryId, groupName: cat?.groupName ?? '', dollarAmt: e.amount };
      }),
  ];

  const handleApply = async () => {
    setApplying(true);
    try {
      const nowMonth = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      })();

      // 1. Fetch FRESH category budgets from YNAB for this month — avoids stale flatCategories
      //    causing double-counting on retry or first-run with outdated context.
      const freshBudgeted = {};
      try {
        const monthRes = await api.get('/budgets/month', { params: { budgetId: activeBudgetId, month: `${nowMonth}-01` } });
        (monthRes.data?.categories ?? []).forEach((c) => { freshBudgeted[c.id] = c.budgeted ?? 0; });
      } catch {
        // Fall back to flatCategories if month fetch fails (e.g. rate limit already hit)
        flatCategories.forEach((c) => { freshBudgeted[c.id] = c.budgeted ?? 0; });
      }

      // 2. Budget each split to its YNAB category envelope — sequential to avoid rate limiting
      const allValid = [
        ...calculated.filter((s) => s.categoryId && s.dollarAmt > 0),
        ...extraSplits.filter((e) => e.categoryId && e.amount > 0).map((e) => {
          const cat = flatCategories.find((c) => c.id === e.categoryId);
          return { categoryId: e.categoryId, dollarAmt: e.amount, categoryName: cat?.name ?? e.categoryId };
        }),
      ];

      for (const s of allValid) {
        const currentBud = freshBudgeted[s.categoryId] ?? 0;
        const newBud     = currentBud + Math.round(s.dollarAmt * 1000);
        const result     = await api.patch(`/categories/${s.categoryId}/budget`, { budgeted: newBud, month: nowMonth });
        // Keep freshBudgeted in sync so subsequent splits in the same loop see updated values
        if (result?.data?.budgeted != null) freshBudgeted[s.categoryId] = result.data.budgeted;
        // Log each assignment with timestamp
        mergeCategoryBudget(s.categoryId, newBud);
      }

      // 2. Mark transaction approved with simple memo
      const totalBudgeted = allValid.reduce((s, x) => s + x.dollarAmt, 0);
      const leftOver      = txnDollars - totalBudgeted;
      const memo = `[Budget App] ${profile.name} • $${totalBudgeted.toFixed(2)} budgeted • $${Math.abs(leftOver).toFixed(2)} ${leftOver >= 0 ? 'unallocated' : 'over'}`;

      const putRes = await api.put(`/transactions/${transaction.id}`, { ...transaction, approved: true, memo });
      mergeTransactions([putRes.data?.id ? putRes.data : { ...transaction, approved: true, memo }]);

      // ── Save split history to SQLite (supplemental — non-blocking) ──
      try {
        await api.post('/rules/split-history', {
          transactionId: transaction.id,
          profileId:     profile.id,
          profileName:   profile.name,
          transactionDate: transaction.date,
          payeeName:     transaction.payee_name,
          totalAmount:   txnDollars,
          splits: allValid.map((s) => ({
            categoryId:   s.categoryId,
            categoryName: s.categoryName,
            groupName:    s.groupName ?? flatCategories.find((c) => c.id === s.categoryId)?.groupName ?? '',
            amount:       s.dollarAmt,
          })),
        });
      } catch (histErr) {
        console.error('[split-history] Failed to save:', histErr.message);
      }

      notifications.show({
        title: 'Splits applied ✓',
        message: `${allValid.length} categories budgeted in YNAB`,
        color: 'teal',
      });
      onApplied?.();
      onClose();
    } catch (err) {
      const is429 = err.response?.status === 429 || err.message?.includes('429');
      notifications.show({
        title: is429 ? 'YNAB Rate Limit Hit' : 'Error applying splits',
        message: is429
          ? 'YNAB allows 200 API requests/hour. Quota is exhausted — wait until the top of the next hour and try again.'
          : err.response?.data?.error ?? err.message,
        color: 'orange',
        autoClose: is429 ? 8000 : 5000,
      });
    } finally { setApplying(false); }
  };

  if (!transaction || !profile) return null;
  const ProfileIcon = getIconComponent(profile.icon);

  // ── CONFIRM step — clean read-only preview ──────────────────────────────────
  if (step === 'confirm') {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group gap="xs">
            <ThemeIcon color={profile.color} size="sm" variant="light">
              <ProfileIcon size={12} />
            </ThemeIcon>
            <Text fw={600}>Confirm Split Application</Text>
          </Group>
        }
        size="md"
      >
        <Stack>
          <Alert color="blue" icon={<IconAlertCircle size={14} />} p="sm">
            <Text size="xs">
              The following splits will be recorded in YNAB and the transaction will be marked <strong>approved</strong>.
              This cannot be undone automatically — cancel if anything looks wrong.
            </Text>
          </Alert>

          {/* Which check */}
          <Card withBorder radius="md" p="sm"
            style={{ borderLeft: `4px solid var(--mantine-color-${profile.color}-5)` }}>
            <Group justify="space-between">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={2}>{profile.name} paycheck</Text>
                <Text fw={600}>{transaction.payee_name || '—'}</Text>
                <Text size="xs" c="dimmed">{formatDate(transaction.date)}</Text>
              </div>
              <Text fw={800} size="xl" c="teal">{formatCurrency(transaction.amount)}</Text>
            </Group>
          </Card>

          {/* Split preview list */}
          <Stack gap={4}>
            <Text size="sm" fw={600} c="dimmed">Splits to apply</Text>
            {allSplitsForMemo.map((s, i) => (
              <Group key={i} justify="space-between" px={8} py={5}
                style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
                <div>
                  <Text size="xs" c="dimmed">{s.groupName}</Text>
                  <Text size="sm" fw={500}>{s.categoryName}</Text>
                </div>
                <Text fw={700} size="sm" c="teal">${s.dollarAmt.toFixed(2)}</Text>
              </Group>
            ))}
            <Divider />
            <Group justify="space-between" px={8}>
              <Text size="sm" fw={600}>Total</Text>
              <Text fw={700} size="sm" c={isFullyAllocated ? 'teal' : 'orange'}>
                ${total.toFixed(2)} / ${txnDollars.toFixed(2)}
                {!isFullyAllocated && ` (${remainder > 0 ? `$${remainder.toFixed(2)} unallocated` : `$${Math.abs(remainder).toFixed(2)} over`})`}
              </Text>
            </Group>
          </Stack>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setStep('review')}>← Back</Button>
            <Button color={profile.color} loading={applying} leftSection={<IconCheck size={14} />}
              onClick={handleApply}>
              Confirm &amp; Apply
            </Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  // ── REVIEW step — edit breakdown, add extra splits ──────────────────────────
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon color={profile.color} size="sm" variant="light">
            <ProfileIcon size={12} />
          </ThemeIcon>
          <Text fw={600}>Review Splits — {profile.name}</Text>
        </Group>
      }
      size="lg"
    >
      <Stack>
        {/* Transaction summary */}
        <Card withBorder radius="md" p="sm"
          style={{ borderLeft: `4px solid var(--mantine-color-${profile.color}-5)` }}>
          <Group justify="space-between">
            <div>
              <Text fw={600}>{transaction.payee_name || '—'}</Text>
              <Text size="xs" c="dimmed">{formatDate(transaction.date)}</Text>
            </div>
            <Text fw={700} c="teal" size="lg">{formatCurrency(transaction.amount)}</Text>
          </Group>
        </Card>

        {splits.length === 0 ? (
          <Stack gap="sm">
            <Alert color="orange" icon={<IconAlertTriangle size={16} />}>
              <Text size="sm" fw={500} mb={6}>No splits configured for {profile.name}</Text>
              <Text size="xs" c="dimmed">
                Set up budget splits for this income source so the app knows how to allocate each paycheck across your categories.
              </Text>
            </Alert>
            <Text size="xs" c="dimmed" ta="center">Where would you like to set them up?</Text>
            <Group grow>
              <Button
                variant="light"
                color="blue"
                leftSection={<IconGitBranch size={14} />}
                onClick={() => {
                  onClose();
                  onOpenSplits?.(profile);
                }}
              >
                Configure Splits
              </Button>
              <Button
                variant="light"
                color="teal"
                leftSection={<IconCurrencyDollar size={14} />}
                onClick={() => {
                  onClose();
                  onScrollToBudget?.();
                }}
              >
                Set Monthly Budgets
              </Button>
            </Group>
          </Stack>
        ) : (
          <>
            <Text size="sm" fw={500}>Split breakdown</Text>
            <Table withTableBorder withColumnBorders fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Rule</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {calculated.map((s, i) => (
                  <Table.Tr key={i}>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{s.groupName}</Text>
                      <Text size="sm">{s.categoryName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="outline" color={profile.color}>
                        {s.type === 'percent' ? `${s.value}%` : `$${s.value} fixed`}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" fw={600}>${s.dollarAmt.toFixed(2)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            {/* Coverage bar */}
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="xs" c="dimmed">Coverage</Text>
                <Text size="xs" c={isFullyAllocated ? 'teal' : remainder < -0.01 ? 'red' : 'orange'}>
                  {remainder > 0.01
                    ? `$${remainder.toFixed(2)} unallocated`
                    : remainder < -0.01
                    ? `$${Math.abs(remainder).toFixed(2)} over-allocated`
                    : '100% allocated ✓'}
                </Text>
              </Group>
              <Progress
                value={Math.min(100, (total / txnDollars) * 100)}
                color={isFullyAllocated ? 'teal' : remainder < -0.01 ? 'red' : 'orange'}
                size="sm"
              />
            </div>

            {/* Extra splits for remainder */}
            {(remainder > 0.01 || extraSplits.length > 0) && (
              <Card withBorder radius="sm" p="sm" bg="orange.0"
                style={{ borderColor: 'var(--mantine-color-orange-3)' }}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600} c="orange">
                      Allocate remaining ${remainder > 0 ? remainder.toFixed(2) : '0.00'}
                    </Text>
                    <Button size="xs" variant="light" color="orange"
                      leftSection={<IconPlus size={12} />} onClick={addExtra}>
                      Add Category
                    </Button>
                  </Group>
                  {extraSplits.map((e, i) => (
                    <Group key={i} align="flex-end" gap="xs">
                      <CategoryPicker
                        style={{ flex: 2 }} size="xs"
                        placeholder="Select category"
                        categories={flatCategories}
                        value={e.categoryId}
                        onChange={(v) => updateExtra(i, 'categoryId', v)}
                        label={i === 0 ? 'Category' : undefined}
                        clearable={false}
                      />
                      <NumberInput
                        size="xs" w={110} prefix="$" decimalScale={2} min={0}
                        label={i === 0 ? 'Amount' : undefined}
                        value={e.amount}
                        onChange={(v) => updateExtra(i, 'amount', v || 0)}
                      />
                      <ActionIcon size="sm" color="red" variant="subtle" mb={2}
                        onClick={() => removeExtra(i)}>
                        <IconX size={12} />
                      </ActionIcon>
                    </Group>
                  ))}
                  {extraSplits.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Click "Add Category" to allocate the remaining ${remainder.toFixed(2)}.
                    </Text>
                  )}
                </Stack>
              </Card>
            )}
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            color={profile.color}
            disabled={splits.length === 0}
            onClick={() => setStep('confirm')}
          >
            Preview &amp; Confirm →
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Family Budget CSV Import Modal (handles the complex family spreadsheet format)
// ─────────────────────────────────────────────────────────────────────────────
export function FamilyBudgetImportModal({ opened, onClose, profiles, rules, onImported }) {
  const { flatCategories } = useYNAB();
  const fileRef     = useRef(null);
  const [csvText,   setCsvText]   = useState('');
  const [rows,      setRows]      = useState(null); // parsed + per-row state
  const [parseErr,  setParseErr]  = useState(null);
  const [activeTab, setActiveTab] = useState('jon');
  const [jonChecks, setJonChecks]   = useState(2); // paychecks/month
  const [kellChecks, setKellChecks] = useState(2);
  const [income,    setIncome]      = useState(null); // { jonMonthly, jonPerCheck, kellyMonthly, kellyPerCheck }

  useEffect(() => {
    if (opened) { setCsvText(''); setRows(null); setParseErr(null); setIncome(null); }
  }, [opened]);

  const jonProfile   = profiles.find((p) => /adobe/i.test(p.name));
  const kellyProfile = profiles.find((p) => /forcepoint/i.test(p.name));

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText(ev.target.result); runParse(ev.target.result); };
    reader.readAsText(file);
  };

  const runParse = (text = csvText) => {
    const parsed = parseFamilyBudgetCSV(text, flatCategories);
    if (!parsed) {
      setParseErr('Could not detect the family budget format. Make sure the file contains "Estimate Amount" and "JON SHARE" headers.');
      setRows(null);
      setIncome(null);
    } else {
      setParseErr(null);
      setRows(parsed.items.map((r) => ({ ...r }))); // mutable copy
      setIncome(parsed.income);
    }
  };

  const updateRow = (id, field, value) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const jonRows   = rows?.filter((r) => r.jonShare   > 0) ?? [];
  const kellyRows = rows?.filter((r) => r.kellyShare > 0) ?? [];

  const buildSplits = (filteredRows, shareField, checksPerMonth) =>
    filteredRows
      .filter((r) => r[shareField === 'jonShare' ? 'jonInclude' : 'kellyInclude'] && r.categoryId)
      .map((r) => ({
        categoryId: r.categoryId,
        type:       'amount',
        value:      Math.round((r[shareField] / checksPerMonth) * 100) / 100,
        name:       r.name,
      }));

  // Save profile splits + checkAmount, then upsert a matching rule in the Rules tab
  const saveProfileAndRule = async (profile, splits, checkAmount) => {
    if (!profile) {
      notifications.show({ title: 'Profile not found', color: 'red' });
      return;
    }
    // 1. Update profile with new splits + checkAmount
    await api.put(`/rules/profiles/${profile.id}`, { ...profile, defaultSplits: splits, checkAmount });

    // 2. Upsert a rule for this profile
    const existing = (rules ?? []).find((r) => r.profileId === profile.id);
    const rulePayload = {
      name:       `Split ${profile.name} paycheck`,
      enabled:    true,
      profileId:  profile.id,
      trigger:    { type: 'payee', value: profile.payeeMatch },
      splits,
      autoApprove: false,
    };
    if (existing) {
      await api.put(`/rules/${existing.id}`, { ...existing, splits });
    } else {
      await api.post('/rules', rulePayload);
    }
  };

  const handleSaveJon = async () => {
    const splits      = buildSplits(jonRows, 'jonShare', jonChecks);
    const checkAmount = income?.jonPerCheck ?? 2529;
    try {
      await saveProfileAndRule(jonProfile, splits, checkAmount);
      notifications.show({ title: `Saved ${splits.length} splits + rule for ${jonProfile?.name ?? 'Adobe'}`, color: 'teal' });
      onImported();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleSaveKelly = async () => {
    const splits      = buildSplits(kellyRows, 'kellyShare', kellChecks);
    const checkAmount = income?.kellyPerCheck ?? 3060;
    try {
      await saveProfileAndRule(kellyProfile, splits, checkAmount);
      notifications.show({ title: `Saved ${splits.length} splits + rule for ${kellyProfile?.name ?? 'Forcepoint'}`, color: 'teal' });
      onImported();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const BudgetTable = ({ dataRows, shareField, includeField, checksPerMonth, checkAmount }) => {
    const totalMonthly  = dataRows.filter((r) => r[includeField]).reduce((s, r) => s + r[shareField], 0);
    const totalPerCheck = totalMonthly / checksPerMonth;
    const pctOfCheck    = checkAmount > 0 ? ((totalPerCheck / checkAmount) * 100).toFixed(1) : null;

    return (
      <Stack gap="sm">
        <Group gap="lg">
          <Text size="sm" c="dimmed">
            Monthly total: <strong>${totalMonthly.toFixed(0)}</strong>
          </Text>
          <Text size="sm" c="dimmed">
            Per paycheck: <strong style={{ color: 'var(--mantine-color-teal-6)' }}>${totalPerCheck.toFixed(0)}</strong>
          </Text>
          {pctOfCheck && (
            <Badge size="sm" color="grape" variant="light">
              {pctOfCheck}% of paycheck
            </Badge>
          )}
        </Group>
        <ScrollArea h={400}>
          <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>✓</Table.Th>
                <Table.Th>Group</Table.Th>
                <Table.Th>Budget Item</Table.Th>
                <Table.Th ta="right">Monthly $</Table.Th>
                <Table.Th ta="right">Per Check</Table.Th>
                {checkAmount > 0 && <Table.Th ta="right">% of Check</Table.Th>}
                <Table.Th style={{ minWidth: 220 }}>YNAB Category</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dataRows.map((row) => {
                const perCheck = row[shareField] / checksPerMonth;
                const pct = checkAmount > 0 ? ((perCheck / checkAmount) * 100).toFixed(1) : null;
                return (
                  <Table.Tr
                    key={row.id}
                    style={{ opacity: row[includeField] ? 1 : 0.4 }}
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs"
                        checked={!!row[includeField]}
                        onChange={(e) => updateRow(row.id, includeField, e.currentTarget.checked)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">{row.group}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={500}>{row.name}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <NumberInput
                        size="xs"
                        value={row[shareField]}
                        onChange={(v) => updateRow(row.id, shareField, v || 0)}
                        decimalScale={0}
                        prefix="$"
                        w={80}
                        styles={{ input: { textAlign: 'right', fontSize: 11 } }}
                      />
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs" fw={600} c="teal">
                        ${perCheck.toFixed(2)}
                      </Text>
                    </Table.Td>
                    {checkAmount > 0 && (
                      <Table.Td ta="right">
                        <Badge size="xs" color="grape" variant="light">{pct}%</Badge>
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Select
                        size="xs"
                        searchable
                        clearable
                        placeholder={row.matched ? undefined : '⚠ No match — pick one'}
                        data={flatCategories.map((c) => ({
                          value: c.id,
                          label: `${c.groupName} → ${c.name}`,
                        }))}
                        value={row.categoryId}
                        onChange={(v) => updateRow(row.id, 'categoryId', v)}
                        styles={{
                          input: {
                            fontSize: 11,
                            color: row.matched ? undefined : 'var(--mantine-color-orange-6)',
                          },
                        }}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Import Family Budget Spreadsheet"
      size="90vw"
      styles={{ content: { maxWidth: 1100 } }}
    >
      <Stack>
        <Alert icon={<IconAlertCircle size={14} />} color="blue">
          Upload your <strong>2025 BUDGET - FAMILY.csv</strong> file. The app will automatically
          extract Jon&rsquo;s (Adobe) and Kelly&rsquo;s (Forcepoint) monthly budget shares and
          calculate per-paycheck split amounts for each YNAB category.
        </Alert>

        {!rows && (
          <Stack gap="sm">
            <Button
              variant="outline"
              leftSection={<IconUpload size={14} />}
              onClick={() => fileRef.current?.click()}
              w="fit-content"
            >
              Choose Family Budget CSV
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            <Text size="xs" c="dimmed">Or paste the CSV content below:</Text>
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={5}
              styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
              placeholder="Paste CSV here…"
            />
            <Button variant="light" onClick={() => runParse()} disabled={!csvText.trim()}>
              Parse Budget
            </Button>
            {parseErr && (
              <Alert color="red" icon={<IconAlertCircle size={14} />}>{parseErr}</Alert>
            )}
          </Stack>
        )}

        {rows && (
          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tabs.List mb="md">
              <Tabs.Tab value="jon" leftSection={
                <ThemeIcon size="xs" color={jonProfile?.color ?? 'blue'} variant="light" radius="sm">
                  {(() => { const I = getIconComponent(jonProfile?.icon ?? 'building'); return <I size={10} />; })()}
                </ThemeIcon>
              }>
                Jon — {jonProfile?.name ?? 'Adobe'}
                <Badge size="xs" ml={6} color={jonProfile?.color ?? 'blue'} variant="light">
                  {jonRows.filter((r) => r.jonInclude).length} items
                </Badge>
              </Tabs.Tab>
              <Tabs.Tab value="kelly" leftSection={
                <ThemeIcon size="xs" color={kellyProfile?.color ?? 'orange'} variant="light" radius="sm">
                  {(() => { const I = getIconComponent(kellyProfile?.icon ?? 'shield'); return <I size={10} />; })()}
                </ThemeIcon>
              }>
                Kelly — {kellyProfile?.name ?? 'Forcepoint'}
                <Badge size="xs" ml={6} color={kellyProfile?.color ?? 'orange'} variant="light">
                  {kellyRows.filter((r) => r.kellyInclude).length} items
                </Badge>
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="jon">
              <Stack>
                {/* Income summary banner */}
                {income && (
                  <Card withBorder radius="sm" p="sm" bg={`${jonProfile?.color ?? 'blue'}.0`}
                    style={{ borderColor: `var(--mantine-color-${jonProfile?.color ?? 'blue'}-3)` }}>
                    <Group gap="xl">
                      <div>
                        <Text size="xs" c="dimmed">Monthly Net (Jon)</Text>
                        <Text fw={700} size="lg">${income.jonMonthly.toLocaleString()}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Per Paycheck</Text>
                        <Text fw={700} size="lg" c={jonProfile?.color ?? 'blue'}>${income.jonPerCheck.toLocaleString()}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Checks / month</Text>
                        <Text fw={700} size="lg">{jonChecks}×</Text>
                      </div>
                    </Group>
                  </Card>
                )}
                <Group>
                  <Text size="sm">Paychecks per month (Jon):</Text>
                  <SegmentedControl
                    size="xs"
                    value={String(jonChecks)}
                    onChange={(v) => setJonChecks(Number(v))}
                    data={[{ value: '1', label: '1× monthly' }, { value: '2', label: '2× bi-weekly' }]}
                  />
                </Group>
                <BudgetTable
                  dataRows={jonRows}
                  shareField="jonShare"
                  includeField="jonInclude"
                  checksPerMonth={jonChecks}
                  checkAmount={income?.jonPerCheck ?? 0}
                />
                <Group justify="flex-end">
                  <Button
                    color={jonProfile?.color ?? 'blue'}
                    leftSection={<IconFileImport size={14} />}
                    onClick={handleSaveJon}
                    disabled={!jonProfile}
                  >
                    Save splits + rule to {jonProfile?.name ?? 'Adobe'}
                  </Button>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="kelly">
              <Stack>
                {/* Income summary banner */}
                {income && (
                  <Card withBorder radius="sm" p="sm" bg={`${kellyProfile?.color ?? 'orange'}.0`}
                    style={{ borderColor: `var(--mantine-color-${kellyProfile?.color ?? 'orange'}-3)` }}>
                    <Group gap="xl">
                      <div>
                        <Text size="xs" c="dimmed">Monthly Net (Kelly)</Text>
                        <Text fw={700} size="lg">${income.kellyMonthly.toLocaleString()}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Per Paycheck</Text>
                        <Text fw={700} size="lg" c={kellyProfile?.color ?? 'orange'}>${income.kellyPerCheck.toLocaleString()}</Text>
                      </div>
                      <div>
                        <Text size="xs" c="dimmed">Checks / month</Text>
                        <Text fw={700} size="lg">{kellChecks}×</Text>
                      </div>
                    </Group>
                  </Card>
                )}
                <Group>
                  <Text size="sm">Paychecks per month (Kelly):</Text>
                  <SegmentedControl
                    size="xs"
                    value={String(kellChecks)}
                    onChange={(v) => setKellChecks(Number(v))}
                    data={[{ value: '1', label: '1× monthly' }, { value: '2', label: '2× bi-weekly' }]}
                  />
                </Group>
                <BudgetTable
                  dataRows={kellyRows}
                  shareField="kellyShare"
                  includeField="kellyInclude"
                  checksPerMonth={kellChecks}
                  checkAmount={income?.kellyPerCheck ?? 0}
                />
                <Group justify="flex-end">
                  <Button
                    color={kellyProfile?.color ?? 'orange'}
                    leftSection={<IconFileImport size={14} />}
                    onClick={handleSaveKelly}
                    disabled={!kellyProfile}
                  >
                    Save splits + rule to {kellyProfile?.name ?? 'Forcepoint'}
                  </Button>
                </Group>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}

        {rows && (
          <Group justify="space-between">
            <Button variant="subtle" size="xs" onClick={() => setRows(null)}>
              ← Re-upload
            </Button>
            <Button variant="default" onClick={onClose}>Close</Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple CSV Import Modal (for generic splits)
// ─────────────────────────────────────────────────────────────────────────────
export function CSVImportModal({ opened, onClose, profile, onImported }) {
  const { flatCategories } = useYNAB();
  const [csvText, setCsvText] = useState('');
  const [parsed,  setParsed]  = useState(null);
  const [parseError, setParseError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (opened) { setCsvText(''); setParsed(null); setParseError(null); }
  }, [opened]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText(ev.target.result); runParse(ev.target.result); };
    reader.readAsText(file);
  };

  const runParse = (text = csvText) => {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length < 2) { setParseError('Need at least a header row and one data row'); setParsed(null); return; }
    const headers  = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const catIdx   = headers.indexOf('category');
    const typeIdx  = headers.indexOf('type');
    const valIdx   = headers.indexOf('value');
    const labelIdx = headers.indexOf('label');
    if (catIdx === -1 || typeIdx === -1 || valIdx === -1) {
      setParseError('Required columns: category, type, value (optional: label)');
      setParsed(null); return;
    }
    setParseError(null);
    setParsed(lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim());
      const categoryName = cols[catIdx] || '';
      const rawType = (cols[typeIdx] || 'percent').toLowerCase();
      const value = parseFloat(cols[valIdx]) || 0;
      const label = labelIdx >= 0 ? cols[labelIdx] || '' : '';
      const matched = flatCategories.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase() ||
               `${c.groupName} → ${c.name}`.toLowerCase() === categoryName.toLowerCase()
      );
      return { categoryName, categoryId: matched?.id ?? null, matched: !!matched,
               type: ['percent','amount'].includes(rawType) ? rawType : 'percent', value, label };
    }));
  };

  const handleImport = async () => {
    if (!parsed || !profile) return;
    const splits = parsed.filter((r) => r.matched).map((r) => ({
      categoryId: r.categoryId, type: r.type, value: r.value, name: r.label,
    }));
    try {
      await api.put(`/rules/profiles/${profile.id}`, { ...profile, defaultSplits: splits });
      notifications.show({ title: `${splits.length} splits saved to ${profile.name}`, color: 'teal' });
      onImported(); onClose();
    } catch (err) {
      notifications.show({ title: 'Import failed', message: err.message, color: 'red' });
    }
  };

  const matchedCount   = parsed?.filter((r) => r.matched).length   ?? 0;
  const unmatchedCount = parsed?.filter((r) => !r.matched).length  ?? 0;

  return (
    <Modal opened={opened} onClose={onClose}
      title={`Import CSV Splits${profile ? ` → ${profile.name}` : ''}`} size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Format: <code style={{ background: 'var(--mantine-color-gray-1)', padding: '1px 5px', borderRadius: 3 }}>
            category, type, value, label
          </code>
        </Text>
        <Button variant="outline" leftSection={<IconUpload size={14} />}
          onClick={() => fileRef.current?.click()} w="fit-content">
          Choose CSV File
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv"
          style={{ display: 'none' }} onChange={handleFile} />
        <Textarea label="Or paste CSV content"
          placeholder={`category,type,value,label\nRent & Mortgage,percent,35,Housing\nGroceries,percent,10,Food`}
          value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={5}
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} />
        <Button variant="light" onClick={() => runParse()} disabled={!csvText.trim()}>Parse</Button>
        {parseError && <Alert color="red" icon={<IconAlertCircle size={16} />}>{parseError}</Alert>}
        {parsed && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge color="teal">{matchedCount} matched</Badge>
              {unmatchedCount > 0 && <Badge color="orange">{unmatchedCount} unmatched</Badge>}
            </Group>
            <ScrollArea h={240}>
              <Table striped withTableBorder withColumnBorders fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Category</Table.Th><Table.Th>Type</Table.Th>
                    <Table.Th>Value</Table.Th><Table.Th>Label</Table.Th><Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {parsed.map((row, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{row.categoryName}</Table.Td>
                      <Table.Td>{row.type}</Table.Td>
                      <Table.Td>{row.type === 'percent' ? `${row.value}%` : `$${row.value}`}</Table.Td>
                      <Table.Td>{row.label || '—'}</Table.Td>
                      <Table.Td>
                        {row.matched
                          ? <Badge size="xs" color="teal">✓ Matched</Badge>
                          : <Badge size="xs" color="red">✗ Not found</Badge>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={matchedCount === 0}
                leftSection={<IconFileImport size={14} />} color={profile?.color ?? 'blue'}>
                Save {matchedCount} splits to {profile?.name}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Modal
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_PROFILE = { name: '', color: 'blue', icon: 'building', payeeMatch: '', description: '', checkAmount: null };

export function ProfileModal({ opened, onClose, profile, onSaved }) {
  const isEdit = !!profile?.id;
  const [form, setForm] = useState({ ...EMPTY_PROFILE });

  useEffect(() => {
    setForm(profile ? { ...profile } : { ...EMPTY_PROFILE });
  }, [profile, opened]);

  const handleSave = async () => {
    if (!form.name.trim())       return notifications.show({ title: 'Name required',         color: 'red' });
    if (!form.payeeMatch.trim()) return notifications.show({ title: 'Payee match required',  color: 'red' });
    try {
      isEdit
        ? await api.put(`/rules/profiles/${profile.id}`, form)
        : await api.post('/rules/profiles', form);
      notifications.show({ title: isEdit ? 'Source updated' : 'Source created', color: 'teal' });
      onSaved(); onClose();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const IconPreview = getIconComponent(form.icon);

  return (
    <Modal opened={opened} onClose={onClose}
      title={isEdit ? 'Edit Income Source' : 'New Income Source'} size="md">
      <Stack>
        <Card withBorder radius="md" p="sm"
          style={{ borderLeft: `4px solid ${PROFILE_COLORS[form.color] ?? PROFILE_COLORS.gray}` }}>
          <Group gap="sm">
            <ThemeIcon size="lg" radius="md" color={form.color} variant="light">
              <IconPreview size={18} />
            </ThemeIcon>
            <div>
              <Text fw={700} size="sm">{form.name || 'Preview'}</Text>
              <Text size="xs" c="dimmed">{form.description || 'Paycheck source'}</Text>
            </div>
          </Group>
        </Card>
        <TextInput label="Source Name" required value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Adobe" />
        <TextInput label="Payee Match Pattern" required value={form.payeeMatch}
          onChange={(e) => setForm((f) => ({ ...f, payeeMatch: e.target.value }))}
          placeholder="e.g. ADOBE INC"
          description="Transactions whose payee contains this text will be tagged as this source" />
        <TextInput label="Description" value={form.description || ''}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="e.g. Adobe Inc. bi-weekly salary" />
        <NumberInput
          label="Bi-weekly Paycheck Amount"
          value={form.checkAmount ?? ''}
          onChange={(v) => setForm((f) => ({ ...f, checkAmount: v || null }))}
          prefix="$"
          decimalScale={2}
          placeholder="e.g. 2529.00"
          description="Your take-home pay per paycheck. Used to show % of check in split rules."
        />
        <Select label="Icon" data={ICON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={form.icon} onChange={(v) => setForm((f) => ({ ...f, icon: v }))} />
        <div>
          <Text size="sm" fw={500} mb={6}>Color</Text>
          <Group gap="xs">
            {COLOR_OPTIONS.map((color) => (
              <Tooltip key={color} label={color}>
                <ColorSwatch color={PROFILE_COLORS[color]} size={26} style={{
                  cursor: 'pointer',
                  outline: form.color === color ? `2px solid ${PROFILE_COLORS[color]}` : 'none',
                  outlineOffset: 2,
                }} onClick={() => setForm((f) => ({ ...f, color }))} />
              </Tooltip>
            ))}
          </Group>
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color={form.color} onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Create Source'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Card
// ─────────────────────────────────────────────────────────────────────────────
export function ProfileCard({ profile, allRules, onEdit, onDelete, onImportCSV, onModifySplits }) {
  const Icon        = getIconComponent(profile.icon);
  const ruleCount   = allRules.filter((r) => r.profileId === profile.id).length;
  const activeCount = allRules.filter((r) => r.profileId === profile.id && r.enabled).length;
  const splitCount  = profile.defaultSplits?.length ?? 0;

  return (
    <Card withBorder radius="md" p={0} style={{
      overflow: 'hidden',
      borderColor: `var(--mantine-color-${profile.color}-3)`,
    }}>
      <Box bg={`${profile.color}.6`} px="md" py="xs">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size={34} radius="md" variant="white"
              style={{ color: `var(--mantine-color-${profile.color}-6)` }}>
              <Icon size={18} />
            </ThemeIcon>
            <div>
              <Text fw={700} size="md" c="white" lineClamp={1}>{profile.name}</Text>
              <Text size="xs" c={`${profile.color}.1`} lineClamp={1}>
                {profile.description || 'Paycheck source'}
              </Text>
            </div>
          </Group>
          <Group gap={4}>
            <Tooltip label="Edit source">
              <ActionIcon variant="white" color={profile.color} size="sm" onClick={onEdit}>
                <IconEdit size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete source">
              <ActionIcon variant="white" color="red" size="sm" onClick={onDelete}>
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      <Box px="md" py="sm">
        <Text size="xs" c="dimmed" mb="xs">
          Matches payee:{' '}
          <code style={{ background: 'var(--mantine-color-gray-1)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
            {profile.payeeMatch}
          </code>
        </Text>
        <Group gap="xs" mb="sm" wrap="wrap">
          <Badge size="sm" color={profile.color} variant="light">
            {ruleCount} rule{ruleCount !== 1 ? 's' : ''}
          </Badge>
          {activeCount > 0 && (
            <Badge size="sm" color="green" variant="dot">{activeCount} active</Badge>
          )}
          {splitCount > 0 && (
            <Badge size="sm" color="grape" variant="light">
              {splitCount} budget split{splitCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {profile.checkAmount > 0 && (
            <Badge size="sm" color="teal" variant="light">
              ${profile.checkAmount.toLocaleString()}/check
            </Badge>
          )}
        </Group>
        <Group gap="xs" wrap="wrap">
          <Button size="xs" color={profile.color} variant="light"
            leftSection={<IconGitBranch size={12} />} onClick={onModifySplits}>
            Modify Splits
          </Button>
          <Button size="xs" variant="subtle" color="gray"
            leftSection={<IconFileImport size={12} />} onClick={onImportCSV}>
            Simple CSV
          </Button>
        </Group>
      </Box>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule Modal
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_RULE = {
  name: '', enabled: true, profileId: null,
  trigger: { type: 'payee', value: '' },
  splits: [], autoApprove: false,
};

function RuleModal({ opened, onClose, rule, profiles, defaultProfileId, onSaved }) {
  const { flatCategories } = useYNAB();
  const isEdit = !!rule?.id;
  const [form, setForm] = useState({ ...EMPTY_RULE });

  useEffect(() => {
    if (rule) {
      setForm({ ...rule, trigger: { ...rule.trigger }, splits: [...(rule.splits ?? [])] });
    } else {
      setForm({ ...EMPTY_RULE, splits: [], profileId: defaultProfileId ?? null });
    }
  }, [rule, defaultProfileId, opened]);

  const handleProfileChange = (profileId) => {
    const p = profiles.find((x) => x.id === profileId);
    setForm((f) => ({
      ...f, profileId,
      trigger: !f.trigger.value && p ? { ...f.trigger, value: p.payeeMatch } : f.trigger,
    }));
  };

  const loadProfileSplits = () => {
    const p = profiles.find((x) => x.id === form.profileId);
    if (!p?.defaultSplits?.length) return;
    setForm((f) => ({ ...f, splits: [...p.defaultSplits] }));
    notifications.show({ title: `Loaded ${p.defaultSplits.length} splits from ${p.name}`, color: 'teal' });
  };

  const handleSave = async () => {
    if (!form.name.trim())    return notifications.show({ title: 'Name required',          color: 'red' });
    if (!form.trigger.value)  return notifications.show({ title: 'Trigger value required', color: 'red' });
    try {
      isEdit
        ? await api.put(`/rules/${rule.id}`, form)
        : await api.post('/rules', form);
      notifications.show({ title: isEdit ? 'Rule updated' : 'Rule created', color: 'teal' });
      onSaved(); onClose();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const addSplit    = () => setForm((f) => ({ ...f, splits: [...f.splits, { categoryId: '', type: 'percent', value: 0, name: '' }] }));
  const updateSplit = (idx, field, value) => setForm((f) => { const s = [...f.splits]; s[idx] = { ...s[idx], [field]: value }; return { ...f, splits: s }; });
  const removeSplit = (idx) => setForm((f) => ({ ...f, splits: f.splits.filter((_, i) => i !== idx) }));

  const selectedProfile = profiles.find((p) => p.id === form.profileId);

  return (
    <Modal opened={opened} onClose={onClose}
      title={isEdit ? 'Edit Rule' : 'New Income Rule'} size="xl">
      <Stack>
        <Select label="Income Source" placeholder="Link to an income source (optional)"
          data={profiles.map((p) => ({ value: p.id, label: p.name }))}
          value={form.profileId} onChange={handleProfileChange} clearable
          leftSection={selectedProfile
            ? <ColorSwatch color={PROFILE_COLORS[selectedProfile.color]} size={14} />
            : undefined} />
        <TextInput label="Rule Name" required value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Split Adobe bi-weekly paycheck" />
        <Divider label="Trigger" labelPosition="left" />
        <Group align="flex-end">
          <Select label="When"
            data={[
              { value: 'payee',         label: 'Payee contains'   },
              { value: 'amount_above',  label: 'Amount above ($)' },
              { value: 'memo_contains', label: 'Memo contains'    },
            ]}
            value={form.trigger.type}
            onChange={(v) => setForm((f) => ({ ...f, trigger: { ...f.trigger, type: v } }))} w={200} />
          <TextInput label="Value" value={form.trigger.value}
            onChange={(e) => setForm((f) => ({ ...f, trigger: { ...f.trigger, value: e.target.value } }))}
            placeholder={form.trigger.type === 'amount_above' ? '1000' : 'e.g. ADOBE INC'}
            style={{ flex: 1 }} />
        </Group>
        <Divider label="Splits" labelPosition="left" />
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed">How to distribute the incoming deposit across categories.</Text>
          {selectedProfile?.defaultSplits?.length > 0 && (
            <Button size="xs" variant="light" color={selectedProfile.color} onClick={loadProfileSplits}>
              Load {selectedProfile.defaultSplits.length} splits from {selectedProfile.name}
            </Button>
          )}
        </Group>

        {form.splits.map((split, i) => (
          <SplitRow key={i} split={split} index={i} flatCategories={flatCategories}
            onChange={updateSplit} onRemove={removeSplit}
            checkAmount={selectedProfile?.checkAmount ?? 0} />
        ))}

        <Group justify="space-between" align="center">
          <Button variant="outline" size="xs" leftSection={<IconPlus size={14} />}
            onClick={addSplit} w="fit-content">
            Add Split
          </Button>

          {/* Live allocation total for % splits */}
          {form.splits.some((s) => s.type === 'percent') && (() => {
            const total = form.splits.filter((s) => s.type === 'percent').reduce((sum, s) => sum + (s.value || 0), 0);
            const color = total === 100 ? 'teal' : total > 100 ? 'red' : 'orange';
            return (
              <Badge size="sm" color={color} variant="light">
                {total}% allocated{total < 100 ? ` — ${100 - total}% remaining` : total > 100 ? ' — OVER by ' + (total - 100) + '%' : ' ✓'}
              </Badge>
            );
          })()}
        </Group>

        {form.splits.length === 0 && (
          <Alert color="blue" icon={<IconAlertCircle size={14} />}>
            No splits defined. The rule will match transactions but not assign any categories until
            you add at least one split.
          </Alert>
        )}

        <Divider />
        <Checkbox label="Auto-approve matched transactions" checked={form.autoApprove}
          onChange={(e) => setForm((f) => ({ ...f, autoApprove: e.currentTarget.checked }))} />

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color={selectedProfile?.color ?? 'teal'} onClick={handleSave}>
            {isEdit ? 'Update Rule' : 'Create Rule'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Splits Modal — view/edit a profile's defaultSplits with full CRUD + clear-all
// ─────────────────────────────────────────────────────────────────────────────
export function SplitsModal({ opened, onClose, profile, allProfiles, onSaved }) {
  const { flatCategories } = useYNAB();
  const [splits,       setSplits]       = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [syncSourceId, setSyncSourceId] = useState(null);   // id of profile to copy from
  const [syncPending,  setSyncPending]  = useState(false);  // showing confirm banner

  const checkAmount        = profile?.checkAmount ?? 0;
  const CHECKS_PER_SOURCE  = 2; // bi-weekly per source
  const numSources         = (allProfiles?.length ?? 1) || 1;
  const perCheckDivisor    = numSources * CHECKS_PER_SOURCE; // e.g. 2 sources × 2 = 4

  // Sort splits by group A→Z, then category name A→Z (e.g. Vehicle > Insurance)
  const sortedByCat = (arr) =>
    [...arr].sort((a, b) => {
      const catA   = flatCategories.find((c) => c.id === a.categoryId);
      const catB   = flatCategories.find((c) => c.id === b.categoryId);
      const groupA = catA?.groupName ?? '';
      const groupB = catB?.groupName ?? '';
      const nameA  = catA?.name ?? '';
      const nameB  = catB?.name ?? '';
      return groupA.localeCompare(groupB) || nameA.localeCompare(nameB);
    });

  useEffect(() => {
    if (opened && profile) {
      setSplits(sortedByCat((profile.defaultSplits ?? []).map((s) => ({ ...s }))));
      setSyncSourceId(null);
      setSyncPending(false);
    }
  }, [opened, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Categories with a non-zero YNAB budget that are NOT yet in this profile's splits
  const missingFromSplits = useMemo(() => {
    const EXCLUDED = new Set(['Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments']);
    const inSplits = new Set(splits.map((s) => s.categoryId).filter(Boolean));
    return (flatCategories ?? [])
      .filter((c) => !c.hidden && !c.deleted && !EXCLUDED.has(c.groupName) && c.budgeted > 0 && !inSplits.has(c.id))
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
  }, [splits, flatCategories]);

  const addMissingCategory = (cat) => {
    const monthly  = Math.abs((cat.budgeted || 0) / 1000);
    const perCheck = perCheckDivisor > 0 ? parseFloat((monthly / perCheckDivisor).toFixed(2)) : 0;
    setSplits((prev) => sortedByCat([...prev, { categoryId: cat.id, type: 'amount', value: perCheck, name: cat.name }]));
  };

  const addSplit    = () => setSplits((prev) => sortedByCat([...prev, { categoryId: '', type: 'amount', value: 0, name: '' }]));
  const updateSplit = (idx, field, value) =>
    setSplits((prev) => {
      const s = [...prev];
      s[idx] = { ...s[idx], [field]: value };
      // Re-sort whenever the category assignment changes
      return field === 'categoryId' ? sortedByCat(s) : s;
    });
  const removeSplit = (idx) => setSplits((prev) => prev.filter((_, i) => i !== idx));

  // Budget math
  const totalPerCheck = splits.reduce((sum, s) => sum + splitDollarAmount(s, checkAmount), 0);
  const overage       = checkAmount > 0 ? totalPerCheck - checkAmount : 0;
  const isOver        = overage > 0.01;
  const isBalanced    = checkAmount > 0 && Math.abs(overage) < 0.01;
  const budgetColor   = isOver ? 'red' : isBalanced ? 'teal' : 'orange';

  const persist = async (newSplits) => {
    await api.put(`/rules/profiles/${profile.id}`, { ...profile, defaultSplits: newSplits });
    try {
      const rr = await api.get('/rules');
      const linked = rr.data.find((r) => r.profileId === profile.id);
      if (linked) await api.put(`/rules/${linked.id}`, { ...linked, splits: newSplits });
    } catch (_) { /* non-critical */ }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persist(splits);
      notifications.show({ title: `${splits.length} split${splits.length !== 1 ? 's' : ''} saved`, color: 'teal' });
      onSaved();
      onClose();
    } catch (err) {
      notifications.show({ title: 'Error saving splits', message: err.message, color: 'red' });
    } finally { setSaving(false); }
  };

  const handleClearAll = async () => {
    setSaving(true);
    try {
      await persist([]);
      setSplits([]);
      setConfirmClear(false);
      notifications.show({ title: 'All splits cleared', color: 'orange' });
      onSaved();
    } catch (err) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally { setSaving(false); }
  };

  if (!profile) return null;

  const ProfileIcon = getIconComponent(profile.icon);

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        size="90%"
        title={
          <Group gap="sm">
            <ThemeIcon size="md" radius="sm" color={profile.color} variant="light">
              <ProfileIcon size={16} />
            </ThemeIcon>
            <div>
              <Text fw={700} size="sm">{profile.name} — Budget Splits</Text>
              <Text size="xs" c="dimmed">
                {checkAmount > 0
                  ? `$${checkAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} per paycheck · bi-weekly (2×/mo)`
                  : 'Set a paycheck amount in the profile to enable budget math'}
              </Text>
            </div>
          </Group>
        }
      >
        <Stack>
          {/* ── Top toolbar: math explainer + sync button ── */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Alert color="blue" icon={<IconAlertCircle size={14} />} p="sm" style={{ flex: 1 }}>
              <Text size="xs" fw={600} mb={2}>How the math works</Text>
              <Text size="xs" c="dimmed">
                {numSources} income source{numSources !== 1 ? 's' : ''} × {CHECKS_PER_SOURCE} checks/month = <strong>{perCheckDivisor} total checks</strong>.
                Per-check amount = monthly budget ÷ {numSources} source{numSources !== 1 ? 's' : ''} ÷ {CHECKS_PER_SOURCE} checks.
                {' '}Example: $4,000/mo mortgage ÷ {numSources} ÷ {CHECKS_PER_SOURCE} = <strong>${(4000 / perCheckDivisor).toFixed(0)}/check</strong>.
              </Text>
            </Alert>

            {(allProfiles?.length ?? 0) > 1 && !syncPending && (
              <Button
                size="xs"
                variant="light"
                color="violet"
                leftSection={<IconGitBranch size={13} />}
                onClick={() => setSyncPending(true)}
                style={{ flexShrink: 0, marginTop: 2 }}
              >
                Sync from source
              </Button>
            )}
          </Group>

          {/* ── Sync confirmation banner ── */}
          {syncPending && (
            <Card withBorder radius="md" p="sm" style={{ borderLeft: '4px solid var(--mantine-color-violet-5)' }}>
              <Stack gap="xs">
                <Text size="sm" fw={600} c="violet">Copy splits from another source</Text>
                <Text size="xs" c="dimmed">
                  Select a source below. Its splits will replace <strong>{profile.name}</strong>'s current splits.
                  You can review and adjust before saving.
                </Text>
                <Group gap="sm" align="flex-end">
                  <Select
                    style={{ flex: 1 }}
                    placeholder="Pick a source…"
                    value={syncSourceId}
                    onChange={setSyncSourceId}
                    data={(allProfiles ?? [])
                      .filter((p) => p.id !== profile.id)
                      .map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <Button
                    size="xs"
                    color="violet"
                    disabled={!syncSourceId}
                    leftSection={<IconCheck size={13} />}
                    onClick={() => {
                      const src = (allProfiles ?? []).find((p) => p.id === syncSourceId);
                      if (src?.defaultSplits) {
                        // Copy all fields, then recalculate per-check using current perCheckDivisor
                        const synced = sortedByCat(src.defaultSplits.map((s) => {
                          const cat     = flatCategories.find((c) => c.id === s.categoryId);
                          const monthly = cat ? Math.abs((cat.budgeted || 0) / 1000) : null;
                          const value   = (monthly !== null && perCheckDivisor > 0)
                            ? parseFloat((monthly / perCheckDivisor).toFixed(2))
                            : s.value;
                          return { ...s, type: 'amount', value };
                        }));
                        setSplits(synced);
                        notifications.show({
                          title: 'Splits synced',
                          message: `${synced.length} splits copied from ${src.name} and recalculated (÷ ${perCheckDivisor}). Review and hit Save to apply.`,
                          color: 'violet',
                          autoClose: 5000,
                        });
                      }
                      setSyncPending(false);
                      setSyncSourceId(null);
                    }}
                  >
                    Apply
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconX size={13} />}
                    onClick={() => { setSyncPending(false); setSyncSourceId(null); }}
                  >
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Card>
          )}

          {splits.length === 0 ? (
            <Alert color="gray" icon={<IconAlertCircle size={14} />}>
              No splits yet. Add one below, or import from <strong>Family Budget CSV</strong>.
            </Alert>
          ) : (
            <Stack gap="sm">
              {splits.map((split, i) => (
                <SplitRow
                  key={split.categoryId || `new-${i}`}
                  split={split}
                  index={i}
                  isFirst={i === 0}
                  flatCategories={flatCategories}
                  onChange={updateSplit}
                  onRemove={removeSplit}
                  checkAmount={checkAmount}
                />
              ))}
            </Stack>
          )}

          {/* ── Missing from budget panel ── */}
          {missingFromSplits.length > 0 && (
            <Card withBorder radius="sm" p="sm"
              style={{ borderColor: 'var(--mantine-color-orange-4)', background: 'var(--mantine-color-orange-0)' }}>
              <Group mb="xs" gap="xs">
                <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" />
                <Text size="xs" fw={600} c="orange.7">
                  {missingFromSplits.length} budgeted categor{missingFromSplits.length !== 1 ? 'ies' : 'y'} not in your splits
                </Text>
              </Group>
              <Stack gap={4}>
                {missingFromSplits.map((cat) => {
                  const monthly  = Math.abs((cat.budgeted || 0) / 1000);
                  const perCheck = perCheckDivisor > 0 ? parseFloat((monthly / perCheckDivisor).toFixed(2)) : 0;
                  return (
                    <Group key={cat.id} justify="space-between" py={4}
                      style={{ borderBottom: '1px solid var(--mantine-color-orange-2)' }}>
                      <div>
                        <Text size="xs" c="dimmed">{cat.groupName}</Text>
                        <Text size="sm">{cat.name}</Text>
                      </div>
                      <Group gap="xs">
                        <Text size="xs" c="dimmed">${monthly.toFixed(2)}/mo → ${perCheck.toFixed(2)}/check</Text>
                        <Button size="xs" variant="light" color="orange"
                          leftSection={<IconPlus size={10} />}
                          onClick={() => addMissingCategory(cat)}>
                          Add
                        </Button>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            </Card>
          )}

          <Button variant="outline" size="xs" leftSection={<IconPlus size={14} />} onClick={addSplit} style={{ alignSelf: 'flex-start' }}>
            Add Split
          </Button>

          {/* ── Budget math summary ── */}
          {checkAmount > 0 && splits.length > 0 && (
            <Card withBorder radius="md" p="sm" style={{ borderLeft: `4px solid var(--mantine-color-${budgetColor}-5)` }}>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>Paycheck Budget Summary</Text>
                  <Badge color={budgetColor} variant="light">
                    {isOver
                      ? `⚠ Over by $${overage.toFixed(2)}/check`
                      : isBalanced
                      ? '✓ Fully allocated'
                      : `$${Math.abs(overage).toFixed(2)} unallocated`}
                  </Badge>
                </Group>

                <Progress
                  value={checkAmount > 0 ? Math.min(100, (totalPerCheck / checkAmount) * 100) : 0}
                  color={budgetColor}
                  size="lg"
                  radius="xl"
                />

                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Splits total: <strong>${totalPerCheck.toFixed(2)}</strong>/check
                    &nbsp;·&nbsp;
                    Shared monthly: <strong>${(totalPerCheck * perCheckDivisor).toFixed(2)}</strong>
                    &nbsp;({numSources} src × {CHECKS_PER_SOURCE} checks)
                  </Text>
                  <Text size="xs" c="dimmed">
                    Check size: <strong>${checkAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                    &nbsp;·&nbsp;
                    Monthly income: <strong>${(checkAmount * CHECKS_PER_SOURCE).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>/source
                  </Text>
                </Group>

                {isOver && (
                  <Alert color="red" icon={<IconAlertTriangle size={14} />} p="xs">
                    Your splits exceed your ${checkAmount.toFixed(2)} paycheck by <strong>${overage.toFixed(2)}</strong>.
                    Reduce split amounts or increase your check amount in the profile settings.
                  </Alert>
                )}
              </Stack>
            </Card>
          )}

          <Divider />

          <Group justify="space-between" align="center">
            <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />}
              disabled={splits.length === 0} onClick={() => setConfirmClear(true)}>
              Clear All Splits
            </Button>
            <Group align="center">
              <Button variant="default" onClick={onClose}>Cancel</Button>
              <Button color={profile.color} loading={saving} onClick={handleSave} leftSection={<IconCheck size={14} />}>
                Save Changes
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <ConfirmDeleteModal
        opened={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear All Splits"
        description={`This will remove all ${splits.length} split${splits.length !== 1 ? 's' : ''} from ${profile.name}. This cannot be undone.`}
        onConfirm={handleClearAll}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Budget Summary — shows income vs budgeted amounts at the bottom of
// the Income page so the user can see surplus/deficit at a glance
// ─────────────────────────────────────────────────────────────────────────────
export function MonthlyBudgetSummaryCard({ profiles }) {
  const { flatCategories } = useYNAB();

  // Total monthly income: each profile pays 2 paychecks/month (bi-weekly)
  const totalMonthlyIncome = profiles.reduce((sum, p) => sum + (p.checkAmount || 0) * 2, 0);

  // Unique category IDs across all splits (each category counted once)
  const uniqueCategoryIds = useMemo(() => {
    const ids = new Set();
    (profiles ?? []).forEach((p) => (p.defaultSplits ?? []).forEach((s) => s.categoryId && ids.add(s.categoryId)));
    return [...ids];
  }, [profiles]);

  // Total monthly budgeted = sum of YNAB envelope budgets for those categories
  const totalMonthlyBudgeted = useMemo(
    () => uniqueCategoryIds.reduce((sum, id) => {
      const cat = flatCategories.find((c) => c.id === id);
      return sum + (cat ? Math.abs(cat.budgeted || 0) / 1000 : 0);
    }, 0),
    [uniqueCategoryIds, flatCategories]
  );

  const difference  = totalMonthlyIncome - totalMonthlyBudgeted;
  const isOver      = difference < -0.01;
  const isBalanced  = Math.abs(difference) < 1;
  const statusColor = isOver ? 'red' : isBalanced ? 'teal' : 'green';

  // Per-source rows: income and split commitment per source
  const sourceRows = useMemo(
    () => profiles.map((p) => {
      const monthlyIncome   = (p.checkAmount || 0) * 2;
      // Per-check splits total in dollars
      const perCheckSplits  = (p.defaultSplits ?? []).reduce((sum, s) =>
        sum + (s.type === 'percent' ? (s.value / 100) * (p.checkAmount || 0) : (s.value || 0)), 0);
      const monthlyCommitted = perCheckSplits * 2;
      return { ...p, monthlyIncome, monthlyCommitted };
    }),
    [profiles]
  );

  if (profiles.length === 0 || totalMonthlyIncome === 0) return null;

  return (
    <Card withBorder radius="md" p="md"
      style={{ borderLeft: `4px solid var(--mantine-color-${statusColor}-5)` }}>
      <Group mb="md" gap="xs">
        <ThemeIcon color={statusColor} variant="light" size="md">
          <IconCurrencyDollar size={14} />
        </ThemeIcon>
        <Text fw={600}>Monthly Budget Summary</Text>
        <Text size="xs" c="dimmed">Based on bi-weekly paychecks × 2 per source</Text>
        <Badge ml="auto" color={statusColor} variant="light" size="sm">
          {isOver
            ? `Over by $${Math.abs(difference).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            : isBalanced
            ? 'Balanced'
            : `$${difference.toLocaleString('en-US', { minimumFractionDigits: 2 })} remaining`}
        </Badge>
      </Group>

      {/* Per-source breakdown */}
      <Stack gap={4} mb="md">
        {sourceRows.map((p) => {
          const ProfileIcon = getIconComponent(p.icon);
          const diff = p.monthlyIncome - p.monthlyCommitted;
          const over = diff < -0.01;
          return (
            <Group key={p.id} justify="space-between" px={8} py={6} wrap="wrap" gap="xs"
              style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
              <Group gap="xs" wrap="wrap">
                <ThemeIcon color={p.color} size="sm" variant="light">
                  <ProfileIcon size={12} />
                </ThemeIcon>
                <Text size="sm" fw={500}>{p.name}</Text>
                <Text size="xs" c="dimmed">${p.checkAmount?.toLocaleString()}/check × 2</Text>
              </Group>
              <Group gap="xs" wrap="wrap">
                <Text size="xs" c="dimmed">${p.monthlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })} income</Text>
                <Text size="xs">→</Text>
                <Text size="xs" c="dimmed">${p.monthlyCommitted.toLocaleString('en-US', { minimumFractionDigits: 2 })} committed</Text>
                <Badge size="xs" color={over ? 'red' : 'teal'} variant="light">
                  {over ? `-$${Math.abs(diff).toFixed(2)}` : `+$${diff.toFixed(2)}`}
                </Badge>
              </Group>
            </Group>
          );
        })}
      </Stack>

      {/* Overall totals */}
      <Divider mb="sm" />
      <Group justify="space-between" px={4} wrap="wrap" gap="md">
        <Group gap="xl" wrap="wrap">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Combined Monthly Income</Text>
            <Text fw={700} size="lg">${totalMonthlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total Budgeted (YNAB)</Text>
            <Text fw={700} size="lg">${totalMonthlyBudgeted.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
          </div>
        </Group>
        <div style={{ textAlign: 'right' }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{isOver ? 'Over Budget' : 'Remaining'}</Text>
          <Text fw={800} size="xl" c={statusColor}>
            {isOver ? '-' : '+'}${Math.abs(difference).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </Text>
        </div>
      </Group>

      <Progress
        mt="sm"
        value={totalMonthlyIncome > 0 ? Math.min(100, (totalMonthlyBudgeted / totalMonthlyIncome) * 100) : 0}
        color={statusColor}
        size="md"
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Split History Tab — shows all splits that have been applied via the API
// ─────────────────────────────────────────────────────────────────────────────
function SplitHistoryEntry({ entry, expanded, onToggle }) {
  const totalSplit = entry.splits.reduce((s, x) => s + (x.amount ?? 0), 0);
  const leftover = entry.totalAmount - totalSplit;
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" wrap="nowrap"
        style={{ cursor: 'pointer' }} onClick={onToggle}>
        <Group gap="xs" wrap="nowrap">
          {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          <div>
            <Group gap="xs">
              <Text fw={600}>{entry.payeeName ?? 'Unknown Payee'}</Text>
              <Badge size="sm" color="blue" variant="light">{entry.profileName}</Badge>
              {!expanded && (
                <Text size="xs" c="dimmed">{entry.splits.length} split{entry.splits.length !== 1 ? 's' : ''}</Text>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {entry.transactionDate ? new Date(entry.transactionDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              {' · Applied '}
              {new Date(entry.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </div>
        </Group>
        <div style={{ textAlign: 'right' }}>
          <Text fw={700} size="lg" c="teal">${entry.totalAmount?.toFixed(2)}</Text>
          {leftover > 0.01 && <Text size="xs" c="orange">⚠ ${leftover.toFixed(2)} unallocated</Text>}
        </div>
      </Group>

      {/* Detail table only mounts when expanded */}
      {expanded && (
        <Table striped highlightOnHover withTableBorder withColumnBorders fontSize="sm" mt="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Category Group</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entry.splits.map((s, i) => (
              <Table.Tr key={i}>
                <Table.Td><Text size="sm" c="dimmed">{s.groupName || '—'}</Text></Table.Td>
                <Table.Td><Text size="sm" fw={500}>{s.categoryName || s.categoryId}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Text size="sm" fw={600} c="teal">${(s.amount ?? 0).toFixed(2)}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={2}><Text size="sm" fw={600}>Total Budgeted</Text></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <Text size="sm" fw={700} c="teal">${totalSplit.toFixed(2)}</Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      )}
    </Card>
  );
}

export function SplitHistoryTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/rules/split-history');
      const data = res.data ?? [];
      setHistory(data);
      // Expand only the two most recent by default; the rest stay collapsed.
      setExpanded(new Set(data.slice(0, 2).map((e) => e.id)));
    } catch (err) {
      notifications.show({ title: 'Error loading split history', message: err.message, color: 'red' });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  if (loading) return <Text c="dimmed" ta="center" py="xl">Loading split history…</Text>;

  if (history.length === 0) {
    return (
      <Card withBorder p="xl" ta="center">
        <IconHistory size={48} color="var(--mantine-color-gray-4)" style={{ marginBottom: 12 }} />
        <Text fw={600} size="lg" c="dimmed">No split history yet</Text>
        <Text size="sm" c="dimmed">Applied splits will appear here once you use "Apply Splits" on a paycheck.</Text>
      </Card>
    );
  }

  const allExpanded = expanded.size === history.length;

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600} size="lg">Applied Splits History</Text>
        <Group gap="xs">
          <Button variant="subtle" size="xs"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(history.map((e) => e.id)))}>
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={load}>Refresh</Button>
        </Group>
      </Group>
      {history.map((entry) => (
        <SplitHistoryEntry
          key={entry.id}
          entry={entry}
          expanded={expanded.has(entry.id)}
          onToggle={() => toggle(entry.id)}
        />
      ))}
    </Stack>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// RecalculateSplitsButton
// Uses monthly budget (SQLite override → YNAB budgeted) as source of truth.
// perCheck = monthly ÷ 4  (2 sources × 2 checks each).
// Idempotent: skips any split already within $0.01 of the correct value.
// ─────────────────────────────────────────────────────────────────────────────
export function RecalculateSplitsButton({ profiles, onReload }) {
  const { flatCategories } = useYNAB();
  const [running, setRunning] = useState(false);

  const DIVISOR = 4; // 2 sources × 2 checks/month

  const handleRecalc = async () => {
    setRunning(true);
    try {
      // Fetch saved monthly budget overrides from SQLite
      const overridesRes = await api.get('/rules/budget-overrides');
      const overrides    = overridesRes.data ?? {}; // { categoryId: milliunits }

      let totalUpdated   = 0;
      let totalCurrent   = 0;

      for (const profile of profiles) {
        const splits = profile.defaultSplits ?? [];
        if (splits.length === 0) continue;

        let changed = false;
        const newSplits = splits.map((s) => {
          if (!s.categoryId) return s;

          // Source of truth: SQLite override first, then YNAB budgeted
          const overrideMil = overrides[s.categoryId];
          const cat         = flatCategories.find((c) => c.id === s.categoryId);
          const monthly     = overrideMil != null
            ? overrideMil / 1000
            : Math.abs((cat?.budgeted ?? 0) / 1000);

          if (monthly === 0) { totalCurrent++; return s; } // no budget set, leave alone

          const correct = parseFloat((monthly / DIVISOR).toFixed(2));

          if (Math.abs((s.value ?? 0) - correct) < 0.01) {
            totalCurrent++;
            return s; // already correct
          }

          changed = true;
          totalUpdated++;
          return { ...s, type: 'amount', value: correct };
        });

        if (changed) {
          await api.put(`/rules/profiles/${profile.id}`, { ...profile, defaultSplits: newSplits });
        }
      }

      if (totalUpdated === 0) {
        notifications.show({
          title: 'Splits are up to date',
          message: `All ${totalCurrent} splits already match their monthly budgets ÷ ${DIVISOR} checks.`,
          color: 'teal',
          autoClose: 4000,
        });
      } else {
        notifications.show({
          title: 'Splits recalculated',
          message: `${totalUpdated} split${totalUpdated !== 1 ? 's' : ''} updated · ${totalCurrent} already correct.`,
          color: 'teal',
          autoClose: 4000,
        });
        onReload?.();
      }
    } catch (err) {
      notifications.show({ title: 'Recalculate failed', message: err.message, color: 'red' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Group justify="flex-end">
      <Tooltip label={`Monthly budget ÷ 4 checks (2 sources × 2/mo). Skips splits already correct.`} withArrow>
        <Button
          size="xs"
          variant="light"
          color="teal"
          loading={running}
          leftSection={<IconRefresh size={14} />}
          onClick={handleRecalc}
        >
          Recalculate Splits
        </Button>
      </Tooltip>
    </Group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BudgetVsActualTab — multi-month aggregated comparison view
// For each range: sums Spent across all months, shows latest Available balance
// ─────────────────────────────────────────────────────────────────────────────

// Return array of "YYYY-MM" strings for every month in [start, end]
function getMonthsInRange(start, end) {
  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

export function BudgetVsActualTab() {
  const { activeBudgetId, budgetOverrides: overrides } = useYNAB();
  const now = new Date();

  const [bvaDateRange,    setBvaDateRange]    = useState(() => {
    return [new Date(now.getFullYear(), now.getMonth(), 1),
            new Date(now.getFullYear(), now.getMonth() + 1, 0)];
  });
  const [rangeData,       setRangeData]       = useState(null); // { months[], monthlyData[][] }
  const [loading,         setLoading]         = useState(false);
  const [lastSynced,      setLastSynced]      = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [bvaTracking,     setBvaTracking]     = useState({});

  const EXCLUDED = useMemo(() => new Set([
    'Internal Master Category', 'Inflow', 'Hidden Categories', 'Credit Card Payments',
  ]), []);

  // Fetch all months in range from YNAB in parallel
  const fetchRange = useCallback(async (dateRange) => {
    if (!activeBudgetId || !dateRange) return;
    const months = getMonthsInRange(dateRange[0], dateRange[1]);
    setLoading(true);
    try {
      const results = await Promise.all(
        months.map(m =>
          api.get('/budgets/month', { params: { budgetId: activeBudgetId, month: `${m}-01` } })
        )
      );
      const monthlyData = results.map(r => r.data?.categories ?? []);
      setRangeData({ months, monthlyData });
      setLastSynced(new Date());
    } catch (err) {
      notifications.show({ title: 'Error loading BvA data', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [activeBudgetId]);

  // Load BvA tracking on mount. Monthly budget overrides come from context so
  // edits made with the Adjust button show up immediately.
  useEffect(() => {
    api.get('/rules/bva-tracking').then(r => setBvaTracking(r.data ?? {})).catch(() => {});
  }, []);

  // Fetch whenever activeBudgetId or dateRange changes
  useEffect(() => {
    if (activeBudgetId) fetchRange(bvaDateRange);
  }, [activeBudgetId, bvaDateRange, fetchRange]);

  const handleRefresh = async () => {
    await fetchRange(bvaDateRange);
    notifications.show({ title: 'Refreshed', message: 'Latest YNAB data loaded.', color: 'teal', autoClose: 2000 });
  };

  // Aggregate across all months in range
  const grouped = useMemo(() => {
    if (!rangeData) return [];
    const { months, monthlyData } = rangeData;
    const numMonths = months.length;
    const lastIdx   = monthlyData.length - 1;

    // Per-category aggregate
    const catMap = {};
    monthlyData.forEach((monthCats, idx) => {
      monthCats
        .filter(c => !c.hidden && !c.deleted && !EXCLUDED.has(c.category_group_name))
        .forEach(c => {
          if (!catMap[c.id]) {
            catMap[c.id] = { id: c.id, name: c.name, groupName: c.category_group_name,
                             totalActivity: 0, latestBalance: 0, ynabBudgetedSum: 0, latestBudgeted: 0 };
          }
          catMap[c.id].totalActivity   += Math.abs(c.activity ?? 0);
          catMap[c.id].ynabBudgetedSum += Math.abs(c.budgeted  ?? 0);
          if (idx === lastIdx) {
            catMap[c.id].latestBalance  = c.balance ?? 0;
            catMap[c.id].latestBudgeted = Math.abs(c.budgeted ?? 0);
          }
        });
    });

    // Group and build rows
    const groupMap = {};
    Object.values(catMap)
      .filter(c => bvaTracking[c.id] !== false)
      .forEach(c => {
        const override = overrides[c.id];
        // Budget for range: override/mo × numMonths  OR  YNAB budgeted sum
        const budget = override != null
          ? (Math.abs(override) / 1000) * numMonths
          : c.ynabBudgetedSum / 1000;

        if (!groupMap[c.groupName]) groupMap[c.groupName] = [];
        groupMap[c.groupName].push({
          id:      c.id,
          name:    c.name,
          monthly: budget,
          perMonth: override != null ? Math.abs(override) / 1000 : c.latestBudgeted / 1000,
          spent:   c.totalActivity  / 1000,
          balance: c.latestBalance  / 1000,
        });
      });

    return Object.entries(groupMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, cats]) => ({
        group,
        cats:         cats.sort((a, b) => a.name.localeCompare(b.name)),
        totalMonthly: cats.reduce((s, c) => s + (c.monthly ?? 0), 0),
        totalSpent:   cats.reduce((s, c) => s + c.spent,   0),
        totalBalance: cats.reduce((s, c) => s + c.balance, 0),
      }));
  }, [rangeData, overrides, bvaTracking, EXCLUDED]);

  const grandTotals = useMemo(() => ({
    monthly: grouped.reduce((s, g) => s + g.totalMonthly, 0),
    spent:   grouped.reduce((s, g) => s + g.totalSpent,   0),
    balance: grouped.reduce((s, g) => s + g.totalBalance, 0),
  }), [grouped]);

  const toggleGroup = (group) =>
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));

  const fmt = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const numMonths   = rangeData?.months?.length ?? 1;
  const budgetLabel = numMonths === 1 ? 'Budget' : `Budget (${numMonths} mo)`;
  const rangeText   = numMonths === 1 ? 'this month' : `these ${numMonths} months`;

  const barColor = (spent, budget) =>
    budget <= 0 ? 'gray' : spent > budget ? 'red' : spent / budget > 0.8 ? 'orange' : 'teal';

  const COLS = [
    { key: 'budget', label: budgetLabel,
      tip: numMonths === 1
        ? 'What you planned to spend this month (your monthly budget from the Budget page, or YNAB\'s assigned amount if none is set)'
        : `Your monthly budget × ${numMonths} months — what you planned to spend across the selected dates` },
    { key: 'spent', label: 'Spent',
      tip: 'Money actually spent from this category in the selected dates' },
    { key: 'left', label: 'Left / Over',
      tip: 'Budget minus Spent. Green = still under budget, red = spent more than planned' },
    { key: 'avail', label: 'YNAB balance',
      tip: 'The category\'s Available balance in YNAB at the end of the range — includes money rolled over from earlier months, so it can differ from Left/Over' },
  ];

  const leftText = (budget, spent) => {
    if (budget <= 0) return spent > 0 ? 'No budget' : '—';
    const diff = budget - spent;
    return diff >= 0 ? `${fmt(diff)} left` : `${fmt(diff)} over`;
  };

  return (
    <Stack gap="md">
      {/* Header controls */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="wrap">
          <DateRangeFilter
            value={bvaDateRange}
            onChange={(r) => setBvaDateRange(r ?? [
              new Date(now.getFullYear(), now.getMonth(), 1),
              new Date(now.getFullYear(), now.getMonth() + 1, 0),
            ])}
          />
          {lastSynced && (
            <Text size="xs" c="dimmed">
              Synced {lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {numMonths > 1 && ` · ${numMonths} months`}
            </Text>
          )}
          {loading && <Text size="xs" c="dimmed">Loading {numMonths} month{numMonths !== 1 ? 's' : ''}…</Text>}
        </Group>
        <Button
          size="xs"
          variant="light"
          color="teal"
          loading={loading}
          leftSection={<IconRefresh size={14} />}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </Group>

      {/* What am I looking at? */}
      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} p="sm">
        <Text size="sm">
          Did you stay within budget {rangeText}? Each row compares what you <b>planned</b> to spend
          (Budget) with what you <b>actually spent</b>. The bar fills as you spend: teal is on track,
          orange is over 80%, red means you went over.
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          Use the button at the end of a row to change that category's monthly budget. An orange
          amount means your recent spending suggests a different budget; click it to see why.
        </Text>
      </Alert>

      {/* Table — scrolls horizontally on narrow viewports so columns stay legible */}
      <Card withBorder radius="md" p={0} style={{ overflowX: 'auto' }}>
       <div style={{ minWidth: 820 }}>
        {/* Column headers */}
        <Group
          px="md" py="xs" gap={0} wrap="nowrap"
          style={{ background: 'var(--mantine-color-default-hover)', borderBottom: '1px solid var(--mantine-color-default-border)' }}
        >
          <Text size="xs" fw={700} style={{ flex: 2.5 }}>Category</Text>
          {COLS.map(c => <ColumnHeader key={c.key} label={c.label} tip={c.tip} />)}
          <Text size="xs" fw={700} ta="right" style={{ width: 104, flexShrink: 0 }}>Monthly budget</Text>
        </Group>

        {grouped.map(({ group, cats, totalMonthly, totalSpent, totalBalance }) => {
          const isCollapsed = !!collapsedGroups[group];
          const groupOver   = totalMonthly > 0 && totalSpent > totalMonthly;
          return (
            <div key={group}>
              {/* Group header row */}
              <Group
                px="md" py={6} gap={0} wrap="nowrap"
                style={{
                  cursor: 'pointer',
                  background: 'var(--mantine-color-default-hover)',
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                }}
                onClick={() => toggleGroup(group)}
              >
                <Group gap={6} style={{ flex: 2.5 }}>
                  {isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                  <Text size="xs" fw={700}>{group}</Text>
                  <Badge size="xs" variant="outline" color="gray">{cats.length}</Badge>
                </Group>
                <Text size="xs" fw={600} ta="right" style={{ flex: 1, whiteSpace: 'nowrap' }}>{fmt(totalMonthly)}</Text>
                <Text size="xs" fw={600} ta="right" c={groupOver ? 'red' : undefined} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                  {fmt(totalSpent)}
                </Text>
                <Text size="xs" fw={600} ta="right" c={totalMonthly <= 0 ? 'dimmed' : groupOver ? 'red' : 'teal'} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                  {leftText(totalMonthly, totalSpent)}
                </Text>
                <Text size="xs" fw={600} ta="right" c={totalBalance < 0 ? 'red' : 'dimmed'} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                  {totalBalance < 0 ? '−' : ''}{fmt(totalBalance)}
                </Text>
                <div style={{ width: 104, flexShrink: 0 }} />
              </Group>

              {/* Category rows */}
              {!isCollapsed && cats.map((cat) => {
                const overBudget = cat.monthly > 0 && cat.spent > cat.monthly;
                const rawPct     = cat.monthly > 0 ? (cat.spent / cat.monthly) * 100 : 0;
                return (
                  <Box
                    key={cat.id} px="md" py={6}
                    style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                  >
                    <Group gap={0} wrap="nowrap" align="flex-start">
                      <Box style={{ flex: 2.5, minWidth: 0 }} pl={20} pr="md">
                        <Text size="sm" lineClamp={1}>{cat.name}</Text>
                        <Progress
                          mt={4}
                          size="xs"
                          value={Math.min(100, rawPct)}
                          color={barColor(cat.spent, cat.monthly)}
                          aria-label={`${cat.name}: ${Math.round(rawPct)}% of budget spent`}
                        />
                        <Text size="10px" c={overBudget ? 'red' : 'dimmed'} mt={2}>
                          {cat.monthly > 0
                            ? `${Math.round(rawPct)}% of budget used`
                            : cat.spent > 0 ? 'Spent with no budget set' : 'No budget, no spending'}
                        </Text>
                      </Box>
                      <Text size="sm" ta="right" c="dimmed" style={{ flex: 1, whiteSpace: 'nowrap' }}>
                        {cat.monthly > 0 ? fmt(cat.monthly) : '—'}
                      </Text>
                      <Text size="sm" ta="right" c={overBudget ? 'red' : undefined} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                        {cat.spent > 0 ? fmt(cat.spent) : '—'}
                      </Text>
                      <Text size="sm" ta="right" fw={500}
                        c={cat.monthly <= 0 ? 'dimmed' : overBudget ? 'red' : 'teal'} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                        {leftText(cat.monthly, cat.spent)}
                      </Text>
                      <Text size="sm" ta="right" c={cat.balance < 0 ? 'red' : 'dimmed'} style={{ flex: 1, whiteSpace: 'nowrap' }}>
                        {cat.balance < 0 ? '−' : ''}{fmt(cat.balance)}
                      </Text>
                      <Group justify="flex-end" style={{ width: 104, flexShrink: 0 }}>
                        <AdjustBudgetButton
                          cat={cat}
                          currentMonthly={cat.perMonth}
                          rangeAvg={cat.spent / numMonths}
                          rangeMonths={numMonths}
                        />
                      </Group>
                    </Group>
                  </Box>
                );
              })}
            </div>
          );
        })}

        {/* Grand total footer */}
        <Group
          px="md" py="sm" gap={0} wrap="nowrap"
          style={{
            borderTop: '2px solid var(--mantine-color-default-border)',
            background: 'var(--mantine-color-default-hover)',
          }}
        >
          <Text size="sm" fw={700} style={{ flex: 2.5 }}>Total</Text>
          <Text size="sm" fw={700} ta="right" style={{ flex: 1, whiteSpace: 'nowrap' }}>{fmt(grandTotals.monthly)}</Text>
          <Text size="sm" fw={700} ta="right"
            c={grandTotals.monthly > 0 && grandTotals.spent > grandTotals.monthly ? 'red' : undefined}
            style={{ flex: 1, whiteSpace: 'nowrap' }}>
            {fmt(grandTotals.spent)}
          </Text>
          <Text size="sm" fw={700} ta="right"
            c={grandTotals.monthly <= 0 ? 'dimmed' : grandTotals.spent > grandTotals.monthly ? 'red' : 'teal'}
            style={{ flex: 1, whiteSpace: 'nowrap' }}>
            {leftText(grandTotals.monthly, grandTotals.spent)}
          </Text>
          <Text size="sm" fw={700} ta="right" c={grandTotals.balance < 0 ? 'red' : 'dimmed'} style={{ flex: 1, whiteSpace: 'nowrap' }}>
            {grandTotals.balance < 0 ? '−' : ''}{fmt(grandTotals.balance)}
          </Text>
          <div style={{ width: 104, flexShrink: 0 }} />
        </Group>
       </div>
      </Card>
    </Stack>
  );
}

// RulesPage — main export
// ─────────────────────────────────────────────────────────────────────────────
export default function RulesPage() {
  const navigate = useNavigate();
  const [profiles,      setProfiles]      = useState([]);
  const [splitsProfile, setSplitsProfile] = useState(null);

  const [splitsModalOpen, { open: openSplitsModal, close: closeSplitsModal }] = useDisclosure(false);

  const load = async () => {
    try {
      const pr = await api.get('/rules/profiles');
      setProfiles(pr.data);
    } catch (err) {
      notifications.show({ title: 'Error loading data', message: err.message, color: 'red' });
    }
  };

  useEffect(() => { load(); }, []);

  const openModifySplits = (profile) => {
    // Always fetch latest profile data before opening so splits are current
    setSplitsProfile(profile);
    openSplitsModal();
  };

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={2}>Income</Title>
        <Button variant="light" leftSection={<IconEdit size={16} />}
          onClick={() => navigate('/budget')}>
          Manage Budget
        </Button>
      </Group>

      <Last30IncomeCard
        profiles={profiles}
        onLoadRules={load}
        onAllocateTotal={() => {}}
        onOpenSplits={openModifySplits}
        onScrollToBudget={() => navigate('/budget')}
      />

      <SplitsModal
        opened={splitsModalOpen}
        onClose={closeSplitsModal}
        profile={splitsProfile}
        allProfiles={profiles}
        onSaved={load}
      />
    </Stack>
  );
}
