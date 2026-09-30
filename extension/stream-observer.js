// ChatGPT Stream Resume Lab — passive observer
// Observes stock ChatGPT lifecycle traffic. It never creates recovery requests.
(() => {
  if (window.__CGUARD_STREAM_OBSERVER_INSTALLED__) return;
  window.__CGUARD_STREAM_OBSERVER_INSTALLED__ = true;

  const originalFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const streamStatusByConversation = new Map();
  const resumeByConversation = new Map();
  const stateTtlMs = 2 * 60 * 1000;
  const metrics = {
    installedAt: new Date().toISOString(),
    streamStatusObserved: 0,
    streamingObserved: 0,
    resumeObserved: 0,
    resume404: 0,
    resume404WhileStreaming: 0,
    resumeTerminalSuccess: 0,
    websocketTurnComplete: 0,
    websocketAfterResume404: 0,
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

  const cleanState = () => {
    const cutoff = Date.now() - stateTtlMs;
    for (const [key, value] of streamStatusByConversation) {
      if (!value || value.at < cutoff) streamStatusByConversation.delete(key);
    }
    for (const [key, value] of resumeByConversation) {
      if (!value || value.at < cutoff) resumeByConversation.delete(key);
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

  const isResumeRequest = info =>
    info &&
    info.url.origin === location.origin &&
    info.method === "POST" &&
    info.url.pathname === "/backend-api/f/conversation/resume";

  const resumeConversationId = async request => {
    if (!request) return null;
    try {
      const body = JSON.parse(await request.text());
      return typeof body?.conversation_id === "string" && body.conversation_id
        ? body.conversation_id
        : null;
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

  const observeResume = async (response, conversationIdPromise) => {
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
      if (conversationId) {
        resumeByConversation.set(conversationId, {
          at: Date.now(),
          status: 404,
          terminal: false
        });
      }
      emit("resume-404", { streamingSeen, statusAgeMs });
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

  window.fetch = function(input, init) {
    const info = requestInfo(input, init);
    const statusConversationId = info
      ? streamStatusConversationId(info.url)
      : null;
    const resume = isResumeRequest(info);
    const resumeIdPromise = resume && info?.request
      ? resumeConversationId(info.request.clone())
      : Promise.resolve(null);

    const task = originalFetch(input, init);
    if (!statusConversationId && !resume) return task;

    return task.then(response => {
      let clone = null;
      try { clone = response.clone(); } catch {}
      if (statusConversationId && clone) {
        void rememberStreamStatus(clone, statusConversationId);
      }
      if (resume && clone) void observeResume(clone, resumeIdPromise);
      return response;
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

  window.__CGUARD_STREAM_STATUS__ = () => ({
    installed: true,
    trackedStreamStatuses: streamStatusByConversation.size,
    trackedResumes: resumeByConversation.size,
    metrics: { ...metrics }
  });

  emit("stream-observer-installed");
})();
