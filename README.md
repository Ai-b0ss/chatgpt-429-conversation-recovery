# ChatGPT Stream Recovery

Unofficial browser-side recovery tools for ChatGPT conversation and streaming failures.

Common search/UI wording for the problem includes **“This chat is unavailable”**, **“Chat unavailable”**, **“stream interrupted”**, **HTTP 429 / Too Many Requests**, and the Russian ChatGPT message **«Этот чат недоступен»**.

**Current stable variant:** **ChatGPT 429 Guard v0.8.4** — targets the 429-backed form of the “This chat is unavailable” / «Этот чат недоступен» failure. It coalesces duplicate conversation reads, performs short UI-safe rescue retries after transient HTTP 429 / “Too Many Requests”, and keeps explicit server `Retry-After` delays authoritative without letting one chat impose a long local cooldown on unrelated chats.

The same visible “chat unavailable” message can have other causes. If no 429 is present, this specific variant may not help; other recovery paths should remain separate until verified.

> This project does **not** bypass OpenAI rate limits. It only reduces unnecessary client-side retry traffic and respects server backoff.

## Why this exists

We captured a real ChatGPT failure where one conversation was fetched 34 times: 4 successful reads followed by 30 HTTP 429 responses. The failed reads were spaced about 5.3 seconds apart, matching a client recovery loop.

The 429 Guard sits in front of a small set of conversation-read requests. When a 429 appears, it coalesces duplicate reads, shares a conversation-family cooldown across protected chats/tabs, honors `Retry-After` (including long server-directed waits), and lets ChatGPT retry later with much less request pressure.

## What it protects

Traffic-changing protection is intentionally narrow:

- `GET /backend-api/conversations/{id}`
- `GET /backend-api/conversation/{id}`
- `GET /backend-api/conversations` (conversation list)

It does **not** modify message sending, uploads, model requests, or conversation POST writes.
## Measured behavior

| Scenario | Baseline client | 429 Guard |
|---|---:|---:|
| Server recovers after ~20 s | 5 network calls | 3 |
| Server recovers after ~90 s | 19 network calls | 5 |
| Persistent 429 storm | 30 calls before failure | 6 across the simulated window |
| `Retry-After: 120` | 21 calls | 2 |
| Five identical simultaneous reads | multiple callers | 2 network calls; all callers recover |

These are controlled recovery simulations, not a promise that every ChatGPT 429 has the same cause.

## Install

1. Download the latest ZIP from **Releases**.
2. Extract it somewhere permanent.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `extension` folder.
7. Reload open ChatGPT tabs.

Chrome must keep that folder in place while the unpacked extension is installed.

## Using it

Open ChatGPT, then click the extension icon. The popup shows whether protection is active, how many retries were delayed, successful recoveries, final 429s, and local diagnostic counters.

**Copy safe diagnostics** produces a small JSON report for bug reports. It excludes conversation text, cookies, response bodies, full request URLs and conversation IDs.
## Safety model

The extension is deliberately conservative:

- exact-request deduplication prevents the wrong response from being reused;
- the same conversation shares a rate-limit key across legacy/current read endpoints;
- Chrome Web Locks serialize competing reads across tabs;
- cooldown survives a page reload;
- a 429 on one protected conversation read slows other protected conversation reads during the same cooldown window;
- positive `Retry-After` values are honored as seconds or HTTP dates, with a one-hour safety cap;
- normal pre-response aborts do not create a false cooldown;
- every deduplicated caller receives its own cloned `Response`;
- a local kill switch can disable the guard immediately for future requests.

Passive telemetry can observe related ChatGPT network failures, but the 429 variant does not change those requests.

## Project branches

- `main` — project hub and current stable 429 release.
- `429-only` — deliberately narrow branch for HTTP 429 conversation-read recovery.
- Future recovery experiments can live in separate branches before anything is merged into the stable path.

This separation is intentional: a fix for one ChatGPT failure mode should not silently change unrelated traffic.

## Development

The extension has no runtime dependencies.

Maintainer regression tests use Playwright and a local synthetic server:

```bash
npm install
npx playwright install chromium
npm test
```

The suite covers concurrency, non-target passthrough, POST passthrough, aborts, `Request` objects, `Retry-After`, the kill switch, and two-tab coordination.
## Reporting a problem

Use the GitHub 429 bug-report template and include:

1. the exact ChatGPT error shown in the UI;
2. whether reloading the page changed anything;
3. the copied safe diagnostics from the extension popup;
4. Chrome/Edge version and OS;
5. whether disabling the extension changes the behavior.

Please do **not** post cookies, authorization headers, conversation contents, private conversation URLs, or account tokens.

## Scope

This is currently a Chromium Manifest V3 extension tested against `chatgpt.com`. ChatGPT is a moving target, so endpoint changes may require updates.

The project is unofficial and is not affiliated with or endorsed by OpenAI.

## License

MIT. See [LICENSE](LICENSE).

Upstream engineering references and license decisions are recorded in [docs/upstream-tech-audit.md](docs/upstream-tech-audit.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Russian quick start: [README.ru.md](README.ru.md).
