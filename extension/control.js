// UI transport only. Request/retry policy remains in the unchanged guard.js.
(() => {
  window.addEventListener("__cguard_control__", event => {
    try {
      const { id, command } = JSON.parse(event.detail);
      if (typeof id !== "string" || !["status", "enable", "disable"].includes(command)) return;
      if (command === "disable") window.__CGUARD_DISABLE__?.();
      if (command === "enable") window.__CGUARD_ENABLE__?.();
      window.dispatchEvent(new CustomEvent("__cguard_control_response__", {
        detail: JSON.stringify({ id, status: window.__CGUARD_STATUS__?.() || null })
      }));
    } catch {}
  });
})();
