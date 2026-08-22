import { useState, useEffect } from 'react';
import {
  Stack, Title, Button, Card, Group, Text,
  Divider, Tooltip, Grid, ThemeIcon,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconEdit, IconBriefcase, IconFileImport, IconInfoCircle,
} from '@tabler/icons-react';
import { api } from '../context/YNABContext';
import {
  MonthlyBudgetCard, ProfileCard, ProfileModal, CSVImportModal,
  FamilyBudgetImportModal, SplitsModal, ConfirmDeleteModal, RecalculateSplitsButton,
} from './RulesPage';

// Budget page — paycheck sources (profiles + splits) and monthly budget
// envelopes, moved out of the Income page.
export default function BudgetPage() {
  const [rules,         setRules]         = useState([]);
  const [profiles,      setProfiles]      = useState([]);
  const [editProfile,   setEditProfile]   = useState(null);
  const [csvProfile,    setCsvProfile]    = useState(null);
  const [splitsProfile, setSplitsProfile] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name }

  const [profileModalOpen,      { open: openProfileModal,      close: closeProfileModal      }] = useDisclosure(false);
  const [csvModalOpen,          { open: openCsvModal,          close: closeCsvModal          }] = useDisclosure(false);
  const [splitsModalOpen,       { open: openSplitsModal,       close: closeSplitsModal       }] = useDisclosure(false);
  const [familyBudgetModalOpen, { open: openFamilyBudgetModal, close: closeFamilyBudgetModal }] = useDisclosure(false);

  const load = async () => {
    try {
      const [rr, pr] = await Promise.all([api.get('/rules'), api.get('/rules/profiles')]);
      setRules(rr.data);
      setProfiles(pr.data);
    } catch (err) {
      notifications.show({ title: 'Error loading data', message: err.message, color: 'red' });
    }
  };

  useEffect(() => { load(); }, []);

  const requestDeleteProfile = (profile) =>
    setConfirmDelete({ id: profile.id, name: profile.name });

  const executeDelete = async () => {
    if (!confirmDelete) return;
    await api.delete(`/rules/profiles/${confirmDelete.id}`);
    notifications.show({ title: 'Source deleted', color: 'orange' });
    load();
    setConfirmDelete(null);
  };

  const openModifySplits = (profile) => {
    // Always fetch latest profile data before opening so splits are current
    setSplitsProfile(profile);
    openSplitsModal();
  };

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={2}>Budget</Title>
        <Group wrap="wrap" gap="xs">
          <Button variant="light" color="grape"
            leftSection={<IconFileImport size={16} />} onClick={openFamilyBudgetModal}>
            Family Budget CSV
          </Button>
          <Button variant="light" leftSection={<IconPlus size={16} />}
            onClick={() => { setEditProfile(null); openProfileModal(); }}>
            New Income Source
          </Button>
        </Group>
      </Group>

      <Stack gap="lg">
        {/* ── Paychecks ─────────────────────────────────────────────── */}
        <RecalculateSplitsButton profiles={profiles} onReload={load} />

        <div>
          <Group gap="xs" mb="sm">
            <Text fw={600}>Income Sources</Text>
            <Tooltip
              multiline
              w={260}
              label="Each source has its own colour, icon, and budget splits. Use Family Budget CSV to import your household spreadsheet."
            >
              <ThemeIcon size="sm" radius="xl" variant="subtle" color="gray">
                <IconInfoCircle size={14} />
              </ThemeIcon>
            </Tooltip>
          </Group>

          {profiles.length === 0 ? (
            <Card withBorder radius="md" p="xl" ta="center">
              <IconBriefcase size={40} color="gray" />
              <Text mt="sm" c="dimmed">No income sources yet — Adobe and Forcepoint are seeded on first load.</Text>
              <Button mt="md" leftSection={<IconPlus size={14} />}
                onClick={() => { setEditProfile(null); openProfileModal(); }}>
                Add First Source
              </Button>
            </Card>
          ) : (
            <Grid>
              {profiles.map((profile) => (
                <Grid.Col key={profile.id} span={{ base: 12, sm: 6, lg: 4 }}>
                  <ProfileCard
                    profile={profile}
                    allRules={rules}
                    onEdit={() => { setEditProfile(profile); openProfileModal(); }}
                    onDelete={() => requestDeleteProfile(profile)}
                    onImportCSV={() => { setCsvProfile(profile); openCsvModal(); }}
                    onModifySplits={() => openModifySplits(profile)}
                  />
                </Grid.Col>
              ))}
              <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                <Card withBorder radius="md" p="xl"
                  style={{ border: '2px dashed var(--mantine-color-gray-3)', cursor: 'pointer', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => { setEditProfile(null); openProfileModal(); }}>
                  <Stack align="center" gap="xs">
                    <ThemeIcon size="xl" variant="light" color="gray" radius="md">
                      <IconPlus size={24} />
                    </ThemeIcon>
                    <Text c="dimmed" size="sm">Add Income Source</Text>
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          )}
        </div>

        {/* ── Monthly Budget ─────────────────────────────────────────── */}
        <div>
          <Divider
            my="xs"
            label={<Group gap={6}><IconEdit size={14} /><Text fw={600} size="sm">Monthly Budget</Text></Group>}
            labelPosition="left"
          />
          <MonthlyBudgetCard profiles={profiles} onReload={load} />
        </div>
      </Stack>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      <SplitsModal
        opened={splitsModalOpen}
        onClose={closeSplitsModal}
        profile={splitsProfile}
        allProfiles={profiles}
        onSaved={load}
      />
      <ProfileModal opened={profileModalOpen} onClose={closeProfileModal}
        profile={editProfile} onSaved={load} />
      <CSVImportModal opened={csvModalOpen} onClose={closeCsvModal}
        profile={csvProfile} onImported={load} />
      <FamilyBudgetImportModal opened={familyBudgetModalOpen} onClose={closeFamilyBudgetModal}
        profiles={profiles} rules={rules} onImported={load} />

      <ConfirmDeleteModal
        opened={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Income Source"
        description={`"${confirmDelete?.name}" and all its settings will be permanently deleted.`}
        onConfirm={executeDelete}
      />
    </Stack>
  );
}
