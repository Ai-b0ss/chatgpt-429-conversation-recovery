let writeChain = Promise.resolve();

const SAFE_EVENT_KEYS = new Set([
  "ts", "type", "surface", "method", "status", "protection", "source",
  "attempt", "waitMs", "retryAfterMs", "cooldownMs", "elapsedMs",
  "scope", "capped", "rawWaitMs", "error"
]);

function sanitizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const safe = {};
  for (const key of SAFE_EVENT_KEYS) {
    if (!(key in event)) continue;
    const value = event[key];
    if (["attempt", "waitMs", "retryAfterMs", "cooldownMs", "elapsedMs", "rawWaitMs", "status"].includes(key)) {
      if (Number.isFinite(value) && value >= 0) safe[key] = value;
      continue;
    }
    if (key === "capped") {
      if (typeof value === "boolean") safe[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    if (key === "error") {
      if (/^net::[A-Z0-9_]+$/.test(value)) safe[key] = value;
      continue;
    }
    safe[key] = value.slice(0, 120);
  }
  if (!safe.ts) safe.ts = new Date().toISOString();
  if (!safe.type) safe.type = "unknown";
  return safe;
}

function enqueueEvent(event) {
  const sanitized = sanitizeEvent(event);
  if (!sanitized) return;
  writeChain = writeChain.then(async () => {
    const current = await chrome.storage.local.get([
      "cguard_events",
      "cguard_counts",
      "cguard_last_event"
    ]);
    const events = Array.isArray(current.cguard_events)
      ? current.cguard_events.map(sanitizeEvent).filter(Boolean)
      : [];
    const counts = current.cguard_counts &&
      typeof current.cguard_counts === "object"
      ? current.cguard_counts
      : {};

    events.push(sanitized);
    while (events.length > 200) events.shift();

    const type = String(sanitized.type || "unknown");
    counts[type] = (counts[type] || 0) + 1;
    await chrome.storage.local.set({
      cguard_events: events,
      cguard_counts: counts,
      cguard_last_event: sanitized
    });
  }).catch(() => {});
}

async function sanitizeStoredEvents() {
  try {
    const current = await chrome.storage.local.get([
      "cguard_events",
      "cguard_last_event"
    ]);
    const events = Array.isArray(current.cguard_events)
      ? current.cguard_events.map(sanitizeEvent).filter(Boolean).slice(-200)
      : [];
    const last = sanitizeEvent(current.cguard_last_event) ||
      (events.length ? events[events.length - 1] : null);
    await chrome.storage.local.set({
      cguard_events: events,
      cguard_last_event: last
    });
  } catch {}
}

writeChain = sanitizeStoredEvents();

chrome.runtime.onMessage.addListener(message => {
  if (!message || message.type !== "cguard_event") return;
  enqueueEvent(message.event);
});

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

function protectionFor(surface, method) {
  if (method === "GET" && [
    "conversation-list",
    "conversation-detail",
    "legacy-conversation",
    "stream-status"
  ].includes(surface)) {
    return "active-eligible";
  }
  return "passive-only";
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
      protection: protectionFor(surface, details.method),
      source: "webRequest"
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
      protection: protectionFor(surface, details.method),
      source: "webRequest"
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
    protection: protectionFor(surface, details.method),
    source: "webRequest"
  });
}, { urls: ["https://chatgpt.com/backend-api/*"] });
