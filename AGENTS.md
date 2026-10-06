# AGENTS.md — ChatGPT Conversation Availability Guard

## Mandatory orientation
1. Pin branch/head in `.agent/branch-index.json`.
2. Read `README.md`, `docs/429-recovery-design.md`, then `docs/AGENT_NAVIGATION.md`.
3. Use `.agent/file-index.json` to locate runtime versus regression code.
4. On checkout run `python tools/build_agent_index.py` for exact line counts and symbol starts.
5. Run the relevant regression suite before and after behavior changes.

`main` is the current stable/integration state. Other branches are focused historical experiments or maintenance lines. Do not mix `429-only`, resume-404 and stream-resume behavior without comparing the branch diff.

## Non-negotiable behavior boundary
Do not turn the extension into a rate-limit bypass. Automatic replay remains limited to requests proven safe/idempotent by the project. Do not replay POST actions merely because a 429 occurred. Preserve privacy filtering of diagnostics and bounded retry/cooldown behavior.
