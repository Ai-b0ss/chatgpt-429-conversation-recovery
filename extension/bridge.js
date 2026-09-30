(() => {
  if (window.__CGUARD_BRIDGE_INSTALLED__) return;
  window.__CGUARD_BRIDGE_INSTALLED__ = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "cguard_control" || sender.id !== chrome.runtime.id) return;
    if (!["status", "enable", "disable"].includes(message.command)) return;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("__cguard_control_response__", receive);
      sendResponse({ error: "Guard status unavailable. Reload the ChatGPT tab." });
    }, 2000);
    function receive(event) {
      try {
        const result = JSON.parse(event.detail);
        if (result.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("__cguard_control_response__", receive);
        sendResponse(result);
      } catch {}
    }
    window.addEventListener("__cguard_control_response__", receive);
    window.dispatchEvent(new CustomEvent("__cguard_control__", {
      detail: JSON.stringify({ id, command: message.command })
    }));
    return true;
  });

  window.addEventListener("__cguard_event__", event => {
    try {
      const detail = typeof event.detail === "string"
        ? JSON.parse(event.detail)
        : event.detail;
      if (!detail || typeof detail !== "object") return;
      chrome.runtime.sendMessage({
        type: "cguard_event",
        event: detail
      }).catch(() => {});
    } catch {}
  });
})();
