const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render PostgreSQL requires SSL
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// ── Schema init ────────────────────────────────────────────────────────────
async function initDb() {
  const client = await pool.connect();
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

      CREATE INDEX IF NOT EXISTS idx_keys_string ON keys(key_string);
      CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);
      CREATE INDEX IF NOT EXISTS idx_devices_kid ON key_devices(key_id);
      CREATE INDEX IF NOT EXISTS idx_logs_kid    ON key_logs(key_id);
    `);
    console.log('✅ PostgreSQL schema ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
