# Changelog

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
