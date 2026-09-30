# Stream / Resume recovery lab

Status: experimental branch `stream-resume-lab`.

The stable 429 Guard remains narrow. This lab studies a different failure class: an
existing ChatGPT turn is still running, the page reloads or loses its stream, and
ChatGPT attempts to continue through `/backend-api/f/conversation/resume`.

## Current lab rule

The first stage is **passive only**. It does not create `stream_status` requests,
does not create `/resume` requests, and does not poll the conversation API.

It observes only traffic ChatGPT itself already generated:

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

The local browser regression now simulates:

1. a stock `stream_status` response with `IS_STREAMING`;
2. a stock resume that returns HTTP 404;
3. a real RFC6455 WebSocket frame carrying
   `conversation-turn-complete` for that same conversation;
4. a second resume whose final Assistant state arrives through v1 patches;
5. `message_stream_complete` and `[DONE]`.

Expected result: the observer recognizes the 404-while-streaming shape, correlates
the later WebSocket completion, recognizes the patched final Assistant, and emits
no parser errors.

## Candidate active recovery (not enabled yet)

The next experimental stage can be gated on strong evidence:

1. Stock resume returns 404.
2. A fresh stock `IS_STREAMING` was observed for the same conversation.
3. No matching `conversation-turn-complete` arrives during a short grace window.
4. The original stock resume request can be cloned without exposing or persisting
   its token/credentials.
5. Retry count is strictly bounded and abort/navigation aware.

Public implementations show two useful recovery patterns: retrying resume with
small offsets (for example 0/1/2), and waiting for the provider WebSocket terminal
before deciding that a 404 represents a failed continuation.

Neither strategy is enabled until the passive observer has enough live evidence
from real ChatGPT failures.

## Upstream evidence

Exact projects and reviewed commit SHAs are recorded in
[`upstream-tech-audit.md`](upstream-tech-audit.md).
