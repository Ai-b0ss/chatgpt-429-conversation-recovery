// ChatGPT Stream Resume Lab — passive by default.
// Optional active resume-404 recovery is lab-only and disabled unless explicitly enabled.
(() => {
  if (window.__CGUARD_STREAM_OBSERVER_INSTALLED__) return;
  window.__CGUARD_STREAM_OBSERVER_INSTALLED__ = true;

  const originalFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const streamStatusByConversation = new Map();
  const resumeByConversation = new Map();
  const completionByConversation = new Map();
  const completionWaiters = new Map();
  let completionSequence = 0;
  const detailInFlightByConversation = new Map();
  const detailSuccessByConversation = new Map();
  const detailOutcomeWaiters = new Map();
  let detailSequence = 0;
  const recoveryInFlight = new Set();
  const stateTtlMs = 2 * 60 * 1000;
  const recoveryStreamingEvidenceMaxAgeMs = 30 * 1000;
  const recoveryGraceMs = 1200;
  const recoveryDetailExtensionMs = 4800;
  const recoveryPostDetailGraceMs = 800;
  const recoveryRetryDelayMs = 150;
  const recoveryOffsetCandidates = [0, 1, 2];
  const recoveryMaxAttempts = recoveryOffsetCandidates.length;
  let recoveryEnabled = false;
  const metrics = {
    installedAt: new Date().toISOString(),
    streamStatusObserved: 0,
    streamingObserved: 0,
    resumeObserved: 0,
    resume404: 0,
    resume404WhileStreaming: 0,
    resume404AfterCompletion: 0,
    resumeTerminalSuccess: 0,
    resumeHandoffObserved: 0,
    websocketTurnComplete: 0,
    websocketAfterResume404: 0,
    recoveryCandidates: 0,
    recoveryAttempts: 0,
    recoverySuccess: 0,
    recoverySuppressedByWebsocket: 0,
    stockDetailObserved: 0,
    stockDetailSuccess: 0,
    recoveryDetailWaits: 0,
    recoveryDetailSuccessObserved: 0,
    recoveryDetailFailureObserved: 0,
    recoverySkippedNoStreaming: 0,
    recoverySkippedStaleStreaming: 0,
    recoverySkippedUnsupported: 0,
    recoverySkippedConcurrent: 0,
    recoverySkippedCrossTab: 0,
    stockResumeOffsets: {},
    recoveryAborted: 0,
    recoveryRejectedNonStream: 0,
    recoveryRejectedInvalidStream: 0,
    recoveryValidationTimeouts: 0,
    recoveryExhausted: 0,
    parseErrors: 0,
    lastEventAt: null
  };

  const emit = (type, data = {}) => {
    metrics.lastEventAt = new Date().toISOString();
    const record = { ts: metrics.lastEventAt, type, ...data };
    try {
      window.dispatchEvent(new CustomEvent(
        "__cguard_event__",
        { detail: JSON.stringify(record) }
      ));
    } catch {}
    try { console.debug("[StreamResumeLab]", record); } catch {}
  };

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });

  const waitForConversationCompletion = (
    conversationId,
    sinceSequence,
    ms,
    signal
  ) => new Promise((resolve, reject) => {
      if (!conversationId) {
        resolve(false);
        return;
      }
      const alreadyCompleted = completionByConversation.get(conversationId);
      if (alreadyCompleted?.seq > sinceSequence) {
        resolve(true);
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
        return;
      }

      let settled = false;
      const waiters = completionWaiters.get(conversationId) || new Set();
      const cleanup = () => {
        waiters.delete(finish);
        if (!waiters.size) completionWaiters.delete(conversationId);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(value);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      };

      waiters.add(finish);
      completionWaiters.set(conversationId, waiters);
      const timer = setTimeout(() => finish(false), ms);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });

  const signalConversationCompletion = conversationId => {
    if (!conversationId) return;
    completionSequence++;
    completionByConversation.set(conversationId, {
      at: Date.now(),
      seq: completionSequence
    });
    const waiters = completionWaiters.get(conversationId);
    if (!waiters) return;
    completionWaiters.delete(conversationId);
    for (const finish of [...waiters]) {
      try { finish(true); } catch {}
    }
  };

  const waitForDetailOutcome = (
    conversationId,
    sinceSequence,
    ms,
    signal
  ) => new Promise((resolve, reject) => {
    if (!conversationId) {
      resolve(null);
      return;
    }
    const recentSuccess = detailSuccessByConversation.get(conversationId);
    if (recentSuccess?.seq > sinceSequence) {
      resolve("success");
      return;
    }
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }

    let settled = false;
    const waiters = detailOutcomeWaiters.get(conversationId) || new Set();
    const cleanup = () => {
      waiters.delete(finish);
      if (!waiters.size) detailOutcomeWaiters.delete(conversationId);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };

    waiters.add(finish);
    detailOutcomeWaiters.set(conversationId, waiters);
    const timer = setTimeout(() => finish(null), ms);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });

  const waitForNaturalRecoverySignal = async (
    conversationId,
    completionSequenceAtStart,
    detailSequenceAtStart,
    ms,
    signal
  ) => {
    const timeout = Symbol("timeout");
    const never = new Promise(() => {});
    return await Promise.race([
      waitForConversationCompletion(
        conversationId,
        completionSequenceAtStart,
        ms,
        signal
      ).then(value => value ? "provider-complete" : never),
      waitForDetailOutcome(
        conversationId,
        detailSequenceAtStart,
        ms,
        signal
      ).then(value => {
        if (value === "success") return "stock-detail-success";
        if (value === "failed") return "stock-detail-failed";
        return never;
      }),
      sleep(ms, signal).then(() => timeout)
    ]).then(value => value === timeout ? null : value);
  };

  const beginDetailRequest = conversationId => {
    if (!conversationId) return;
    const count = detailInFlightByConversation.get(conversationId) || 0;
    detailInFlightByConversation.set(conversationId, count + 1);
    metrics.stockDetailObserved++;
  };

  const finishDetailRequest = (conversationId, ok) => {
    if (!conversationId) return;
    const count = Math.max(
      0,
      (detailInFlightByConversation.get(conversationId) || 1) - 1
    );
    if (count) detailInFlightByConversation.set(conversationId, count);
    else detailInFlightByConversation.delete(conversationId);

    if (ok) {
      detailSequence++;
      detailSuccessByConversation.set(conversationId, {
        at: Date.now(),
        seq: detailSequence
      });
      metrics.stockDetailSuccess++;
    }

    const waiters = detailOutcomeWaiters.get(conversationId);
    if (!waiters) return;
    detailOutcomeWaiters.delete(conversationId);
    for (const finish of [...waiters]) {
      try { finish(ok ? "success" : "failed"); } catch {}
    }
  };

  const cleanState = () => {
    const cutoff = Date.now() - stateTtlMs;
    for (const [key, value] of streamStatusByConversation) {
      if (!value || value.at < cutoff) streamStatusByConversation.delete(key);
    }
    for (const [key, value] of resumeByConversation) {
      if (!value || value.at < cutoff) resumeByConversation.delete(key);
    }
    for (const [key, value] of completionByConversation) {
      if (!value?.at || value.at < cutoff) completionByConversation.delete(key);
    }
    for (const [key, value] of detailSuccessByConversation) {
      if (!value?.at || value.at < cutoff) detailSuccessByConversation.delete(key);
    }
  };

  const requestInfo = (input, init) => {
    try {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      const url = new URL(request.url, location.href);
      return { request, url, method: request.method.toUpperCase() };
    } catch {
      return null;
    }
  };

  const streamStatusConversationId = url => {
    if (url.origin !== location.origin) return null;
    const match = url.pathname.match(
      /^\/backend-api\/conversation\/([^/?]+)\/stream_status$/
    );
    return match ? decodeURIComponent(match[1]) : null;
  };

  const conversationDetailConversationId = info => {
    if (!info || info.url.origin !== location.origin || info.method !== "GET") {
      return null;
    }
    let match = info.url.pathname.match(
      /^\/backend-api\/conversations\/([^/?]+)$/
    );
    if (!match) {
      match = info.url.pathname.match(
        /^\/backend-api\/conversation\/([^/?]+)$/
      );
    }
    return match ? decodeURIComponent(match[1]) : null;
  };

  const isResumeRequest = info =>
    info &&
    info.url.origin === location.origin &&
    info.method === "POST" &&
    info.url.pathname === "/backend-api/f/conversation/resume";

  const resumeRequestMetadata = async request => {
    if (!request) return null;
    try {
      const body = JSON.parse(await request.text());
      const conversationId =
        typeof body?.conversation_id === "string" && body.conversation_id
          ? body.conversation_id
          : null;
      if (!conversationId || !body || typeof body !== "object") return null;
      const offset = Number.isInteger(body.offset) && body.offset >= 0
        ? body.offset
        : 0;
      return { conversationId, body, offset };
    } catch {
      metrics.parseErrors++;
      return null;
    }
  };

  const rememberStreamStatus = async (response, conversationId) => {
    if (!response || !conversationId || !response.ok) return;
    try {
      const payload = await response.json();
      const status = typeof payload?.status === "string"
        ? payload.status.slice(0, 64)
        : "unknown";
      const at = Date.now();
      streamStatusByConversation.set(conversationId, { status, at });
      metrics.streamStatusObserved++;
      if (status === "IS_STREAMING") metrics.streamingObserved++;
      emit("stream-status-observed", { status });
      cleanState();
    } catch {
      metrics.parseErrors++;
      emit("stream-status-parse-error");
    }
  };

  const createTracker = () => ({
    buffer: "",
    currentMessage: null,
    messageStreamComplete: false,
    done: false,
    handoff: false,
    resumeTokenSeen: false,
    finalAssistant: false,
    errorCode: null,
    lastPath: "",
    lastOp: ""
  });

  const inspectCurrentMessage = tracker => {
    const message = tracker.currentMessage;
    if (!message || message.role !== "assistant") return;
    if (
      message.channel === "final" &&
      message.status === "finished_successfully" &&
      message.endTurn === true
    ) {
      tracker.finalAssistant = true;
    }
  };

  const inspectMessage = (tracker, message) => {
    if (!message || typeof message !== "object") return;
    tracker.currentMessage = {
      role: message?.author?.role ?? null,
      channel: message?.channel ?? null,
      status: message?.status ?? null,
      endTurn: message?.end_turn === true
    };
    inspectCurrentMessage(tracker);
  };

  const updateCurrentFromPatch = (tracker, path, value) => {
    if (!tracker.currentMessage || typeof path !== "string") return;
    if (/(^|\/)message\/channel$/.test(path)) {
      tracker.currentMessage.channel = value;
    } else if (/(^|\/)message\/status$/.test(path)) {
      tracker.currentMessage.status = value;
    } else if (/(^|\/)message\/end_turn$/.test(path)) {
      tracker.currentMessage.endTurn = value === true;
    }
    inspectCurrentMessage(tracker);
  };

  const visitEvent = (tracker, event) => {
    if (!event || typeof event !== "object") return;
    if (Array.isArray(event)) {
      for (const item of event) visitEvent(tracker, item);
      return;
    }

    if (event.type === "resume_conversation_token") {
      tracker.resumeTokenSeen = true;
    }
    if (event.type === "stream_handoff") tracker.handoff = true;
    if (event.type === "message_stream_complete") {
      tracker.messageStreamComplete = true;
      if (event.message) inspectMessage(tracker, event.message);
    }
    if (typeof event.error_code === "string") {
      tracker.errorCode = event.error_code.slice(0, 80);
    }
    if (event.message) inspectMessage(tracker, event.message);
    if (!Object.prototype.hasOwnProperty.call(event, "v")) return;

    const hasPath = Object.prototype.hasOwnProperty.call(event, "p");
    const hasOp = Object.prototype.hasOwnProperty.call(event, "o");
    const path = hasPath ? String(event.p ?? "") : tracker.lastPath;
    const op = hasOp ? String(event.o ?? "") : tracker.lastOp;
    if (hasPath) tracker.lastPath = path;
    if (hasOp) tracker.lastOp = op;

    const value = event.v;
    if (Array.isArray(value)) {
      for (const item of value) visitEvent(tracker, item);
      return;
    }
    if (path === "" && value && typeof value === "object") {
      if (value.message) inspectMessage(tracker, value.message);
      return;
    }
    updateCurrentFromPatch(tracker, path, value);
  };

  const consumeSseBlock = (tracker, block) => {
    const lines = block.split("\n");
    const data = lines
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;
    if (data === "[DONE]") {
      tracker.done = true;
      return;
    }
    try {
      visitEvent(tracker, JSON.parse(data));
    } catch {
      metrics.parseErrors++;
    }
  };

  const feedSse = (tracker, text, final = false) => {
    tracker.buffer += text.replace(/\r\n/g, "\n");
    const blocks = tracker.buffer.split("\n\n");
    tracker.buffer = blocks.pop() ?? "";
    for (const block of blocks) consumeSseBlock(tracker, block);
    if (final && tracker.buffer.trim()) {
      consumeSseBlock(tracker, tracker.buffer);
      tracker.buffer = "";
    }
  };

  const recoveryEvidenceFromEvent = event => {
    const state = { evidence: false, errorCode: null };
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (typeof value.error_code === "string" && value.error_code) {
        state.errorCode = value.error_code.slice(0, 80);
      }
      if (
        value.type === "resume_conversation_token" ||
        value.type === "stream_handoff" ||
        value.type === "message_stream_complete" ||
        value.message ||
        Object.prototype.hasOwnProperty.call(value, "v")
      ) {
        state.evidence = true;
      }
      if (Array.isArray(value.v)) {
        for (const item of value.v) visit(item);
      } else if (value.v && typeof value.v === "object") {
        visit(value.v);
      }
    };
    visit(event);
    return state;
  };

  const validateRecoveryStream = async (response, signal) => {
    let clone;
    try { clone = response.clone(); }
    catch { return { ok: false, reason: "clone-failed" }; }
    if (!clone.body) return { ok: false, reason: "missing-body" };

    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytesRead = 0;
    let explicitError = null;
    const maxBytes = 128 * 1024;
    const maxWaitMs = 1500;
    const deadline = performance.now() + maxWaitMs;

    const inspectBlock = block => {
      const data = block.split("\n")
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") return false;
      try {
        const event = JSON.parse(data);
        const evidence = recoveryEvidenceFromEvent(event);
        if (evidence.errorCode) explicitError = evidence.errorCode;
        return evidence.evidence;
      } catch {
        return false;
      }
    };

    try {
      while (bytesRead <= maxBytes) {
        if (signal?.aborted) {
          throw signal.reason || new DOMException("Aborted", "AbortError");
        }
        const remaining = Math.max(0, deadline - performance.now());
        if (remaining <= 0) {
          metrics.recoveryValidationTimeouts++;
          return { ok: false, reason: "validation-timeout" };
        }
        const timeout = Symbol("timeout");
        const result = await Promise.race([
          reader.read(),
          sleep(remaining, signal).then(() => timeout)
        ]);
        if (result === timeout) {
          metrics.recoveryValidationTimeouts++;
          return { ok: false, reason: "validation-timeout" };
        }
        if (result.done) {
          if (buffer.trim()) {
            if (inspectBlock(buffer) && !explicitError) {
              return { ok: true, reason: "protocol-evidence" };
            }
          }
          return {
            ok: false,
            reason: explicitError ? "error-only-stream" : "empty-stream"
          };
        }

        bytesRead += result.value?.byteLength || 0;
        buffer += decoder.decode(result.value, { stream: true })
          .replace(/\r\n/g, "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const evidence = inspectBlock(block);
          if (evidence && !explicitError) {
            return { ok: true, reason: "protocol-evidence" };
          }
        }
      }
      return { ok: false, reason: "validation-byte-limit" };
    } finally {
      try { void reader.cancel(); } catch {}
    }
  };

  const consumeResumeStream = async (response, conversationId) => {
    const tracker = createTracker();
    if (!response?.body) return tracker;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feedSse(tracker, decoder.decode(value, { stream: true }), false);
      }
      feedSse(tracker, decoder.decode(), true);
    } catch {
      metrics.parseErrors++;
      emit("resume-stream-read-error");
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    if (tracker.finalAssistant) {
      metrics.resumeTerminalSuccess++;
      emit("resume-terminal-success", {
        messageStreamComplete: tracker.messageStreamComplete,
        done: tracker.done
      });
    }
    if (tracker.handoff || tracker.resumeTokenSeen) {
      metrics.resumeHandoffObserved++;
    }
    emit("resume-stream-summary", {
      finalAssistant: tracker.finalAssistant,
      messageStreamComplete: tracker.messageStreamComplete,
      done: tracker.done,
      handoff: tracker.handoff,
      resumeTokenSeen: tracker.resumeTokenSeen,
      errorCode: tracker.errorCode
    });
    if (conversationId) {
      resumeByConversation.set(conversationId, {
        at: Date.now(),
        status: response.status,
        terminal: tracker.finalAssistant
      });
    }
    cleanState();
    return tracker;
  };

  const observeResume = async (
    response,
    conversationIdPromise,
    completionSequenceAtStart = completionSequence
  ) => {
    metrics.resumeObserved++;
    const conversationId = await conversationIdPromise;
    const statusEntry = conversationId
      ? streamStatusByConversation.get(conversationId)
      : null;
    const statusAgeMs = statusEntry ? Date.now() - statusEntry.at : null;
    const streamingSeen = Boolean(
      statusEntry &&
      statusEntry.status === "IS_STREAMING" &&
      statusAgeMs >= 0 &&
      statusAgeMs <= stateTtlMs
    );

    if (response.status === 404) {
      metrics.resume404++;
      if (streamingSeen) metrics.resume404WhileStreaming++;
      const completionEntry = conversationId
        ? completionByConversation.get(conversationId)
        : null;
      const completedSinceRequest =
        Boolean(completionEntry?.seq > completionSequenceAtStart);
      if (completedSinceRequest) metrics.resume404AfterCompletion++;
      if (conversationId && !completedSinceRequest) {
        resumeByConversation.set(conversationId, {
          at: Date.now(),
          status: 404,
          terminal: false
        });
      }
      emit("resume-404", {
        streamingSeen,
        statusAgeMs,
        completedSinceRequest
      });
      cleanState();
      return;
    }

    if (!response.ok) {
      emit("resume-http-error", {
        status: response.status,
        streamingSeen,
        statusAgeMs
      });
      return;
    }
    await consumeResumeStream(response, conversationId);
  };

  const maybeRecoverResume404 = async (
    retryRequest,
    metadataPromise,
    completionSequenceAtStart = completionSequence,
    detailSequenceAtStart = detailSequence
  ) => {
    const candidateAt = Date.now();
    metrics.recoveryCandidates++;
    const metadata = await metadataPromise;
    if (!retryRequest || !metadata?.conversationId || !metadata?.body) {
      metrics.recoverySkippedUnsupported++;
      emit("resume-recovery-skipped", { reason: "unsupported-request" });
      return null;
    }

    const { conversationId, body, offset } = metadata;
    const statusEntry = streamStatusByConversation.get(conversationId);
    const statusAgeMs = statusEntry ? candidateAt - statusEntry.at : null;
    const streamingStatusSeen = Boolean(
      statusEntry &&
      statusEntry.status === "IS_STREAMING"
    );
    const streamingSeen = Boolean(
      streamingStatusSeen &&
      statusAgeMs >= 0 &&
      statusAgeMs <= recoveryStreamingEvidenceMaxAgeMs
    );
    if (!streamingSeen) {
      const staleStreaming = Boolean(
        streamingStatusSeen &&
        Number.isFinite(statusAgeMs) &&
        statusAgeMs > recoveryStreamingEvidenceMaxAgeMs
      );
      if (staleStreaming) metrics.recoverySkippedStaleStreaming++;
      else metrics.recoverySkippedNoStreaming++;
      emit("resume-recovery-skipped", {
        reason: staleStreaming
          ? "stale-streaming-evidence"
          : "no-recent-streaming",
        statusAgeMs
      });
      return null;
    }

    if (recoveryInFlight.has(conversationId)) {
      metrics.recoverySkippedConcurrent++;
      emit("resume-recovery-skipped", { reason: "concurrent" });
      return null;
    }

    const runRecovery = async () => {
      let naturalSignal = await waitForNaturalRecoverySignal(
        conversationId,
        completionSequenceAtStart,
        detailSequenceAtStart,
        recoveryGraceMs,
        retryRequest.signal
      );

      if (
        !naturalSignal &&
        (detailInFlightByConversation.get(conversationId) || 0) > 0
      ) {
        metrics.recoveryDetailWaits++;
        naturalSignal = await waitForNaturalRecoverySignal(
          conversationId,
          completionSequenceAtStart,
          detailSequenceAtStart,
          recoveryDetailExtensionMs,
          retryRequest.signal
        );
      }

      if (naturalSignal === "provider-complete") {
        metrics.recoverySuppressedByWebsocket++;
        emit("resume-recovery-suppressed", { reason: naturalSignal });
        return null;
      }

      if (naturalSignal === "stock-detail-success") {
        metrics.recoveryDetailSuccessObserved++;
        emit("resume-recovery-detail-observed", { outcome: "success" });
        const completedAfterDetail = await waitForConversationCompletion(
          conversationId,
          completionSequenceAtStart,
          recoveryPostDetailGraceMs,
          retryRequest.signal
        );
        if (completedAfterDetail) {
          metrics.recoverySuppressedByWebsocket++;
          emit("resume-recovery-suppressed", {
            reason: "provider-complete-after-detail"
          });
          return null;
        }
      } else if (naturalSignal === "stock-detail-failed") {
        metrics.recoveryDetailFailureObserved++;
        emit("resume-recovery-detail-observed", { outcome: "failed" });
      }

      const offsets = recoveryOffsetCandidates
        .filter(candidate => candidate !== offset)
        .slice(0, recoveryMaxAttempts);

      let attemptsMade = 0;
      for (const nextOffset of offsets) {
        if (retryRequest.signal?.aborted) {
          throw retryRequest.signal.reason ||
            new DOMException("Aborted", "AbortError");
        }

        attemptsMade++;
        await sleep(
          recoveryRetryDelayMs + Math.floor(Math.random() * 100),
          retryRequest.signal
        );

        let nextRequest;
        try {
          nextRequest = new Request(retryRequest, {
            body: JSON.stringify({ ...body, offset: nextOffset })
          });
        } catch {
          metrics.recoverySkippedUnsupported++;
          emit("resume-recovery-skipped", { reason: "request-rebuild-failed" });
          return null;
        }

        metrics.recoveryAttempts++;
        let retryResponse;
        try {
          retryResponse = await originalFetch(nextRequest);
        } catch (error) {
          if (retryRequest.signal?.aborted) throw error;
          emit("resume-recovery-network-error", {
            attempt: attemptsMade,
            aborted: false
          });
          return null;
        }

        emit("resume-recovery-attempt", {
          attempt: attemptsMade,
          offset: nextOffset,
          status: retryResponse.status
        });

        if (retryResponse.status === 404) continue;
        if (!retryResponse.ok) {
          emit("resume-recovery-stopped", {
            attempt: attemptsMade,
            status: retryResponse.status
          });
          return null;
        }

        const mimeType = retryResponse.headers.get("content-type") || "";
        if (!retryResponse.body || !mimeType.includes("text/event-stream")) {
          metrics.recoveryRejectedNonStream++;
          emit("resume-recovery-stopped", {
            attempt: attemptsMade,
            status: retryResponse.status,
            reason: "non-stream-response"
          });
          return null;
        }

        const validation = await validateRecoveryStream(
          retryResponse,
          retryRequest.signal
        );
        if (!validation.ok) {
          metrics.recoveryRejectedInvalidStream++;
          emit("resume-recovery-stopped", {
            attempt: attemptsMade,
            status: retryResponse.status,
            reason: validation.reason
          });
          return null;
        }

        let observationClone = null;
        try { observationClone = retryResponse.clone(); } catch {}
        if (observationClone) {
          void observeResume(
            observationClone,
            Promise.resolve(conversationId)
          );
        }

        metrics.recoverySuccess++;
        emit("resume-recovery-success", {
          attempt: attemptsMade,
          offset: nextOffset,
          status: retryResponse.status
        });
        return retryResponse;
      }

      metrics.recoveryExhausted++;
      emit("resume-recovery-exhausted", { attempts: attemptsMade });
      return null;
    };

    recoveryInFlight.add(conversationId);
    try {
      if (navigator.locks?.request) {
        if (retryRequest.signal?.aborted) {
          throw retryRequest.signal.reason ||
            new DOMException("Aborted", "AbortError");
        }
        return await navigator.locks.request(
          "chatgpt-resume-recovery:" + conversationId,
          { ifAvailable: true },
          async lock => {
            if (!lock) {
              metrics.recoverySkippedCrossTab++;
              emit("resume-recovery-skipped", { reason: "cross-tab" });
              return null;
            }
            if (retryRequest.signal?.aborted) {
              throw retryRequest.signal.reason ||
                new DOMException("Aborted", "AbortError");
            }
            return await runRecovery();
          }
        );
      }
      return await runRecovery();
    } catch (error) {
      if (retryRequest.signal?.aborted) {
        metrics.recoveryAborted++;
        emit("resume-recovery-aborted");
        throw error;
      }
      emit("resume-recovery-error");
      return null;
    } finally {
      recoveryInFlight.delete(conversationId);
    }
  };

  window.fetch = function(input, init) {
    const info = requestInfo(input, init);
    const statusConversationId = info
      ? streamStatusConversationId(info.url)
      : null;
    const detailConversationId = conversationDetailConversationId(info);
    const resume = isResumeRequest(info);

    if (detailConversationId) {
      beginDetailRequest(detailConversationId);
    }

    let retryRequest = null;
    let metadataPromise = Promise.resolve(null);
    if (resume && info?.request) {
      try {
        retryRequest = info.request.clone();
        metadataPromise = resumeRequestMetadata(info.request.clone());
      } catch {
        metrics.parseErrors++;
      }
    }
    const conversationIdPromise = metadataPromise.then(
      metadata => metadata?.conversationId || null
    );
    if (resume) {
      void metadataPromise.then(metadata => {
        if (!Number.isInteger(metadata?.offset)) return;
        const key = String(metadata.offset);
        metrics.stockResumeOffsets[key] =
          (metrics.stockResumeOffsets[key] || 0) + 1;
        emit("resume-request-observed", { offset: metadata.offset });
      });
    }
    const completionSequenceAtStart = resume ? completionSequence : 0;
    const detailSequenceAtStart = resume ? detailSequence : 0;

    let task;
    try {
      task = originalFetch(input, init);
    } catch (error) {
      if (detailConversationId) {
        finishDetailRequest(detailConversationId, false);
      }
      throw error;
    }
    if (!statusConversationId && !resume && !detailConversationId) return task;

    return task.then(async response => {
      if (detailConversationId) {
        finishDetailRequest(detailConversationId, response.ok);
      }

      let clone = null;
      try { clone = response.clone(); } catch {}
      if (statusConversationId && clone) {
        void rememberStreamStatus(clone, statusConversationId);
      }
      if (resume && clone) {
        void observeResume(
          clone,
          conversationIdPromise,
          completionSequenceAtStart
        );
      }
      if (resume && recoveryEnabled && response.status === 404) {
        const recovered = await maybeRecoverResume404(
          retryRequest,
          metadataPromise,
          completionSequenceAtStart,
          detailSequenceAtStart
        );
        if (recovered) return recovered;
      }
      return response;
    }, error => {
      if (detailConversationId) {
        finishDetailRequest(detailConversationId, false);
      }
      throw error;
    });
  };
  const inspectWsFrame = frame => {
    if (!frame || typeof frame !== "object") return;
    if (Array.isArray(frame)) {
      for (const item of frame) inspectWsFrame(item);
      return;
    }
    if (
      frame.type === "message" &&
      frame.topic_id === "conversations" &&
      frame?.payload?.type === "conversation-turn-complete"
    ) {
      metrics.websocketTurnComplete++;
      const conversationId = frame?.payload?.payload?.conversation_id;
      const prior = typeof conversationId === "string"
        ? resumeByConversation.get(conversationId)
        : null;
      const after404 = Boolean(
        prior &&
        prior.status === 404 &&
        Date.now() - prior.at <= stateTtlMs
      );
      if (after404) metrics.websocketAfterResume404++;
      if (typeof conversationId === "string") {
        signalConversationCompletion(conversationId);
      }
      emit("ws-conversation-turn-complete", { afterResume404: after404 });
      if (typeof conversationId === "string") resumeByConversation.delete(conversationId);
    }
    if (frame.type === "reply" && Array.isArray(frame?.reply?.catchups)) {
      for (const item of frame.reply.catchups) inspectWsFrame(item);
    }
  };

  if (typeof NativeWebSocket === "function") {
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        socket.addEventListener("message", event => {
          if (typeof event.data !== "string") return;
          try { inspectWsFrame(JSON.parse(event.data)); }
          catch {}
        });
        return socket;
      }
    });
  }

  window.__CGUARD_RESUME_RECOVERY_ENABLE__ = () => {
    recoveryEnabled = true;
    emit("resume-recovery-enabled");
    return true;
  };

  window.__CGUARD_RESUME_RECOVERY_DISABLE__ = () => {
    recoveryEnabled = false;
    emit("resume-recovery-disabled");
    return true;
  };

  window.__CGUARD_STREAM_STATUS__ = () => ({
    installed: true,
    recoveryEnabled,
    recoveryInFlight: recoveryInFlight.size,
    trackedStreamStatuses: streamStatusByConversation.size,
    trackedResumes: resumeByConversation.size,
    completionWaiterConversations: completionWaiters.size,
    detailInFlightConversations: detailInFlightByConversation.size,
    trackedDetailSuccesses: detailSuccessByConversation.size,
    detailOutcomeWaiterConversations: detailOutcomeWaiters.size,
    metrics: { ...metrics }
  });

  emit("stream-observer-installed", { recoveryEnabled });
})();
