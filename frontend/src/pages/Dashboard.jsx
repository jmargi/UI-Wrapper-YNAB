import { useEffect, useState, useMemo } from 'react';
import {
  Card, Text, Group, Badge, Stack, Title,
  Skeleton, ThemeIcon, SimpleGrid,
  Tooltip, Modal, Table, ScrollArea, Box, ColorSwatch, Divider,
} from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import {
  IconCurrencyDollar,
  IconTrendingUp,
  IconTrendingDown,
  IconAlertCircle,
  IconChartPie,
} from '@tabler/icons-react';
import { AreaChart, DonutChart } from '@mantine/charts';
import { useYNAB } from '../context/YNABContext';
import { formatCurrency, formatDate } from '../utils/format';

// Mantine chart color palette (hex) — maps index → colour
const PIE_COLORS = [
  '#12b886', '#228be6', '#7950f2', '#fd7e14',
  '#fa5252', '#40c057', '#15aabf', '#e64980',
  '#fab005', '#be4bdb', '#74c0fc', '#a9e34b',
];

// Groups to exclude from the budget pie (system / internal YNAB groups)
const EXCLUDED_GROUPS = new Set([
  'Internal Master Category',
  'Inflow',
  'Hidden Categories',
  'Credit Card Payments',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Stat card — clickable with tooltip
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon: Icon, color, subtitle, tooltip, onClick }) {
  const card = (
    <Card
      withBorder
      radius="md"
      p="lg"
      onClick={onClick}
      style={{
        cursor:     onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s, transform 0.1s',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.12)'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.boxShadow = ''; }}
    >
      <Group justify="space-between">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {title}
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {value}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed" mt={4}>
              {subtitle}
            </Text>
          )}
        </div>
        <ThemeIcon color={color} size="xl" variant="light">
          <Icon size={20} />
        </ThemeIcon>
      </Group>
      {onClick && (
        <Text size="xs" c={`${color}.5`} mt={8} ta="right" style={{ opacity: 0.8 }}>
          Click to view →
        </Text>
      )}
    </Card>
  );

  if (!tooltip) return card;
  return (
    <Tooltip label={tooltip} multiline maw={240} position="bottom" withArrow>
      {card}
    </Tooltip>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down modal — shows transactions for a clicked stat card
// ─────────────────────────────────────────────────────────────────────────────
function DrillDownModal({ opened, onClose, title, transactions }) {
  const total = transactions.reduce((s, t) => s + t.amount, 0);

  return (
    <Modal opened={opened} onClose={onClose} title={title} size="xl">
      <Stack>
        {transactions.length > 0 && (
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
            </Text>
            <Text fw={700} c={total >= 0 ? 'teal' : 'red'}>
              Total: {formatCurrency(total)}
            </Text>
          </Group>
        )}

        {transactions.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No transactions found for this period.</Text>
        ) : (
          <ScrollArea h={500}>
            <Table striped highlightOnHover withTableBorder fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Payee</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Memo</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {transactions.map((t) => (
                  <Table.Tr key={t.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>{t.payee_name || '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={1}>{t.category_name || '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={1}>{t.memo || ''}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} c={t.amount >= 0 ? 'teal' : 'red'}>
                        {formatCurrency(t.amount)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={t.approved ? 'teal' : 'orange'} variant="light">
                        {t.approved ? 'Approved' : 'Pending'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { transactions, accounts, loading, flatCategories } = useYNAB();
  const [chartData, setChartData] = useState([]);
  const [drillType, setDrillType] = useState(null); // 'income' | 'expenses' | 'unapproved'

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthStr   = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthShort = selectedMonth.toLocaleString('default', { month: 'short' });
  const monthLabel = selectedMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  // End-of-month date string for comparison (e.g. "2026-03" → anything > "2026-03-31")
  // We want transactions strictly AFTER the selected month to subtract from current balance
  const afterMonthStr = useMemo(() => {
    const d = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [selectedMonth]);

  // Net amount of transactions per account that occurred AFTER the selected month
  // Subtracting these from current balance gives the end-of-month historical balance
  const postMonthNetByAccount = useMemo(() => {
    const map = {};
    transactions
      .filter((t) => !t.deleted && t.date && t.date >= afterMonthStr)
      .forEach((t) => {
        map[t.account_id] = (map[t.account_id] || 0) + t.amount;
      });
    return map;
  }, [transactions, afterMonthStr]);

  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return selectedMonth.getFullYear() === now.getFullYear() &&
           selectedMonth.getMonth()    === now.getMonth();
  }, [selectedMonth]);

  // For current month: use live balance. For past months: subtract post-month transactions.
  const historicalBalance = (account) => {
    if (isCurrentMonth) return account.balance;
    return account.balance - (postMonthNetByAccount[account.id] || 0);
  };

  const onBudgetAccounts = useMemo(
    () => accounts.filter((a) => !a.closed && a.on_budget),
    [accounts]
  );

  const totalBalance = useMemo(
    () => isCurrentMonth
      ? onBudgetAccounts.reduce((sum, a) => sum + a.balance, 0)
      : onBudgetAccounts.reduce((sum, a) => sum + historicalBalance(a), 0),
    [onBudgetAccounts, isCurrentMonth, postMonthNetByAccount]
  );

  const monthTxns      = useMemo(() => transactions.filter((t) => !t.deleted && t.date?.startsWith(monthStr)), [transactions, monthStr]);
  const incomeTxns     = useMemo(() => monthTxns.filter((t) => t.amount > 0).sort((a, b) => new Date(b.date) - new Date(a.date)), [monthTxns]);
  const expenseTxns    = useMemo(() => monthTxns.filter((t) => t.amount < 0).sort((a, b) => new Date(b.date) - new Date(a.date)), [monthTxns]);
  const unapprovedTxns = useMemo(() => transactions.filter((t) => !t.approved && !t.deleted).sort((a, b) => new Date(b.date) - new Date(a.date)), [transactions]);

  const income     = incomeTxns.reduce((s, t) => s + t.amount, 0);
  const expenses   = expenseTxns.reduce((s, t) => s + t.amount, 0);
  const unapproved = unapprovedTxns.length;
  const monthUnapproved = useMemo(() => monthTxns.filter((t) => !t.approved).length, [monthTxns]);

  // 6-month chart relative to selected month
  useEffect(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - i, 1);
      const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      const txns  = transactions.filter((t) => !t.deleted && t.date?.startsWith(key));
      const inc   = txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) / 1000;
      const exp   = Math.abs(txns.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)) / 1000;
      months.push({ month: label, Income: inc, Expenses: exp });
    }
    setChartData(months);
  }, [transactions, selectedMonth]);

  // ── Budget pie chart data ────────────────────────────────────────────────────
  // Pie is sized by YNAB "Available" (balance) — exactly what the Available
  // column in YNAB shows. Only include groups with positive available balance.
  const pieGroups = useMemo(() => {
    const map = {};
    (flatCategories ?? [])
      .filter((c) => !c.hidden && !c.deleted && !EXCLUDED_GROUPS.has(c.groupName))
      .forEach((cat) => {
        if (!map[cat.groupName]) map[cat.groupName] = { name: cat.groupName, budgeted: 0, balance: 0 };
        map[cat.groupName].budgeted += cat.budgeted;
        map[cat.groupName].balance  += cat.balance;
      });
    return Object.values(map)
      .filter((g) => g.balance > 0)          // only show groups with positive available
      .sort((a, b) => b.balance - a.balance); // largest available first
  }, [flatCategories]);

  const totalAvailable = pieGroups.reduce((s, g) => s + g.balance, 0); // milliunits

  const donutData = useMemo(
    () => pieGroups.map((g, i) => ({
      name:  g.name,
      value: parseFloat((g.balance / 1000).toFixed(2)), // milliunits → dollars (available)
      color: PIE_COLORS[i % PIE_COLORS.length],
    })),
    [pieGroups]
  );
  // ─────────────────────────────────────────────────────────────────────────────

  const drillTxns  = drillType === 'income'     ? incomeTxns
                   : drillType === 'expenses'    ? expenseTxns
                   : drillType === 'unapproved'  ? unapprovedTxns
                   : [];
  const drillTitle = drillType === 'income'     ? `Income — ${monthLabel}`
                   : drillType === 'expenses'    ? `Expenses — ${monthLabel}`
                   : drillType === 'unapproved'  ? 'Unapproved Transactions (all time)'
                   : '';

  if (loading) {
    return (
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} h={100} radius="md" />)}
        </SimpleGrid>
        <Skeleton h={300} radius="md" />
      </Stack>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={2}>Dashboard</Title>
        <MonthPickerInput
          value={selectedMonth}
          onChange={(v) => v && setSelectedMonth(v)}
          maxDate={new Date()}
          valueFormat="MMMM YYYY"
          label={undefined}
          placeholder="Select month"
          style={{ flex: '1 1 200px', maxWidth: 240 }}
        />
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
        <StatCard
          title={isCurrentMonth ? 'Total Balance' : `Balance — ${monthShort}`}
          value={formatCurrency(totalBalance)}
          icon={IconCurrencyDollar}
          color="teal"
          tooltip={isCurrentMonth
            ? 'Combined live balance of all on-budget accounts.'
            : `Estimated combined balance at end of ${monthLabel}, calculated by working backwards from current balances using transaction history.`}
        />
        <StatCard
          title={`Income — ${monthShort}`}
          value={formatCurrency(income)}
          icon={IconTrendingUp}
          color="green"
          subtitle={`${incomeTxns.length} inflow${incomeTxns.length !== 1 ? 's' : ''}`}
          tooltip={`Total money received in ${monthLabel} (all positive transactions). Click to see the full breakdown.`}
          onClick={() => setDrillType('income')}
        />
        <StatCard
          title={`Expenses — ${monthShort}`}
          value={formatCurrency(Math.abs(expenses))}
          icon={IconTrendingDown}
          color="red"
          subtitle={`${expenseTxns.length} outflow${expenseTxns.length !== 1 ? 's' : ''}`}
          tooltip={`Total money spent in ${monthLabel} (all negative transactions). Click to see the full breakdown.`}
          onClick={() => setDrillType('expenses')}
        />
        <StatCard
          title={`Unapproved — ${monthShort}`}
          value={monthUnapproved}
          icon={IconAlertCircle}
          color="orange"
          subtitle={`${unapproved} all time`}
          tooltip={`Bank-imported transactions in ${monthLabel} that haven't been reviewed yet. Click to see all ${unapproved} across every month.`}
          onClick={() => setDrillType('unapproved')}
        />
      </SimpleGrid>

      <Card withBorder radius="md" p="lg">
        <Text fw={600} mb="md">Income vs Expenses — 6 months to {monthLabel}</Text>
        <AreaChart
          h={280}
          data={chartData}
          dataKey="month"
          series={[
            { name: 'Income',   color: 'teal.6' },
            { name: 'Expenses', color: 'red.6'  },
          ]}
          curveType="monotone"
        />
      </Card>

      <Card withBorder radius="md" p="lg">
        <Group justify="space-between" mb="md">
          <Text fw={600}>Account Balances</Text>
          {!isCurrentMonth && (
            <Badge color="blue" variant="light" size="sm">
              End of {monthLabel}
            </Badge>
          )}
        </Group>
        <Stack gap="sm">
          {onBudgetAccounts.map((account) => {
            const bal     = historicalBalance(account);
            const current = account.balance;
            const diff    = isCurrentMonth ? null : current - bal;
            return (
              <Group key={account.id} justify="space-between">
                <Text size="sm">{account.name}</Text>
                <Group gap="xs">
                  {!isCurrentMonth && diff !== 0 && (
                    <Tooltip label={`Current: ${formatCurrency(current)}`} position="left" withArrow>
                      <Badge
                        size="xs"
                        color={diff > 0 ? 'teal' : 'red'}
                        variant="dot"
                        style={{ cursor: 'default' }}
                      >
                        {diff > 0 ? '+' : ''}{formatCurrency(diff)} since
                      </Badge>
                    </Tooltip>
                  )}
                  <Text size="sm" fw={600} c={bal >= 0 ? 'teal' : 'red'}>
                    {formatCurrency(bal)}
                  </Text>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Card>

      {/* ── Budget by Category pie ──────────────────────────────────────── */}
      {donutData.length > 0 && (
        <Card withBorder radius="md" p="lg">
          <Group mb="md" gap="xs">
            <ThemeIcon color="violet" variant="light" size="md">
              <IconChartPie size={14} />
            </ThemeIcon>
            <Text fw={600}>Budget by Category</Text>
            <Text size="xs" c="dimmed">— YNAB available balance per category group</Text>
            <Badge ml="auto" color="violet" variant="light" size="sm">
              ${(totalAvailable / 1000).toLocaleString('en-US', { minimumFractionDigits: 2 })} total available
            </Badge>
          </Group>

          <Group align="flex-start" gap="xl" wrap="wrap">
            {/* Donut chart */}
            <Box style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 220 }}>
              <DonutChart
                data={donutData}
                size={220}
                thickness={44}
                withTooltip
                tooltipDataSource="segment"
                chartLabel={`${donutData.length} groups`}
              />
            </Box>

            {/* Legend table — three numbers per slice */}
            <Box style={{ flex: 1, minWidth: 280, overflowX: 'auto' }}>
              <Table fz="sm" withRowBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Category Group</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                    <Table.Th ta="right">Budgeted</Table.Th>
                    <Table.Th ta="right">% of Available</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pieGroups.map((g, i) => {
                    const pct        = totalAvailable > 0 ? ((g.balance / totalAvailable) * 100).toFixed(1) : '0.0';
                    const avlDollars = g.balance / 1000;
                    const budDollars = g.budgeted / 1000;
                    return (
                      <Table.Tr key={g.name}>
                        <Table.Td>
                          <Group gap={6}>
                            <ColorSwatch color={PIE_COLORS[i % PIE_COLORS.length]} size={10} withShadow={false} />
                            <Text size="sm">{g.name}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right" fw={700} c="teal">
                          ${avlDollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Table.Td>
                        <Table.Td ta="right" c="dimmed">
                          ${budDollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs" fw={600}>{pct}%</Text>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>

              <Divider my="xs" />
              <Group justify="space-between" px={4}>
                <Text size="xs" fw={600} c="dimmed">Total</Text>
                <Group gap="xl">
                  <Text size="xs" fw={700} c="teal">
                    ${(totalAvailable / 1000).toLocaleString('en-US', { minimumFractionDigits: 2 })} available
                  </Text>
                  <Text size="xs" c="dimmed">
                    ${(pieGroups.reduce((s, g) => s + g.budgeted, 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 2 })} budgeted
                  </Text>
                  <Text size="xs" c="dimmed">100%</Text>
                </Group>
              </Group>
            </Box>
          </Group>
        </Card>
      )}

      <DrillDownModal
        opened={!!drillType}
        onClose={() => setDrillType(null)}
        title={drillTitle}
        transactions={drillTxns}
      />
    </Stack>
  );
}
