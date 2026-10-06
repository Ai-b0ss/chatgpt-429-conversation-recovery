# ChatGPT 429 / “This chat is unavailable” Conversation Recovery

> **Agent navigation:** start with [`AGENTS.md`](AGENTS.md), then [`docs/AGENT_NAVIGATION.md`](docs/AGENT_NAVIGATION.md). Branch names and non-main head snapshots are indexed in [`.agent/branch-index.json`](.agent/branch-index.json); `main` is resolved at read time. A bootstrap map of main-branch files/blobs is in [`.agent/file-index.json`](.agent/file-index.json). For any branch/SHA, run `python tools/build_agent_index.py --ref "<branch-or-SHA>"` to generate exact line counts and symbol locations.

**ChatGPT Conversation Availability Guard** is the browser extension behind this project.

Unofficial Chrome extension for recovering ChatGPT conversations that fail to load after HTTP 429 / Too Many Requests.

Search/error wording: **“This chat is unavailable”**, **“Unable to load this conversation”**, **“Failed to load conversation”**, **“Chat unavailable”**, **HTTP 429 / Too Many Requests**, **«Этот чат недоступен»**, and **«Не удалось загрузить этот разговор ChatGPT»**.

**Latest stable release:** ChatGPT Conversation Availability Guard v0.9.3.

v0.8.4 reduced duplicate conversation reads and recovered several deterministic transient-429 scenarios, but it did **not** prevent a real confirmed 429-backed recurrence after prolonged ordinary ChatGPT use. A local v0.9.0 build later added bounded lost-stream resume recovery without changing the v0.8.4 429 Guard itself. A 2026-10-05 production reproduction then identified the critical surface directly: GET conversation-detail returned real HTTP 429 responses with no Retry-After, while the server remained rate-limited for roughly 2.5 minutes. v0.9.3 therefore keeps that safe production GET pending in a bounded five-minute sparse-retry window instead of exposing the early 429 to React.

> This project does **not** bypass OpenAI rate limits or subscription limits. It only reduces unnecessary client-side retry pressure, respects server Retry-After, and tries to keep transient conversation-read failures from immediately degrading the UI.

## Why this exists

A captured failure showed one conversation being fetched 34 times: 4 successful reads followed by 30 HTTP 429 responses roughly 5.3 seconds apart. That looked like a client recovery loop adding pressure while the backend was already rate-limiting.

A later real-world recurrence showed that v0.8.4 was still incomplete: ChatGPT again reached “This chat is unavailable” after prolonged normal use with HTTP 429 involved. On 2026-10-05 the failure was reproduced against chatgpt.com: conversation-detail began returning 429, the old short budget emitted 429-final about six seconds later, and the backend did not recover until roughly 2.5 minutes after rate limiting began.

The current approach is conservative:

- actively protect only safe/idempotent conversation GET reads;
- deduplicate identical concurrent reads;
- coordinate cooldowns across tabs;
- honor Retry-After;
- keep production conversation-detail recovery bounded by a five-minute elapsed-time window with sparse backoff;
- observe related POST failures without replaying them;
- keep a small local, privacy-filtered event history so the next real failure identifies the request surface.

## What v0.9.3 actively protects

Traffic-changing protection is limited to safe GET requests:

- GET /backend-api/conversations/{id}
- GET /backend-api/conversation/{id}
- GET /backend-api/conversation/{id}/stream_status
- GET /backend-api/conversations

Active 429 protection for stream_status is new in v0.9.3. The local v0.9.0 stream-recovery layer could observe stream status for resume recovery, but the underlying 429 Guard still let a stream_status 429 pass through without retrying it.

Related POST surfaces such as:

- POST /backend-api/f/conversation/resume
- POST /backend-api/conversations/batch
- POST /backend-api/conversation/init

are observed for diagnostics but are **not** automatically replayed. Their idempotence has not been proven, and blindly retrying them could duplicate an action.

Message sending, uploads, model requests and unrelated ChatGPT traffic are not modified.

## Measured behavior

The local rows are deterministic recovery simulations. The final row records the live 2026-10-05 production reproduction; it is evidence for this failure mode, not a promise about every possible ChatGPT outage.

