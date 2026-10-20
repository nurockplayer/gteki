# GTEki — Six-lane coordination Handoff

**Status:** Owner selected six core work lanes, 2026-10-20. This document is a work-allocation/contract Handoff, **not proof that any agents, tools, tests, or stations have started or passed**. Only accepted after its PR merges into `main`.

## Purpose

Keep two Opus 5.5 station directors advancing independently toward **source-backed, L2-quality playable station slices** and growing completeness, while four supporting lanes supply reusable systems and rigorous evidence. **Quality and completeness over timing; no 72-hour deadline or 70/30 split.** Preserve the long-term L3/Godot option. Avoid policies that force Opus to seek approval for ordinary implementation choices.

## Six exclusive write lanes

| Lane | Task / preferred lead | Primary write ownership | Station-facing output |
| --- | --- | --- | --- |
| A | [#3 Ikebukuro](https://github.com/nurockplayer/gteki/issues/3) — Opus 5.5 A | `stations/ikebukuro/**`, optional `docs/stations/ikebukuro/**` | Searchable, verified and polished Ikebukuro scenes, coverage/field gaps |
| B | [#5 Shinjuku](https://github.com/nurockplayer/gteki/issues/5) — Opus 5.5 B | `stations/shinjuku/**`, optional `docs/stations/shinjuku/**` | Searchable, verified and polished Shinjuku scenes, coverage/field gaps |
| C | [#2 Shared core](https://github.com/nurockplayer/gteki/issues/2) — Sol xHigh preferred | `packages/**`, `apps/web/**`, necessary root pnpm/workspace config, `docs/core/**` | One schema, navigation/search, Web integration, station switching |
| D | [#10 GIS](https://github.com/nurockplayer/gteki/issues/10) — Codex | `tools/gis/**`, `docs/gis/**` | Reproducible licensed source inspection, GIS/CRS/geometry proof, field gaps |
| E | [#11 Blender](https://github.com/nurockplayer/gteki/issues/11) — Codex | `tools/blender/**`, `assets/library/**` (licensed/reviewed only), `docs/assets/**` | Reusable modular GLB assets and generator, Web/Godot import proof |
| F | [#12 QA](https://github.com/nurockplayer/gteki/issues/12) — Codex, Astra High review if available | `tests/e2e/**`, `tools/qa/**`, `docs/qa/**`, `.github/workflows/**` | Actual gameplay evidence, desktop/mobile/visual checks, reproducible failures |

[#4 Web journey integration](https://github.com/nurockplayer/gteki/issues/4) is part of lane **C**, not a seventh lead. [#6 independent acceptance](https://github.com/nurockplayer/gteki/issues/6) is a joint **F + Owner release gate**, not a competing station owner. [#1 research](https://github.com/nurockplayer/gteki/issues/1) / ChatGPT is evidence support, not one of the six implementation lanes.

Paths in the table are **ownership boundaries, not rigid architecture mandates**: the leads can propose a better layout via a small reviewed interface/ownership change. Until agreed, avoid edits to another lane's files. No two workers should write the same physical file or branch concurrently.

## Minimal shared contract

The C lane is the sole writer of the shared station/level/POI/graph/coordinate/asset contract. A/B contribute real needs; D/E consume it and return source-identified outputs; F consumes exposed test hooks and reviews behavior. Start with the **smallest compatible, versioned interface**, not a sweeping design process. Station contents are owned by A or B; shared-core does not invent/rewrite station topology. Any required adjustment is communicated through an Issue/PR and merged only after relevant station owners review its compatibility.

- Stable station/level/POI/node/edge IDs, known-vs-unknown access attributes and dataset/provenance references.
- CRS -> local metric origin and axis/height semantics. `floor index` and assumed render height **never** imply surveyed elevation.
- The GLB model and navgraph are separate; a visible geometry mesh does **not** establish legal pedestrian connectivity.
- Synthetic test routes/assets may be used for early development only if unmistakably labeled synthetic/non-navigational.

## Practical coordination and worktrees

Each active lane should use **a separate Claude Code/Codex session, Git worktree and branch**; never have multiple processes edit one worktree. Launch C/D/GIS work and station evidence inspection promptly, but do not force station directors to stop exploring visual prototypes while legal source inspection proceeds. D/E/F do not wait to be assigned every subtask by Opus; they should select their own highest-leverage deliverables compatible with the above boundaries.

Suggested distinct worktree names (verify branch/path availability first; commands are examples, not automated setup):

```bash
git fetch origin
git worktree add -b feat/gteki-core ../gteki-core origin/main
git worktree add -b feat/gteki-gis ../gteki-gis origin/main
git worktree add -b feat/gteki-assets ../gteki-assets origin/main
git worktree add -b test/gteki-qa ../gteki-qa origin/main
```

Existing A/B worktrees or branches must be discovered, **not recreated or reset**. `main` is canonical after merge; don't force-push shared branches. Heavy Blender/GIS transformations should avoid competing for the same Mac GPU/RAM; serialize expensive render jobs where necessary while keeping coding/research concurrent.

## Priority handshake (not a clock-based schedule)

1. **Before execution**: each lane checks live `main`, open PRs, its Issue and worktree; do not discard existing uncommitted work. Confirm the actual model and effort level before attributing work.
2. **Minimal interface**: C and two Opus leads agree an initial station/asset/route data seam. D/E can prototype bounded import/generators using declared fixtures while it settles.
3. **Parallel production**: A/B choose their own evidence-backed scene scope and game-feel approach; D produces verified datasets/coverage, E produces reusable assets, F establishes reproducible gameplay and screenshot review. All contribute via isolated PRs.
4. **Stage reports**: record candidate SHA, source/license check, actual CLI/browser/phone/visual evidence, G0–G4 result, gaps and next owner. Station work never gets declared complete merely because one scene loads or a model imports.
5. **Integrate/repeat**: C owns cross-station compatibility; F runs smoke plus visual examination on exact candidates; independent review for meaningful changes. Owner retains accepted merge and release approval; once merged, all lanes reread current `main` and the latest Handoff.

## Hard quality / rights boundaries

- Target **L2 commercial-game-feel** on each accepted bounded playable slice, and improve coverage continuously; L0/L1 remain interim. L3 faithful high-fidelity/Godot stays an ambition, not a fake status badge.
- **G0 is independent of visual polish**: real route graph edges require verified rights, data provenance and true access/level connectivity. Unknown paths, closures, paid areas, accessibility, hours and elevations remain UNKNOWN or unroutable; no fabricated directions.
- The GitHub repo is public. Source-specific redistribution/reuse checks apply to any GLB, texture, map, sign, photo, POI data or model. No operator-map tracing, scraping restricted street view or publishing unlicensed raw evidence. Large raw imports and renders go in private isolated storage, not into Git.
- Only pnpm/Homebrew, no npm/npx/yarn.
- A useful test report cannot claim Astra High, Sol xHigh, actual iPhone device testing, or screenshots unless tools actually ran those checks.

## Accepted quality gates

[Quality-first Acceptance](acceptance.md): separately report G0 provenance/rights, G1 geometry/collision, G2 routing, G3 real gameplay/L2 visual fidelity, G4 release evidence. Both stations have separate acceptance and coverage inventories. No automatic deadline, no obligation to stop at one corridor. **Neither six Issues nor this Handoff mean the six sessions have been started.**
