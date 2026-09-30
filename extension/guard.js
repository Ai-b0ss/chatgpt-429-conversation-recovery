// ChatGPT 429 Guard v0.8.1
// Reduces duplicate conversation reads after HTTP 429; it does not bypass rate limits.
(() => {
  if (window.__CGUARD_INSTALLED__) return;
  window.__CGUARD_INSTALLED__ = true;

  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();
  const cooldown = new Map();
  const failureLevel = new Map();
  const peers = new Map();
  const channel = new BroadcastChannel("chatgpt-429-guard-v1");
  const detailBackoffs = [12000, 15000, 60000, 120000, 240000];
  const listBackoffs = [8000, 30000];
  const detailMaxInternalRetries = 4;
  const listMaxInternalRetries = 1;
  const detailTerminalCooldownMs = 180000;
  const listTerminalCooldownMs = 30000;
  const disableKey = "chatgpt-429-guard:disable";
  const cooldownStoragePrefix = "chatgpt-429-guard:cooldown:";

  const metrics = {
    version: "0.8.1",
    installedAt: new Date().toISOString(),
    protectedCalls: 0,
    nativeCalls: 0,
    dedupeHits: 0,
    dedupeSignalMismatches: 0,
    retries429: 0,
    successAfter429: 0,
    final429: 0,
    terminalCooldowns: 0,
    abortedCalls: 0,
    crossTabLocks: 0,
    persistedCooldownHits: 0,
    staleCooldownsCleared: 0,
    passive429: 0,
    passive429BySurface: {},
    passiveErrors: 0,
    passiveErrorsBySurface: {},
    totalWaitMs: 0,
    lastStatus: null,
    lastEventAt: null
  };

  const now = () => Date.now();
  const disabled = () => {
    try { return localStorage.getItem(disableKey) === "1"; }
    catch { return false; }
  };

  const hashKey = value => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };

  const storageCooldownKey = key =>
    cooldownStoragePrefix + hashKey(key);

  const readPersistedCooldown = key => {
    try {
      const raw = Number(localStorage.getItem(storageCooldownKey(key)));
      if (!Number.isFinite(raw) || raw <= now()) {
        localStorage.removeItem(storageCooldownKey(key));
        return 0;
      }
      return raw;
    } catch {
      return 0;
    }
  };

  const setCooldownUntil = (key, until) => {
    cooldown.set(key, until);
    try {
      localStorage.setItem(storageCooldownKey(key), String(until));
    } catch {}
  };

  const clearCooldown = key => {
    cooldown.delete(key);
    try { localStorage.removeItem(storageCooldownKey(key)); }
    catch {}
  };

  const cleanupPersistedCooldowns = () => {
    try {
      const current = now();
      const maxFuture = current + 24 * 60 * 60 * 1000;
      const remove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(cooldownStoragePrefix)) continue;
        const value = Number(localStorage.getItem(key));
        if (!Number.isFinite(value) ||
            value <= current ||
            value > maxFuture) {
          remove.push(key);
        }
      }
      for (const key of remove) localStorage.removeItem(key);
      metrics.staleCooldownsCleared += remove.length;
    } catch {}
  };

  const log = (type, data = {}) => {
    metrics.lastEventAt = new Date().toISOString();
    const record = {
      ts: metrics.lastEventAt,
      type,
      ...data
    };
    try {
      console.debug("[ConversationGuard]", record);
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent(
        "__cguard_event__",
        { detail: JSON.stringify(record) }
      ));
    } catch {}
  };

  const abortError = signal => {
    if (signal && signal.reason) return signal.reason;
    try { return new DOMException("Aborted", "AbortError"); }
    catch {
      const e = new Error("Aborted");
      e.name = "AbortError";
      return e;
    }
  };

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError(signal));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(finish, ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });

  const retryAfterMs = response => {
    const raw = response.headers && response.headers.get
      ? response.headers.get("retry-after")
      : null;
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 300000);
    }
    const when = Date.parse(raw);
    return Number.isFinite(when)
      ? Math.max(0, Math.min(when - now(), 300000))
      : 0;
  };

  const requestSignal = (input, init) => {
    if (init && init.signal) return init.signal;
    return input instanceof Request ? input.signal : null;
  };

  const requestInfo = (input, init) => {
    const req = input instanceof Request ? input : null;
    const method = String(
      (init && init.method) || (req && req.method) || "GET"
    ).toUpperCase();
    const raw = req ? req.url : String(input);
    let url;
    try { url = new URL(raw, location.href); }
    catch { return null; }
    return { method, url };
  };

  const passiveKind = (input, init) => {
    const info = requestInfo(input, init);
    if (!info || info.url.origin !== location.origin) return null;
    const path = info.url.pathname;
    if (info.method === "GET" && path === "/backend-api/conversations") {
      return "conversation-list";
    }
    if (info.method === "POST" && path === "/backend-api/conversations/batch") {
      return "conversation-batch";
    }
    if (info.method === "POST" && path === "/backend-api/conversation/init") {
      return "conversation-init";
    }
    if (info.method === "GET" &&
        /^\/backend-api\/conversation\/[^/?]+$/.test(path)) {
      return "legacy-conversation";
    }
    if (info.method === "GET" &&
        /^\/backend-api\/conversation\/[^/?]+\/stream_status$/.test(path)) {
      return "stream-status";
    }
    if (path === "/backend-api/f/conversation/resume") {
      return "conversation-resume";
    }
    return null;
  };

  const protectedInfo = (input, init) => {
    const info = requestInfo(input, init);
    if (!info || info.method !== "GET" ||
        info.url.origin !== location.origin) return null;

    const path = info.url.pathname;
    let match = path.match(/^\/backend-api\/conversations\/([^/?]+)$/);
    if (match) {
      return {
        requestKey: info.url.href,
        rateKey: "conversation:" + match[1],
        surface: "conversation-detail",
      };
    }

    match = path.match(/^\/backend-api\/conversation\/([^/?]+)$/);
    if (match) {
      return {
        requestKey: info.url.href,
        rateKey: "conversation:" + match[1],
        surface: "conversation-detail",
      };
    }

    if (path === "/backend-api/conversations") {
      return {
        requestKey: info.url.href,
        rateKey: "conversation-list:" + info.url.search,
        surface: "conversation-list"
      };
    }
    return null;
  };

  channel.onmessage = event => {
    const msg = event.data || {};
    if (!msg.key) return;
    if (msg.type === "peer-start") {
      peers.set(msg.key, now() + 3000);
    } else if (msg.type === "peer-finish") {
      peers.delete(msg.key);
    } else if (msg.type === "peer-429" && Number.isFinite(msg.until)) {
      setCooldownUntil(
        msg.key,
        Math.max(cooldown.get(msg.key) || 0, msg.until)
      );
    }
  };

  async function waitForPeer(key, signal) {
    const until = peers.get(key) || 0;
    const ms = until - now();
    if (ms <= 0) return;
    metrics.totalWaitMs += Math.min(ms, 3000);
    log("peer-delay", { waitMs: Math.min(ms, 3000) });
    await sleep(Math.min(ms, 3000), signal);
  }

  async function waitForCooldown(key, signal) {
    const memoryUntil = cooldown.get(key) || 0;
    const persistedUntil = readPersistedCooldown(key);
    const until = Math.max(memoryUntil, persistedUntil);
    if (persistedUntil > memoryUntil) {
      cooldown.set(key, persistedUntil);
      metrics.persistedCooldownHits++;
    }
    const ms = until - now();
    if (ms <= 0) return;
    metrics.totalWaitMs += ms;
    log("cooldown-wait", { waitMs: ms });
    await sleep(ms, signal);
  }

  async function guardedFetch(input, init, key, protectedRequest) {
    const { surface } = protectedRequest;
    const signal = requestSignal(input, init);
    const isList = surface === "conversation-list";
    const backoffs = isList ? listBackoffs : detailBackoffs;
    const maxInternalRetries = isList
      ? listMaxInternalRetries
      : detailMaxInternalRetries;
    const terminalCooldownMs = isList
      ? listTerminalCooldownMs
      : detailTerminalCooldownMs;
    const abortCooldownMs = isList ? 5000 : 12000;

    await waitForPeer(key, signal);
    await waitForCooldown(key, signal);
    channel.postMessage({ type: "peer-start", key });
    let lastResponse = null;
    let saw429 = false;

    try {
      for (let attempt = 0; attempt <= maxInternalRetries; attempt++) {
        metrics.nativeCalls++;
        const started = now();
        const response = await nativeFetch(input, init);
        const elapsed = now() - started;
        lastResponse = response;
        metrics.lastStatus = response.status;

        if (response.status !== 429) {
          clearCooldown(key);
          failureLevel.delete(key);
          if (saw429) metrics.successAfter429++;
          log("response", {
            surface,
            status: response.status,
            elapsedMs: elapsed,
            attempt
          });
          return response;
        }

        saw429 = true;
        let serverWait = retryAfterMs(response);

        if (attempt >= maxInternalRetries) break;

        metrics.retries429++;
        const level = failureLevel.get(key) || 0;
        const localWait = backoffs[Math.min(
          level,
          backoffs.length - 1
        )];
        failureLevel.set(key, level + 1);
        const wait = Math.max(localWait, serverWait)
          + Math.floor(Math.random() * 500);
        const until = now() + wait;
        setCooldownUntil(key, until);
        channel.postMessage({ type: "peer-429", key, until });
        metrics.totalWaitMs += wait;
        log("429-backoff", {
          surface,
          elapsedMs: elapsed,
          attempt,
          waitMs: wait,
          retryAfterMs: serverWait
        });
        await sleep(wait, signal);
      }

      metrics.final429++;
      metrics.terminalCooldowns++;
      failureLevel.set(
        key,
        (failureLevel.get(key) || 0) + 1
      );
      const terminalUntil = now() + terminalCooldownMs;
      setCooldownUntil(key, terminalUntil);
      channel.postMessage({
        type: "peer-429",
        key,
        until: terminalUntil
      });
      log("429-final", { surface, cooldownMs: terminalCooldownMs });
      return lastResponse;
    } catch (error) {
      if (signal && signal.aborted) {
        metrics.abortedCalls++;
        if (saw429) {
          failureLevel.delete(key);
          const abortUntil = now() + abortCooldownMs;
          setCooldownUntil(key, abortUntil);
          channel.postMessage({
            type: "peer-429",
            key,
            until: abortUntil
          });
          log("aborted-after-429", {
            surface,
            cooldownMs: abortCooldownMs
          });
        } else {
          log("aborted-before-response", { surface });
        }
      }
      throw error;
    } finally {
      channel.postMessage({ type: "peer-finish", key });
    }
  }

  const findPending = (key, signal) => {
    const group = pending.get(key);
    if (!group) return null;
    for (const entry of group) {
      if (entry.signal === signal) return entry;
    }
    return null;
  };

  const removePending = (key, entry) => {
    const group = pending.get(key);
    if (!group) return;
    group.delete(entry);
    if (group.size === 0) pending.delete(key);
  };

  const pendingCount = () => {
    let count = 0;
    for (const group of pending.values()) count += group.size;
    return count;
  };

  const runSerialized = (key, signal, task) => {
    if (typeof navigator === "undefined" ||
        !navigator.locks ||
        typeof navigator.locks.request !== "function") {
      return task();
    }
    const options = { mode: "exclusive" };
    if (signal) options.signal = signal;
    metrics.crossTabLocks++;
    return navigator.locks.request(
      "cguard:" + hashKey(key),
      options,
      task
    );
  };

  window.fetch = function(input, init) {
    const protectedRequest = protectedInfo(input, init);
    if (disabled()) return nativeFetch(input, init);

    if (!protectedRequest) {
      const kind = passiveKind(input, init);
      const task = nativeFetch(input, init);
      if (!kind) return task;
      return task.then(response => {
        if (response.status === 429) {
          metrics.passive429++;
          metrics.passive429BySurface[kind] =
            (metrics.passive429BySurface[kind] || 0) + 1;
          log("passive-429", { surface: kind });
        } else if (response.status >= 400) {
          metrics.passiveErrors++;
          const errorKey = kind + ":" + response.status;
          metrics.passiveErrorsBySurface[errorKey] =
            (metrics.passiveErrorsBySurface[errorKey] || 0) + 1;
          log("passive-error", {
            surface: kind,
            status: response.status
          });
        }
        return response;
      });
    }

    const { requestKey, rateKey, surface } = protectedRequest;
    metrics.protectedCalls++;
    const signal = requestSignal(input, init);
    const existing = findPending(requestKey, signal);
    if (existing) {
      metrics.dedupeHits++;
      log("dedupe-hit", { surface });
      return existing.task.then(response => response.clone());
    }

    if (pending.has(requestKey)) {
      metrics.dedupeSignalMismatches++;
      log("dedupe-skip-signal", { surface });
    }

    const entry = { signal, task: null };
    const task = runSerialized(
      rateKey,
      signal,
      () => guardedFetch(input, init, rateKey, protectedRequest)
    ).finally(() => removePending(requestKey, entry));
    entry.task = task;

    let group = pending.get(requestKey);
    if (!group) {
      group = new Set();
      pending.set(requestKey, group);
    }
    group.add(entry);
    return task.then(response => response.clone());
  };

  window.__CGUARD_STATUS__ = () => ({
    installed: true,
    version: metrics.version,
    disabled: disabled(),
    pendingCount: pendingCount(),
    cooldownCount: cooldown.size,
    failureKeys: failureLevel.size,
    peerCount: peers.size,
    metrics: { ...metrics }
  });

  window.__CGUARD_DISABLE__ = () => {
    try { localStorage.setItem(disableKey, "1"); } catch {}
    log("disabled");
  };

  window.__CGUARD_ENABLE__ = () => {
    try { localStorage.removeItem(disableKey); } catch {}
    log("enabled");
  };

  cleanupPersistedCooldowns();
  log("installed", { version: metrics.version });
})();
