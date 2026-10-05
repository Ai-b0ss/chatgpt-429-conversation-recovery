# ChatGPT Conversation Availability Guard

Unofficial browser-side resilience and diagnostics for ChatGPT conversations that become unavailable after HTTP 429 / Too Many Requests.

Common UI wording includes “This chat is unavailable”, “Chat unavailable”, and «Этот чат недоступен».

**Latest published release:** ChatGPT 429 Guard v0.8.4.
**Current development candidate:** Conversation Availability Guard v0.8.5.

v0.8.4 reduced duplicate conversation reads and recovered several deterministic transient-429 scenarios, but it did **not** prevent a real confirmed 429-backed recurrence after prolonged ordinary ChatGPT use. The exact request surface that triggered that real failure was not captured. v0.8.5 therefore expands safe GET coverage and diagnostics instead of claiming the problem is universally solved.

> This project does **not** bypass OpenAI rate limits or subscription limits. It only reduces unnecessary client-side retry pressure, respects server Retry-After, and tries to keep transient conversation-read failures from immediately degrading the UI.

## Why this exists

A captured failure showed one conversation being fetched 34 times: 4 successful reads followed by 30 HTTP 429 responses roughly 5.3 seconds apart. That looked like a client recovery loop adding pressure while the backend was already rate-limiting.

A later real-world recurrence showed that v0.8.4 was still incomplete: ChatGPT again reached “This chat is unavailable” after prolonged normal use with HTTP 429 involved. That means the old three-endpoint protection set was not sufficient evidence of a complete fix.

The current approach is conservative:

- actively protect only safe/idempotent conversation GET reads;
- deduplicate identical concurrent reads;
- coordinate cooldowns across tabs;
- honor Retry-After;
- stop internal retries after a bounded budget;
- observe related POST failures without replaying them;
- keep a small local, privacy-filtered event history so the next real failure identifies the request surface.

## What v0.8.5 actively protects

Traffic-changing protection is limited to safe GET requests:

- GET /backend-api/conversations/{id}
- GET /backend-api/conversation/{id}
- GET /backend-api/conversation/{id}/stream_status
- GET /backend-api/conversations

The stream_status route is new in v0.8.5. It was already visible to passive network telemetry in v0.8.4 but was not protected, so a 429 there could be observed without being delayed/retried by the Guard.

Related POST surfaces such as:

- POST /backend-api/f/conversation/resume
- POST /backend-api/conversations/batch
- POST /backend-api/conversation/init

are observed for diagnostics but are **not** automatically replayed. Their idempotence has not been proven, and blindly retrying them could duplicate an action.

Message sending, uploads, model requests and unrelated ChatGPT traffic are not modified.

## Measured behavior

These are deterministic local recovery simulations, not a promise about every production 429.

| Scenario | Result |
|---|---:|
| Five identical simultaneous reads | 2 network calls; all callers recover |
| stream_status: first response 429, second 200 | recovered with 2 network calls |
| Transient two-429 conversation-detail case | recovered within the UI test budget |
| Retry-After: 14 | second attempt waits for the server-directed delay |
| resume / batch / init POST 429 | one call only; observed, not replayed |
| Cross-tab same-conversation reads | serialized/deduplicated |
| Copied/stored diagnostics | no full URLs, conversation IDs, tab IDs or correlation hashes |

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

For the unreleased v0.8.5 development candidate, use the reviewed development branch only after its tests pass and it is intentionally published.

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

The GitHub repository is still named chatgpt-stream-recovery; the product-facing extension name is changing because the actual project scope is conversation availability rather than generic stream recovery.

## Development

The extension has no runtime dependencies.

Maintainer regression tests use Playwright and a local synthetic server only. Run npm install, install the Playwright Chromium browser, then run npm test.

No regression test should make a live request to ChatGPT/OpenAI or use a real account session.

The current suite covers concurrency, non-target passthrough, POST passthrough, aborts, Request objects, Retry-After, stream-status recovery, the kill switch, two-tab coordination, passive POST diagnostics and diagnostic privacy.

## Reporting a problem

Issue #1 remains the collection point for the confirmed 429-backed “This chat is unavailable” problem.

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
