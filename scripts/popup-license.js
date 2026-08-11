/**
 * mnthnnnn's Extension — Popup State Machine
 * States: loading | login | active | paused | expired | revoked
 */
(function () {
  'use strict';

  // ── State elements ──────────────────────────────────────────────────────
  const states = {
    loading: document.getElementById('state-loading'),
    login:   document.getElementById('state-login'),
    active:  document.getElementById('state-active'),
    paused:  document.getElementById('state-paused'),
    expired: document.getElementById('state-expired'),
    revoked: document.getElementById('state-revoked'),
  };

  const el = id => document.getElementById(id);

  // ── Show/hide helpers ───────────────────────────────────────────────────
  function showState(name) {
    Object.entries(states).forEach(([k, v]) => {
      if (v) v.style.display = k === name ? '' : 'none';
    });
  }

  function setMsg(id, text, ok) {
    const el2 = el(id);
    if (!el2) return;
    el2.textContent = text || '';
    el2.className = 'msg' + (ok ? ' ok' : ok === false ? ' err' : '');
  }

  // ── Countdown timer ─────────────────────────────────────────────────────
  let countdownInterval = null;

  function startCountdown(expiresAt) {
    clearInterval(countdownInterval);
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;

      let str;
      if (d > 0)      str = `${d}d ${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
      else if (h > 0) str = `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
      else            str = `${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;

      const cdEl = el('countdown');
      if (cdEl) cdEl.textContent = str;

      // Apply urgency classes
      if (cdEl) {
        cdEl.classList.remove('urgent', 'warning');
        if (diff < 3600)       cdEl.classList.add('urgent');
        else if (diff < 86400) cdEl.classList.add('warning');
      }

      if (diff === 0) {
        clearInterval(countdownInterval);
        handleStatus({ ok: false, status: 'expired', message: 'Your access key has expired. Please renew your plan.' });
      }
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  // ── Load panel scripts (injected after validation) ──────────────────────
  function loadPanelScripts() {
    const files = [
      'scripts/shared/fingerprint.js',
      'scripts/shared/flow.js',
      'scripts/shared/translations.js',
      'scripts/panel/panel-templates.js',
      'scripts/panel/panel.js',
    ];
    let i = 0;
    const next = () => {
      if (i >= files.length) return;
      const s = document.createElement('script');
      s.src = files[i++];
      s.onload = next;
      s.onerror = next;
      document.body.appendChild(s);
    };
    next();
  }

  // ── Handle status response ──────────────────────────────────────────────
  function handleStatus(res) {
    clearInterval(countdownInterval);

    if (res && res.ok && res.status === 'active') {
      // Show active state
      const planEl   = el('active-plan');
      const expiryEl = el('active-expiry');
      const userEl   = el('active-user');
      if (planEl)   planEl.textContent  = res.planLabel || res.plan || 'Active';
      if (expiryEl) expiryEl.textContent = res.expiresAt
        ? new Date(res.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : '—';
      if (userEl)   userEl.textContent  = res.userName || 'User';
      showState('active');
      if (res.expiresAt) startCountdown(res.expiresAt);
      loadPanelScripts();
      return;
    }

    if (res && res.status === 'paused') {
      const msgEl = el('paused-msg');
      if (msgEl) msgEl.textContent = res.message || 'Subscription paused. Contact support.';
      showState('paused');
      return;
    }

    if (res && res.status === 'expired') {
      showState('expired');
      return;
    }

    if (res && (res.status === 'revoked' || res.status === 'invalid')) {
      // Wipe local data
      chrome.runtime.sendMessage({ type: 'MNTH_LOGOUT' }, () => {});
      showState('login');
      return;
    }

    if (res && res.status === 'none') {
      showState('login');
      return;
    }

    // Error / unreachable
    showState('login');
    setMsg('login-msg', (res && res.message) || 'Cannot connect to license server.', false);
  }

  // ── Activate ────────────────────────────────────────────────────────────
  function activate() {
    const keyEl  = el('key-input');
    const nameEl = el('name-input');
    const btn    = el('activate-btn');

    const key  = String(keyEl?.value  || '').trim().toUpperCase();
    const name = String(nameEl?.value || '').trim();

    if (!name) { setMsg('login-msg', 'Please enter your name.', false); return; }

    if (!/^MNTHNNNN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
      setMsg('login-msg', 'Key format: MNTHNNNN-XXXX-XXXX-XXXX', false);
      return;
    }

    setMsg('login-msg', 'Validating…');
    if (btn) { btn.disabled = true; btn.textContent = 'Validating…'; }

    chrome.runtime.sendMessage({ type: 'MNTH_VALIDATE', key, userName: name }, res => {
      if (btn) { btn.disabled = false; btn.textContent = 'Activate'; }
      if (chrome.runtime.lastError) {
        setMsg('login-msg', 'Extension error — try reloading.', false);
        return;
      }
      if (res && res.ok) {
        setMsg('login-msg', 'Activated!', true);
        setTimeout(() => handleStatus(res), 400);
      } else {
        setMsg('login-msg', (res && res.message) || 'Invalid key.', false);
      }
    });
  }

  // ── Logout ──────────────────────────────────────────────────────────────
  function logout() {
    clearInterval(countdownInterval);
    chrome.runtime.sendMessage({ type: 'MNTH_LOGOUT' }, () => {
      const keyEl = el('key-input');
      const nameEl = el('name-input');
      if (keyEl) keyEl.value = '';
      if (nameEl) nameEl.value = '';
      setMsg('login-msg', '');
      showState('login');
    });
  }

  // ── Wire up events ──────────────────────────────────────────────────────
  const activateBtn  = el('activate-btn');
  const logoutBtn    = el('logout-btn');
  const logoutBtn2   = el('logout-btn-2');
  const logoutBtn3   = el('logout-btn-3');
  const keyInput     = el('key-input');

  if (activateBtn)  activateBtn.addEventListener('click', activate);
  if (logoutBtn)    logoutBtn.addEventListener('click', logout);
  if (logoutBtn2)   logoutBtn2.addEventListener('click', logout);
  if (logoutBtn3)   logoutBtn3.addEventListener('click', logout);
  if (keyInput)     keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });

  // ── Listen for background status changes ────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'MNTH_STATUS_CHANGED') handleStatus({ status: msg.status });
  });

  // ── Init: check current status ──────────────────────────────────────────
  showState('loading');
  chrome.runtime.sendMessage({ type: 'MNTH_STATUS' }, res => {
    if (chrome.runtime.lastError || !res) {
      showState('login');
      return;
    }
    handleStatus(res);
  });
})();
