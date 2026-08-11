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
  KEY:        'mnth_key',
  DEVICE:     'mnth_device_id',
  STATUS:     'mnth_status',       // active | paused | expired | revoked | invalid
  USERNAME:   'mnth_user_name',
  PLAN:       'mnth_plan',
  PLAN_LABEL: 'mnth_plan_label',
  EXPIRES:    'mnth_expires_at',
  REMAINING:  'mnth_remaining_sec',
  PAUSED_MSG: 'mnth_paused_msg',
  LAST_CHECK: 'mnth_last_check',
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
      [SK.PLAN]:       data.plan       || '',
      [SK.PLAN_LABEL]: data.planLabel  || '',
      [SK.EXPIRES]:    data.expiresAt  || '',
      [SK.REMAINING]:  data.remainingSeconds || 0,
      [SK.USERNAME]:   data.userName   || 'User',
      [SK.PAUSED_MSG]: '',
    });
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
});

// ── Message handlers ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return false;

  // ── Validate (user enters key) ──────────────────────────────────────
  if (msg.type === 'MNTH_VALIDATE') {
    (async () => {
      const key      = String(msg.key || '').trim().toUpperCase();
      const userName = String(msg.userName || 'User').trim().slice(0, 64);

      if (!/^MNTHNNNN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
        sendResponse({ ok: false, status: 'invalid', message: 'Invalid key format. Expected: MNTHNNNN-XXXX-XXXX-XXXX' });
        return;
      }

      const deviceId = await getDeviceId();
      const data     = await validateWithServer(key, deviceId, userName);

      if (!data) {
        sendResponse({ ok: false, status: 'error', message: 'Cannot reach license server. Check your connection.' });
        return;
      }

      if (data.ok) {
        await chrome.storage.local.set({ [SK.KEY]: key, [SK.USERNAME]: userName });
        await applyResponse(data);
        await injectFreezeAllTabs();
      }

      sendResponse(data);
    })();
    return true;
  }

  // ── Status check ────────────────────────────────────────────────────
  if (msg.type === 'MNTH_STATUS') {
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
        });
        return;
      }

      // Otherwise ask server
      const deviceId = await getDeviceId();
      const data     = await validateWithServer(key, deviceId, stored[SK.USERNAME]);

      if (!data) {
        // Server down — return cached status
        sendResponse({ ok: stored[SK.STATUS]==='active', status: stored[SK.STATUS]||'error', message: 'Cannot reach server.' });
        return;
      }

      if (data.ok) await injectFreezeAllTabs();
      await applyResponse(data);
      sendResponse(data);
    })();
    return true;
  }

  // ── Logout ──────────────────────────────────────────────────────────
  if (msg.type === 'MNTH_LOGOUT') {
    chrome.storage.local.remove(Object.values(SK), () => sendResponse({ ok: true }));
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
