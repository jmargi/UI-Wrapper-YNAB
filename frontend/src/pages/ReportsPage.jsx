import { useState, useEffect } from 'react';
import {
  Stack, Title, Group, Select, Card, Text, ThemeIcon, Alert, Loader,
} from '@mantine/core';
import {
  IconChartBar, IconScale, IconHistory, IconReportAnalytics, IconInfoCircle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { api } from '../context/YNABContext';
import {
  BudgetVsActualTab,
  SplitHistoryTab,
  MonthlyBudgetSummaryCard,
} from './RulesPage';

// Registry of available reports. Add new reports here and they appear in the picker.
const REPORTS = [
  {
    value: 'budget-vs-actual',
    label: 'Budget vs Actual',
    description: 'Per-category budgeted vs spent vs available, across any date range.',
    icon: IconChartBar,
    color: 'teal',
  },
  {
    value: 'budget-vs-income',
    label: 'Budget vs Income',
    description: 'Monthly income from each source vs what you have committed to budget.',
    icon: IconScale,
    color: 'grape',
  },
  {
    value: 'split-history',
    label: 'Split History',
    description: 'Every paycheck split that has been applied through the app.',
    icon: IconHistory,
    color: 'blue',
  },
];

export default function ReportsPage() {
  const [selected, setSelected] = useState('budget-vs-actual');

  // profiles only needed for the income report
  const [profiles, setProfiles]   = useState([]);
  const [loadingProfiles, setLP]  = useState(false);

  useEffect(() => {
    if (selected !== 'budget-vs-income' || profiles.length) return;
    setLP(true);
    api.get('/rules/profiles')
      .then(r => setProfiles(r.data))
      .catch(err => notifications.show({ title: 'Error loading income sources', message: err.message, color: 'red' }))
      .finally(() => setLP(false));
  }, [selected]);

  const current = REPORTS.find(r => r.value === selected);

  const renderReport = () => {
    switch (selected) {
      case 'budget-vs-actual':
        return <BudgetVsActualTab />;
      case 'split-history':
        return <SplitHistoryTab />;
      case 'budget-vs-income':
        if (loadingProfiles) return <Group justify="center" p="xl"><Loader /></Group>;
        if (!profiles.length) {
          return (
            <Alert icon={<IconInfoCircle size={16} />} color="grape" title="No income sources yet">
              Add income sources on the Income page to see this report.
            </Alert>
          );
        }
        return <MonthlyBudgetSummaryCard profiles={profiles} />;
      default:
        return null;
    }
  };

  return (
    <Stack>
      <Group gap="sm">
        <ThemeIcon size="lg" radius="md" color="teal" variant="light">
          <IconReportAnalytics size={18} />
        </ThemeIcon>
        <Title order={2}>Reports</Title>
      </Group>

      {/* Report picker */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Select
            label="Select a report"
            description="Choose which report to view"
            value={selected}
            onChange={(v) => v && setSelected(v)}
            data={REPORTS.map(r => ({ value: r.value, label: r.label }))}
            leftSection={current ? <current.icon size={16} /> : null}
            allowDeselect={false}
          />
          {current && (
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <ThemeIcon size="md" radius="md" color={current.color} variant="light" style={{ flexShrink: 0 }}>
                <current.icon size={16} />
              </ThemeIcon>
              <Text size="sm" c="dimmed">{current.description}</Text>
            </Group>
          )}
        </Stack>
      </Card>

      {/* Selected report */}
      <div>{renderReport()}</div>
    </Stack>
  );
}
