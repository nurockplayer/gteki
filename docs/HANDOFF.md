# GTEki — Engineering Handoff

Updated: 2026-10-20. **Status: QUALITY-FIRST KICKOFF READY; NOT YET ACCEPTED.** Initial research and the proposed station architecture are documented. No verified complete station graph, L2 playable scene, or deployed, audited navigation product has been demonstrated in this Handoff.

## Authority

Owner-approved: product name GTEki; browser-first searchable 3D station exploration and independent renderer-neutral navigation/search; high-fidelity Godot option; **two independently led Opus 5.5 station sessions (Ikebukuro and Shinjuku), without any 70/30 effort ratio or 72-hour timebox**. Quality, source-backed accuracy and progressively broad station completeness determine progress. Opus leads have final station-specific engineering authority within approved scope. Only pnpm/Homebrew for installs.

**Preferred collaboration (Owner instruction, 2026-10-20):** Both Opus 5.5 leads may direct GPT-6.1 Sol (xHigh), GPT-6 Astra (High) and Codex where actually available. Sol xHigh is the preferred shared-core collaborator; Astra High is an on-demand architecture/quality adviser. Neither introduces a mandatory committee, veto, or unverifiable model-credit gate. Avoid simultaneous writes to shared code: nominate one shared-core maintainer and use small versioned contracts. Opus leads retain freedom to choose technical methods and staffing.

## Read first

1. `README.md`
2. `docs/product-vision.md`
3. `docs/architecture.md`
4. `docs/research/source-register.md`
5. `docs/acceptance.md`
6. `docs/parallel-station-plan.md`
7. [Notion Research & World Bible](https://app.notion.com/p/3ffd7d8b390781568122c2dae6005de2)

## Open work items

- [#1 Public source research and licensing](https://github.com/nurockplayer/gteki/issues/1)
- [#2 Renderer-neutral navigation/search contracts](https://github.com/nurockplayer/gteki/issues/2)
- [#3 Ikebukuro Web 3D walkable slice](https://github.com/nurockplayer/gteki/issues/3)
- [#4 Search to 3D guided route](https://github.com/nurockplayer/gteki/issues/4)
- [#5 Shinjuku partial import and coverage](https://github.com/nurockplayer/gteki/issues/5)
- [#6 Final acceptance, Godot and public-data review](https://github.com/nurockplayer/gteki/issues/6)

## Next actions

1. Each station Opus inspects latest `main`, station-specific evidence, existing PRs, tool availability, quality levels and worktree ownership.
2. Agree a minimal, versioned shared graph/POI/coordinate/asset contract and one writer for shared files; do not require extensive design meetings.
3. Independently verify source geometry, rights and actual accessible topology for both stations; generate permission-aware field-survey gaps where open data is insufficient.
4. Build and repeatedly **play, see, critique and refine** evidence-backed station slices toward L2 commercial-game-feel quality. Grow them to greater station completeness in later accepted stages; do not stop at L0/L1 technical previews.
5. Independently verify desktop and phone walkthroughs, navigation correctness and visual identity; preserve the Godot high-fidelity path with an actual import proof.
6. Record per-station G0–G4, test/visual evidence and next steps in GitHub; request Owner approval for merge/public release. **There is no clock-based deadline or automatic 72-hour completion.**

## Reporting discipline

Every stage leaves a PR/Issue comment with candidate SHA, files changed, evidence, tests, rights gates, known gaps, reviewer verdict and next step. After merge, re-read live `main` and this Handoff. Fail closed on uncertain navigational geometry.

## Current-stage exclusions (not abandoned end goals)

No present claim of complete station coverage, production routing guarantees, precise underground phone positioning, real-time train/construction feeds, or high-fidelity Godot completion. Whole-station validated coverage and L3 fidelity are **long-term product goals**, not explicitly cancelled. No changes to other game projects.

## Current blockers

- Need exact verified data download, rights and coverage, especially interiors.
- Need initial technical implementation and tested station graph.
- Need legal check before redistribution of source files or imagery in public demo.

## Quality target and completeness policy

Accepted station slices target **L2 commercial-game-feel** quality: believable scale, station-specific landmarks, polished materials/lighting, intuitive wayfinding, responsive walking and actual phone/desktop visual review. L0/L1 are internal milestones. **L3 high-fidelity digital twins** (potential Godot client) are the long-term aspiration. Route correctness and redistribution rights override visual polish; none of these milestones authorize inventing missing station geometry. Consult `docs/acceptance.md` for observable criteria. A slice passing L2 never means an entire station has been reconstructed.

## Research intake — 2026-10-20

The full public data study is now committed at [docs/research/GTEki_Public_Data_Research_2026-10-20.md](research/GTEki_Public_Data_Research_2026-10-20.md). Research and small metadata/CSV/PDF checks are finished. **No full underground CityGML import, geometry coverage validation, current-world indoor navigation, field verification, or real demo has been performed.**

**First blocking gate (G0):** inspect rights and exact resource versions; download only the individual Ikebukuro PLATEAU underground GML (~35.4MB) with schema/codelists after verifying current API; record URL, hash, timestamps and metadata; enumerate gml:id, geometry footprint, floor semantics, CRS/axis/vertical datum and unverified connectivity. The Ikebukuro 2019 walking CSV is NOT an indoor graph (in_out=1, elevation empty). Use separate candidate layers for geometry, access graph and POI entrance. Unknown edges are unroutable.

**Independent Shinjuku lane (no fixed percentage):** validate Toei Oedo Shinjuku E27 partial indoor GeoJSON/PDL and PLATEAU underground file; preserve operator-specific floor labels and verify cross-operator connections instead of extrapolating. Aim for its own visually polished, playable, source-backed slice, with honest GAP/HOLD if geometry or access evidence is unavailable.

**Rights gate:** public GitHub means no unlicensed scanned station diagrams, copied map PNG/JPEG, unapproved photographs, scraped POIs or derived mesh uploads. Documentation can link to restricted references without embedding them as released assets.

**Owner process:** Two Opus 5.5 station leads independently own Ikebukuro and Shinjuku; one shared-core writer integrates their common contracts. They may recruit Codex/Sol xHigh/Astra High as actually available. Owner controls major product change, merges and releases, not routine engineering choices. This intake is documentation-only, not acceptance of either station.
