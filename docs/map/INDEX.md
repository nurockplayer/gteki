---
area: index
owner: gteki-fa
updated: 2026-10-26 JST
---
# GT-Eki project map

Read this first, then open the note for your area, then open exactly the files and line ranges it names. Don't scan the repo.

- Symbols: `docs/map/symbols.tsv` lists every exported function, class, type, interface, enum and const, plus every package.json script, as `symbol, kind, path, line`. Look a name up with grep, e.g. `grep -P '^createRouter\t' docs/map/symbols.tsv`. Regenerate it with `pnpm map:gen`. CI (root-test, `tools/map/map.test.ts`) fails when it's stale, and also when a backtick path or a double-bracket wikilink in `docs/map/` doesn't exist.
- Rule: a PR that moves files or changes the architecture updates the map in the same PR: the note, this index, and `pnpm map:gen`.
- Obsidian: open `docs/map/` as a vault. Its .obsidian folder is git-ignored.

## Areas

One line per area: what it owns · where it lives · its note. "no note yet" means the owning lead hasn't written one.

### Repo root
- Worker rules: what Codex and other workers read first (map first, brief scope, orb-test, times with zone, no checkout in the shared clone, no big files) · `AGENTS.md` · no note (the file is the rules)
- Private preview deployment: local-only deployment of the private overlay to the Pages `private` branch · `scripts/deploy-private.sh`

### App (`apps/web`)
- Explorer: the 3D station view. Scene load, walk/camera, route rendering, POI labels, minimap hookup · `apps/web/src/explorer/` · [[web-explorer]]
- UI shell: app frame, search combobox, minimap, identity/merchant cards, rail travel, live region · `apps/web/src/ui/` · [[web-ui]]
- Merchant form: the merchant submission form and payload · `apps/web/src/merchant/` · [[web-merchant]]
- App root: entry `apps/web/src/main.ts`, station registry `apps/web/src/registry.ts`, hours/credits/i18n/no-path helpers · `apps/web/src/` · covered in [[web-explorer]] and [[web-ui]]

### Packages (`packages/`)
- navigation: `createRouter` over a validated bundle (Dijkstra, or a time-dependent Pareto search when hours matter), polyline + ja/en instructions, no-path explanation. The Shinjuku and Ikebukuro routes run through it · `packages/navigation/` · [[pkg-navigation]]
- search: Japanese-aware name/alias search over one station's POIs and tenant brands; marks hits routable or search-only · `packages/search/` · [[pkg-search]]
- schema: the gteki.station/0.1 data contract. `parseStationFiles` composes station/graph/pois/tenants JSON into a `StationBundle` and fails closed · `packages/schema/` · [[pkg-schema]]
- scene-api: the contract between a station's `buildScene` and its hosts (explorer, walk/replay tools, Godot export): `StationScene`, `WALKER_BODY` · `packages/scene-api/` · [[pkg-scene-api]]
- geo: WGS84 ↔ station ENU ↔ renderer frame conversions · `packages/geo/` · [[pkg-geo]]
- cli: `route.ts` (one route as JSON, also called by Godot) and `export-fixture.ts` (synthetic demo station) · `packages/cli/` · [[pkg-cli]]
- godot: Godot HQ client fed by exported GLB + sidecar snapshots; routes/searches by calling the TS CLIs. `src/*.test.ts` runs in root vitest, the GDScript suites in `packages/godot/tests/` run in no CI · `packages/godot/` · [[pkg-godot]]

### Stations (`stations/`)
- Shinjuku: E27-derived station data (`stations/shinjuku/gteki/`), scene build (`stations/shinjuku/scene/`), importers (`stations/shinjuku/tools/`), fare/replay tests (`stations/shinjuku/test/`) · data generation and raw-data runs: [[data-stations]]; scene: no note yet (station lead)
- Ikebukuro: data (`stations/ikebukuro/gteki/`), scene (`stations/ikebukuro/scene/`), pipeline (`stations/ikebukuro/pipeline/`), lane docs (`stations/ikebukuro/docs/`), entry point `stations/ikebukuro/README.md` · data generation and receipts: [[data-stations]]; scene: no note yet (station lead)

### Tools (`tools/`)
- GIS: its own pnpm workspace. Source acquisition, CRS conversion, S03 nav graph, publish path into the stations · `tools/gis/` · [[gis]]
- Map generator: `tools/map/gen-symbols.mjs` and its test `tools/map/map.test.ts` · this index
- Private overlay builder: `tools/private-overlay/build-overlay.ts` · builds station contract overlays from private additions for local builds/dev only
- S03 private seam drape: `packages/godot/src/drape-edges.ts` · optional second generator stage snaps nodes and routes walk edges over the scene floor.
- Route clip audit: `packages/godot/src/route-clip-audit.ts` · headless check of a private build's added edges against the real station scene (floor within ±0.3 m, no wall crossing); `--route <from> <to>` audits one route
- Greybox stats: `packages/godot/src/greybox-stats.ts` · headless runtime passage statistics for public stations or local private overlays; JSON is printed to stdout.
- QA: L2 acceptance pack, avatar baseline, recognition and Shinjuku B checks · `tools/qa/` · no note yet (visual lead); the protocol is in `docs/qa/protocol.md`
- Blender: asset build, GLB validation, texture budget, Godot import · `tools/blender/` · no note yet (visual lead); start at `tools/blender/README.md`
- Fonts: the sign-font subset (`pnpm fonts:subset`) · `tools/fonts/` · no note yet
- Test box: `tools/test-box.mjs` (`pnpm test:heavy:box`) and `tools/box-idle.mjs` · no note yet

### Tests
- E2E: Playwright smoke and guided walkthrough, run against the built app · `tests/e2e/` · [[e2e]]
- Unit: co-located `*.test.ts`, collected by the root `vitest.config.ts`. `*.heavy.test.ts` runs only under `pnpm test:heavy`.

### Docs, CI, deploy
- Architecture and product: `docs/architecture.md`, `docs/product-vision.md`, `docs/acceptance.md`, `docs/ci-limits.md`
- Core contracts: `docs/core/contract.md`, `docs/core/merchant-submission-format.md`
- GIS records (acquisitions, decisions, rights, S03): `docs/gis/`; start at `docs/gis/README.md` · data-lane view: [[data-gis]]
- Research and source register: `docs/research/`; start at `docs/research/source-register.md` · lines, gap table, field run and receipts (#533): [[data-research-lines]]
- Data rights: OD-34 precedents and per-source rights classes · `docs/research/owner-decisions-pending.md` · [[data-rights]]
- Assets and visual: `docs/assets/`, `docs/visual/`, `assets/`
- CI: `.github/workflows/root-test.yml` (typecheck + root vitest, the merge gate together with `test`), `.github/workflows/gis-test.yml`, `.github/workflows/e2e-smoke.yml`, `.github/workflows/reuse.yml`, `.github/workflows/deploy-pages.yml`
- Deploy: `deploy/cloudflare-pages/`
- Licensing: `REUSE.toml`, `LICENSES/`, `NOTICE`

## Common commands
- Full root CI locally: `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`
- GIS CI: in `tools/gis/`, `pnpm typecheck` and `pnpm test`
- Dev server: `pnpm dev`. Build: `pnpm build`
- Regenerate symbols: `pnpm map:gen`
