/**
 * mnthnnnn's Extension — content script (document_start)
 * Lightweight: only removes any old full-page gate.
 * Real UI is handled by floating-ui.js (injected at document_idle).
 */
(function () {
  "use strict";
  if (window.__mnthnnnnGate__) return;
  window.__mnthnnnnGate__ = true;

  // Clean any previous full-page gate if present (from older versions)
  function removeOldGate() {
    try {
      var g = document.getElementById("trivis-page-license-gate");
      if (g) g.remove();
    } catch (_) {}
  }

  removeOldGate();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", removeOldGate, { once: true });
  }
})();
