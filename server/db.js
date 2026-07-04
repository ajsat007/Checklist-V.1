/* =====================================================================
   db.js — SQLite storage (replaces the Google Sheet)
   Uses Node's BUILT-IN sqlite module (node:sqlite, Node >= 22.13 / 24),
   so there are NO native npm dependencies and no build tools needed.
   Writes are synchronous and serialized in this single process — that
   gives us the atomicity the old Apps Script code needed LockService for.

   The exported object mimics the tiny slice of the better-sqlite3 API the
   rest of the code uses: prepare(), exec(), transaction().
   ===================================================================== */
'use strict';

const path = require('path');
const fs   = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR env var lets hosting platforms point the DB at a persistent disk
// (e.g. Render mounts one at /data). Defaults to ../data for local use.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const raw = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
raw.exec('PRAGMA journal_mode = WAL;');   // better read concurrency during writes

raw.exec(`
CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  password    TEXT,               -- NULL/'' => default password is the employee_id
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS locations (
  district TEXT NOT NULL,
  station  TEXT NOT NULL,
  UNIQUE(district, station)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT PRIMARY KEY,
  token_id         TEXT,
  district         TEXT,
  station          TEXT,
  supervisor_name  TEXT,
  employee_id      TEXT,
  checklist_type   TEXT,
  checklist_key    TEXT,
  created_time     TEXT,          -- 'dd/MM/yyyy HH:mm:ss' (IST)
  created_date     TEXT,          -- 'dd/MM/yyyy' (fast day filter/duplicate gate)
  date_iso         TEXT,          -- 'yyyy-MM-dd' (what the <input type=date> uses)
  last_updated     TEXT,
  completed_shifts INTEGER DEFAULT 0,
  total_buses      INTEGER DEFAULT 0,
  status           TEXT,
  total_shifts     INTEGER DEFAULT 0,
  pdf_url          TEXT DEFAULT '',
  shifts_json      TEXT DEFAULT '[]',
  buses_json       TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_sessions_emp    ON sessions(employee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(station, checklist_key, status);

CREATE TABLE IF NOT EXISTS token_counters (
  code TEXT PRIMARY KEY,          -- 'DIST_STN'
  seq  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT,
  action  TEXT,
  session_id TEXT,
  details TEXT
);
`);

const db = {
  prepare: (sql) => raw.prepare(sql),
  exec:    (sql) => raw.exec(sql),
  // better-sqlite3-style transaction wrapper: db.transaction(fn) returns a
  // callable that runs fn atomically.
  transaction (fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try { const r = fn(...args); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch (_) {} throw e; }
    };
  }
};

module.exports = db;
