# Changelog

## 0.9.1 — Unreleased

Conversation-availability hardening after a confirmed real 429-backed recurrence that v0.8.4 did not prevent. This candidate also imports the separately developed local v0.9.0 bounded lost-stream resume-recovery layer so GitHub source matches the actually installed feature set.

- Renames the product-facing extension from ChatGPT 429 Guard to ChatGPT Conversation Availability Guard while keeping the remote repository name unchanged.
- Imports stream-observer.js from the local v0.9.0 build without broadening its existing resume-404 recovery policy.
- Adds active protection for GET /backend-api/conversation/{id}/stream_status; the local v0.9.0 observer could inspect this surface but the underlying 429 Guard still passed its 429 responses through.
- Keeps resume, batch and init POST 429s diagnostic-only; automatic generic replay remains forbidden because idempotence is not proven. The separate stream-resume module only performs its narrowly validated resume-404 recovery flow.
- Stores a bounded, privacy-filtered event history with 429 and stream-recovery surface/status/timing fields.
- Removes tab IDs, correlation hashes, full URLs and conversation identifiers from stored/exported diagnostics.
- Expands Copy safe diagnostics from one last event to the recent bounded event sequence needed to classify the next real recurrence.
- Adds deterministic regression coverage for stream-status 429 recovery, terminal 429 escape diagnostics, passive POST 429s, diagnostic privacy, and the inherited resume-404 recovery path.
- Documents that v0.9.1 is a development candidate, not a universal cure, until another real recurrence identifies the production failure surface.

## 0.8.4 — 2026-09-30

Live 429/UI-timeout fix based on a real browser failure capture.

- Shortens the first inline conversation-detail retries to a UI-safe rescue window instead of holding ChatGPT's fetch promise for 12–60+ seconds.
- Caps soft preflight cooldown waits at 1.2 seconds, including shared conversation-family cooldowns, so one rate-limited chat cannot stall another chat long enough to trip the frontend error state.
- Keeps explicit server `Retry-After` as a hard per-conversation lower bound and persists it separately from local soft cooldowns.
- Stops propagating one conversation's hard `Retry-After` deadline to unrelated conversations.
- Uses bounded symmetric jitter around local backoff instead of positive-only jitter.
- Limits one conversation-detail UI request to three network attempts before returning the final 429, reducing both retry storms and frontend timeout exposure.
- Adds anonymized deterministic `rateHash` diagnostics so browser-level 429s can be correlated with Guard backoff events without storing conversation IDs.
- Adds regression coverage for a transient two-429 recovery under 9 seconds and a capped cross-conversation cooldown.

## 0.8.3 — 2026-09-30

Rate-limit de-synchronization hardening.

- Expands the small fixed retry jitter into proportional positive jitter (up to 20% of the local backoff).
- Keeps `Retry-After` as the hard lower bound, so randomization never retries earlier than the server-directed wait.
- Reduces the chance that several tabs/conversations wake at the same instant after a shared cooldown and create a fresh mini-storm.

## 0.8.2 — 2026-09-30

Upstream-informed 429 hardening.

- Adds a shared conversation-family cooldown after HTTP 429 so different protected chats/tabs do not immediately add more conversation-read pressure.
- Extends `Retry-After` handling to delta-seconds and HTTP-date values, with a one-hour cap and a small grace buffer.
- Makes cooldown writes monotonic so a later shorter cooldown cannot accidentally shorten an existing longer one.
- Adds regression coverage proving a second conversation is delayed by the shared cooldown.
- Strengthens the `Retry-After` regression so the server directive is longer than the local first-step backoff.
- Adds an upstream technology/license audit and third-party research notices.

## 0.8.1 — 2026-09-30

Security and discoverability hardening.

- Adds exact search wording for “This chat is unavailable” / «Этот чат недоступен».
- Narrows the background webRequest observer to `https://chatgpt.com/backend-api/*`.
- Pins GitHub Actions to full commit SHAs and keeps workflow permissions read-only.
- Disables persisted checkout credentials in CI.
- Adds Dependabot, CODEOWNERS, expanded security documentation and safer contribution guidance.
- Extends regression coverage to verify network-level 429 telemetry.

## 0.8.0 — 2026-09-30

First public 429-focused release.

- Keeps traffic-changing behavior limited to ChatGPT conversation reads.
- Removes the experimental plural-to-singular fallback from the public build.
- Preserves duplicate coalescing, adaptive 429 backoff, Retry-After support, cross-tab serialization, reload-persistent cooldowns, abort handling and kill switch.
- Adds a public English popup and safe diagnostic export.
- Adds a reproducible Playwright regression suite and GitHub Actions workflow.
- Adds English and Russian installation documentation.
