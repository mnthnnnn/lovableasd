// Force IPv4 DNS — Render free tier doesn't support IPv6
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { pool, initDb } = require('./db');
const { generateKey, PLANS } = require('./keygen');

const app            = express();
const PORT           = process.env.PORT          || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_now';

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',   // Allow Netlify admin panel + Chrome extension
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-password'],
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Admin Auth ─────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function autoExpire() {
  await pool.query("UPDATE keys SET status='expired' WHERE status='active' AND expires_at < NOW()");
}

async function logAction(keyId, keyStr, action, adminName, note) {
  await pool.query(
    'INSERT INTO key_logs (key_id, key_string, action, admin_name, note) VALUES ($1,$2,$3,$4,$5)',
    [keyId, keyStr, action, adminName || null, note || null]
  );
}

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ══════════════════════════════════════════════════════════════════════════
// PUBLIC API  (Chrome Extension)
// ══════════════════════════════════════════════════════════════════════════

/** POST /api/keys/validate */
app.post('/api/keys/validate', async (req, res) => {
  const { key, deviceId, userName = 'User' } = req.body || {};

  if (!key || !deviceId)
    return res.json({ ok: false, status: 'invalid', message: 'Missing key or device ID.' });

  const keyStr = String(key).trim().toUpperCase();
  const devId  = String(deviceId).trim();

  if (!/^MNTHNNNN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(keyStr))
    return res.json({ ok: false, status: 'invalid', message: 'Invalid key format.' });

  try {
    const { rows } = await pool.query('SELECT * FROM keys WHERE key_string=$1', [keyStr]);
    const rec = rows[0];
    if (!rec) return res.json({ ok: false, status: 'invalid', message: 'Invalid license key.' });

    // ── Revoked ──
    if (rec.status === 'revoked') {
      await logAction(rec.id, keyStr, 'validate_rejected', null, 'revoked');
      return res.json({ ok: false, status: 'revoked', message: 'This key has been revoked.' });
    }

    // ── Paused ──
    if (rec.status === 'paused') {
      await logAction(rec.id, keyStr, 'validate_rejected', null, 'paused');
      return res.json({
        ok: false, status: 'paused',
        message: `This subscription has been stopped by ${rec.admin_action_by || 'Admin'}. Contact support to resume.`,
        pausedBy: rec.admin_action_by || 'Admin',
      });
    }

    // ── Inactive → Activate ──
    if (rec.status === 'inactive') {
      const { rows: devRows } = await pool.query(
        'SELECT COUNT(*) AS c FROM key_devices WHERE key_id=$1', [rec.id]
      );
      if (rec.max_devices > 0 && parseInt(devRows[0].c) >= rec.max_devices)
        return res.json({ ok: false, status: 'device_limit', message: 'Maximum device limit reached.' });

      const now       = new Date();
      const expiresAt = new Date(now.getTime() + rec.duration_minutes * 60_000);

      await pool.query(
        "UPDATE keys SET status='active', activated_at=$1, expires_at=$2, device_count=device_count+1 WHERE id=$3",
        [now, expiresAt, rec.id]
      );
      await pool.query(
        'INSERT INTO key_devices (key_id, device_id, user_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [rec.id, devId, userName]
      );
      await logAction(rec.id, keyStr, 'activated', null, `Device: ${devId}`);

      return res.json({
        ok: true, status: 'active',
        plan: rec.plan, planLabel: PLANS[rec.plan]?.label || rec.plan,
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: Math.floor((expiresAt - now) / 1000),
        userName,
        deviceCount: rec.device_count + 1,
        maxDevices:  rec.max_devices,
      });
    }

    // ── Active ──
    if (rec.status === 'active') {
      const now       = new Date();
      const expiresAt = new Date(rec.expires_at);

      if (now >= expiresAt) {
        await pool.query("UPDATE keys SET status='expired' WHERE id=$1", [rec.id]);
        await logAction(rec.id, keyStr, 'expired', null, 'Auto-expired on validate');
        return res.json({ ok: false, status: 'expired', message: 'Your access key has expired. Please renew your plan.' });
      }

      // Register device if new
      const { rows: devCheck } = await pool.query(
        'SELECT id FROM key_devices WHERE key_id=$1 AND device_id=$2', [rec.id, devId]
      );
      if (!devCheck.length) {
        if (rec.max_devices > 0 && rec.device_count >= rec.max_devices)
          return res.json({ ok: false, status: 'device_limit', message: 'Maximum device limit reached.' });
        await pool.query(
          'INSERT INTO key_devices (key_id, device_id, user_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [rec.id, devId, userName]
        );
        await pool.query('UPDATE keys SET device_count=device_count+1 WHERE id=$1', [rec.id]);
      }

      await logAction(rec.id, keyStr, 'validated', null, `Device: ${devId}`);
      return res.json({
        ok: true, status: 'active',
        plan: rec.plan, planLabel: PLANS[rec.plan]?.label || rec.plan,
        expiresAt: rec.expires_at,
        remainingSeconds: Math.floor((expiresAt - now) / 1000),
        userName,
        deviceCount: rec.device_count,
        maxDevices:  rec.max_devices,
      });
    }

    // ── Expired ──
    if (rec.status === 'expired')
      return res.json({ ok: false, status: 'expired', message: 'Your access key has expired. Please renew your plan.' });

    return res.json({ ok: false, status: 'invalid', message: 'Invalid license key.' });

  } catch (e) {
    console.error('[validate]', e.message);
    return res.json({ ok: false, status: 'error', message: 'Server error. Try again.' });
  }
});

