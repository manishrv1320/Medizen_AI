import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'data');
export const UPLOAD_DIR = path.join(root, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'medizen.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  dob             TEXT,
  gender          TEXT,
  blood_group     TEXT,
  height_cm       REAL,
  phone           TEXT,
  conditions      TEXT,
  allergies       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  assistant_name  TEXT NOT NULL DEFAULT 'Zen',
  voice_enabled   INTEGER NOT NULL DEFAULT 0,
  last_briefing_on TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  date        TEXT NOT NULL,
  provider    TEXT,
  doctor      TEXT,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  value      REAL NOT NULL,
  unit       TEXT,
  ref_low    REAL,
  ref_high   REAL
);

CREATE TABLE IF NOT EXISTS report_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id      INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  stored_name    TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vitals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  value        REAL NOT NULL,
  value2       REAL,
  note         TEXT,
  recorded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other',
  notes         TEXT,
  frequency     TEXT NOT NULL DEFAULT 'once',
  next_due_at   TEXT NOT NULL,
  snooze_until  TEXT,
  notified_for  TEXT,
  escalated_for TEXT,
  last_done_at  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT NOT NULL DEFAULT 'info',
  link        TEXT,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS family_shares (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_email    TEXT NOT NULL COLLATE NOCASE,
  member_user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  relation        TEXT,
  access          TEXT NOT NULL DEFAULT 'view',
  notify          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, member_email)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_user   ON reports(user_id, date);
CREATE INDEX IF NOT EXISTS idx_vitals_user    ON vitals(user_id, type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_reminders_due  ON reminders(active, next_due_at);
CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_shares_member  ON family_shares(member_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_user      ON chat_messages(user_id, id);
`);

// node:sqlite returns null-prototype rows; spread them into plain objects for JSON/res.json.
const plain = (row) => (row ? { ...row } : undefined);

export const one = (sql, ...params) => plain(db.prepare(sql).get(...params));
export const all = (sql, ...params) => db.prepare(sql).all(...params).map(plain);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
