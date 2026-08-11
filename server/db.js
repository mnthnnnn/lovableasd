const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');

let isPg = false;
let pgPool = null;
let sqliteDb = null;

// Determine database connection strategy
const dbUrl = process.env.DATABASE_URL;

if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
  try {
    pgPool = new Pool({
      connectionString: dbUrl,
      family: 4,
      ssl: { rejectUnauthorized: false },
    });
    isPg = true;
    console.log('📦 Using PostgreSQL database connection');
  } catch (e) {
    console.warn('⚠️ PostgreSQL connection failed, falling back to local SQLite:', e.message);
    isPg = false;
  }
}

if (!isPg) {
  const dbPath = path.join(__dirname, 'keygen.sqlite');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  console.log(`📦 Using local SQLite database at: ${dbPath}`);
}

// ── SQL Translator for SQLite Compatibility ────────────────────────────────
function translateSql(sql) {
  let translated = sql;

  // 1. Complex BOOL_OR with interval
  translated = translated.replace(
    /BOOL_OR\s*\(\s*ks\.is_online\s+AND\s+ks\.last_seen\s*>\s*NOW\(\)\s*-\s*INTERVAL\s*'90 seconds'\s*\)/gi,
    "MAX(CASE WHEN ks.is_online = 1 AND ks.last_seen > datetime('now', '-90 seconds') THEN 1 ELSE 0 END)"
  );
  translated = translated.replace(/BOOL_OR\((.+?)\)/gi, "MAX(CASE WHEN $1 THEN 1 ELSE 0 END)");

  // 2. NOW() - INTERVAL '90 seconds'
  translated = translated.replace(/NOW\(\)\s*-\s*INTERVAL\s*'90 seconds'/gi, "datetime('now', '-90 seconds')");

  // 3. General NOW()
  translated = translated.replace(/\bNOW\(\)/gi, "datetime('now')");

  // 4. STRING_AGG(DISTINCT expr, delim) -> GROUP_CONCAT(DISTINCT expr)
  translated = translated.replace(/STRING_AGG\(\s*DISTINCT\s+(.+?)\s*,\s*('.+?')\s*\)/gi, "GROUP_CONCAT(DISTINCT $1)");
  translated = translated.replace(/STRING_AGG\((.+?)\s*,\s*('.+?')\s*\)/gi, "GROUP_CONCAT($1)");

  // 5. Postgres casts
  translated = translated.replace(/::text/gi, "");
  translated = translated.replace(/::INTEGER/gi, "");

  // 6. Convert Postgres $1, $2 parameters to ? in SQLite
  translated = translated.replace(/\$(\d+)/g, '?');

  return translated;
}

