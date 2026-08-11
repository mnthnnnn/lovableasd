/**
 * mnthnnnn's Extension — Service Worker Bridge
 * Validates license keys against VPS. Periodic 60s re-check.
 * Handles: active | paused | expired | revoked | invalid
 */

// ── CONFIG — Render backend URL ─────────────────────────────────────────────
const VPS_URL       = 'https://mnthnnnn-s-extention.onrender.com';
const VALIDATE_EP   = `${VPS_URL}/api/keys/validate`;

// ── Storage keys ──────────────────────────────────────────────────────────
const SK = {
  KEY:          'mnth_key',
  DEVICE:       'mnth_device_id',
  STATUS:       'mnth_status',       // active | paused | expired | revoked | invalid
  USERNAME:     'mnth_user_name',
  PLAN:         'mnth_plan',
  PLAN_LABEL:   'mnth_plan_label',
  EXPIRES:      'mnth_expires_at',
  REMAINING:    'mnth_remaining_sec',
  PAUSED_MSG:   'mnth_paused_msg',
  LAST_CHECK:   'mnth_last_check',
  // ── Activity tracking ──
  DEV_COUNT:    'mnth_device_count',   // how many devices on this key
  MAX_DEV:      'mnth_max_devices',    // max devices allowed
  CHAT_COUNT:   'mnth_chat_count',     // chats sent this session
  SESSION_START:'mnth_session_start',  // timestamp session began
  TOTAL_SECS:   'mnth_total_seconds',  // lifetime active seconds stored locally
  LAST_SEEN:    'mnth_last_seen',      // last heartbeat timestamp
};

// ── Freeze injection targets ───────────────────────────────────────────────
const FREEZE_MAIN = ['scripts/content/page-ws.js'];
const FREEZE_ISO  = [
  'scripts/shared/fingerprint.js',
  'scripts/shared/flow.js',
  'scripts/shared/translations.js',
  'scripts/content/content.js',
];

// ── Device ID ─────────────────────────────────────────────────────────────
function getDeviceId() {
  return new Promise(resolve => {
    chrome.storage.local.get([SK.DEVICE], r => {
      if (r[SK.DEVICE]) return resolve(r[SK.DEVICE]);
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      const id = 'mnth_' + Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,24);
      chrome.storage.local.set({ [SK.DEVICE]: id }, () => resolve(id));
    });
  });
}

// ── Status helpers ────────────────────────────────────────────────────────
function getStoredStatus() {
  return new Promise(resolve =>
    chrome.storage.local.get(Object.values(SK), r => resolve(r))
  );
}

function isActiveByStorage(data) {
  if (data[SK.STATUS] !== 'active') return false;
  if (!data[SK.EXPIRES]) return false;
  return Date.now() < new Date(data[SK.EXPIRES]).getTime();
}

// ── VPS Validate ──────────────────────────────────────────────────────────
async function validateWithServer(key, deviceId, userName) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(VALIDATE_EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, deviceId, userName: userName || 'User' }),
      signal: ctrl.signal,
    });
    return await res.json().catch(() => null);
  } catch (e) {
    return null; // network error — caller decides fallback
  } finally {
    clearTimeout(t);
  }
}

// ── Apply response to storage ─────────────────────────────────────────────
async function applyResponse(data) {
  const patch = { [SK.LAST_CHECK]: Date.now() };

  if (data && data.ok && data.status === 'active') {
    Object.assign(patch, {
      [SK.STATUS]:     'active',
      [SK.PLAN]:       data.plan          || '',
      [SK.PLAN_LABEL]: data.planLabel     || '',
      [SK.EXPIRES]:    data.expiresAt     || '',
      [SK.REMAINING]:  data.remainingSeconds || 0,
      [SK.USERNAME]:   data.userName      || 'User',
      [SK.PAUSED_MSG]: '',
      // device counts from server
      [SK.DEV_COUNT]:  data.deviceCount   ?? 1,
      [SK.MAX_DEV]:    data.maxDevices    ?? 1,
    });
    // start session timer if not already started
    const existing = await new Promise(r => chrome.storage.local.get([SK.SESSION_START], r));
    if (!existing[SK.SESSION_START]) {
      patch[SK.SESSION_START] = Date.now();
    }
    patch[SK.LAST_SEEN] = Date.now();
  } else if (data && !data.ok) {
    Object.assign(patch, {
      [SK.STATUS]:     data.status || 'invalid',
      [SK.PAUSED_MSG]: data.message || '',
      [SK.EXPIRES]:    '',
      [SK.REMAINING]:  0,
    });
  }

  await chrome.storage.local.set(patch);
  return patch[SK.STATUS];
}

