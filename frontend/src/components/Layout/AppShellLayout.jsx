import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  Text,
  Badge,
  Select,
  Tooltip,
  ActionIcon,
  Box,
  Divider,
  UnstyledButton,
  Stack,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconDashboard,
  IconList,
  IconCategory,
  IconGitBranch,
  IconWallet,
  IconReportAnalytics,
  IconRobot,
  IconRefresh,
  IconSun,
  IconMoon,
} from '@tabler/icons-react';
import { useYNAB } from '../../context/YNABContext';

const NAV_ITEMS = [
  { path: '/dashboard',    label: 'Dashboard',    icon: IconDashboard },
  { path: '/transactions', label: 'Transactions', icon: IconList      },
  { path: '/categories',   label: 'Categories',   icon: IconCategory  },
  { path: '/income',       label: 'Income',       icon: IconGitBranch },
  { path: '/budget',       label: 'Budget',       icon: IconWallet    },
  { path: '/reports',      label: 'Reports',      icon: IconReportAnalytics },
  { path: '/agent',        label: 'Marie AI',     icon: IconRobot     },
];

// Bottom tab bar (mobile only) — the 5 most-used destinations, one tap away.
// Categories & Reports stay reachable through the burger drawer.
const MOBILE_TABS = [
  { path: '/dashboard',    label: 'Home',    icon: IconDashboard },
  { path: '/transactions', label: 'Txns',    icon: IconList      },
  { path: '/income',       label: 'Income',  icon: IconGitBranch },
  { path: '/budget',       label: 'Budget',  icon: IconWallet    },
  { path: '/agent',        label: 'Marie',   icon: IconRobot     },
];

export default function AppShellLayout({ children }) {
  const [opened, { toggle, close }] = useDisclosure();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { budgets, activeBudgetId, selectBudget, connected, lastSync, triggerSync } = useYNAB();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  const handleNav = (path) => {
    navigate(path);
    close(); // auto-close drawer on mobile after tapping a link
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="lg" c="teal" truncate>
              YNAB
            </Text>
          </Group>

          <Group gap="sm" wrap="nowrap">
            {/* Budget select — desktop only; mobile users pick from the navbar drawer */}
            <Select
              visibleFrom="sm"
              size="xs"
              placeholder="Select budget"
              data={budgets.map((b) => ({ value: b.id, label: b.name }))}
              value={activeBudgetId}
              onChange={selectBudget}
              w={200}
            />

            <Tooltip label={connected ? 'Live sync active' : 'Disconnected'}>
              <Badge color={connected ? 'teal' : 'red'} variant="dot" size="sm">
                {connected ? 'Live' : 'Offline'}
              </Badge>
            </Tooltip>

            <Tooltip label="Sync now">
              <ActionIcon variant="subtle" onClick={triggerSync} color="teal">
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <ActionIcon
                variant="subtle"
                color={isDark ? 'yellow' : 'blue'}
                onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                aria-label="Toggle color scheme"
              >
                {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Box mt="xs">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              label={label}
              leftSection={<Icon size={16} />}
              active={location.pathname === path}
              onClick={() => handleNav(path)}
              variant="filled"
              mb={4}
            />
          ))}
        </Box>

        {/* Mobile-only budget select — desktop has it in the header */}
        <Box hiddenFrom="sm" px="xs" mt="sm">
          <Select
            size="xs"
            placeholder="Select budget"
            data={budgets.map((b) => ({ value: b.id, label: b.name }))}
            value={activeBudgetId}
            onChange={selectBudget}
          />
        </Box>

        <Divider my="sm" />
        {lastSync && (
          <Text size="xs" c="dimmed" px="xs">
            Last sync: {lastSync.toLocaleTimeString()}
          </Text>
        )}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>

      {/* ── Mobile bottom tab bar ──────────────────────────────────────── */}
      <Box
        hiddenFrom="sm"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 199,
          background: 'var(--mantine-color-body)',
          borderTop: '1px solid var(--mantine-color-default-border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <Group grow gap={0}>
          {MOBILE_TABS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <UnstyledButton
                key={path}
                onClick={() => handleNav(path)}
                py={6}
                aria-label={label}
              >
                <Stack gap={2} align="center">
                  <Icon
                    size={20}
                    color={active ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-gray-6)'}
                  />
                  <Text fz={10} fw={active ? 700 : 500} c={active ? 'teal' : 'dimmed'}>
                    {label}
                  </Text>
                </Stack>
              </UnstyledButton>
            );
          })}
        </Group>
      </Box>
    </AppShell>
  );
}
