let tabId, status;
const byId = id => document.getElementById(id);
const extensionVersion = chrome.runtime.getManifest().version;
byId("version").textContent = "v" + extensionVersion;

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
    byId("status").textContent = status.disabled
      ? "Protection is disabled"
      : "429 protection is active";
    byId("toggle").disabled = false;
    byId("toggle").textContent = status.disabled
      ? "Enable protection"
      : "Disable protection";

    const m = status.metrics;
    byId("metrics").textContent =
      "This tab\n" +
      "Pending: " + status.pendingCount + "\n" +
      "Retries after 429: " + m.retries429 + "\n" +
      "Recovered after 429: " + m.successAfter429 + "\n" +
      "Final 429 responses: " + m.final429 + "\n" +
      "Cross-chat cooldown waits: " + (m.globalCooldownHits || 0) + "\n" +
      "Wait time: " + m.totalWaitMs + " ms";
  } catch (error) {
    status = null;
    byId("status").textContent = error.message;
    byId("toggle").disabled = true;
    byId("metrics").textContent = "";
  }
  const data = await chrome.storage.local.get([
    "cguard_counts",
    "cguard_last_event"
  ]);
  const counts = data.cguard_counts || {};
  byId("telemetry").textContent =
    "Local diagnostics\n" +
    "429 backoffs: " + (counts["429-backoff"] || 0) + "\n" +
    "Network 429s: " + (counts["network-429"] || 0) + "\n" +
    "Last event: " + (data.cguard_last_event?.ts || "none");
}

async function copyDiagnostics() {
  const data = await chrome.storage.local.get([
    "cguard_counts",
    "cguard_last_event"
  ]);
  const safe = {
    extension: "ChatGPT 429 Guard",
    version: extensionVersion,
    generatedAt: new Date().toISOString(),
    pageStatus: status,
    eventCounts: data.cguard_counts || {},
    lastEvent: data.cguard_last_event || null
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