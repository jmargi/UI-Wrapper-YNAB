import { useState, useCallback } from 'react';
import { Group, Button, Popover, Text, Stack, Divider } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { IconCalendar, IconChevronDown } from '@tabler/icons-react';

// Preset helpers
const today      = () => new Date();
const startOfDay = (d) => { const n = new Date(d); n.setHours(0,0,0,0); return n; };
const endOfDay   = (d) => { const n = new Date(d); n.setHours(23,59,59,999); return n; };
const toISO      = (d) => d?.toISOString().slice(0, 10) ?? null;

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

const PRESETS = [
  {
    label: 'This Month',
    range: () => {
      const n = today();
      return [startOfMonth(n), endOfMonth(n)];
    },
  },
  {
    label: 'Last Month',
    range: () => {
      const n = today();
      const first = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      return [first, endOfMonth(first)];
    },
  },
  {
    label: 'Last 30 Days',
    range: () => {
      const end   = today();
      const start = new Date(end); start.setDate(start.getDate() - 29);
      return [start, end];
    },
  },
  {
    label: 'Last 90 Days',
    range: () => {
      const end   = today();
      const start = new Date(end); start.setDate(start.getDate() - 89);
      return [start, end];
    },
  },
  {
    label: 'Year to Date',
    range: () => {
      const n = today();
      return [new Date(n.getFullYear(), 0, 1), n];
    },
  },
];

/**
 * DateRangeFilter
 *
 * Props:
 *   value        — [startDate, endDate] | null (null = all time)
 *   onChange     — (range: [Date, Date] | null) => void
 *   label        — optional label string shown on the trigger button
 */
export default function DateRangeFilter({ value, onChange, label }) {
  const [opened, setOpened] = useState(false);
  const [picking, setPicking] = useState(value ?? [null, null]);

  const allTime = value === null;

  const apply = useCallback((range) => {
    setPicking(range);
    if (range[0] && range[1]) {
      onChange([startOfDay(range[0]), endOfDay(range[1])]);
      setOpened(false);
    }
  }, [onChange]);

  const handlePreset = (range) => {
    apply(range);
  };

  const handleAllTime = () => {
    setPicking([null, null]);
    onChange(null);
    setOpened(false);
  };

  // Format display label
  const displayLabel = (() => {
    if (allTime) return 'All Time';
    if (!value?.[0] || !value?.[1]) return 'Select range…';
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fmt(value[0])} – ${fmt(value[1])}`;
  })();

  return (
    <Popover
      opened={opened}
      onClose={() => setOpened(false)}
      position="bottom-start"
      withinPortal
      shadow="md"
      width="auto"
    >
      <Popover.Target>
        <Button
          variant={allTime ? 'filled' : 'default'}
          color={allTime ? 'teal' : undefined}
          size="sm"
          rightSection={<IconChevronDown size={14} />}
          leftSection={<IconCalendar size={14} />}
          onClick={() => setOpened((o) => !o)}
          styles={{ label: { fontWeight: allTime ? 700 : 400 } }}
        >
          {label ? `${label}: ` : ''}{displayLabel}
        </Button>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap="xs" p={4}>
          {/* Preset chips */}
          <Group gap={6} wrap="wrap">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                size="xs"
                variant="light"
                color="teal"
                onClick={() => handlePreset(p.range())}
              >
                {p.label}
              </Button>
            ))}
            <Button size="xs" variant={allTime ? 'filled' : 'light'} color="gray" onClick={handleAllTime}>
              All Time
            </Button>
          </Group>

          <Divider />

          {/* Calendar */}
          <DatePicker
            type="range"
            value={picking}
            onChange={(range) => {
              setPicking(range);
              if (range[0] && range[1]) {
                onChange([startOfDay(range[0]), endOfDay(range[1])]);
                setOpened(false);
              }
            }}
            maxDate={today()}
            numberOfColumns={2}
            size="sm"
          />

          {picking[0] && !picking[1] && (
            <Text size="xs" c="dimmed" ta="center">Now pick an end date</Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
