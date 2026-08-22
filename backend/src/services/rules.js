import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';

// ─── helpers ──────────────────────────────────────────────────────────────────
const rowToProfile = (row) => ({
  id:            row.id,
  name:          row.name,
  color:         row.color,
  icon:          row.icon,
  payeeMatch:    row.payee_match,
  description:   row.description,
  checkAmount:   row.check_amount ?? 0,
  defaultSplits: JSON.parse(row.default_splits ?? '[]'),
  createdAt:     row.created_at,
});

const rowToRule = (row) => ({
  id:          row.id,
  name:        row.name,
  enabled:     row.enabled === 1,
  profileId:   row.profile_id,
  trigger:     JSON.parse(row.trigger ?? '{}'),
  splits:      JSON.parse(row.splits ?? '[]'),
  autoApprove: row.auto_approve === 1,
  createdAt:   row.created_at,
});

// ─── Rules ────────────────────────────────────────────────────────────────────
export const getRules = async () => {
  const db = getDb();
  return db.prepare('SELECT * FROM rules ORDER BY created_at ASC').all().map(rowToRule);
};

export const saveRule = async (ruleData) => {
  const db = getDb();
  const rule = {
    id:          uuidv4(),
    name:        ruleData.name ?? null,
    enabled:     ruleData.enabled !== false ? 1 : 0,
    profileId:   ruleData.profileId ?? null,
    trigger:     JSON.stringify(ruleData.trigger ?? {}),
    splits:      JSON.stringify(ruleData.splits ?? []),
    autoApprove: ruleData.autoApprove ? 1 : 0,
    createdAt:   new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO rules (id, name, enabled, profile_id, trigger, splits, auto_approve, created_at)
    VALUES (@id, @name, @enabled, @profileId, @trigger, @splits, @autoApprove, @createdAt)
  `).run(rule);
  return rowToRule(db.prepare('SELECT * FROM rules WHERE id = ?').get(rule.id));
};

export const updateRule = async (id, updates) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  if (!row) throw new Error('Rule not found');
  const merged = {
    name:        updates.name        ?? row.name,
    enabled:     (updates.enabled !== undefined ? updates.enabled : row.enabled === 1) ? 1 : 0,
    profileId:   updates.profileId   !== undefined ? updates.profileId  : row.profile_id,
    trigger:     updates.trigger     !== undefined ? JSON.stringify(updates.trigger) : row.trigger,
    splits:      updates.splits      !== undefined ? JSON.stringify(updates.splits)  : row.splits,
    autoApprove: (updates.autoApprove !== undefined ? updates.autoApprove : row.auto_approve === 1) ? 1 : 0,
    id,
  };
  db.prepare(`
    UPDATE rules SET name=@name, enabled=@enabled, profile_id=@profileId,
      trigger=@trigger, splits=@splits, auto_approve=@autoApprove
    WHERE id=@id
  `).run(merged);
  return rowToRule(db.prepare('SELECT * FROM rules WHERE id = ?').get(id));
};

export const deleteRule = async (id) => {
  getDb().prepare('DELETE FROM rules WHERE id = ?').run(id);
};

// ─── Profiles ─────────────────────────────────────────────────────────────────
export const getProfiles = async () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all();
  if (rows.length === 0) {
    // Seed defaults on first run
    const defaults = [
      { id: 'profile-adobe',      name: 'Adobe',      color: 'blue',   icon: 'building', payeeMatch: 'Adobe',      description: 'Adobe Inc. salary deposit' },
      { id: 'profile-forcepoint', name: 'Forcepoint', color: 'orange', icon: 'shield',   payeeMatch: 'Forcepoint', description: 'Forcepoint salary deposit'  },
    ];
    for (const p of defaults) await saveProfile(p);
    return getProfiles();
  }
  return rows.map(rowToProfile);
};

export const saveProfile = async (profileData) => {
  const db = getDb();
  const profile = {
    id:           profileData.id ?? uuidv4(),
    name:         profileData.name,
    color:        profileData.color ?? null,
    icon:         profileData.icon ?? null,
    payeeMatch:   profileData.payeeMatch ?? null,
    description:  profileData.description ?? null,
    checkAmount:  profileData.checkAmount ?? 0,
    defaultSplits: JSON.stringify(profileData.defaultSplits ?? []),
    createdAt:    profileData.createdAt ?? new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO profiles (id, name, color, icon, payee_match, description, check_amount, default_splits, created_at)
    VALUES (@id, @name, @color, @icon, @payeeMatch, @description, @checkAmount, @defaultSplits, @createdAt)
  `).run(profile);
  return rowToProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id));
};