// ── Broadcast status to popup / content scripts ───────────────────────────
async function broadcastStatus(status) {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://lovable.dev/*', 'https://*.lovable.dev/*'] });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'MNTH_STATUS_CHANGED', status }).catch(() => {});
    }
  } catch (_) {}
}

// ── Freeze injection ──────────────────────────────────────────────────────
async function injectFreeze(tabId) {
  try {
    for (const file of FREEZE_MAIN) {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [file], world: 'MAIN' });
    }
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: FREEZE_ISO, world: 'ISOLATED' });
  } catch (_) {}
}

async function injectFreezeAllTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://lovable.dev/*', 'https://*.lovable.dev/*'] });
    for (const tab of tabs) if (tab.id) await injectFreeze(tab.id);
  } catch (_) {}
}

// ── Periodic check (alarm) ────────────────────────────────────────────────
chrome.alarms.create('mnth_periodic', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'mnth_periodic') return;

  const stored = await getStoredStatus();
  const key    = stored[SK.KEY];
  if (!key) return; // no key stored — nothing to check

  const deviceId  = await getDeviceId();
  const prevStatus = stored[SK.STATUS];

  const data = await validateWithServer(key, deviceId, stored[SK.USERNAME]);

  if (!data) {
    // Server unreachable — keep cached status (grace period)
    return;
  }

  const newStatus = await applyResponse(data);

  // If status changed, broadcast to content scripts & popup
  if (newStatus !== prevStatus) {
    await broadcastStatus(newStatus);
    // Stop injecting if no longer active
    if (newStatus !== 'active') {
      // Revoked/invalid → wipe key from storage
      if (newStatus === 'revoked' || newStatus === 'invalid') {
        await chrome.storage.local.remove([SK.KEY, SK.STATUS, SK.PLAN, SK.PLAN_LABEL, SK.EXPIRES, SK.REMAINING, SK.USERNAME, SK.PAUSED_MSG]);
      }
    }
  }

  // ── Send heartbeat to server if active ──────────────────────────────
  if (newStatus === 'active' || prevStatus === 'active') {
    const totalSecs = stored[SK.TOTAL_SECS] || 0;
    // accumulate 60s per alarm tick while active
    const updatedTotal = totalSecs + 60;
    await chrome.storage.local.set({
      [SK.TOTAL_SECS]: updatedTotal,
      [SK.LAST_SEEN]:  Date.now(),
    });
    // fire-and-forget heartbeat to server
    try {
      fetch(`${VPS_URL}/api/keys/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          deviceId,
          totalSeconds: updatedTotal,
          chatCount: stored[SK.CHAT_COUNT] || 0,
          userName: stored[SK.USERNAME] || 'User',
        }),
      }).catch(() => {});
    } catch (_) {}
  }
});

// ── Message handlers ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return false;

  // ── Validate (user enters key) ──────────────────────────────────────
  if (msg.type === 'MNTH_VALIDATE' || msg.type === 'TRIVIS_VALIDATE') {
    (async () => {
      const key      = String(msg.key || '').trim().toUpperCase();
      const userName = String(msg.userName || msg.name || 'User').trim().slice(0, 64);

      if (!/^MNTHNNNN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
        sendResponse({ ok: false, status: 'invalid', error: 'Key format: MNTHNNNN-XXXX-XXXX-XXXX', message: 'Key format: MNTHNNNN-XXXX-XXXX-XXXX' });
        return;
      }

      const deviceId = await getDeviceId();
      const data     = await validateWithServer(key, deviceId, userName);

      if (!data) {
        sendResponse({ ok: false, status: 'error', error: 'Cannot reach license server.', message: 'Cannot reach license server.' });
        return;
      }

      if (data.ok) {
        await chrome.storage.local.set({ [SK.KEY]: key, [SK.USERNAME]: userName });
        await applyResponse(data);
        await injectFreezeAllTabs();
        data.key = key;
      } else if (data && data.status === 'device_limit') {
        data.key = key;
      }

      sendResponse(data);
    })();
    return true;
  }

  // ── Status check ────────────────────────────────────────────────────
  if (msg.type === 'MNTH_STATUS' || msg.type === 'TRIVIS_STATUS') {
    (async () => {
      const stored = await getStoredStatus();
      const key    = stored[SK.KEY];

      if (!key) {
        sendResponse({ ok: false, status: 'none' });
        return;
      }

      // If cached as active and not locally expired — return cache
      if (isActiveByStorage(stored)) {
        sendResponse({
          ok:               true,
          status:           'active',
          plan:             stored[SK.PLAN]       || '',
          planLabel:        stored[SK.PLAN_LABEL] || '',
          expiresAt:        stored[SK.EXPIRES]    || '',
          remainingSeconds: stored[SK.REMAINING]  || 0,
          userName:         stored[SK.USERNAME]   || 'User',
          deviceCount:      stored[SK.DEV_COUNT]  || 1,
          maxDevices:       stored[SK.MAX_DEV]    || 1,
          key:              key,
        });
        return;
      }

      // Otherwise ask server
      const deviceId = await getDeviceId();
      const data     = await validateWithServer(key, deviceId, stored[SK.USERNAME]);

      if (!data) {
        // Server down — return cached status
        sendResponse({ ok: stored[SK.STATUS]==='active', status: stored[SK.STATUS]||'error', message: 'Cannot reach server.', key });
        return;
      }

      if (data.ok) {
        await injectFreezeAllTabs();
        data.key = key;
      } else if (data && data.status === 'device_limit') {
        data.key = key;
      }
      await applyResponse(data);
      sendResponse(data);
    })();
    return true;
  }

  // ── Logout ──────────────────────────────────────────────────────────
  if (msg.type === 'MNTH_LOGOUT' || msg.type === 'TRIVIS_LOGOUT') {
    chrome.storage.local.remove(Object.values(SK), () => sendResponse({ ok: true }));
    return true;
  }

  // ── Chat increment (content script tells us user sent a chat) ────────
  if (msg.type === 'TRIVIS_CHAT_INCREMENT') {
    chrome.storage.local.get([SK.CHAT_COUNT], r => {
      const newCount = ((r[SK.CHAT_COUNT] || 0) + 1);
      chrome.storage.local.set({ [SK.CHAT_COUNT]: newCount });
      sendResponse({ ok: true, chatCount: newCount });
    });
    return true;
  }

  // ── Activity status (for panel live card) ────────────────────────────
  if (msg.type === 'TRIVIS_ACTIVITY') {
    (async () => {
      const stored = await new Promise(r =>
        chrome.storage.local.get(Object.values(SK), r)
      );
      const sessionStart = stored[SK.SESSION_START] || null;
      const lastSeen     = stored[SK.LAST_SEEN]     || null;
      const totalSecs    = stored[SK.TOTAL_SECS]    || 0;
      const chatCount    = stored[SK.CHAT_COUNT]    || 0;
      const devCount     = stored[SK.DEV_COUNT]     || 1;
      const maxDev       = stored[SK.MAX_DEV]       || 1;
      const deviceId     = await getDeviceId();

      // "online" = last seen within 90s
      const isOnline = lastSeen && (Date.now() - lastSeen) < 90_000;

      sendResponse({
        ok: true,
        sessionStart,
        lastSeen,
        totalSeconds: totalSecs,
        chatCount,
        deviceCount: devCount,
        maxDevices:  maxDev,
        deviceId,
        isOnline,
      });
    })();
    return true;
  }

  return false;
});

// ── Tab listeners ─────────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  if (!/https:\/\/([a-z0-9-]+\.)?lovable\.dev\//i.test(tab.url)) return;

  const stored = await getStoredStatus();
  if (stored[SK.STATUS] === 'active' && isActiveByStorage(stored)) {
    injectFreeze(tabId);
  }
});

chrome.runtime.onInstalled.addListener(() => injectFreezeAllTabs());
chrome.runtime.onStartup.addListener(   () => injectFreezeAllTabs());

// ── Load original background logic ───────────────────────────────────────
try {
  importScripts('background.js');
} catch (e) {
  console.warn('[mnthnnnn] background.js load failed', e);
}
