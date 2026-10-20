# GTEki — Engineering Handoff

Updated: 2026-10-20. **Status: PRE-KICKOFF.** GitHub repository, initial documents and Issues #1–#6 exist; implementation has not started. No station model, routing engine, verified station route or deployed demo has been reported.

## Authority

Owner-approved: product name GTEki; public browser-first search/3D navigation; Ikebukuro 70% + Shinjuku 30% parallel; renderer-independent route/search; high-fidelity Godot option. Opus 5.5 leads engineering, Codex assists. Only pnpm/Homebrew for installations.

## Read first

1. `README.md`
2. `docs/product-vision.md`
3. `docs/architecture.md`
4. `docs/research/source-register.md`
5. `docs/acceptance.md`
6. [Notion Research & World Bible](https://app.notion.com/p/3ffd7d8b390781568122c2dae6005de2)

## Open work items

- [#1 Public source research and licensing](https://github.com/nurockplayer/gteki/issues/1)
- [#2 Renderer-neutral navigation/search contracts](https://github.com/nurockplayer/gteki/issues/2)
- [#3 Ikebukuro Web 3D walkable slice](https://github.com/nurockplayer/gteki/issues/3)
- [#4 Search to 3D guided route](https://github.com/nurockplayer/gteki/issues/4)
- [#5 Shinjuku partial import and coverage](https://github.com/nurockplayer/gteki/issues/5)
- [#6 Final acceptance, Godot and public-data review](https://github.com/nurockplayer/gteki/issues/6)

## Next actions

1. Inspect current `main`; check tooling and repo settings; document meaningful deviations from architecture proposal.
2. Commission verified public data research for Ikebukuro and Shinjuku; never ingest unknown-rights content as redistributable.
3. Freeze an initial `schema` + station coordinate transform contract.
4. Split work: navigation/search core, Ikebukuro model/web slice, Shinjuku evidence/import study; avoid overlapping writes.
5. Run small real-data import tests and make a station-specific survey-gap list.
6. Produce tests and screenshots / screen recording for each stage; use independent review before integration.

## Reporting discipline

Every stage leaves a PR/Issue comment with candidate SHA, files changed, evidence, tests, rights gates, known gaps, reviewer verdict and next step. After merge, re-read live `main` and this Handoff. Fail closed on uncertain navigational geometry.

## Explicit non-goals

No production routing guarantee, phone indoor positioning, 100% station coverage, real-time train or construction feeds, or replacing Eddington assets in M0.

## Current blockers

- Need exact verified data download, rights and coverage, especially interiors.
- Need initial technical implementation and tested station graph.
- Need legal check before redistribution of source files or imagery in public demo.

## Research intake — 2026-10-20

The full public data study is now committed at [docs/research/GTEki_Public_Data_Research_2026-10-20.md](research/GTEki_Public_Data_Research_2026-10-20.md). Research and small metadata/CSV/PDF checks are finished. **No full underground CityGML import, geometry coverage validation, current-world indoor navigation, field verification, or real demo has been performed.**

**First blocking gate (G0):** inspect rights and exact resource versions; download only the individual Ikebukuro PLATEAU underground GML (~35.4MB) with schema/codelists after verifying current API; record URL, hash, timestamps and metadata; enumerate gml:id, geometry footprint, floor semantics, CRS/axis/vertical datum and unverified connectivity. The Ikebukuro 2019 walking CSV is NOT an indoor graph (in_out=1, elevation empty). Use separate candidate layers for geometry, access graph and POI entrance. Unknown edges are unroutable.

**Parallel Shinjuku (~30%):** validate Toei Oedo Shinjuku E27 partial indoor GeoJSON/PDL, preserve its own source floor labels; study Shinjuku PLATEAU underground file without extrapolating to all operators. No cross-operator connections without evidence.

**Rights gate:** public GitHub means no unlicensed scanned station diagrams, copied map PNG/JPEG, unapproved photographs, scraped POIs or derived mesh uploads. Documentation can link to restricted references without embedding them as released assets.

**Owner process:** Opus 5.5 is engineering lead, Codex implements bounded tasks; follow GitHub issues and independent evidence-based review. This intake is a documentation handoff only, not completion of M0 engineering.
