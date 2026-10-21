# GTEki

**Explore real Japanese stations in 3D. Search, navigate, and walk.**

GTEki is a browser-first 3D exploration and indoor-navigation project for real Japanese stations. People should eventually be able to search for a station exit, shop, platform or facility, receive an evidence-backed route, and explore or preview it in a convincing virtual station.

## Product direction

- **Quality and completeness over speed:** no 72-hour deadline, no fixed Ikebukuro/Shinjuku percentage, no arbitrary feature-count finish line.
- **Two equal-owner station efforts:** separate Opus 5.5 sessions develop Ikebukuro and Shinjuku concurrently, with independent station worktrees and evidence.
- **One shared platform:** routing, search, POIs, coordinate frames and contracts stay renderer-neutral; both stations use a common Web explorer.
- **Experience aspiration:** GTA-like freedom of movement and an immersive sense of place, *without imitating GTA's protected assets or gameplay*. A real place must be recognizable, navigable, responsive and visually convincing.
- **Visual ladder:** L0 engineering blockout → L1 recognizable station → **L2 polished commercial-game-feel scene** (quality target for each accepted, evidence-backed slice) → **L3 faithful high-fidelity station digital twin** (long-term ambition, potentially in Godot).
- **Long-term completeness:** expand each station systematically across publicly traversable routes, exits, accessible transfers and searchable POIs; publish coverage and freshness instead of pretending unverified areas are complete.
- **Truth before polish:** no invented routes, assumed elevator connections, operator-area access, floor heights or unlicensed assets represented as authentic.

## Delivery and verification

The first meaningful milestone is an independently verified end-to-end experience for **each** station, with an identifiable area, destination search, trustworthy route, 3D walk-through, browser/mobile interaction, and visual review. Deliverable boundaries are chosen from evidence; milestones can be staged without declaring either complete station finished.

The accepted plan deliberately has **no clock-based deadline**; progress is tracked through measurable playable/visual/navigation/rights gates. See [quality and acceptance](docs/acceptance.md) and [two-session coordination](docs/parallel-station-plan.md).

## Technical direction (working defaults, not a creativity constraint)

- Browser-first TypeScript + Three.js initial proposal; Opus may justify a better solution while preserving browser access and the shared contract.
- Blender and reproducible asset pipelines; preserve an independent path to a high-quality Godot version.
- Shared renderer-agnostic search/navigation/POI and station-coordinate metadata.
- **pnpm or Homebrew only** for installs; no npm/npx/yarn.
- Station-specific files and model inputs stay isolated; shared core has one accountable writer at a time.

## Tests

`pnpm test` excludes `*.heavy.test.ts` files.
Put long replay, matrix, and brute-force suites in `*.heavy.test.ts` files.
Run them with `pnpm test:heavy` (single worker).
Each worker's V8 heap is capped at 3072 MB; override with `GTEKI_TEST_HEAP_MB`.
`pnpm test:heavy:box [vitest args]` runs heavy tests in Docker/OrbStack with hard memory/CPU limits; reports under `.qa/` are saved on the host.
Defaults: `GTEKI_BOX_MEMORY=2g`, `GTEKI_BOX_CPUS=2`, `GTEKI_BOX_IMAGE=node:24-bookworm-slim`; `GTEKI_TEST_HEAP_MB` defaults to 75% of the container memory.
When the last gteki box finishes and no other container runs (apart from the `GTEKI_BOX_IDLE_IGNORE` list, comma-separated, default `belabox-receiver`), the runner runs `orbctl stop` (OrbStack backend only, after re-checking for new containers; plain Docker or Linux is untouched), because OrbStack's VM keeps freed guest memory until it is stopped. The next `docker` command restarts OrbStack. Set `GTEKI_BOX_STOP_VM=0` to skip this; the step never changes the exit code.
GPU/WebGL work stays on the host.

## Research and rights

- [Full public-source dossier](docs/research/GTEki_Public_Data_Research_2026-10-20.md)
- [Source register & rights gates](docs/research/source-register.md)
- [Engineering handoff](docs/HANDOFF.md)
- [Notion Research & World Bible](https://app.notion.com/p/3ffd7d8b390781568122c2dae6005de2)

The GitHub repository is public. Third-party maps, photos, logos, 3D models, POI datasets and derived downloadable assets need source-specific reuse and redistribution checks. A source being public or a map being viewable is not enough to distribute its content. Prototype-only inferred visuals must be explicitly labeled; unverified passages must not appear in production routing.

No open-source license has yet been selected for this repository.
