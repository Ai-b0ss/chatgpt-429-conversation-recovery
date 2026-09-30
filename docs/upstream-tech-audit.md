# Upstream technology audit

Date: 2026-09-30

This document records public projects reviewed while hardening ChatGPT 429 Guard. The goal is to reuse proven ideas without silently copying incompatible or unlicensed source.

## Sources reviewed

| Project | Commit reviewed | License status | Useful ideas | Decision |
|---|---|---|---|---|
| [NASIRCISSISTIC/chatgpt-triage](https://github.com/NASIRCISSISTIC/chatgpt-triage) | `c9350c9097703075e7d36e346bb6d32bd55c41f9` | MIT | global pacing/cooldown, honoring `Retry-After`, fallback cooldown ladder, recovery after interrupted work | Design reference. v0.8.2 independently implements conversation-family cooldown and longer server-directed waits. |
| [ch040602/chatgpt-tool-suite-chrome-extension](https://github.com/ch040602/chatgpt-tool-suite-chrome-extension) | `9039ecadf5a7cd90ecabded606eae8e8c9901133` | MIT | MAIN-world fetch interception, fail-open behavior, bounded local state, safety-lock ideas, long-chat response trimming | Keep separate from 429-only. Useful reference for a future long-chat/recovery module. |
| [blankTwo/chatgpt-lag-fixer](https://github.com/blankTwo/chatgpt-lag-fixer) | `583784a153ebb6cf35de9da46bf7bd88dad1c534` | MIT | support for legacy/current conversation response shapes, response-level trimming, memory-leak tests | Future long-chat branch candidate; no trimming code is included in the 429 build. |
| [walter-la/chatgpt-Long-conversation-optimization](https://github.com/walter-la/chatgpt-Long-conversation-optimization) | `d3b64935d61744de2863880e60c183e3d2d2c9f4` | MIT | search/export/timeline UX for long conversations | Product/UI reference only; unrelated to 429 core. |
| [Junyi-99/chatgpt-bulk-delete-export](https://github.com/Junyi-99/chatgpt-bulk-delete-export) | `96710f1c6d38920fde7141ff1fbff4198943194b` | **No repository license detected** | bounded retry decisions, `Retry-After`, bounded worker pools, token refresh | Behavioral study only. Do not copy source code unless the author publishes a compatible license. |
| [manxisuo/ChatGPTLongConversationToolkit](https://github.com/manxisuo/ChatGPTLongConversationToolkit) | `bb8844c04a0f7bc29e36e652d13d80e0c965e5d1` | **No repository license detected** | navigator/search/bookmark UX | Feature research only; no source copied. |

## What v0.8.2 adopted

Two hardening changes were selected because they directly address conversation-read 429 storms without expanding extension scope:

1. **Conversation-family cooldown.** A 429 on one protected conversation read now creates a shared cooldown for other protected conversation reads. Exact-request deduplication remains request-specific; only the rate-limit cooldown is shared.
2. **Longer server-directed waits.** `Retry-After` accepts both delta-seconds and HTTP-date values. A positive server value receives a small grace buffer and is honored up to one hour.

The implementation in ChatGPT 429 Guard was written for this project rather than copied line-for-line from an upstream project.

## What was deliberately not adopted

- Bulk archive/delete/rename operations.
- Access-token extraction or storage.
- Conversation-content export.
- DOM hiding, response trimming or WASM history rewriting.
- Prompt automation/queueing.
- Automatic fallback to undocumented alternate endpoints.
- Any source from a repository without an explicit compatible license.

These belong in separate modules or branches if they are ever added. Keeping 429-only narrow makes failures easier to reason about and reduces the extension's permission and privacy surface.

## Testing added

v0.8.2 adds a synthetic regression where conversation A receives 429 while conversation B is requested shortly afterward. The server records verify that B is delayed by the shared cooldown rather than immediately adding another conversation read.

The regression suite also verifies a `Retry-After` value longer than the local first-step backoff, so the server directive—not merely the local timer—controls the wait.
