/**
 * Trivis Floating UI v1.2 — Lovable in-page panel
 * UI only. Freeze / credit logic untouched.
 */
(function () {
  "use strict";
  if (window.__trivisFloatingUI__) return;
  window.__trivisFloatingUI__ = true;

  const ACCENT = "#DD0D10";
  const STORAGE_POS = "trivis_fab_pos";
  const DISCORD_URL = "https://discord.gg/trivis";
  const INSTAGRAM_URL = "https://instagram.com/trivis";

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
      width: 54px;
      height: 54px;
      border-radius: 16px;
      background: linear-gradient(145deg, #1c1214 0%, #0a0809 100%);
      border: 1px solid rgba(221,13,16,0.5);
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.4),
        0 8px 28px rgba(0,0,0,0.55),
        0 0 20px rgba(221,13,16,0.18),
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
        0 0 28px rgba(221,13,16,0.35),
        inset 0 1px 0 rgba(255,255,255,0.09);
    }
    #trivis-fab:active { cursor: grabbing; }
    #trivis-fab.dragging {
      cursor: grabbing;
      transition: none;
      box-shadow:
        0 0 0 1px rgba(0,0,0,0.5),
        0 16px 40px rgba(0,0,0,0.7),
        0 0 32px rgba(221,13,16,0.4);
    }
    #trivis-fab img {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      pointer-events: none;
      filter: drop-shadow(0 0 6px rgba(221,13,16,0.35));
    }
    #trivis-fab .trivis-dot {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #5a5a5a;
      box-shadow: 0 0 0 2px #0a0809;
      transition: background 0.3s, box-shadow 0.3s;
    }
    #trivis-fab.licensed .trivis-dot {
      background: #3fb950;
      box-shadow: 0 0 0 2px #0a0809, 0 0 10px rgba(63,185,80,0.7);
      animation: trivis-pulse 2s ease infinite;
    }
    @keyframes trivis-pulse {
      0%, 100% { box-shadow: 0 0 0 2px #0a0809, 0 0 8px rgba(63,185,80,0.55); }
      50% { box-shadow: 0 0 0 2px #0a0809, 0 0 14px rgba(63,185,80,0.9); }
    }

    /* PANEL */
    #trivis-panel {
      pointer-events: auto;
      position: absolute;
      width: 312px;
      max-height: min(82vh, 560px);
      overflow: hidden;
      display: none;
      flex-direction: column;
      background: linear-gradient(180deg, #120e10 0%, #0a0809 100%);
      border: 1px solid rgba(221,13,16,0.28);
      border-radius: 18px;
      box-shadow:
        0 24px 64px rgba(0,0,0,0.7),
        0 0 0 1px rgba(221,13,16,0.12),
        0 0 40px rgba(221,13,16,0.08);
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
      background: linear-gradient(180deg, rgba(221,13,16,0.08) 0%, transparent 100%);
    }
    .tv-hd-left {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .tv-hd-left img {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      box-shadow: 0 0 12px rgba(221,13,16,0.3);
    }
    .tv-hd-title {
      font-family: Orbitron, Inter, sans-serif;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #fff;
      text-shadow: 0 0 20px rgba(221,13,16,0.4);
    }
    .tv-hd-sub {
      font-size: 10px;
      color: #9a9a9a;
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
      background: rgba(221,13,16,0.15);
      border-color: rgba(221,13,16,0.4);
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
    }
    .tv-timer-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #6e6e6e;
      font-weight: 600;
      margin-bottom: 3px;
    }
    .tv-timer-value {
      font-family: Orbitron, JetBrains Mono, monospace;
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: ${ACCENT};
      text-shadow: 0 0 18px rgba(221,13,16,0.55);
      font-variant-numeric: tabular-nums;
      animation: tv-timer-glow 2.4s ease-in-out infinite;
    }
    @keyframes tv-timer-glow {
      0%, 100% { text-shadow: 0 0 14px rgba(221,13,16,0.4); }
      50% { text-shadow: 0 0 24px rgba(221,13,16,0.7); }
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
      color: #8a8a8a;
      margin-bottom: 5px;
      font-weight: 600;
    }
    .tv-form input {
      width: 100%;
      padding: 11px 12px;
      border-radius: 11px;
      border: 1px solid rgba(255,255,255,0.1);
      background: #161012;
      color: #f0f0f0;
      font-size: 13px;
      outline: none;
      margin-bottom: 11px;
      transition: border-color 0.18s, box-shadow 0.18s;
      font-family: Inter, system-ui, sans-serif;
    }
    .tv-form input:focus {
      border-color: ${ACCENT};
      box-shadow: 0 0 0 3px rgba(221,13,16,0.18);
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
      background: linear-gradient(135deg, #e81115 0%, #b50b0e 100%);
      color: #fff;
      font-weight: 700;
      font-size: 13.5px;
      letter-spacing: 0.04em;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: transform 0.12s, box-shadow 0.2s, opacity 0.15s;
      box-shadow: 0 4px 16px rgba(221,13,16,0.35);
      font-family: Inter, system-ui, sans-serif;
    }
    .tv-btn:hover {
      box-shadow: 0 6px 22px rgba(221,13,16,0.5);
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
      border: 2px solid rgba(221,13,16,0.25);
      border-top-color: ${ACCENT};
      animation: tv-spin 0.85s linear infinite;
    }
    @keyframes tv-spin { to { transform: rotate(360deg); } }
    .tv-seq-text {
      font-family: Orbitron, Inter, sans-serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #e8e8e8;
      text-align: center;
      min-height: 18px;
      animation: tv-text-in 0.35s ease;
    }
    @keyframes tv-text-in {
      from { opacity: 0; transform: translateY(6px); letter-spacing: 0.2em; }
      to   { opacity: 1; transform: translateY(0); letter-spacing: 0.12em; }
    }
    .tv-seq-text.success {
      color: #3fb950;
      text-shadow: 0 0 16px rgba(63,185,80,0.55);
    }

    /* CARDS */
    .tv-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 13px;
      padding: 12px;
      transition: border-color 0.2s;
    }
    .tv-card:hover { border-color: rgba(221,13,16,0.22); }
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
      color: #7a7a7a;
      font-weight: 700;
    }
    .tv-refresh {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: #bbb;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .tv-refresh:hover {
      background: rgba(221,13,16,0.15);
      border-color: rgba(221,13,16,0.4);
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
      color: #ff3b3b;
      text-shadow: 0 0 12px rgba(255,59,59,0.55), 0 0 24px rgba(255,59,59,0.25);
      font-family: Orbitron, Inter, sans-serif;
      font-size: 12px;
      letter-spacing: 0.04em;
      animation: tv-glow-red 1.8s ease-in-out infinite;
    }
    @keyframes tv-glow-red {
      0%, 100% { text-shadow: 0 0 10px rgba(255,59,59,0.45); }
      50% { text-shadow: 0 0 18px rgba(255,59,59,0.8), 0 0 28px rgba(255,59,59,0.3); }
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
      color: #6e6e6e;
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
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #b0b0b0;
      text-decoration: none;
      transition: all 0.18s;
    }
    .tv-social a:hover {
      background: rgba(221,13,16,0.14);
      border-color: rgba(221,13,16,0.4);
      color: #fff;
      transform: translateY(-2px);
    }
    .tv-social svg { width: 15px; height: 15px; fill: currentColor; }
    .tv-foot {
      text-align: center;
      font-size: 9.5px;
      color: #4a4a4a;
      letter-spacing: 0.06em;
      padding-bottom: 2px;
      font-family: Orbitron, sans-serif;
    }
  `;

  // ---------- DOM ----------
  const style = el("style", { html: css });
  document.documentElement.appendChild(style);

  const root = el("div", { id: "trivis-fab-root" });
  const fab = el("div", { id: "trivis-fab", title: "Trivis" });
  const logoUrl = chrome.runtime.getURL("assets/icon48.png");
  fab.appendChild(el("img", { src: logoUrl, alt: "Trivis" }));
  fab.appendChild(el("div", { className: "trivis-dot" }));

  const panel = el("div", { id: "trivis-panel" });

  // Header
  const hd = el("div", { className: "tv-hd" }, [
    el("div", { className: "tv-hd-left" }, [
      el("img", { src: logoUrl, alt: "" }),
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

  function renderLicensed() {
    const name = (statusData && statusData.name) || "User";
    const expires = (statusData && statusData.expires_at) || null;
    const key = (statusData && statusData.key) || "—";

    const sub = document.getElementById("tv-hd-sub");
    if (sub) sub.textContent = name;

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

    // Licence Key Setting
    const licCard = el("div", { className: "tv-card" });
    licCard.appendChild(el("div", { className: "tv-card-title", text: "Licence Key Setting", style: { marginBottom: "6px" } }));

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
        el("span", { className: "v", text: "This device" })
      ])
    );
    kv.appendChild(
      el("div", { className: "tv-kv" }, [
        el("span", { className: "k", text: "Chats used" }),
        el("span", { className: "v", text: "—" })
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

    // Social
    body.appendChild(
      el("div", { className: "tv-social" }, [
        el("a", { href: DISCORD_URL, target: "_blank", rel: "noopener noreferrer", title: "Discord" }, [
          (() => {
            const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            s.setAttribute("viewBox", "0 0 24 24");
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute(
              "d",
              "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
            );
            s.appendChild(p);
            return s;
          })()
        ]),
        el("a", { href: INSTAGRAM_URL, target: "_blank", rel: "noopener noreferrer", title: "Instagram" }, [
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

  function startCountdown() {
    stopCountdown();
    const tick = () => {
      const node = document.getElementById("tv-timer-val");
      if (node && statusData && statusData.expires_at) {
        node.textContent = formatRemaining(statusData.expires_at);
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
      if (panelOpen && licensed) updateProjectStatus();
    }, 2000);

    setInterval(async () => {
      const r = await send({ type: "TRIVIS_STATUS" });
      if (r) {
        const was = licensed;
        licensed = !!r.ok;
        statusData = r;
        if (licensed) fab.classList.add("licensed");
        else fab.classList.remove("licensed");
        if (panelOpen && was !== licensed) renderBody();
        if (licensed && !was) startCountdown();
        if (!licensed) stopCountdown();
      }
    }, 10000);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
