# Stream / Resume recovery lab

Status: the v0.9.0 release candidate keeps the passive observer and enables bounded active resume-404 recovery by default. The stable v0.8.4 429 policy remains unchanged inside the same extension.

The stable 429 Guard remains narrow. This lab studies a different failure class: an
existing ChatGPT turn is still running, the page reloads or loses its stream, and
ChatGPT attempts to continue through `/backend-api/f/conversation/resume`.

## Current release rule

The observer itself is passive: it never creates a new `stream_status` request and
does not poll the conversation API. Active recovery is eligible only after ChatGPT
itself has already generated a fresh `IS_STREAMING` status and a stock resume
request has returned 404. The recovery path replays that exact observed resume
request with bounded offset changes; it does not synthesize credentials or start a
new generation.

The observer watches only traffic ChatGPT itself already generated:

- `GET /backend-api/conversation/<id>/stream_status`
- `POST /backend-api/f/conversation/resume`
- resume SSE lifecycle records
- the global ChatGPT WebSocket `conversation-turn-complete` notification

This gives us evidence for an active recovery policy without increasing request
pressure while we are still learning the modern transport.

## Structured evidence

The observer treats these signals differently:

- `status: "IS_STREAMING"` means the provider still reports active work.
- HTTP 404 from stock `/resume` is recorded, including whether a recent
  `IS_STREAMING` for the same conversation was already observed.
- A successful resume stream is terminal-success only after a structured
  Assistant record reaches `channel:"final"`,
  `status:"finished_successfully"`, and `end_turn:true`.
- `message_stream_complete` and `[DONE]` are recorded separately; neither is
  used alone as proof that a final Assistant answer exists.
- Global WebSocket `conversation-turn-complete` is recorded and correlated
  with a recent resume 404 only in memory.

The parser handles complete snapshots plus v1 patch updates to message
`channel`, `status`, and `end_turn`.

## Privacy boundary

Conversation ids are needed transiently to correlate the stock signals above.
They stay in page memory and expire after two minutes.

The extension diagnostics persist only event classes and bounded booleans/status
values. They do **not** persist:

- conversation ids
- prompts or Assistant text
- response bodies
- cookies or authorization headers
- resume/conduit token values
- raw WebSocket payloads

The observer only records whether a resume token was seen, never the token itself.

## Regression coverage

The browser regression covers both the passive observer and the opt-in active lab:

1. stock `stream_status = IS_STREAMING`;
2. stock resume HTTP 404;
3. real RFC6455 `conversation-turn-complete`;
4. successful resume whose final Assistant state arrives through v1 patches;
5. `message_stream_complete` and `[DONE]`;
6. active 404 recovery from offset 0 to offset 1;
7. exact preservation of unrelated JSON body fields and request headers;
8. WebSocket completion suppressing an unnecessary retry;
9. no retry without recent stock `IS_STREAMING` evidence;
10. bounded exhaustion at offsets 0/1/2;
11. abort propagation during the grace window;
12. rejection of an HTTP 200 retry that is not an SSE response;
13. provider completion arriving before the stock 404 response, with no stale
    pending-404 state and no retry;
14. handoff-only SSE recovery, proving that a valid transport handoff is returned
    to ChatGPT without being misclassified as a final Assistant answer or leaking
    the resume token into diagnostics;
15. a completion from the previous turn in the same conversation does not suppress
    recovery of a newer turn; correlation uses a monotonic completion sequence
    instead of millisecond timestamps;
16. two simultaneous stock resume 404s in one page share one recovery owner:
    exactly one bounded 0→1→2 recovery sequence runs and the second caller does
    not start a duplicate retry storm;
17. two tabs share one recovery owner through Web Locks;
18. conversation-detail success is treated only as a short grace signal, not proof
    that the newest Assistant turn has hydrated;
19. stale `IS_STREAMING` evidence older than 30 seconds cannot trigger recovery;
20. HTTP 200 responses that are not SSE are rejected;
21. SSE responses containing only an error or only `[DONE]` are rejected before
    replacing the stock 404;
22. the extension-wide kill switch disables resume recovery as well as 429 handling.

## Active recovery

In v0.9.0 active recovery is enabled by default, but the extension-wide kill switch
disables it immediately. A stock resume 404 is eligible only when an
`IS_STREAMING` observation for the same conversation is no older than 30 seconds.
The recovery path then:

1. waits 1.2 seconds for a provider `conversation-turn-complete`;
2. if provider completion arrives, sends no retry;
3. otherwise rebuilds the exact observed stock Request, preserving its headers,
   credentials and unrelated JSON fields;
4. increments only the resume `offset`, with at most two additional attempts;
5. validates a successful `text/event-stream` clone before replacement and
   requires recognizable ChatGPT protocol evidence such as a message/delta,
   `resume_conversation_token`, `stream_handoff`, or
   `message_stream_complete`;
6. rejects non-SSE, error-only, empty/`[DONE]`-only, timed-out, or oversized
   validation candidates and returns the original stock 404;
7. propagates AbortSignal cancellation and stops on non-404 HTTP errors;
8. returns the original stock 404 if recovery is ineligible or exhausted.

No token, header value, conversation id, prompt, answer text or raw stream payload
is persisted by diagnostics.

## Upstream evidence

Exact projects and reviewed commit SHAs are recorded in
[`upstream-tech-audit.md`](upstream-tech-audit.md).
