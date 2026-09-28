/* Ferrum persistence — SQLite (node:sqlite) with one-shot JSON migration.
 *
 * keeps a small in-memory mirror of users/creds/subs/invites so existing
 * server.js routes keep working; every saveDb() flushes atomically to SQLite.
 * Per-user workout state lives in user_state (JSON blob + ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { log } from './log.js';

function resolveDataDir() {
  const preferred = process.env.DATA_DIR || '/data';
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'ferrum-data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const DATA = resolveDataDir();
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA, 'ferrum.sqlite');

fs.mkdirSync(DATA, { recursive: true });

const sql = new DatabaseSync(DB_PATH);
try { fs.chmodSync(DB_PATH, 0o600); } catch { /* */ }

sql.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0,
    created TEXT,
    sv INTEGER NOT NULL DEFAULT 0,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS creds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subs (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_state (
    user_id TEXT PRIMARY KEY,
    ts INTEGER,
    json TEXT NOT NULL
  );
`);

/** In-memory mirror — same shape as the old db.json. */
export const db = { users: [], creds: [], subs: [], invites: [] };

function loadMirror() {
  db.users = sql.prepare('SELECT json FROM users').all().map(r => JSON.parse(r.json));
  db.creds = sql.prepare('SELECT json FROM creds').all().map(r => JSON.parse(r.json));
  db.subs = sql.prepare('SELECT json FROM subs').all().map(r => JSON.parse(r.json));
  db.invites = sql.prepare('SELECT json FROM invites').all().map(r => JSON.parse(r.json));
}

export function saveDb() {
  const tx = sql.prepare('BEGIN IMMEDIATE');
  const end = sql.prepare('COMMIT');
  const abort = sql.prepare('ROLLBACK');
  tx.run();
  try {
    sql.prepare('DELETE FROM users').run();
    sql.prepare('DELETE FROM creds').run();
    sql.prepare('DELETE FROM subs').run();
    sql.prepare('DELETE FROM invites').run();
    const insU = sql.prepare('INSERT INTO users (id, name, admin, created, sv, json) VALUES (?, ?, ?, ?, ?, ?)');
    for (const u of db.users) {
      insU.run(u.id, u.name || '', u.admin ? 1 : 0, u.created || null, u.sv || 0, JSON.stringify(u));
    }
    const insC = sql.prepare('INSERT INTO creds (id, user_id, json) VALUES (?, ?, ?)');
    for (const c of db.creds) insC.run(c.id, c.userId, JSON.stringify(c));
    const insS = sql.prepare('INSERT INTO subs (endpoint, user_id, json) VALUES (?, ?, ?)');
    for (const s of db.subs) insS.run(s.endpoint, s.userId, JSON.stringify(s));
    const insI = sql.prepare('INSERT INTO invites (code, json) VALUES (?, ?)');
    for (const i of db.invites) insI.run(i.code, JSON.stringify(i));
    end.run();
  } catch (e) {
    try { abort.run(); } catch { /* */ }
    throw e;
  }
}

export function readState(uid) {
  const row = sql.prepare('SELECT json FROM user_state WHERE user_id = ?').get(uid);
  if (!row) return null;
  try { return JSON.parse(row.json); } catch { return null; }
}

export function writeState(uid, state) {
  const ts = +(state?._ts || Date.now()) || Date.now();
  sql.prepare(`
    INSERT INTO user_state (user_id, ts, json) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET ts = excluded.ts, json = excluded.json
  `).run(uid, ts, JSON.stringify(state));
}

/** One-shot import from legacy db.json + state-*.json if SQLite is empty. */
export function migrateFromJsonIfNeeded() {
  const n = sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (n > 0) { loadMirror(); return { migrated: false }; }

  const dbFile = path.join(DATA, 'db.json');
  let legacy = null;
  try { legacy = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { /* none */ }
  if (legacy) {
    db.users = legacy.users || [];
    db.creds = legacy.creds || [];
    db.subs = legacy.subs || [];
    db.invites = legacy.invites || [];
    saveDb();
    log.info('sqlite_migrated_db_json', { users: db.users.length });
  } else {
    loadMirror();
  }

  let states = 0;
  try {
    for (const f of fs.readdirSync(DATA)) {
      const m = /^state-(.+)\.json$/.exec(f);
      if (!m) continue;
      try {
        const st = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
        writeState(m[1], st);
        states++;
      } catch { /* skip bad file */ }
    }
  } catch { /* */ }
  if (states) log.info('sqlite_migrated_states', { count: states });
  sql.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('migrated_at', new Date().toISOString());
  return { migrated: !!(legacy || states) };
}

migrateFromJsonIfNeeded();

export function dbPath() { return DB_PATH; }
export function userCount() {
  return sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

export default { db, saveDb, readState, writeState, dbPath, userCount };
