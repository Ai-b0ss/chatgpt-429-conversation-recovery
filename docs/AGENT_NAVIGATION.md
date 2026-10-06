# ChatGPT 429 conversation recovery — agent navigation map

## Runtime map
| Concern | Start here | Follow next |
|---|---|---|
| 429 interception/retry policy | `extension/guard.js` | bridge/control integration + regression tests |
| Page/extension bridge | `extension/bridge.js` | guard hooks and message flow |
| Background coordination | `extension/background.js` | control/storage/tab behavior |
| User controls/state | `extension/control.js` | popup and guard configuration |
| Stream observation/recovery | `extension/stream-observer.js` | resume-specific branches/tests |
| Popup diagnostics | `extension/popup.js` + `popup.html` | control/background message APIs |
| Manifest/permissions | `extension/manifest.json` | entry scripts and host permissions |
| Regression suite | `tests/run-regression.js` | synthetic server fixtures |
| Long recovery gate | `tests/run-long-recovery.js` | elapsed-time/backoff expectations |
| Design rationale | `docs/429-recovery-design.md` | upstream audit + changelog |

## Trace a 429 end-to-end
Identify the request surface and method first. Then trace interception → dedup/rate key → Retry-After/cooldown/backoff → terminal or recovered response → diagnostic event → UI behavior. Verify whether the surface is actively protected or observation-only.

## Branch distinctions
`.agent/branch-index.json` records all 8 heads. `429-only` is intentionally narrow; resume/stream branches add different recovery layers. Compare exact files instead of assuming one branch subsumes another.

## Line-level navigation
Run `python tools/build_agent_index.py` after checkout. Use generated symbol lines to inspect bounded windows plus callers/tests. Regenerate after switching branches because line numbers differ.
