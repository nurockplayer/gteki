# Proposal: two independent Opus 5.5 station sessions

Status: **PROPOSED, pending Owner selection.** No change to accepted M0 scope until this proposal is approved and its superseding acceptance language is merged.

## Goal

Replace the fixed 70% Ikebukuro / 30% Shinjuku staffing allocation with **two concurrent, independently accountable station lanes**. Both must demonstrate evidence-based progress in the 72-hour M0 timebox; deliverable depth follows real data readiness, not an artificial effort ratio.

## Three isolated write areas

| Lane | Lead | Exclusive station scope |
| --- | --- | --- |
| Ikebukuro | Opus 5.5 session A | `stations/ikebukuro/**`, station-specific research/scene/tests and field-survey gaps |
| Shinjuku | Opus 5.5 session B | `stations/shinjuku/**`, station-specific research/scene/tests and field-survey gaps |
| Shared core | GPT-6.1 Sol xHigh as preferred lead collaborator (availability must be verified) | `packages/**`, `apps/web/**`, shared 3D import contracts and integration tests |

Astra High is an **on-demand** architecture, reliability, rights and independent-review consultant, not a mandatory meeting or veto. Both Opus sessions make station-specific engineering decisions freely **inside the common contract**. Shared-interface changes go through one core maintainer and short PR review; no simultaneous writers to the same shared files. Either Opus can ask for a shared interface change.

Each station session should use a **separate Claude Code session, Git worktree and feature branch**, with its own station-specific handoff. Shared core runs in a distinct worktree/branch if staffed. Commit/PR as needed, keep `main` authoritative, and re-read live `main` after each merge. Avoid relying on chats or unmerged PRs for canonical facts.

Example worktrees (run inside a clean local `gteki` clone; branch names must be free):

```bash
git fetch origin
git worktree add -b feat/ikebukuro-m0 ../gteki-ikebukuro origin/main
git worktree add -b feat/shinjuku-m0 ../gteki-shinjuku origin/main
git worktree add -b feat/shared-core-m0 ../gteki-core origin/main
```

## Boundary conditions (non-negotiable)

- Search/route/POI data and coordinate transforms remain renderer-independent. Web is browser-first, Godot high-fidelity stays possible.
- The shared core is implemented **once**; neither station session forks its own navigation engine or directly edits shared application/package code without coordination.
- Facts, geometry, rights, and actual passenger connectivity are separately verified. All unknown passage/accessibility, gate, floor and vertical-edge conditions remain unknown and **unroutable**.
- License/re-distribution review before putting third-party data, maps, photos, models, GLBs, textures or POIs in the public GitHub/Web build.
- pnpm/Homebrew only; no npm/npx/yarn. No changes to other game repositories.
- Confirm actual model and effort when receiving Sol/Astra contributions; do not claim a model invocation occurred if unavailable.
- Independent human/real-browser or game-view verification required before announcing either station route as usable.

## M0 acceptance proposal

- **Ikebukuro**: inspect the 2025 PLATEAU single underground CityGML candidate, its coverage and coordinate metadata; attempt one evidence-backed walkable East-West web 3D slice, otherwise explicitly mark the missing topology and show a non-navigational prototype.
- **Shinjuku**: inspect the 2025 underground CityGML plus E27 partial indoor open network; independently attempt a compact searchable/walkable slice supported by evidence, otherwise ship auditable data/geometry/integration findings.
- **Shared core**: one buildable viewer/search/graph stack, tests on both station fixtures, clear licensing and freshness warnings; explicit Godot GLB + coordinate import feasibility.
- **Do not require equal geometry counts, equal playable scope, or two production-ready station routes**. Report each station's G0–G3 evidence and blockers separately.

## Minimal startup choreography

1. Shared core publishes a small versioned interface / coordinate contract early, informed by both Opus leads; avoid a sprawling up-front specification.
2. Start station G0 inspection in parallel immediately. Do not block non-deceptive scene scaffolding on third-party rights checks, but do block ingestion/public release of unlicensed assets and routing over unverified edges.
3. Each Opus independently chooses tasks and delegates technical work to available agents; no imposed task-by-task prompt.
4. Integration owns shared code and acceptance evidence; keep station PRs small and non-overlapping. Commit stage reports to the existing Issues and update the current handoff.

## Supersession if Owner adopts

Update `README.md`, `docs/product-vision.md`, `docs/acceptance.md`, `docs/HANDOFF.md`, relevant station Issues (#3/#5) and Notion brief to remove *prospective* fixed 70/30 staffing. Preserve the **historical 70/30 research report** as research provenance instead of silently rewriting its findings. Existing public-data G0/legal gates remain intact.
