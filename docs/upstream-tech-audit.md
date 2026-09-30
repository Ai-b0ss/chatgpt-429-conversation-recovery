# Upstream technology audit

Date: 2026-09-30

This document records public projects reviewed while hardening ChatGPT Stream Recovery. License/provenance is recorded for attribution, while technical relevance is evaluated independently: useful mechanisms are still studied, tested and reimplemented or adapted when they improve the project.

## Sources reviewed

| Project | Commit reviewed | License status | Useful ideas | Decision |
|---|---|---|---|---|
| [NASIRCISSISTIC/chatgpt-triage](https://github.com/NASIRCISSISTIC/chatgpt-triage) | `c9350c9097703075e7d36e346bb6d32bd55c41f9` | MIT | global pacing/cooldown, honoring `Retry-After`, fallback cooldown ladder, recovery after interrupted work | Design reference. v0.8.2 independently implements conversation-family cooldown and longer server-directed waits. |
| [ch040602/chatgpt-tool-suite-chrome-extension](https://github.com/ch040602/chatgpt-tool-suite-chrome-extension) | `9039ecadf5a7cd90ecabded606eae8e8c9901133` | MIT | MAIN-world fetch interception, fail-open behavior, bounded local state, safety-lock ideas, long-chat response trimming | Keep separate from 429-only. Useful reference for a future long-chat/recovery module. |
| [blankTwo/chatgpt-lag-fixer](https://github.com/blankTwo/chatgpt-lag-fixer) | `583784a153ebb6cf35de9da46bf7bd88dad1c534` | MIT | support for legacy/current conversation response shapes, response-level trimming, memory-leak tests | Future long-chat branch candidate; no trimming code is included in the 429 build. |
| [walter-la/chatgpt-Long-conversation-optimization](https://github.com/walter-la/chatgpt-Long-conversation-optimization) | `d3b64935d61744de2863880e60c183e3d2d2c9f4` | MIT | search/export/timeline UX for long conversations | Product/UI reference only; unrelated to 429 core. |
| [Junyi-99/chatgpt-bulk-delete-export](https://github.com/Junyi-99/chatgpt-bulk-delete-export) | `96710f1c6d38920fde7141ff1fbff4198943194b` | No repository license detected | bounded retry decisions, `Retry-After`, bounded worker pools, token refresh | Behavior and code structure studied; provenance remains recorded if any implementation is adapted. |
| [manxisuo/ChatGPTLongConversationToolkit](https://github.com/manxisuo/ChatGPTLongConversationToolkit) | `bb8844c04a0f7bc29e36e652d13d80e0c965e5d1` | No repository license detected | navigator/search/bookmark UX | Feature research for a future long-chat module. |
| [canxin121/chatgpt-web-performance-fix](https://github.com/canxin121/chatgpt-web-performance-fix) | `c4b12ddd87220ab8d2a14001da46aba5e773f5c7` | MIT | exact resume classification, avoiding extra polling, rate-limit snapshot behavior, modern conversation transport awareness | Direct input to the passive stream/resume lab design. |
| [Ma-XX-oN/DownloadConversation](https://github.com/Ma-XX-oN/DownloadConversation) | `eca5d770d547514bcd78a9b975087582e99edc8f` | No repository license detected | `stream_status`, resume SSE, v1 patch terminal parsing, WebSocket `conversation-turn-complete`, captured 429-storm tests | Major protocol/evidence reference for the stream/resume lab. |
| [ai-integr8tor/diegosouzapw-OmniRoute](https://github.com/ai-integr8tor/diegosouzapw-OmniRoute) | `cc783eeaa2c2917b7f56c714a752d5defa400d46` | MIT | resume handoff, offsets 0/1/2, retrying resume 404, streamed final-answer recovery | Candidate active-recovery reference; not yet enabled in stable code. |
| [superbasedapp/observer](https://github.com/superbasedapp/observer) | `0a747ec26df1140d015ee060d344899ae7d86c01` | Repository reports NOASSERTION | sticky v1 patch parsing, two-leg SSE/WebSocket correlation, answer-scoped completion | Parser robustness reference for stream/resume work. |
| [ratacat/pro-cli](https://github.com/ratacat/pro-cli) | `94dd8c3249652f15fe11a2108ccceabb44aa5abf` | No repository license detected | documented live ChatGPT web transport, resume token/handoff metadata and SSE shapes; explicit resume offsets 0/1/2 | Confirms the bounded offset-retry strategy and conduit-header requirements. |
| [ratacat/omp-chatgpt-pro](https://github.com/ratacat/omp-chatgpt-pro) | `698045728af7c407d7ac29299b9b7b93b30e822e` | No repository license detected | browser-side ChatGPT Pro wire transport; offsets 0/1/2 with credentials/referrer/header preservation | Independent confirmation of the resume strategy. |
| [PamelaSprin47685ghall/SlimGPT](https://github.com/PamelaSprin47685ghall/SlimGPT) | `11cbb34937a42a5397546706f6fdde0989d4dcf0` | No repository license detected | exact Request snapshot/replay, AbortController ownership, SSE reconnect, 15-second reconnect-storm window | Strong reference for replaying the observed request instead of reconstructing auth/session state. |
| [Liu-Bot24/chatgpt-route-inspector](https://github.com/Liu-Bot24/chatgpt-route-inspector) | `05d8d5ab0a263690651a5982ab6cc43aebbd2615` | No repository license detected | current stream-handoff/WebSocket route capture and secret-redaction tests | Confirms that handoff-only SSE must not be mistaken for a missing answer. |
| [pranitnale/AI_Footprint_Tracker](https://github.com/pranitnale/AI_Footprint_Tracker) | `15515fdb70b196c04d72e48494d8a9bc8090a6eb` | MIT | September 2026 live-browser audit where initial SSE hands off to an already-open WebSocket | Fresh evidence that active recovery must remain transport-aware. |
| [xcanwin/KeepChatGPT](https://github.com/xcanwin/KeepChatGPT) | `bdc253cb96bdf7f4741d9bf87c4c6532967ffdb3` | GPL-2.0 | historical network-error recovery, keepalive, fetch interception | Historical reference only; its active keepalive strategy is not suitable for the current 429 goal. |

## What v0.8.2 adopted

Two hardening changes were selected because they directly address conversation-read 429 storms without expanding extension scope:

1. **Conversation-family cooldown.** A 429 on one protected conversation read now creates a shared cooldown for other protected conversation reads. Exact-request deduplication remains request-specific; only the rate-limit cooldown is shared.
2. **Longer server-directed waits.** `Retry-After` accepts both delta-seconds and HTTP-date values. A positive server value receives a small grace buffer and is honored up to one hour.

The implementation in ChatGPT 429 Guard was written for this project rather than copied line-for-line from an upstream project.

## What v0.8.3 adopted

The local 429 backoff now receives proportional positive jitter (up to 20%). This keeps `Retry-After` as the hard lower bound while reducing synchronized wakeups after a shared cooldown. The stronger jitter direction was reinforced by the shared-queue/backoff patterns found during the broader audit.

## Stream / resume lab

The experimental `stream-resume-lab` branch passively observes stock `stream_status`, `/f/conversation/resume` SSE and the ChatGPT WebSocket lifecycle. The follow-on `resume-404-recovery-lab` adds an explicit opt-in, default-off recovery path gated on recent stock `IS_STREAMING`, a WebSocket grace window, exact Request replay and at most two additional offsets. Neither lab is part of the stable 429 build. Diagnostics persist no conversation ids, prompt text, Assistant text, cookies, authorization headers, resume tokens or raw WebSocket payloads.

## What was deliberately not adopted

- Bulk archive/delete/rename operations.
- Access-token extraction or storage.
- Conversation-content export.
- DOM hiding, response trimming or WASM history rewriting.
- Prompt automation/queueing.
- Automatic fallback to undocumented alternate endpoints in the stable 429 build.
- Recovery logic that expands the current permission surface or persists credentials.

These belong in separate modules or branches if they are ever added. Keeping 429-only narrow makes failures easier to reason about and reduces the extension's permission and privacy surface.

## Testing added

v0.8.2 adds a synthetic regression where conversation A receives 429 while conversation B is requested shortly afterward. The server records verify that B is delayed by the shared cooldown rather than immediately adding another conversation read.

The regression suite also verifies a `Retry-After` value longer than the local first-step backoff, so the server directive—not merely the local timer—controls the wait.
