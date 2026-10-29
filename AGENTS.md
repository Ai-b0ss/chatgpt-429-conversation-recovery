# AGENTS.md

ChatGPT Conversation Availability Guard: a Chrome extension (`extension/`) that recovers ChatGPT conversations hit by 429 / "This chat is unavailable" errors. See `README.md` and `docs/429-recovery-design.md` for background.

## Branches
`main` is the stable/integration line. Other branches are focused experiments or maintenance lines. Do not mix `429-only`, resume-404 and stream-resume behavior without diffing the branches first; `429-only` is intentionally narrow.

## Non-negotiable behavior boundary
- Do not turn the extension into a rate-limit bypass.
- Automatic replay is limited to requests the project has proven safe and idempotent. Never replay POST actions just because a 429 occurred.
- Keep privacy filtering of diagnostics.
- Keep retry and cooldown behavior bounded.

## Architecture map
| File | Role |
|---|---|
| `extension/guard.js` | 429 interception, dedup/rate key, Retry-After/cooldown/backoff |
| `extension/bridge.js` | Page/extension bridge and message flow to the guard |
| `extension/background.js` | Background coordination, storage, tab behavior |
| `extension/control.js` | User controls and state; feeds popup and guard configuration |
| `extension/stream-observer.js` | Stream observation and resume recovery |
| `extension/popup.js`, `popup.html` | Popup UI and diagnostics (via control/background messages) |
| `extension/manifest.json` | Entry scripts, permissions, host permissions |
| `tests/run-regression.js` | Regression suite (synthetic server in `tests/server.py`) |
| `tests/run-long-recovery.js` | Long recovery gate: elapsed-time/backoff expectations |

To trace a 429, identify the request surface and method first, then follow: interception, dedup/rate key, Retry-After/cooldown/backoff, terminal or recovered response, diagnostic event, UI. Check whether the surface is actively protected or observation-only.

## Tests
Same as CI (`.github/workflows/regression.yml`; Node 22, Python 3.12):
```
npm ci --ignore-scripts
npx --no-install playwright install chromium
npm test
npm run test:long
```
Run them before and after behavior changes. On Linux CI they run under `xvfb-run -a`.