| Scenario | Result |
|---|---:|
| Five identical simultaneous reads | 2 network calls; all callers recover |
| stream_status: first response 429, second 200 | recovered with 2 network calls |
| Transient two-429 conversation-detail case | recovered within the UI test budget |
| Retry-After: 14 | second attempt waits for the server-directed delay |
| resume / batch / init POST 429 | one call only; observed, not replayed |
| Cross-tab same-conversation reads | serialized/deduplicated |
| Copied/stored diagnostics | no full URLs, conversation IDs, tab IDs or correlation hashes |
| Live chatgpt.com conversation-detail 429 | old budget failed in ~6s; server recovered after ~2.5 min; v0.9.3 window is 5 min |

## Install

For a published build:

1. Download the latest ZIP from Releases.
2. Extract it somewhere permanent.
3. Open chrome://extensions.
4. Enable Developer mode.
5. Click Load unpacked.
6. Select the extracted extension folder.
7. Reload open ChatGPT tabs.

Chrome must keep that folder in place while the unpacked extension is installed.

v0.9.3 is published and is the current stable build. The release passed both the standard regression suite and the production-origin long-429 recovery gate.

## Using it

Open ChatGPT and click the extension icon.

The popup shows:

- whether 429 protection is enabled;
- retries and recoveries;
- final 429 counts;
- passive 429 observations;
- recent 429 surfaces and whether they were actively protected or only observed.

**Copy safe diagnostics** exports the latest bounded event history and counters. Stored/exported diagnostics exclude conversation text, cookies, authorization data, request/response bodies, full request URLs, conversation IDs, tab IDs and correlation hashes.

If “This chat is unavailable” happens again, capture diagnostics as soon as possible. The most useful evidence is the sequence of surface + method + status + protection + timing, especially the last 429 before the UI failure.

## Safety model

The extension is deliberately conservative:

- exact-request deduplication prevents reuse of a response for a different URL;
- the same conversation shares a rate-limit key across current/legacy detail and stream-status reads;
- Chrome Web Locks serialize competing reads across tabs when available;
- cooldown survives a page reload;
- a 429 on one protected conversation read creates a short conversation-family anti-stampede cooldown;
- positive Retry-After values are honored as seconds or HTTP dates, with a one-hour cap;
- normal pre-response aborts do not create a false long cooldown;
- every deduplicated caller receives its own cloned Response;
- a local kill switch can disable future Guard intervention;
- POST actions are never automatically replayed without evidence that doing so is safe.

A terminal 429 can still escape to ChatGPT after the bounded retry budget. That is intentional: the Guard must not hide or defeat a genuine server-side limit indefinitely.

## Project branches

- main — project hub and latest published stable state.
- 429-only — deliberately narrow HTTP 429 recovery branch.
- maintenance/investigation branches — qualification before publication.

The repository is named **chatgpt-429-conversation-recovery** so people searching for the actual failure — ChatGPT 429, “This chat is unavailable”, or conversation recovery — can find it. The installed extension keeps the product name **ChatGPT Conversation Availability Guard**.

## Development

The extension has no runtime dependencies.

Maintainer regression tests use Playwright and a local synthetic server only. Run npm install, install the Playwright Chromium browser, then run npm test.

No regression test should make a live request to ChatGPT/OpenAI or use a real account session.

The current suites cover 429 concurrency/backoff, non-target and POST passthrough, aborts, Request objects, Retry-After, stream-status recovery, terminal 429 diagnostics, two-tab coordination, passive POST diagnostics, diagnostic privacy, and the bounded resume-404 recovery path inherited from the local v0.9.0 build.

## Reporting a problem

Issue #1 documents the confirmed 429-backed “This chat is unavailable” failure and the v0.9.3 fix.

A useful report includes:

1. the exact ChatGPT error shown in the UI;
2. whether the popup showed a final 429 or a passive 429 surface;
3. Copy safe diagnostics captured immediately after the failure;
4. Chrome/Edge version and OS;
5. whether reloading the chat recovered it.

Please do **not** post cookies, authorization headers, account tokens, private conversation URLs, conversation IDs, request/response bodies or conversation contents.

## Scope

This is currently a Chromium Manifest V3 extension tested against chatgpt.com. ChatGPT is a moving target, so endpoint changes may require updates.

The project is unofficial and is not affiliated with or endorsed by OpenAI.

## License

MIT. See LICENSE.

Upstream engineering references and license decisions are recorded in docs/upstream-tech-audit.md and THIRD_PARTY_NOTICES.md.

Russian quick start: README.ru.md.