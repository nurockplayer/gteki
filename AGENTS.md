# AGENTS.md

Rules for Codex and other worker agents in this repo. Your brief comes first. Where it says nothing, follow these rules.

1. Start from the project map. Read `docs/map/INDEX.md`, then only the note for your area. To find a symbol, run `grep <name> docs/map/symbols.tsv`; don't search the whole repo (`grep -rn`, `find .`).
2. Change only what the brief asks for. No extra refactors, hardening, abstractions or tests. List any other ideas under "Follow-ups" in your report.
3. Run tests through `orb-test` (an OrbStack container per run), using the exact command in the brief. Don't run test suites directly on the host. If your sandbox can't start orb-test, say so in your report.
4. Every time you write down (reports, commits, PR bodies, logs) carries its zone, for example `2026-10-27 04:10 JST`. Containers and CI run in UTC, so convert or label their timestamps.
5. Work only in the worktree the brief gives you. Never `git checkout`, `git switch` or `git stash` in the shared clone at the repo root; other sessions are using it.
6. Don't open large or generated files (station JSON under `stations/*/gteki/`, `docs/map/symbols.tsv`, images, logs over a few hundred lines). Use `jq`, `grep` or `sed -n` ranges instead.