export const updateProfile = async (id, updates) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) throw new Error('Profile not found');
  const merged = {
    name:         updates.name         ?? row.name,
    color:        updates.color        !== undefined ? updates.color        : row.color,
    icon:         updates.icon         !== undefined ? updates.icon         : row.icon,
    payeeMatch:   updates.payeeMatch   !== undefined ? updates.payeeMatch   : row.payee_match,
    description:  updates.description  !== undefined ? updates.description  : row.description,
    checkAmount:  updates.checkAmount  !== undefined ? updates.checkAmount  : row.check_amount,
    defaultSplits: updates.defaultSplits !== undefined ? JSON.stringify(updates.defaultSplits) : row.default_splits,
    id,
  };
  db.prepare(`
    UPDATE profiles SET name=@name, color=@color, icon=@icon, payee_match=@payeeMatch,
      description=@description, check_amount=@checkAmount, default_splits=@defaultSplits
    WHERE id=@id
  `).run(merged);
  return rowToProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id));
};

export const deleteProfile = async (id) => {
  getDb().prepare('DELETE FROM profiles WHERE id = ?').run(id);
};

// ─── Budget Overrides ─────────────────────────────────────────────────────────
export const getBudgetOverrides = async () => {
  const db  = getDb();
  const rows = db.prepare('SELECT category_id, milliunits FROM budget_overrides').all();
  const map = {};
  rows.forEach((r) => { map[r.category_id] = r.milliunits; });
  return map;
};

export const setBudgetOverride = async (categoryId, milliunits) => {
  getDb().prepare(`
    INSERT INTO budget_overrides (category_id, milliunits, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(category_id) DO UPDATE SET milliunits=excluded.milliunits, updated_at=excluded.updated_at
  `).run(categoryId, milliunits, new Date().toISOString());
};

// ─── Split History ───────────────────────────────────────────────────────────
export const getSplitHistory = async () => {
  const db = getDb();
  return db.prepare('SELECT * FROM split_history ORDER BY applied_at DESC').all().map((row) => ({
    id:              row.id,
    transactionId:   row.transaction_id,
    profileId:       row.profile_id,
    profileName:     row.profile_name,
    transactionDate: row.transaction_date,
    payeeName:       row.payee_name,
    totalAmount:     row.total_amount,
    splits:          JSON.parse(row.splits_json ?? '[]'),
    appliedAt:       row.applied_at,
  }));
};

export const saveSplitHistory = async (data) => {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO split_history (id, transaction_id, profile_id, profile_name, transaction_date, payee_name, total_amount, splits_json, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.transactionId,
    data.profileId,
    data.profileName ?? null,
    data.transactionDate ?? null,
    data.payeeName ?? null,
    data.totalAmount,
    JSON.stringify(data.splits ?? []),
    new Date().toISOString()
  );
  return { id };
};

// ─── Rule matching engine (unchanged) ────────────────────────────────────────
export const applyRulesToTransaction = async (transaction, rules, budgetId) => {
  if (transaction.amount <= 0) return null;
  if (transaction.approved) return null;

  const matchingRule = rules.find((rule) => {
    if (!rule.enabled) return false;
    const { trigger } = rule;
    if (!trigger) return false;
    switch (trigger.type) {
      case 'payee':
        return transaction.payee_name?.toLowerCase().includes(String(trigger.value).toLowerCase());
      case 'amount_above':
        return transaction.amount >= trigger.value * 1000;
      case 'memo_contains':
        return transaction.memo?.toLowerCase().includes(String(trigger.value).toLowerCase());
      default:
        return false;
    }
  });

  if (!matchingRule) return null;

  const splitUpdates = matchingRule.splits
    .map((split) => ({
      categoryId: split.categoryId,
      amount: split.type === 'percent'
        ? Math.round((transaction.amount * split.value) / 100)
        : split.value * 1000,
      name: split.name || '',
    }))
    .filter((s) => s.amount > 0);

  return {
    transactionId: transaction.id,
    ruleId:        matchingRule.id,
    ruleName:      matchingRule.name,
    profileId:     matchingRule.profileId || null,
    splits:        splitUpdates,
    autoApprove:   matchingRule.autoApprove || false,
  };
};
