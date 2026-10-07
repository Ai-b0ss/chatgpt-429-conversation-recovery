<!-- PUBLIC_ACCOUNT_CONTEXT_V1 -->
## Public repository account context — mandatory

Before substantial work, read:

1. `docs/ACCOUNT_CONTEXT.md` — privacy-safe account-level boundary.
2. `docs/LINEAGE_CONTEXT.md` — privacy-safe idea/system history for this public surface.
3. `.agent/lineage-index.json` — machine-readable public lineage aliases, anchors and publication boundary.
4. `.agent/github-objects-index.json` — this public repository's PR/issue/workflow/tag archaeology.
5. `.agent/pr-ledger.json` — complete all-state PR history for this public repository only, including real base/head SHAs. Read it whenever prior, closed, superseded, or historical PR work could matter; do not infer or publish private account topology from it.
6. `.agent/tag-release-index.json` — exact public tag/release history for this repository, including terminal tag targets and release-asset digests. Read it whenever a version, release, baseline, historical archive, or published artifact may matter; do not infer or publish private account topology from it.

If authenticated owner-authorized tooling exposes related private repositories and the task requires account-wide archaeology, search them too — but never copy private names, metadata, code or evidence into this public repository unless explicitly authorized for publication.

---

<!-- AGENT_BOOTSTRAP_V2 -->
# READ THIS FIRST — mandatory repository bootstrap

For every substantial task in this repository, **before designing or editing**:

1. Read [docs/AGENT_OPERATING_SYSTEM.md](docs/AGENT_OPERATING_SYSTEM.md) — this is the all-work recovery and source-authority contract.
2. Read [docs/AGENT_NAVIGATION.md](docs/AGENT_NAVIGATION.md) — repository-specific architecture map.
3. Pin the exact branch and commit; do not reason from a branch name alone.
4. If prior/abandoned/forgotten work may exist, search branch tips **and full reachable Git history** with `tools/agent_history.py` before implementing a replacement.
5. For exact code locations on any ref, run `python tools/build_agent_index.py --ref "<branch-or-SHA>"`.
6. Never conclude "this was never implemented" from `main` alone.

The navigation files in `main` are deliberately external to old evidence branches so those historical heads remain immutable.

---

# AGENTS.md — ChatGPT Conversation Availability Guard

## Mandatory orientation
1. Pin branch/head in `.agent/branch-index.json`.
2. Read `README.md`, `docs/429-recovery-design.md`, then `docs/AGENT_NAVIGATION.md`.
3. Use `.agent/file-index.json` to locate runtime versus regression code.
4. On checkout run `python tools/build_agent_index.py --ref "<branch-or-SHA>"` for exact line counts and symbol starts.
5. Run the relevant regression suite before and after behavior changes.

`main` is the current stable/integration state. Other branches are focused historical experiments or maintenance lines. Do not mix `429-only`, resume-404 and stream-resume behavior without comparing the branch diff.

## Non-negotiable behavior boundary
Do not turn the extension into a rate-limit bypass. Automatic replay remains limited to requests proven safe/idempotent by the project. Do not replay POST actions merely because a 429 occurred. Preserve privacy filtering of diagnostics and bounded retry/cooldown behavior.