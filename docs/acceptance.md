# GTEki — Quality-first Acceptance Contract

**Status: Owner-adopted direction (2026-10-20).** No fixed 72-hour deadline, 70/30 development split, or automatic completion on time elapsed. Current engineering artifacts remain **NOT YET ACCEPTED**.

## End state and truthful interim milestones

The long-term goal is to reconstruct **Ikebukuro and Shinjuku** as genuinely searchable, reliably navigable, compelling 3D environments, expanding toward validated publicly traversable passages, POIs, exits, levels and access conditions. Both stations have **independent acceptance records**.

The first station milestone is an evidence-bounded, genuinely usable **search → route → guided/free walk** experience that passes quality, source/rights, and real-browser checks. It is **one accepted slice**, not an assertion that the entire station has been modeled or that public navigation is ready.

No deadline can substitute for passing the gates below. The leads are free to iterate and expand the chosen slice until accepted; scope can grow progressively rather than becoming a rushed, flat whole-station mockup.

## Visual maturity ladder

- **L0 — Blockout:** white boxes for coordinates, traversability and interaction verification; not a user-facing finish line.
- **L1 — Recognizable station:** legitimate reference-backed layout, key entrances, directional cues and stations' distinct identity; prototype-in-progress.
- **L2 — Polished playable experience (first accepted quality target):** coherent, believable architecture and scale, useful landmarks, distinct wayfinding, thoughtful materials and light, satisfying movement/interaction feedback, readable interface and credible environmental sound where appropriately licensed; visually and interactively judged on actual desktop/phone captures. L2 is a **bounded scene**, not a promise of full 1:1 photorealism.
- **L3 — High-fidelity digital twin (long term):** far broader and more detailed source-backed geometry and POI/level/route coverage, finer real-world matching, potential Godot high-quality client. Never manufacture "real" details just to claim L3.

**Required observed L2 evidence:** (1) a walkthrough from at least one actual in-scene landmark to the destination, including turning/wayfinding, (2) independent side-by-side review of distinctive reference-grounded features and a list of deliberate simplifications, (3) desktop and phone interaction/visual checks, and (4) any rendering/performance issues and actual device/browser measurements. No ungrounded FPS threshold, texture-count target or arbitrary meter quota.

## Per-station user acceptance

- [ ] User can open GTEki from desktop and phone browsers without installing a game and can select the intended station.
- [ ] A location/POI name or alias is searchable; the **start point is user-chosen** until accurate indoor positioning exists.
- [ ] At least one substantial, source-grounded route for that station is correctly rendered with a usable route preview and visible confidence/freshness; a negative route case fails safely.
- [ ] Guided and free walking feel responsive and intuitive in 3D; collision, floor crossings, paid-area boundaries, signage and camera/controller behavior are manually exercised.
- [ ] The chosen evidence-backed slice meets **L2** by independent visual/interaction review. L0/L1 screenshots alone do not satisfy this target.
- [ ] Existing station identities and distinct local landmarks are supported by the evidence and licensing; no prohibited traced operator map or borrowed commercial-game assets.
- [ ] Material station coverage gaps are listed with level, zone, approximate extent, source-date and field-work needed. Unbuilt / unreliably mapped areas are **not** silently passed off as complete.
- [ ] Source manifest permits every public GLB/texture/map/POI/data asset to be distributed in the browser build, with credit and modification labels as required.

## Shared core acceptance

- [ ] One engine-agnostic station/level/node/edge/POI/search model powers both stations; independent Three.js and Godot clients do not reimplement routing truth.
- [ ] Test shortest-valid path, no path, start=goal, wrong-way, paid boundary, closed link, level transition, unknown fields, accessible route, stale source and cross-operator issues.
- [ ] CityGML/source CRS → station-local metric frame → renderer transforms have recorded axis, units, reference elevations and roundtrip evidence; unknown heights stay unknown (symbolic render offsets marked).
- [ ] Web asset build is reproducible using pnpm/Homebrew tooling; no npm/npx/yarn.
- [ ] Godot compatibility is demonstrated for representative GLB + coordinate metadata or the blocker is documented with evidence; don't promise a high-fidelity Godot game is already complete.

## Evidence/rights/safety gate (G0)

Before interpreting a model as the real station, check actual downloaded resource contents, coverage and licensing. Research metadata/link discovery ≠ geometry read ≠ verified walkable topology ≠ current-world route.

- No inferred connective edges, shortcut through paid/restricted areas, invented stairs/elevators/levels, or guessed 24-hour access.
- Facts about ADA/barrier-free accessibility require actual source evidence and continuity; absent data means **UNKNOWN**, not true/false.
- Government open-data usage requires exact dataset/asset rights, derivative redistribution and attribution checks. Operator graphics and other restricted third-party imagery remain reference-only unless explicitly cleared.
- If G0 fails for a desired route, produce a **clearly marked synthetic/non-navigational visual prototype**, plus a precise acquisition/survey blocker. Do not greenlight real-user route claims.

## Geometry/playability gate (G1–G2)

- **G1 Geometry:** checked model-scale, collisions, local coordinates, floor connectors, no clipping/teleport shortcuts, documented fidelity of any approximations.
- **G2 Routing:** path display matches a verified directed graph, not a visual navmesh guess; route narration and destination correspond to real public access conditions within checked data freshness.

## Visual/product/release gate (G3–G4)

- **G3 Quality:** actual recorded walk (not a static hero screenshot), recognizable station-specific visual identity, polished lighting/materials/wayfinding, sound/input comfort when appropriate, desktop/phone capture and independent critique. Iteration continues until L2 is credibly met.
- **G4 Delivery:** reproducible build/tests, PR and reviewed SHA, screenshots/video, sources/rights bundle, per-station coverage report, known limitations and Handoff. Owner approval before merging/releasing and before making real-world navigation guarantees; acceptance of a demo ≠ approval of live travel directions.

## Review and reports

Report each lane's G0–G4 as **PASS / GAP / HOLD / FAIL**, with evidence and remaining tasks. Astra High may provide independent critique if actually available; lack of that exact model is not a pretext to claim review occurred. Re-test both station entry points following shared-core changes, and re-read merged main after each merge.

**Completeness remains a separate, continuing objective**: an accepted L2 slice can be celebrated while neither entire station is complete. Public demo copy must display coverage/freshness/uncertainty appropriately.
