import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA_DIR = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '../../data');
const DB_PATH  = join(DATA_DIR, 'ynabapp.db');
const RULES_FILE    = join(DATA_DIR, 'rules.json');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');

let _db = null;

export const getDb = () => {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  initSchema(_db);
  migrateFromJson(_db);
  return _db;
};

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       TEXT,
      icon        TEXT,
      payee_match TEXT,
      description TEXT,
      check_amount REAL DEFAULT 0,
      default_splits TEXT DEFAULT '[]',
      created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS rules (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      enabled     INTEGER DEFAULT 1,
      profile_id  TEXT,
      trigger     TEXT,
      splits      TEXT DEFAULT '[]',
      auto_approve INTEGER DEFAULT 0,
      created_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS budget_overrides (
      category_id TEXT PRIMARY KEY,
      milliunits  INTEGER NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS split_history (
      id               TEXT PRIMARY KEY,
      transaction_id   TEXT NOT NULL,
      profile_id       TEXT NOT NULL,
      profile_name     TEXT,
      transaction_date TEXT,
      payee_name       TEXT,
      total_amount     REAL NOT NULL,
      splits_json      TEXT NOT NULL,
      applied_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budget_snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      month        TEXT NOT NULL,
      category_id  TEXT NOT NULL,
      category_name TEXT NOT NULL,
      group_name   TEXT NOT NULL,
      budgeted     INTEGER NOT NULL DEFAULT 0,
      activity     INTEGER NOT NULL DEFAULT 0,
      balance      INTEGER NOT NULL DEFAULT 0,
      override_milliunits INTEGER,
      snapshotted_at TEXT NOT NULL,
      UNIQUE(month, category_id)
    );

    CREATE TABLE IF NOT EXISTS bva_tracking (
      category_id TEXT PRIMARY KEY,
      enabled     INTEGER NOT NULL DEFAULT 1,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hidden_categories (
      category_id TEXT PRIMARY KEY,
      hidden_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS category_feedback (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id        TEXT,
      payee_name            TEXT NOT NULL,
      payee_norm            TEXT NOT NULL,
      amount                REAL,
      memo                  TEXT,
      suggested_category_id TEXT,
      suggested_confidence  TEXT,
      chosen_category_id    TEXT NOT NULL,
      chosen_category_name  TEXT,
      accepted              INTEGER NOT NULL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_category_feedback_payee ON category_feedback(payee_norm);
  `);
}

function migrateFromJson(db) {
  // Only migrate if tables are empty and JSON files exist
  const profileCount = db.prepare('SELECT COUNT(*) as n FROM profiles').get().n;
  if (profileCount === 0 && existsSync(PROFILES_FILE)) {
    try {
      const profiles = JSON.parse(readFileSync(PROFILES_FILE, 'utf-8'));
      const insert = db.prepare(`
        INSERT OR IGNORE INTO profiles (id, name, color, icon, payee_match, description, check_amount, default_splits, created_at)
        VALUES (@id, @name, @color, @icon, @payeeMatch, @description, @checkAmount, @defaultSplits, @createdAt)
      `);
      const migrate = db.transaction((profiles) => {
        for (const p of profiles) {
          insert.run({
            id: p.id,
            name: p.name,
            color: p.color ?? null,
            icon: p.icon ?? null,
            payeeMatch: p.payeeMatch ?? null,
            description: p.description ?? null,
            checkAmount: p.checkAmount ?? 0,
            defaultSplits: JSON.stringify(p.defaultSplits ?? []),
            createdAt: p.createdAt ?? new Date().toISOString(),
          });
        }
      });
      migrate(profiles);
      console.log(`[db] Migrated ${profiles.length} profiles from JSON`);
    } catch (e) {
      console.error('[db] Profile migration error:', e.message);
    }
  }

  const ruleCount = db.prepare('SELECT COUNT(*) as n FROM rules').get().n;
  if (ruleCount === 0 && existsSync(RULES_FILE)) {
    try {
      const rules = JSON.parse(readFileSync(RULES_FILE, 'utf-8'));
      const insert = db.prepare(`
        INSERT OR IGNORE INTO rules (id, name, enabled, profile_id, trigger, splits, auto_approve, created_at)
        VALUES (@id, @name, @enabled, @profileId, @trigger, @splits, @autoApprove, @createdAt)
      `);
      const migrate = db.transaction((rules) => {
        for (const r of rules) {
          insert.run({
            id: r.id,
            name: r.name ?? null,
            enabled: r.enabled ? 1 : 0,
            profileId: r.profileId ?? null,
            trigger: JSON.stringify(r.trigger ?? {}),
            splits: JSON.stringify(r.splits ?? []),
            autoApprove: r.autoApprove ? 1 : 0,
            createdAt: r.createdAt ?? new Date().toISOString(),
          });
        }
      });
      migrate(rules);
      console.log(`[db] Migrated ${rules.length} rules from JSON`);
    } catch (e) {
      console.error('[db] Rules migration error:', e.message);
    }
  }
}

export const getSetting = (key) => {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

export const setSetting = (key, value) => {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
};

// ── Categorization feedback (learn from approved/overridden AI suggestions) ──

export const normalizePayee = (name) => (name || '').trim().toLowerCase();

export const recordCategoryFeedback = (rows) => {
  const insert = getDb().prepare(`
    INSERT INTO category_feedback
      (transaction_id, payee_name, payee_norm, amount, memo,
       suggested_category_id, suggested_confidence, chosen_category_id, chosen_category_name, accepted)
    VALUES (@transactionId, @payeeName, @payeeNorm, @amount, @memo,
            @suggestedCategoryId, @suggestedConfidence, @chosenCategoryId, @chosenCategoryName, @accepted)
  `);
  const insertAll = getDb().transaction((rows) => {
    let n = 0;
    for (const r of rows) {
      if (!r.payee_name || !r.chosen_category_id) continue;
      insert.run({
        transactionId:       r.transaction_id ?? null,
        payeeName:           r.payee_name,
        payeeNorm:           normalizePayee(r.payee_name),
        amount:              r.amount ?? null,
        memo:                r.memo ?? null,
        suggestedCategoryId: r.suggested_category_id ?? null,
        suggestedConfidence: r.suggested_confidence ?? null,
        chosenCategoryId:    r.chosen_category_id,
        chosenCategoryName:  r.chosen_category_name ?? null,
        accepted:            r.accepted ? 1 : 0,
      });
      n++;
    }
    return n;
  });
  return insertAll(rows);
};

// Best learned category per payee: most times chosen, ties broken by recency.
export const getPayeeCategoryMap = () => {
  const rows = getDb().prepare(`
    SELECT payee_norm, payee_name, chosen_category_id, chosen_category_name,
           COUNT(*) AS n, MAX(created_at) AS last_used
    FROM category_feedback
    GROUP BY payee_norm, chosen_category_id
  `).all();

  const best = {};
  for (const r of rows) {
    const cur = best[r.payee_norm];
    if (!cur || r.n > cur.n || (r.n === cur.n && r.last_used > cur.last_used)) best[r.payee_norm] = r;
  }
  return best; // payee_norm → { payee_name, chosen_category_id, chosen_category_name, n, last_used }
};