/** POST /api/keys/heartbeat */
app.post('/api/keys/heartbeat', async (req, res) => {
  const { key, deviceId, totalSeconds = 0, chatCount = 0, userName = 'User' } = req.body || {};

  if (!key || !deviceId)
    return res.json({ ok: false, message: 'Missing key or device ID.' });

  const keyStr = String(key).trim().toUpperCase();
  const devId  = String(deviceId).trim();

  try {
    const { rows } = await pool.query('SELECT id FROM keys WHERE key_string=$1', [keyStr]);
    if (!rows.length) return res.json({ ok: false, message: 'Key not found.' });

    const keyId = rows[0].id;

    await pool.query(`
      INSERT INTO key_sessions (key_id, key_string, device_id, user_name, session_start, last_seen, total_seconds, chat_count, is_online)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, true)
      ON CONFLICT (key_id, device_id)
      DO UPDATE SET last_seen=NOW(), total_seconds=$5, chat_count=$6, user_name=$4, is_online=true
    `, [keyId, keyStr, devId, String(userName).slice(0, 64), parseInt(totalSeconds) || 0, parseInt(chatCount) || 0]);

    return res.json({ ok: true });
  } catch (e) {
    console.error('[heartbeat]', e.message);
    return res.json({ ok: false, message: 'Server error.' });
  }
});

