let tabId, status;
const byId = id => document.getElementById(id);
const extensionVersion = chrome.runtime.getManifest().version;
byId("version").textContent = "v" + extensionVersion;

const SAFE_EVENT_KEYS = new Set([
  "ts", "type", "surface", "method", "status", "protection", "source",
  "attempt", "waitMs", "retryAfterMs", "cooldownMs", "elapsedMs",
  "scope", "capped", "rawWaitMs", "error"
]);

function sanitizeRecentEvent(event) {
  if (!event || typeof event !== "object") return null;
  const safe = {};
  for (const key of SAFE_EVENT_KEYS) {
    if (key in event) safe[key] = event[key];
  }
  return Object.keys(safe).length ? safe : null;
}

function recent429Summary(events) {
  const counts = {};
  for (const event of events) {
    if (!event || (event.status !== 429 &&
        !["429-backoff", "429-final", "passive-429", "network-429"].includes(event.type))) {
      continue;
    }
    const surface = event.surface || "unknown";
    const protection = event.protection || "unknown";
    const key = surface + " [" + protection + "]";
    counts[key] = (counts[key] || 0) + 1;
  }
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, value]) => "  " + key + ": " + value);
  return rows.length ? rows.join("\n") : "  none";
}

async function localDiagnostics() {
  return await chrome.storage.local.get([
    "cguard_counts",
    "cguard_last_event",
    "cguard_events"
  ]);
}

async function refresh(command = "status") {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith("https://chatgpt.com/")) {
      throw Error("Open ChatGPT in the current tab.");
    }
    tabId = tab.id;
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: "cguard_control",
      command
    });
    if (reply?.error || !reply?.status) {
      throw Error(reply?.error || "Reload the ChatGPT tab.");
    }
    status = reply.status;
    const pageVersion = String(
      status.version || status.metrics?.version || "unknown"
    );
    const versionMismatch = pageVersion !== extensionVersion;
    byId("status").textContent = versionMismatch
      ? "Reload this ChatGPT tab: page Guard v" + pageVersion +
        ", extension v" + extensionVersion
      : (status.disabled
          ? "Protection is disabled"
          : "Conversation 429 protection is active");
    byId("toggle").disabled = versionMismatch;
    byId("toggle").textContent = versionMismatch
      ? "Reload tab first"
      : (status.disabled
          ? "Enable protection"
          : "Disable protection");

    const m = status.metrics;
    byId("metrics").textContent =
      "This tab\n" +
      "Page Guard: v" + String(status.version || m.version || "unknown") + "\n" +
      "Pending: " + status.pendingCount + "\n" +
      "Retries after 429: " + m.retries429 + "\n" +
      "Recovered after 429: " + m.successAfter429 + "\n" +
      "Final 429 responses: " + m.final429 + "\n" +
      "Passive 429 observations: " + (m.passive429 || 0) + "\n" +
      "Cross-chat cooldown waits: " + (m.globalCooldownHits || 0) + "\n" +
      "Wait time: " + m.totalWaitMs + " ms";
  } catch (error) {
    status = null;
    byId("status").textContent = error.message;
    byId("toggle").disabled = true;
    byId("metrics").textContent = "";
  }

  const data = await localDiagnostics();
  const counts = data.cguard_counts || {};
  const events = Array.isArray(data.cguard_events)
    ? data.cguard_events.map(sanitizeRecentEvent).filter(Boolean).slice(-30)
    : [];
  byId("telemetry").textContent =
    "Local diagnostics\n" +
    "429 backoffs: " + (counts["429-backoff"] || 0) + "\n" +
    "Network 429s: " + (counts["network-429"] || 0) + "\n" +
    "Recent 429 surfaces:\n" + recent429Summary(events) + "\n" +
    "Last event: " + (data.cguard_last_event?.ts || "none");
}

async function copyDiagnostics() {
  const data = await localDiagnostics();
  const recentEvents = Array.isArray(data.cguard_events)
    ? data.cguard_events.map(sanitizeRecentEvent).filter(Boolean).slice(-30)
    : [];
  const safe = {
    extension: "ChatGPT Conversation Availability Guard",
    version: extensionVersion,
    generatedAt: new Date().toISOString(),
    pageStatus: status,
    eventCounts: data.cguard_counts || {},
    recentEvents
  };
  const text = JSON.stringify(safe, null, 2);
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  byId("copy").textContent = "Copied";
  setTimeout(() => { byId("copy").textContent = "Copy safe diagnostics"; }, 1200);
}

byId("refresh").addEventListener("click", () => refresh());
byId("toggle").addEventListener("click", () =>
  refresh(status?.disabled ? "enable" : "disable")
);
byId("copy").addEventListener("click", copyDiagnostics);
refresh();
