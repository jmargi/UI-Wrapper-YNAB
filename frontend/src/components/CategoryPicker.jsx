import { useState } from 'react';
import {
  Modal, TextInput, Input, UnstyledButton, Group, Text, Box, Stack,
  Select, ActionIcon, Button,
} from '@mantine/core';
import { useMediaQuery, useDisclosure } from '@mantine/hooks';
import { IconSearch, IconChevronDown, IconX, IconCheck } from '@tabler/icons-react';

// Category selector that adapts to the device:
//  - Desktop: a normal searchable/clearable Select.
//  - Mobile (≤48em): an input-look button that opens a full-screen picker with
//    a search box, big touch targets, and a prominent "Clear category" action —
//    replacing/removing a category no longer requires hitting a tiny ✕.
export default function CategoryPicker({
  value, onChange, categories,
  label, placeholder = 'Pick category', size = 'sm',
  clearable = true, disabled, style,
}) {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [opened, { open, close }] = useDisclosure(false);
  const [query, setQuery] = useState('');

  if (!isMobile) {
    return (
      <Select
        label={label}
        placeholder={placeholder}
        size={size}
        style={style}
        disabled={disabled}
        searchable
        clearable={clearable}
        data={categories.map((c) => ({ value: c.id, label: `${c.groupName} → ${c.name}` }))}
        value={value ?? null}
        onChange={onChange}
      />
    );
  }

  const selected = categories.find((c) => c.id === value) || null;

  // Group the (filtered) categories by their group, preserving list order.
  const q = query.trim().toLowerCase();
  const groups = [];
  let cur = null;
  for (const c of categories) {
    if (q && !`${c.groupName} ${c.name}`.toLowerCase().includes(q)) continue;
    if (!cur || cur.name !== c.groupName) {
      cur = { name: c.groupName, cats: [] };
      groups.push(cur);
    }
    cur.cats.push(c);
  }

  const closePicker = () => { setQuery(''); close(); };
  const pick = (id) => { onChange(id); closePicker(); };

  const target = (
    <Input
      component="button"
      type="button"
      pointer
      size={size}
      disabled={disabled}
      onClick={open}
      style={label ? undefined : style}
      rightSection={<IconChevronDown size={14} />}
      rightSectionPointerEvents="none"
    >
      {selected ? (
        <Box component="span" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected.name}
        </Box>
      ) : (
        <Input.Placeholder>{placeholder}</Input.Placeholder>
      )}
    </Input>
  );

  return (
    <>
      {label
        ? <Input.Wrapper label={label} size={size} style={style}>{target}</Input.Wrapper>
        : target}

      <Modal
        opened={opened}
        onClose={closePicker}
        fullScreen
        title="Choose category"
        padding="md"
        transitionProps={{ duration: 0 }}
        styles={{
          // Leave room for the sticky Cancel bar + iPhone home indicator.
          body: { paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' },
        }}
      >
        <Stack gap="sm">
          <TextInput
            placeholder="Search categories…"
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rightSection={query ? (
              <ActionIcon variant="subtle" color="gray" onClick={() => setQuery('')} aria-label="Clear search">
                <IconX size={14} />
              </ActionIcon>
            ) : null}
            style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--mantine-color-body)' }}
          />

          {clearable && value && (
            <UnstyledButton
              onClick={() => pick(null)}
              style={{
                width: '100%', padding: '12px 8px', borderRadius: 8,
                border: '1px dashed var(--mantine-color-red-4)',
              }}
            >
              <Group gap="sm" wrap="nowrap">
                <IconX size={16} color="var(--mantine-color-red-6)" />
                <Text size="sm" c="red" fw={600}>Clear category</Text>
              </Group>
            </UnstyledButton>
          )}

          {groups.map((g) => (
            <Box key={g.name}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={2}>{g.name}</Text>
              {g.cats.map((c) => (
                <UnstyledButton
                  key={c.id}
                  onClick={() => pick(c.id)}
                  style={{
                    display: 'block', width: '100%', padding: '12px 8px', borderRadius: 8,
                    background: c.id === value ? 'var(--mantine-color-teal-light)' : undefined,
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={c.id === value ? 600 : 400}>{c.name}</Text>
                    {c.id === value && <IconCheck size={16} color="var(--mantine-color-teal-6)" />}
                  </Group>
                </UnstyledButton>
              ))}
            </Box>
          ))}

          {groups.length === 0 && (
            <Text c="dimmed" ta="center" py="lg">No categories match “{query}”</Text>
          )}
        </Stack>

        {/* Thumb-reachable Cancel — no need to stretch to the ✕ at the top */}
        <Box
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '0.6rem 1rem',
            paddingBottom: 'calc(0.6rem + env(safe-area-inset-bottom))',
            background: 'var(--mantine-color-body)',
            borderTop: '1px solid var(--mantine-color-default-border)',
            zIndex: 10,
          }}
        >
          <Button fullWidth size="md" variant="default" onClick={closePicker}>
            Cancel
          </Button>
        </Box>
      </Modal>
    </>
  );
}