/** GET /api/keys/:key/activity */
app.get('/api/keys/:key/activity', async (req, res) => {
  const param = String(req.params.key || '').trim();
  if (!param) return res.json({ ok: false, message: 'Missing key parameter.' });

  try {
    const { rows } = await pool.query(`
      SELECT s.*, k.key_string, k.plan, k.status AS key_status
      FROM key_sessions s
      JOIN keys k ON s.key_id = k.id
      WHERE k.key_string = $1 OR k.id::text = $1
      ORDER BY s.last_seen DESC
    `, [param.toUpperCase()]);

    const now = Date.now();
    const sessions = rows.map(r => ({
      ...r,
      is_online: r.last_seen && (now - new Date(r.last_seen).getTime()) < 90000,
    }));

    return res.json({ ok: true, sessions, activity: sessions });
  } catch (e) {
    console.error('[activity]', e.message);
    return res.json({ ok: false, message: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ADMIN API  (password-protected, called by Netlify admin panel)
// ══════════════════════════════════════════════════════════════════════════

/** POST /api/keys/generate */
app.post('/api/keys/generate', adminAuth, async (req, res) => {
  const { plan, count = 1, maxDevices = 1, note = '', customDays = 0 } = req.body;
  if (!PLANS[plan])
    return res.json({ ok: false, error: `Invalid plan. Valid: ${Object.keys(PLANS).join(', ')}` });

  // For custom plan, customDays must be a positive number
  let durationMinutes = PLANS[plan].minutes;
  let planLabel = PLANS[plan].label;
  if (plan === 'custom') {
    const days = parseFloat(customDays);
    if (!days || days <= 0)
      return res.json({ ok: false, error: 'customDays must be > 0 for custom plan.' });
    durationMinutes = Math.round(days * 24 * 60);
    planLabel = `Custom (${days}d)`;
  }

  const n = Math.min(Math.max(parseInt(count) || 1, 1), 200);
  const keys = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    for (let i = 0; i < n; i++) {
      let k, attempts = 0;
      do {
        k = generateKey();
        const { rows } = await client.query('SELECT id FROM keys WHERE key_string=$1', [k]);
        if (!rows.length) break;
        attempts++;
      } while (attempts < 20);

      const { rows: ins } = await client.query(
        'INSERT INTO keys (key_string, plan, duration_minutes, max_devices, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [k, plan, durationMinutes, maxDevices, note]
      );
      await client.query(
        'INSERT INTO key_logs (key_id, key_string, action, note) VALUES ($1,$2,$3,$4)',
        [ins[0].id, k, 'generated', `Plan:${plan} Duration:${durationMinutes}min MaxDevices:${maxDevices}`]
      );
      keys.push(k);
    }
    await client.query('COMMIT');
    res.json({ ok: true, keys, plan, planLabel });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[generate]', e.message);
    res.json({ ok: false, error: 'Generation failed' });
  } finally {
    client.release();
  }
});

/** GET /api/keys */
app.get('/api/keys', adminAuth, async (req, res) => {
  try {
    await autoExpire();
    const { rows } = await pool.query(`
      SELECT k.*,
             STRING_AGG(DISTINCT kd.user_name || '|' || kd.device_id, ';;') AS device_list,
             COALESCE(SUM(ks.total_seconds), 0)::INTEGER AS total_active_seconds,
             COALESCE(SUM(ks.chat_count), 0)::INTEGER AS total_chat_count,
             MAX(ks.last_seen) AS last_seen,
             BOOL_OR(ks.is_online AND ks.last_seen > NOW() - INTERVAL '90 seconds') AS is_online
      FROM keys k
      LEFT JOIN key_devices kd ON k.id = kd.key_id
      LEFT JOIN key_sessions ks ON k.id = ks.key_id
      GROUP BY k.id
      ORDER BY k.created_at DESC
    `);
    res.json({ ok: true, keys: rows });
  } catch (e) {
    console.error('[keys list]', e.message);
    res.json({ ok: false, error: 'DB error' });
  }
});

/** GET /api/keys/stats */
app.get('/api/keys/stats', adminAuth, async (req, res) => {
  try {
    await autoExpire();
    const { rows } = await pool.query('SELECT status, COUNT(*) AS count FROM keys GROUP BY status');
    const stats = { total: 0, active: 0, paused: 0, expired: 0, revoked: 0, inactive: 0 };
    rows.forEach(r => { stats[r.status] = parseInt(r.count); stats.total += parseInt(r.count); });
    res.json({ ok: true, stats });
  } catch (e) {
    res.json({ ok: false, error: 'DB error' });
  }
});

/** POST /api/keys/status */
app.post('/api/keys/status', adminAuth, async (req, res) => {
  const { keyId, action, adminName = 'Admin', note = '', extendDays = 0 } = req.body;

  try {
    const { rows } = await pool.query('SELECT * FROM keys WHERE id=$1', [keyId]);
    const rec = rows[0];
    if (!rec) return res.json({ ok: false, error: 'Key not found' });

    const now = new Date();

    if (action === 'pause') {
      if (rec.status !== 'active') return res.json({ ok: false, error: 'Key is not active' });
      const remaining = Math.max(0, Math.floor((new Date(rec.expires_at) - now) / 1000));
      await pool.query(
        "UPDATE keys SET status='paused', paused_at=$1, paused_remaining_seconds=$2, admin_action_by=$3 WHERE id=$4",
        [now, remaining, adminName, keyId]
      );
      await logAction(keyId, rec.key_string, 'paused', adminName, note || `Paused by ${adminName}`);
      return res.json({ ok: true });
    }

    if (action === 'resume') {
      if (rec.status !== 'paused') return res.json({ ok: false, error: 'Key is not paused' });
      const newExpiry = new Date(now.getTime() + (rec.paused_remaining_seconds || 0) * 1000);
      await pool.query(
        "UPDATE keys SET status='active', expires_at=$1, paused_at=NULL, paused_remaining_seconds=NULL, admin_action_by=NULL WHERE id=$2",
        [newExpiry, keyId]
      );
      await logAction(keyId, rec.key_string, 'resumed', adminName, note || `Resumed by ${adminName}`);
      return res.json({ ok: true });
    }

    if (action === 'revoke') {
      await pool.query("UPDATE keys SET status='revoked', admin_action_by=$1 WHERE id=$2", [adminName, keyId]);
      await logAction(keyId, rec.key_string, 'revoked', adminName, note || `Revoked by ${adminName}`);
      return res.json({ ok: true });
    }

    if (action === 'extend') {
      const days = parseFloat(extendDays);
      if (!days || days <= 0) return res.json({ ok: false, error: 'extendDays must be > 0' });
      const extMs = days * 24 * 3600 * 1000;

      if (rec.status === 'paused') {
        const newRemaining = (rec.paused_remaining_seconds || 0) + Math.floor(days * 24 * 3600);
        await pool.query('UPDATE keys SET paused_remaining_seconds=$1 WHERE id=$2', [newRemaining, keyId]);
      } else {
        const base = rec.expires_at && new Date(rec.expires_at) > now ? new Date(rec.expires_at) : now;
        const newExpiry = new Date(base.getTime() + extMs);
        await pool.query(
          "UPDATE keys SET expires_at=$1, status=CASE WHEN status IN ('expired','inactive') THEN 'active' ELSE status END WHERE id=$2",
          [newExpiry, keyId]
        );
      }
      await logAction(keyId, rec.key_string, 'extended', adminName, `+${days}d`);
      return res.json({ ok: true });
    }

    if (action === 'delete') {
      await pool.query('DELETE FROM key_devices WHERE key_id=$1', [keyId]);
      await pool.query('DELETE FROM key_logs WHERE key_id=$1', [keyId]);
      await pool.query('DELETE FROM keys WHERE id=$1', [keyId]);
      return res.json({ ok: true });
    }

    return res.json({ ok: false, error: 'Unknown action' });

  } catch (e) {
    console.error('[status]', e.message);
    res.json({ ok: false, error: 'Server error' });
  }
});

/** GET /api/keys/:id/logs */
app.get('/api/keys/:id/logs', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM key_logs WHERE key_id=$1 ORDER BY timestamp DESC LIMIT 100',
      [req.params.id]
    );
    res.json({ ok: true, logs: rows });
  } catch (e) {
    res.json({ ok: false, error: 'DB error' });
  }
});

/** GET /api/plans */
app.get('/api/plans', (_req, res) => res.json({ ok: true, plans: PLANS }));

// ── Start ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`\n✅  mnthnnnn Key Server  →  http://localhost:${PORT}`);
      console.log(`🔑  Admin panel         →  http://localhost:${PORT}/admin.html\n`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e.message);
    process.exit(1);
  }
})();
