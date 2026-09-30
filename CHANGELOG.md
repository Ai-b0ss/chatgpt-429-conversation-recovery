# Changelog

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
