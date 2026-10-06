# Repository inventory — chatgpt-429-conversation-recovery

ChatGPT conversation recovery extension with 429, resume and stream-recovery work.

This is a structural snapshot for orientation, not a substitute for exact-ref inspection. For current truth resolve `main` at read time; for another ref use the tools below.

## Canonical navigation

1. `AGENTS.md`
2. `docs/AGENT_OPERATING_SYSTEM.md`
3. `docs/AGENT_NAVIGATION.md`
4. `.agent/branch-index.json`
5. `.agent/file-index.json`

## Current main snapshot

Tracked blob files currently visible on `main`: **39**.
Known named branches in the committed branch catalog: **8**.

### Top-level areas by stored bytes

| Area | Files | Bytes |
|---|---:|---:|
| `extension` | 8 | 73,573 |
| `tests` | 3 | 30,103 |
| `tools` | 2 | 18,832 |
| `docs` | 4 | 18,347 |
| `.agent` | 3 | 9,719 |
| `README.md` | 1 | 9,572 |
| `CHANGELOG.md` | 1 | 7,068 |
| `README.ru.md` | 1 | 6,858 |
| `.github` | 5 | 2,800 |
| `SECURITY.md` | 1 | 2,054 |
| `AGENTS.md` | 1 | 1,960 |
| `package-lock.json` | 1 | 1,243 |
| `THIRD_PARTY_NOTICES.md` | 1 | 1,166 |
| `LICENSE` | 1 | 1,076 |
| `CONTRIBUTING.md` | 1 | 767 |
| `CLAUDE.md` | 1 | 703 |
| `.cursor` | 1 | 658 |
| `GEMINI.md` | 1 | 588 |
| `package.json` | 1 | 370 |
| `.gitignore` | 1 | 114 |

### File roles

| Role | Files |
|---|---:|
| `agent_tooling` | 12 |
| `extension_runtime` | 8 |
| `documentation` | 7 |
| `project_automation` | 4 |
| `project_file` | 3 |
| `regression_test` | 3 |
| `design_or_audit` | 2 |

### Largest tracked files

Large files are not automatically bad; this table tells an agent where blind full-file reading is likely wasteful.

| File | Bytes | Role |
|---|---:|---|
| `extension/stream-observer.js` | 35,862 | `extension_runtime` |
| `extension/guard.js` | 21,976 | `extension_runtime` |
| `tests/run-regression.js` | 20,153 | `regression_test` |
| `tools/agent_history.py` | 14,293 | `agent_tooling` |
| `docs/AGENT_OPERATING_SYSTEM.md` | 10,450 | `agent_tooling` |
| `README.md` | 9,572 | `documentation` |
| `CHANGELOG.md` | 7,068 | `documentation` |
| `README.ru.md` | 6,858 | `documentation` |
| `extension/background.js` | 6,477 | `extension_runtime` |
| `.agent/file-index.json` | 6,213 | `agent_tooling` |
| `tests/server.py` | 5,225 | `regression_test` |
| `extension/popup.js` | 5,174 | `extension_runtime` |
| `tests/run-long-recovery.js` | 4,725 | `regression_test` |
| `tools/build_agent_index.py` | 4,539 | `agent_tooling` |
| `docs/upstream-tech-audit.md` | 4,001 | `design_or_audit` |

## Branch families

Branch prefixes are navigational hints, not authority. Exact names and non-main head SHAs are in `.agent/branch-index.json`.

| Family | Branches |
|---|---:|
| `429-hardening-upstream` | 1 |
| `429-jitter-hardening` | 1 |
| `429-only` | 1 |
| `429-ui-timeout-fix` | 1 |
| `hermes` | 1 |
| `main` | 1 |
| `resume-404-recovery-v084` | 1 |
| `stream-resume-lab` | 1 |

## How to reach all work

Current branch tips:
```bash
python tools/agent_history.py branches
python tools/agent_history.py find-text "term"
python tools/agent_history.py find-path "**/name*"
```

Deleted/older committed work:
```bash
python tools/agent_history.py find-history-text "term"
python tools/agent_history.py find-history-path "**/name*"
```

Candidate branch context:
```bash
python tools/agent_history.py branch-info "<branch>"
```

Exact file/symbol/line index for any ref:
```bash
python tools/build_agent_index.py --ref "<branch-or-SHA>"
```

## Interpretation rule

Do not treat this inventory, a branch name, or a README statement as proof of runtime behavior. Trace the exact ref through code, tests, state/configuration and relevant evidence. When old work is found, determine why it diverged or disappeared before reusing it.
