let writeChain = Promise.resolve();

function enqueueEvent(event) {
  if (!event || typeof event !== "object") return;
  writeChain = writeChain.then(async () => {
    const current = await chrome.storage.local.get([
      "cguard_events",
      "cguard_counts",
      "cguard_last_event"
    ]);
    const events = Array.isArray(current.cguard_events)
      ? current.cguard_events
      : [];
    const counts = current.cguard_counts &&
      typeof current.cguard_counts === "object"
      ? current.cguard_counts
      : {};

    events.push(event);
    while (events.length > 200) events.shift();

    const type = String(event.type || "unknown");
    counts[type] = (counts[type] || 0) + 1;
    await chrome.storage.local.set({
      cguard_events: events,
      cguard_counts: counts,
      cguard_last_event: event
    });
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "cguard_event") return;
  enqueueEvent(message.event);
});

function hashKey(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function rateHashFor(url) {
  let path;
  try { path = new URL(url).pathname; }
  catch { return null; }
  let match = path.match(/^\/backend-api\/conversations\/([^/?]+)$/);
  if (!match) match = path.match(/^\/backend-api\/conversation\/([^/?]+)(?:\/stream_status)?$/);
  return match ? hashKey("conversation:" + match[1]) : null;
}

function classify(url, method) {
  let path;
  try { path = new URL(url).pathname; }
  catch { return null; }
  if (method === "GET" && path === "/backend-api/conversations") {
    return "conversation-list";
  }
  if (method === "POST" && path === "/backend-api/conversations/batch") {
    return "conversation-batch";
  }
  if (method === "POST" && path === "/backend-api/conversation/init") {
    return "conversation-init";
  }
  if (method === "GET" &&
      /^\/backend-api\/conversations\/[^/?]+$/.test(path)) {
    return "conversation-detail";
  }
  if (method === "GET" &&
      /^\/backend-api\/conversation\/[^/?]+$/.test(path)) {
    return "legacy-conversation";
  }
  if (method === "GET" &&
      /^\/backend-api\/conversation\/[^/?]+\/stream_status$/.test(path)) {
    return "stream-status";
  }
  if (path === "/backend-api/f/conversation/resume") {
    return "conversation-resume";
  }
  return null;
}

chrome.webRequest.onCompleted.addListener(details => {
  const surface = classify(details.url, details.method);
  if (!surface) return;

  if (details.statusCode === 429) {
    enqueueEvent({
      ts: new Date().toISOString(),
      type: "network-429",
      surface,
      method: details.method,
      status: details.statusCode,
      tabId: details.tabId,
      rateHash: rateHashFor(details.url)
    });
    return;
  }

  if (details.statusCode >= 400) {
    enqueueEvent({
      ts: new Date().toISOString(),
      type: "network-error",
      surface,
      method: details.method,
      status: details.statusCode,
      tabId: details.tabId,
      rateHash: rateHashFor(details.url)
    });
  }
}, { urls: ["https://chatgpt.com/backend-api/*"] });

chrome.webRequest.onErrorOccurred.addListener(details => {
  const surface = classify(details.url, details.method);
  if (!surface) return;
  enqueueEvent({
    ts: new Date().toISOString(),
    type: "network-failure",
    surface,
    method: details.method,
    error: details.error,
    tabId: details.tabId,
    rateHash: rateHashFor(details.url)
  });
}, { urls: ["https://chatgpt.com/backend-api/*"] });