function processParams(params = []) {
  return params.map(p => {
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

// ── Unified Pool API ───────────────────────────────────────────────────────
const pool = {
  async query(sql, params = []) {
    if (isPg) {
      try {
        return await pgPool.query(sql, params);
      } catch (err) {
        console.warn('⚠️ PostgreSQL query failed, attempting local SQLite fallback:', err.message);
        isPg = false;
        if (!sqliteDb) {
          const dbPath = path.join(__dirname, 'keygen.sqlite');
          sqliteDb = new DatabaseSync(dbPath);
          sqliteDb.exec('PRAGMA foreign_keys = ON;');
        }
        return pool.query(sql, params);
      }
    }

    // SQLite Execution
    const cleanSql = translateSql(sql);
    const cleanParams = processParams(params);

    const trimSql = cleanSql.trim().toUpperCase();

    if (trimSql === 'BEGIN') {
      sqliteDb.exec('BEGIN TRANSACTION');
      return { rows: [], rowCount: 0 };
    }
    if (trimSql === 'COMMIT') {
      sqliteDb.exec('COMMIT');
      return { rows: [], rowCount: 0 };
    }
    if (trimSql === 'ROLLBACK') {
      sqliteDb.exec('ROLLBACK');
      return { rows: [], rowCount: 0 };
    }

    try {
      const stmt = sqliteDb.prepare(cleanSql);
      if (trimSql.startsWith('SELECT') || cleanSql.toUpperCase().includes('RETURNING')) {
        const rows = stmt.all(...cleanParams);
        const normalizedRows = rows.map(row => {
          const newRow = { ...row };
          for (const key in newRow) {
            if (newRow[key] === null || newRow[key] === undefined) continue;
            if (key === 'is_online') {
              newRow[key] = Boolean(newRow[key]);
            }
          }
          return newRow;
        });
        return { rows: normalizedRows, rowCount: normalizedRows.length };
      } else {
        const info = stmt.run(...cleanParams);
        return { rows: [], rowCount: info.changes || 0 };
      }
    } catch (err) {
      console.error('❌ SQLite Query Error:', err.message, '\nSQL:', cleanSql, '\nParams:', cleanParams);
      throw err;
    }
  },

  async connect() {
    if (isPg) {
      return await pgPool.connect();
    }
    return {
      query: (sql, params) => pool.query(sql, params),
      release: () => {},
    };
  }
};

// ── Schema Initialization ─────────────────────────────────────────────────
async function initDb() {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS keys (
          id                       SERIAL PRIMARY KEY,
          key_string               TEXT    UNIQUE NOT NULL,
          plan                     TEXT    NOT NULL,
          duration_minutes         INTEGER NOT NULL,
          max_devices              INTEGER DEFAULT 1,
          note                     TEXT    DEFAULT '',
          status                   TEXT    DEFAULT 'inactive',
          created_at               TIMESTAMPTZ DEFAULT NOW(),
          activated_at             TIMESTAMPTZ,
          expires_at               TIMESTAMPTZ,
          paused_at                TIMESTAMPTZ,
          paused_remaining_seconds INTEGER,
          device_count             INTEGER DEFAULT 0,
          admin_action_by          TEXT
        );

        CREATE TABLE IF NOT EXISTS key_devices (
          id          SERIAL PRIMARY KEY,
          key_id      INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
          device_id   TEXT    NOT NULL,
          user_name   TEXT    DEFAULT 'User',
          linked_at   TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(key_id, device_id)
        );

        CREATE TABLE IF NOT EXISTS key_logs (
          id         SERIAL PRIMARY KEY,
          key_id     INTEGER,
          key_string TEXT,
          action     TEXT    NOT NULL,
          admin_name TEXT,
          note       TEXT,
          timestamp  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS key_sessions (
          id            SERIAL PRIMARY KEY,
          key_id        INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
          key_string    TEXT    NOT NULL,
          device_id     TEXT    NOT NULL,
          user_name     TEXT    DEFAULT 'User',
          session_start TIMESTAMPTZ DEFAULT NOW(),
          last_seen     TIMESTAMPTZ DEFAULT NOW(),
          total_seconds INTEGER DEFAULT 0,
          chat_count    INTEGER DEFAULT 0,
          is_online     BOOLEAN DEFAULT true,
          UNIQUE(key_id, device_id)
        );

        CREATE INDEX IF NOT EXISTS idx_keys_string    ON keys(key_string);
        CREATE INDEX IF NOT EXISTS idx_keys_status    ON keys(status);
        CREATE INDEX IF NOT EXISTS idx_devices_kid    ON key_devices(key_id);
        CREATE INDEX IF NOT EXISTS idx_logs_kid       ON key_logs(key_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_kid   ON key_sessions(key_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_key   ON key_sessions(key_string);
        CREATE INDEX IF NOT EXISTS idx_sessions_dev   ON key_sessions(device_id);
      `);
      console.log('✅ PostgreSQL schema ready');
    } finally {
      client.release();
    }
  } else {
    // SQLite Schema Init
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS keys (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        key_string               TEXT    UNIQUE NOT NULL,
        plan                     TEXT    NOT NULL,
        duration_minutes         INTEGER NOT NULL,
        max_devices              INTEGER DEFAULT 1,
        note                     TEXT    DEFAULT '',
        status                   TEXT    DEFAULT 'inactive',
        created_at               TEXT    DEFAULT (datetime('now')),
        activated_at             TEXT,
        expires_at               TEXT,
        paused_at                TEXT,
        paused_remaining_seconds INTEGER,
        device_count             INTEGER DEFAULT 0,
        admin_action_by          TEXT
      );

      CREATE TABLE IF NOT EXISTS key_devices (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id      INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
        device_id   TEXT    NOT NULL,
        user_name   TEXT    DEFAULT 'User',
        linked_at   TEXT    DEFAULT (datetime('now')),
        UNIQUE(key_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS key_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id     INTEGER,
        key_string TEXT,
        action     TEXT    NOT NULL,
        admin_name TEXT,
        note       TEXT,
        timestamp  TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS key_sessions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id        INTEGER NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
        key_string    TEXT    NOT NULL,
        device_id     TEXT    NOT NULL,
        user_name     TEXT    DEFAULT 'User',
        session_start TEXT    DEFAULT (datetime('now')),
        last_seen     TEXT    DEFAULT (datetime('now')),
        total_seconds INTEGER DEFAULT 0,
        chat_count    INTEGER DEFAULT 0,
        is_online     INTEGER DEFAULT 1,
        UNIQUE(key_id, device_id)
      );

      CREATE INDEX IF NOT EXISTS idx_keys_string    ON keys(key_string);
      CREATE INDEX IF NOT EXISTS idx_keys_status    ON keys(status);
      CREATE INDEX IF NOT EXISTS idx_devices_kid    ON key_devices(key_id);
      CREATE INDEX IF NOT EXISTS idx_logs_kid       ON key_logs(key_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_kid   ON key_sessions(key_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_key   ON key_sessions(key_string);
      CREATE INDEX IF NOT EXISTS idx_sessions_dev   ON key_sessions(device_id);
    `);
    console.log('✅ Local SQLite schema ready');
  }
}

module.exports = { pool, initDb };
