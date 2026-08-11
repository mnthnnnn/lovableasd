/**
 * mnthnnnn Floating UI v1.3 — Lovable in-page panel
 * UI only. Freeze / credit logic untouched.
 */
(function () {
  "use strict";
  if (window.__trivisFloatingUI__) return;
  window.__trivisFloatingUI__ = true;

  const ACCENT = "#7c3aed";
  const STORAGE_POS = "trivis_fab_pos";
  const INSTAGRAM_URL = "https://instagram.com/mnthnnnn";

  // ---------- utils ----------
  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([k, v]) => {
        if (k === "style" && typeof v === "object") Object.assign(n.style, v);
        else if (k === "className") n.className = v;
        else if (k.startsWith("on") && typeof v === "function")
          n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "html") n.innerHTML = v;
        else if (k === "text") n.textContent = v;
        else n.setAttribute(k, v);
      });
    }
    (kids || []).forEach((c) => {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function formatRemaining(expiresAt) {
    if (!expiresAt) return "—";
    const end = Date.parse(expiresAt);
    if (!end || isNaN(end)) return "—";
    let ms = end - Date.now();
    if (ms <= 0) return "EXPIRED";
    const d = Math.floor(ms / 86400000);
    ms %= 86400000;
    const h = Math.floor(ms / 3600000);
    ms %= 3600000;
    const m = Math.floor(ms / 60000);
    ms %= 60000;
    const s = Math.floor(ms / 1000);
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function maskKey(key) {
    if (!key || key.length < 12) return key || "—";
    return key.slice(0, 9) + "••••" + key.slice(-4);
  }

  function detectProject() {
    try {
      const path = location.pathname || "";
      const title = (document.title || "").trim();

      // common lovable patterns
      const m =
        path.match(/\/projects?\/([a-zA-Z0-9_-]+)/i) ||
        path.match(/\/p\/([a-zA-Z0-9_-]+)/i) ||
        path.match(/\/app\/([a-zA-Z0-9_-]+)/i);

      if (m && m[1] && m[1].length > 2) {
        return m[1].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }

      // title based
      if (title && !/lovable/i.test(title) && title.length > 2 && title.length < 80) {
        const clean = title.replace(/\s*[|\-–—]\s*Lovable.*$/i, "").trim();
        if (clean && clean.length > 1) return clean;
      }

      // hash / search
      const h = location.hash || "";
      const hm = h.match(/project[=/]([a-zA-Z0-9_-]+)/i);
      if (hm) return hm[1];

      return null;
    } catch (_) {
      return null;
    }
  }

  // ---------- styles ----------
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

    #trivis-fab-root {
      all: initial;
      position: fixed;
      z-index: 2147483645;
      pointer-events: none;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #trivis-fab-root * { box-sizing: border-box; }

    /* FAB */
    #trivis-fab {
      pointer-events: auto;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: linear-gradient(145deg, #13111f 0%, #0b0a14 100%);
      border: 1px solid rgba(124,58,237,0.5);
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.4),
        0 8px 28px rgba(0,0,0,0.55),
        0 0 20px rgba(124,58,237,0.2),
        inset 0 1px 0 rgba(255,255,255,0.07);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      user-select: none;
      touch-action: none;
      transition: box-shadow 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
      position: relative;
      will-change: transform;
    }
    #trivis-fab:hover {
      border-color: ${ACCENT};
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.4),
        0 10px 32px rgba(0,0,0,0.6),
        0 0 28px rgba(124,58,237,0.45),
        inset 0 1px 0 rgba(255,255,255,0.09);
    }
    #trivis-fab:active { cursor: grabbing; }
    #trivis-fab.dragging {
      cursor: grabbing;
      transition: none;
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.5),
        0 16px 40px rgba(0,0,0,0.7),
        0 0 32px rgba(124,58,237,0.5);
    }
    #trivis-fab .fab-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #a78bfa, #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.5px;
      box-shadow: 0 2px 8px rgba(124,58,237,0.4);
    }
    #trivis-fab .trivis-dot {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3a3a55;
      box-shadow: 0 0 0 2px #0b0a14;
      transition: background 0.3s, box-shadow 0.3s;
    }
    #trivis-fab.licensed .trivis-dot {
      background: #3fb950;
      box-shadow: 0 0 0 2px #0b0a14, 0 0 10px rgba(63,185,80,0.7);
      animation: trivis-pulse 2s ease infinite;
    }
    @keyframes trivis-pulse {
      0%, 100% { box-shadow: 0 0 0 2px #0b0a14, 0 0 8px rgba(63,185,80,0.55); }
      50% { box-shadow: 0 0 0 2px #0b0a14, 0 0 14px rgba(63,185,80,0.9); }
    }

    /* PANEL */
    #trivis-panel {
      pointer-events: auto;
      position: absolute;
      width: 312px;
      max-height: min(82vh, 580px);
      overflow: hidden;
      display: none;
      flex-direction: column;
      background: linear-gradient(180deg, #0f0d1a 0%, #09080f 100%);
      border: 1px solid rgba(124,58,237,0.28);
      border-radius: 18px;
      box-shadow:
        0 24px 64px rgba(0,0,0,0.7),
        0 0 0 1px rgba(124,58,237,0.12),
        0 0 40px rgba(124,58,237,0.1);
      color: #f0f0f0;
      transform-origin: bottom right;
    }
    #trivis-panel.open {
      display: flex;
      animation: trivis-panel-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes trivis-panel-in {
      from { opacity: 0; transform: translateY(12px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* HEADER */
    .tv-hd {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 12px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      background: linear-gradient(180deg, rgba(124,58,237,0.1) 0%, transparent 100%);
    }
    .tv-hd-left {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .tv-hd-logo {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #a78bfa, #7c3aed);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.3px;
      box-shadow: 0 0 12px rgba(124,58,237,0.4);
      flex-shrink: 0;
    }
    .tv-hd-title {
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .tv-hd-sub {
      font-size: 10px;
      color: #7a7a9a;
      margin-top: 1px;
      font-weight: 500;
    }
    .tv-hd-actions {
      display: flex;
      gap: 6px;
    }
    .tv-icon-btn {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: #aaa;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.18s ease;
    }
    .tv-icon-btn:hover {
      background: rgba(124,58,237,0.18);
      border-color: rgba(124,58,237,0.45);
      color: #fff;
    }
    .tv-icon-btn.close:hover {
      background: rgba(248,81,73,0.18);
      border-color: rgba(248,81,73,0.45);
      color: #f85149;
    }

    /* TIMER BAR */
    .tv-timer {
      text-align: center;
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      background: rgba(124,58,237,0.04);
    }
    .tv-timer-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #6e6e8e;
      font-weight: 600;
      margin-bottom: 3px;
    }
    .tv-timer-value {
      font-family: 'JetBrains Mono', JetBrains Mono, monospace;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #a78bfa;
      text-shadow: 0 0 18px rgba(124,58,237,0.55);
      font-variant-numeric: tabular-nums;
      animation: tv-timer-glow 2.4s ease-in-out infinite;
    }
    .tv-timer-value.expired { color: #f85149; text-shadow: 0 0 18px rgba(248,81,73,0.55); }
    .tv-timer-value.warning { color: #f59e0b; text-shadow: 0 0 18px rgba(245,158,11,0.55); }
    @keyframes tv-timer-glow {
      0%, 100% { text-shadow: 0 0 14px rgba(124,58,237,0.4); }
      50% { text-shadow: 0 0 24px rgba(124,58,237,0.7); }
    }

    /* BODY */
    .tv-body {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 11px;
      scrollbar-width: thin;
      scrollbar-color: rgba(221,13,16,0.35) transparent;
    }

    /* FORM */
    .tv-form label {
      display: block;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #8a8aaa;
      margin-bottom: 5px;
      font-weight: 600;
    }
    .tv-form input {
      width: 100%;
      padding: 11px 12px;
      border-radius: 11px;
      border: 1px solid rgba(255,255,255,0.09);
      background: #100e1c;
      color: #f0f0f0;
      font-size: 13px;
      outline: none;
      margin-bottom: 11px;
      transition: border-color 0.18s, box-shadow 0.18s;
      font-family: Inter, system-ui, sans-serif;
    }
    .tv-form input:focus {
      border-color: ${ACCENT};
      box-shadow: 0 0 0 3px rgba(124,58,237,0.2);
    }
    .tv-form .key-input {
      letter-spacing: 0.07em;
      text-transform: uppercase;
      font-family: JetBrains Mono, ui-monospace, monospace;
      font-size: 12px;
    }
    .tv-btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 11px;
      background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
      color: #fff;
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: 0.04em;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: transform 0.12s, box-shadow 0.2s, opacity 0.15s;
      box-shadow: 0 4px 16px rgba(124,58,237,0.4);
      font-family: Inter, system-ui, sans-serif;
    }
    .tv-btn:hover {
      box-shadow: 0 6px 22px rgba(124,58,237,0.58);
      transform: translateY(-1px);
    }
    .tv-btn:active { transform: translateY(0) scale(0.98); }
    .tv-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

    /* ACTIVATION SEQUENCE */
    .tv-seq {
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 28px 16px 24px;
      min-height: 180px;
    }
    .tv-seq.show { display: flex; }
    .tv-seq-ring {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: 2px solid rgba(124,58,237,0.2);
      border-top-color: ${ACCENT};
      animation: tv-spin 0.85s linear infinite;
    }
    @keyframes tv-spin { to { transform: rotate(360deg); } }
    .tv-seq-text {
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #c4b5fd;
      text-align: center;
      min-height: 18px;
      animation: tv-text-in 0.35s ease;
    }
    @keyframes tv-text-in {
      from { opacity: 0; transform: translateY(6px); letter-spacing: 0.2em; }
      to   { opacity: 1; transform: translateY(0); letter-spacing: 0.1em; }
    }
    .tv-seq-text.success {
      color: #3fb950;
      text-shadow: 0 0 16px rgba(63,185,80,0.55);
    }

    /* CARDS */
    .tv-card {
      background: rgba(124,58,237,0.04);
      border: 1px solid rgba(124,58,237,0.12);
      border-radius: 13px;
      padding: 12px;
      transition: border-color 0.2s;
    }
    .tv-card:hover { border-color: rgba(124,58,237,0.28); }
    .tv-card-hd {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .tv-card-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #7a7a9a;
      font-weight: 700;
    }
    .tv-refresh {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: #bbb;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .tv-refresh:hover {
      background: rgba(124,58,237,0.18);
      border-color: rgba(124,58,237,0.45);
      color: #fff;
    }
    .tv-refresh.spin svg { animation: tv-spin 0.7s linear; }

    .tv-sync-status {
      font-size: 13px;
      font-weight: 650;
      line-height: 1.35;
      min-height: 20px;
    }
    .tv-sync-status.notfound {
      color: #f85149;
      font-size: 12px;
      letter-spacing: 0.04em;
      font-weight: 700;
    }
    .tv-sync-status.ok {
      color: #3fb950;
      text-shadow: 0 0 12px rgba(63,185,80,0.4);
      animation: tv-fade-up 0.4s ease;
    }
    @keyframes tv-fade-up {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .tv-sync-hint {
      font-size: 11px;
      color: #5a5a7a;
      margin-top: 5px;
      line-height: 1.4;
    }

    /* KV rows */
    .tv-kv {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 12.5px;
    }
    .tv-kv:last-of-type { border-bottom: none; }
    .tv-kv .k { color: #8a8a8a; font-weight: 500; }
    .tv-kv .v {
      color: #eee;
      font-weight: 600;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .tv-kv .v.mono {
      font-family: JetBrains Mono, ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
    }

    /* WELCOME BANNER */
    .tv-welcome {
      background: linear-gradient(135deg, rgba(124,58,237,0.18), rgba(124,58,237,0.06));
      border: 1px solid rgba(124,58,237,0.22);
      border-radius: 13px;
      padding: 12px 14px;
      text-align: center;
    }
    .tv-welcome-hi {
      font-size: 14px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
      margin-bottom: 3px;
    }
    .tv-welcome-sub {
      font-size: 11px;
      color: #a78bfa;
      font-weight: 500;
    }

    /* WATERMARK BUTTON */
    .tv-wm-btn {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(16,185,129,0.3);
      background: rgba(16,185,129,0.07);
      color: #3fb950;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      transition: background 0.18s, transform 0.1s, box-shadow 0.18s;
      font-family: Inter, system-ui, sans-serif;
    }
    .tv-wm-btn:hover {
      background: rgba(16,185,129,0.15);
      box-shadow: 0 4px 14px rgba(16,185,129,0.2);
      transform: translateY(-1px);
    }
    .tv-wm-btn:active { transform: translateY(0) scale(0.98); }
    .tv-wm-btn.sent {
      border-color: rgba(124,58,237,0.35);
      background: rgba(124,58,237,0.1);
      color: #a78bfa;
    }
    .tv-wm-btn.sent:hover { transform: none; cursor: default; }

    .tv-logout {
      width: 100%;
      margin-top: 8px;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid rgba(248,81,73,0.4);
      background: rgba(248,81,73,0.08);
      color: #f85149;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: background 0.18s, transform 0.1s;
    }
    .tv-logout:hover {
      background: rgba(248,81,73,0.18);
      transform: translateY(-1px);
    }

    /* FOOTER SOCIAL */
    .tv-social {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 4px 0 2px;
    }
    .tv-social a {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: rgba(124,58,237,0.07);
      border: 1px solid rgba(124,58,237,0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #b0b0cc;
      text-decoration: none;
      transition: all 0.18s;
    }
    .tv-social a:hover {
      background: rgba(124,58,237,0.2);
      border-color: rgba(124,58,237,0.5);
      color: #fff;
      transform: translateY(-2px);
    }
    .tv-social svg { width: 15px; height: 15px; fill: currentColor; }
    .tv-foot {
      text-align: center;
      font-size: 10px;
      color: #4a4a6a;
      letter-spacing: 0.04em;
      padding-bottom: 2px;
      font-family: Inter, sans-serif;
      font-weight: 600;
    }
  `;

  // ---------- DOM ----------
  const style = el("style", { html: css });
  document.documentElement.appendChild(style);

  const root = el("div", { id: "trivis-fab-root" });
  const fab = el("div", { id: "trivis-fab", title: "mnthnnnn" });
  const fabIcon = el("div", { className: "fab-icon", text: "M" });
  fab.appendChild(fabIcon);
  fab.appendChild(el("div", { className: "trivis-dot" }));

  const panel = el("div", { id: "trivis-panel" });

  // Header
  const hd = el("div", { className: "tv-hd" }, [
    el("div", { className: "tv-hd-left" }, [
      el("div", { className: "tv-hd-logo", text: "M" }),
      el("div", null, [
        el("div", { className: "tv-hd-title", text: "mnthnnnn" }),
        el("div", { className: "tv-hd-sub", id: "tv-hd-sub", text: "License required" })
      ])
    ]),
    el("div", { className: "tv-hd-actions" }, [
      el("button", {
        className: "tv-icon-btn",
        type: "button",
        title: "Hide panel",
        onClick: closePanel,
        html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/></svg>`
      }),
      el("button", {
        className: "tv-icon-btn close",
        type: "button",
        title: "Close",
        onClick: closePanel,
        html: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>`
      })
    ])
  ]);
  panel.appendChild(hd);

  // Timer (only visible when licensed)
  const timerWrap = el("div", { className: "tv-timer", id: "tv-timer", style: { display: "none" } }, [
    el("div", { className: "tv-timer-label", text: "License expires in" }),
    el("div", { className: "tv-timer-value", id: "tv-timer-val", text: "—" })
  ]);
  panel.appendChild(timerWrap);

  const body = el("div", { className: "tv-body", id: "tv-body" });
  panel.appendChild(body);

  root.appendChild(fab);
  root.appendChild(panel);
  document.documentElement.appendChild(root);

  // ---------- state ----------
  let licensed = false;
  let statusData = null;
  let panelOpen = false;
  let countdownTimer = null;
  let projectName = null;
  let syncOk = false;

  // Smooth drag with rAF
  let drag = {
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origLeft: 0,
    origTop: 0,
    ptrId: null
  };
  let rafId = 0;
  let pendingX = 0;
  let pendingY = 0;

  // ---------- position ----------
  function loadPos() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_POS], (r) => {
        const p = r[STORAGE_POS];
        if (p && typeof p.x === "number" && typeof p.y === "number") resolve(p);
        else resolve({ x: Math.max(8, window.innerWidth - 74), y: Math.max(8, window.innerHeight - 96) });
      });
    });
  }

  function savePos(x, y) {
    chrome.storage.local.set({ [STORAGE_POS]: { x, y } });
  }

  function place(x, y) {
    const maxX = window.innerWidth - 58;
    const maxY = window.innerHeight - 58;
    x = Math.max(6, Math.min(x, maxX));
    y = Math.max(6, Math.min(y, maxY));
    root.style.left = x + "px";
    root.style.top = y + "px";
    positionPanel();
  }

  function positionPanel() {
    const fr = fab.getBoundingClientRect();
    const panelW = 312;
    const spaceLeft = fr.left;
    const spaceRight = window.innerWidth - fr.right;
    let left = 0;
    if (spaceLeft >= panelW + 14) left = -(panelW + 12);
    else if (spaceRight >= panelW + 14) left = 64;
    else left = Math.max(-(fr.left - 8), -(panelW - 54));

    let top = 0;
    const estH = 480;
    if (fr.bottom + estH > window.innerHeight - 10) {
      top = Math.min(0, window.innerHeight - fr.top - estH - 10);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  // ---------- smooth drag ----------
  function onPtrDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    drag.active = true;
    drag.moved = false;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.origLeft = root.offsetLeft;
    drag.origTop = root.offsetTop;
    drag.ptrId = e.pointerId;
    fab.classList.add("dragging");
    try { fab.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }

  function onPtrMove(e) {
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) drag.moved = true;
    if (!drag.moved) return;

    pendingX = drag.origLeft + dx;
    pendingY = drag.origTop + dy;

    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        place(pendingX, pendingY);
      });
    }
  }

  function onPtrUp(e) {
    if (!drag.active) return;
    drag.active = false;
    fab.classList.remove("dragging");
    try { fab.releasePointerCapture(drag.ptrId); } catch (_) {}
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      place(pendingX, pendingY);
    }
    if (drag.moved) {
      savePos(root.offsetLeft, root.offsetTop);
    } else {
      togglePanel();
    }
  }

  fab.addEventListener("pointerdown", onPtrDown);
  fab.addEventListener("pointermove", onPtrMove);
  fab.addEventListener("pointerup", onPtrUp);
  fab.addEventListener("pointercancel", onPtrUp);

  window.addEventListener("resize", () => place(root.offsetLeft, root.offsetTop));

  // ---------- panel ----------
  function openPanel() {
    panelOpen = true;
    panel.classList.add("open");
    positionPanel();
    renderBody();
    updateProjectStatus();
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove("open");
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  // ---------- project status ----------
  function updateProjectStatus() {
    projectName = detectProject();
    const node = document.getElementById("tv-sync-status");
    if (!node) return;
    if (!projectName) {
      syncOk = false;
      node.className = "tv-sync-status notfound";
      node.textContent = "PROJECT NOT FOUND";
    } else {
      syncOk = true;
      node.className = "tv-sync-status ok";
      node.textContent = `${projectName.toUpperCase()}  ·  SYNC SUCCESSFUL`;
    }
  }

  // ---------- render ----------
  function renderBody() {
    body.innerHTML = "";
    const seq = el("div", { className: "tv-seq", id: "tv-seq" }, [
      el("div", { className: "tv-seq-ring" }),
      el("div", { className: "tv-seq-text", id: "tv-seq-text", text: "" })
    ]);
    body.appendChild(seq);

    if (!licensed) {
      timerWrap.style.display = "none";
      renderLicenseForm();
    } else {
      timerWrap.style.display = "";
      renderLicensed();
      updateProjectStatus();
    }
  }

  function renderLicenseForm() {
    const sub = document.getElementById("tv-hd-sub");
    if (sub) sub.textContent = "Activate to unlock";

    const form = el("div", { className: "tv-form", id: "tv-form" });
    form.appendChild(el("label", { text: "Your Name" }));
    const nameIn = el("input", {
      id: "tv-name",
      placeholder: "Enter your name",
      autocomplete: "off"
    });
    form.appendChild(nameIn);

    form.appendChild(el("label", { text: "Licence Key" }));
    const keyIn = el("input", {
      id: "tv-key",
      className: "key-input",
      placeholder: "MNTHNNNN-XXXX-XXXX-XXXX",
      spellcheck: "false",
      autocomplete: "off"
    });
    form.appendChild(keyIn);

    const btn = el("button", { className: "tv-btn", type: "button", id: "tv-activate", text: "ACTIVATE" });
    form.appendChild(btn);
    body.appendChild(form);

    const runSequence = (steps, onDone) => {
      const formEl = document.getElementById("tv-form");
      const seqEl = document.getElementById("tv-seq");
      const textEl = document.getElementById("tv-seq-text");
      if (formEl) formEl.style.display = "none";
      if (seqEl) seqEl.classList.add("show");

      let i = 0;
      const next = () => {
        if (i >= steps.length) {
          if (onDone) onDone();
          return;
        }
        const step = steps[i++];
        if (textEl) {
          textEl.className = "tv-seq-text" + (step.ok ? " success" : "");
          textEl.style.animation = "none";
          void textEl.offsetWidth;
          textEl.style.animation = "";
          textEl.textContent = step.t;
        }
        setTimeout(next, step.ms || 700);
      };
      next();
    };

    const activate = async () => {
      const name = (nameIn.value || "").trim();
      const key = (keyIn.value || "").trim().toUpperCase();
      if (!name) {
        nameIn.focus();
        nameIn.style.borderColor = "#f85149";
        setTimeout(() => (nameIn.style.borderColor = ""), 1200);
        return;
      }
      if (!/^MNTHNNNN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
        keyIn.focus();
        keyIn.style.borderColor = "#f85149";
        setTimeout(() => (keyIn.style.borderColor = ""), 1200);
        return;
      }

      btn.disabled = true;

      // Visual sequence first (feels premium), then real validate
      runSequence(
        [
          { t: "CHECKING USER NAME", ms: 650 },
          { t: "VERIFY USERNAME", ms: 700 },
          { t: "CHECKING VALID LICENCE KEY", ms: 750 },
          { t: "VERIFY LICENCE KEY", ms: 800 }
        ],
        async () => {
          const res = await send({ type: "TRIVIS_VALIDATE", key, name });
          const textEl = document.getElementById("tv-seq-text");
          const seqEl = document.getElementById("tv-seq");

          if (res && res.ok) {
            if (textEl) {
              textEl.className = "tv-seq-text success";
              textEl.textContent = "ACTIVATE SUCCESSFULLY";
            }
            licensed = true;
            statusData = res;
            fab.classList.add("licensed");
            setTimeout(() => {
              if (seqEl) seqEl.classList.remove("show");
              renderBody();
              startCountdown();
            }, 900);
          } else {
            if (textEl) {
              textEl.className = "tv-seq-text";
              textEl.style.color = "#f85149";
              textEl.textContent = (res && res.error) || "INVALID LICENCE KEY";
            }
            setTimeout(() => {
              if (seqEl) seqEl.classList.remove("show");
              const formEl = document.getElementById("tv-form");
              if (formEl) formEl.style.display = "";
              btn.disabled = false;
              if (textEl) textEl.style.color = "";
            }, 1400);
          }
        }
      );
    };

    btn.addEventListener("click", activate);
    keyIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") activate();
    });
    nameIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") keyIn.focus();
    });
  }

  function formatDuration(secs) {
    if (!secs || secs <= 0) return "0s";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatLastSeen(ts) {
    if (!ts) return "Never";
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 10) return "Just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const m = Math.floor(diffSec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
  }

  function renderLicensed() {
    const name = (statusData && (statusData.userName || statusData.name)) || "User";
    const expires = (statusData && (statusData.expiresAt || statusData.expires_at)) || null;
    const key = (statusData && statusData.key) || "—";
    const firstName = name.split(" ")[0];

    const sub = document.getElementById("tv-hd-sub");
    if (sub) sub.textContent = `Hey, ${firstName} 👋`;

    // Welcome banner
    body.appendChild(
      el("div", { className: "tv-welcome" }, [
        el("div", { className: "tv-welcome-hi", text: `Welcome, ${firstName}! 👋` }),
        el("div", { className: "tv-welcome-sub", text: "Lovable is fully unlocked for you" })
      ])
    );

    // Auto Project Sync card
    const syncCard = el("div", { className: "tv-card" });
    const syncHd = el("div", { className: "tv-card-hd" }, [
      el("div", { className: "tv-card-title", text: "Auto Project Sync" }),
      el("button", {
        className: "tv-refresh",
        type: "button",
        title: "Refresh sync",
        id: "tv-refresh-btn",
        html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>`,
        onClick: () => {
          const btn = document.getElementById("tv-refresh-btn");
          if (btn) btn.classList.add("spin");
          updateProjectStatus();
          updateLiveStats();
          // soft re-check license / keep freeze alive
          send({ type: "TRIVIS_STATUS" }).then((r) => {
            if (r) {
              licensed = !!r.ok;
              statusData = r;
              if (!licensed) {
                fab.classList.remove("licensed");
                renderBody();
              }
            }
            setTimeout(() => {
              if (btn) btn.classList.remove("spin");
            }, 700);
          });
        }
      })
    ]);
    syncCard.appendChild(syncHd);
    syncCard.appendChild(el("div", { className: "tv-sync-status notfound", id: "tv-sync-status", text: "PROJECT NOT FOUND" }));
    syncCard.appendChild(
      el("div", {
        className: "tv-sync-hint",
        text: "Create or open a project, then hit refresh if needed."
      })
    );
    body.appendChild(syncCard);

    // Live Activity Card
    const activityCard = el("div", { className: "tv-card", id: "tv-activity-card" });
    activityCard.appendChild(el("div", { className: "tv-card-title", text: "Live Activity", style: { marginBottom: "6px" } }));
    const actKv = el("div", { id: "tv-activity-kv" });
    actKv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Status" }),
        el("span", { className: "v", id: "tv-act-status", text: "🟢 Online" })
      ])
    );
    actKv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Time Worked" }),
        el("span", { className: "v mono", id: "tv-act-worked", text: "0s" })
      ])
    );
    actKv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Last Seen" }),
        el("span", { className: "v", id: "tv-act-lastseen", text: "Just now" })
      ])
    );
    activityCard.appendChild(actKv);
    body.appendChild(activityCard);

    // Licence Key Setting Card
    const licCard = el("div", { className: "tv-card" });
    licCard.appendChild(el("div", { className: "tv-card-title", text: "Licence Key Setting", style: { marginBottom: "6px" } }));

    const devCount = statusData.deviceCount || statusData.device_count || 1;
    const maxDev = statusData.maxDevices || statusData.max_devices || 1;

    const kv = el("div");
    kv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Key" }),
        el("span", { className: "v mono", text: maskKey(key) })
      ])
    );
    kv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Devices" }),
        el("span", { className: "v", id: "tv-lic-devices", text: `${devCount} / ${maxDev}` })
      ])
    );
    kv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Chats used" }),
        el("span", { className: "v mono", id: "tv-lic-chats", text: "0" })
      ])
    );
    licCard.appendChild(kv);

    licCard.appendChild(
      el("button", {
        className: "tv-logout",
        type: "button",
        text: "LOGOUT",
        onClick: async () => {
          await send({ type: "TRIVIS_LOGOUT" });
          licensed = false;
          statusData = null;
          fab.classList.remove("licensed");
          stopCountdown();
          renderBody();
        }
      })
    );
    body.appendChild(licCard);

    // Update initial live activity stats
    updateLiveStats();

    // Remove Watermark button
    const wmBtn = el("button", {
      className: "tv-wm-btn",
      type: "button",
      id: "tv-wm-btn",
      html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9.5 14.5L3 21"/><path d="M14.5 9.5L21 3"/><path d="M20 4l-1 1"/><circle cx="12" cy="12" r="3"/></svg> Remove Watermark`
    });
    wmBtn.addEventListener("click", () => {
      if (wmBtn.classList.contains("sent")) return;
      sendWatermarkPrompt(wmBtn);
    });
    body.appendChild(wmBtn);

    // Social — Instagram only
    body.appendChild(
      el("div", { className: "tv-social" }, [
        el("a", { href: INSTAGRAM_URL, target: "_blank", rel: "noopener noreferrer", title: "Instagram @mnthnnnn" }, [
          (() => {
            const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            s.setAttribute("viewBox", "0 0 24 24");
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute(
              "d",
              "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"
            );
            s.appendChild(p);
            return s;
          })()
        ])
      ])
    );
    body.appendChild(el("div", { className: "tv-foot", text: "mnthnnnn's Extension" }));
  }

  // ---------- watermark removal ----------
  function sendWatermarkPrompt(btn) {
    const PROMPT = "use CSS to completely hide the Lovable badge (the 'Made with Lovable' element), without breaking the layout";

    // Try to find the Lovable chat input on the page and send the prompt
    const sent = tryInjectPrompt(PROMPT);

    if (sent) {
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Prompt Sent!`;
      btn.classList.add("sent");
      // Reset after 3s so they can send again if needed
      setTimeout(() => {
        btn.classList.remove("sent");
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9.5 14.5L3 21"/><path d="M14.5 9.5L21 3"/><path d="M20 4l-1 1"/><circle cx="12" cy="12" r="3"/></svg> Remove Watermark`;
      }, 3000);
    } else {
      // Fallback: copy to clipboard so user can paste
      navigator.clipboard.writeText(PROMPT).catch(() => {});
      btn.innerHTML = `📋 Copied! Paste in chat`;
      btn.classList.add("sent");
      setTimeout(() => {
        btn.classList.remove("sent");
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9.5 14.5L3 21"/><path d="M14.5 9.5L21 3"/><path d="M20 4l-1 1"/><circle cx="12" cy="12" r="3"/></svg> Remove Watermark`;
      }, 3000);
    }
  }

  function tryInjectPrompt(text) {
    try {
      // Lovable uses a textarea or contenteditable for the chat input
      const selectors = [
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="chat" i]',
        'textarea[placeholder*="ask" i]',
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"]',
        'textarea',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;

        // Set value / content
        if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, text);
          } else {
            el.value = text;
          }
          // Fire React synthetic events
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          // contenteditable
          el.focus();
          el.textContent = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }

        el.focus();

        // Try to click the send button after a short delay
        setTimeout(() => {
          const sendBtns = [
            document.querySelector('button[type="submit"]'),
            document.querySelector('button[aria-label*="send" i]'),
            document.querySelector('button[aria-label*="submit" i]'),
            document.querySelector('[data-testid*="send" i]'),
            (() => {
              // find button sibling near the textarea
              const parent = el.closest("form") || el.parentElement;
              return parent ? parent.querySelector("button") : null;
            })(),
          ].find(Boolean);
          if (sendBtns) sendBtns.click();
          else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        }, 120);

        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async function updateLiveStats() {
    if (!licensed) return;
    const act = await send({ type: "TRIVIS_ACTIVITY" });
    if (!act || !act.ok) return;

    const stEl = document.getElementById("tv-act-status");
    const wrkEl = document.getElementById("tv-act-worked");
    const lsEl = document.getElementById("tv-act-lastseen");
    const devEl = document.getElementById("tv-lic-devices");
    const chatEl = document.getElementById("tv-lic-chats");

    if (stEl) stEl.textContent = act.isOnline ? "🟢 Online" : "🔴 Offline";
    if (wrkEl) wrkEl.textContent = formatDuration(act.totalSeconds);
    if (lsEl) lsEl.textContent = formatLastSeen(act.lastSeen);
    if (devEl) devEl.textContent = `${act.deviceCount || 1} / ${act.maxDevices || 1}`;
    if (chatEl) chatEl.textContent = String(act.chatCount || 0);
  }

  // ---------- countdown ----------
  function startCountdown() {
    stopCountdown();
    const tick = () => {
      const node = document.getElementById("tv-timer-val");
      // statusData can have expiresAt (from server) or expires_at (legacy)
      const expires = (statusData && (statusData.expiresAt || statusData.expires_at)) || null;
      if (node && expires) {
        const remaining = formatRemaining(expires);
        node.textContent = remaining;
        // Apply colour classes
        node.className = "tv-timer-value";
        if (remaining === "EXPIRED") {
          node.classList.add("expired");
          // Auto-logout: wipe key and re-render login
          stopCountdown();
          send({ type: "TRIVIS_LOGOUT" }).then(() => {
            licensed = false;
            statusData = null;
            fab.classList.remove("licensed");
            renderBody();
          });
        } else {
          const ms = Date.parse(expires) - Date.now();
          if (ms < 3600000) node.classList.add("expired");
          else if (ms < 86400000) node.classList.add("warning");
        }
      }
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  // ---------- init ----------
  async function init() {
    const pos = await loadPos();
    place(pos.x, pos.y);

    const res = await send({ type: "TRIVIS_STATUS" });
    if (res && res.ok) {
      licensed = true;
      statusData = res;
      fab.classList.add("licensed");
      startCountdown();
    }

    // SPA navigation / project switch detection
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        if (panelOpen && licensed) updateProjectStatus();
      }
      // also re-check project periodically while open
      if (panelOpen && licensed) {
        updateProjectStatus();
        updateLiveStats();
      }
    }, 2000);

    setInterval(async () => {
      const r = await send({ type: "TRIVIS_STATUS" });
      if (r) {
        const was = licensed;
        licensed = !!r.ok;
        statusData = r;
        if (licensed) {
          fab.classList.add("licensed");
          updateLiveStats();
        } else fab.classList.remove("licensed");
        if (panelOpen && was !== licensed) renderBody();
        if (licensed && !was) startCountdown();
        if (!licensed) {
          stopCountdown();
          // If expired/revoked, auto-logout and return to form
          if (r.status === 'expired' || r.status === 'revoked' || r.status === 'invalid') {
            await send({ type: "TRIVIS_LOGOUT" });
            if (panelOpen) renderBody();
          }
        }
      }
    }, 10000);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
