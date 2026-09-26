import { Group, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

// Right-aligned table column header with an (i) hover explanation.
export default function ColumnHeader({ label, tip, flex = 1 }) {
  return (
    <Tooltip label={tip} multiline w={260} withArrow>
      <Group gap={3} justify="flex-end" wrap="nowrap" style={{ flex, cursor: 'help', whiteSpace: 'nowrap' }}>
        <Text size="xs" fw={700} ta="right">{label}</Text>
        <IconInfoCircle size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
      </Group>
    </Tooltip>
  );
}
