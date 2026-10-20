# GTEki

**Explore real Japanese stations in 3D. Search, navigate, and walk.**

GTEki is an open-to-access, browser-first 3D station exploration and indoor-navigation project. The first milestone targets a **verified, walkable Ikebukuro Station east-to-west route**; Shinjuku is researched in parallel.

## Product goals

- Search for station exits, destinations, facilities, and POIs.
- Preview a route and explore it in a browser-based 3D scene.
- Share a renderer-independent station graph, route engine, and POI data.
- Retain the option for a future high-fidelity Godot client.
- Prioritize safe, verifiable directions over visually plausible but invented passages.

## M0: 72-hour proof of concept

- **Ikebukuro (70%):** one evidence-backed east-to-west route with browser controls, destination search, route display, and explicit uncertainty indicators.
- **Shinjuku (30%):** dataset/license/coverage research and an isolated limited-scale scene-import feasibility result.
- **Not a live station-navigation service yet.** Until pathways are verified, public demos must say they are experimental; never assert unknown routes or accessibility.

## Initial technical direction

- Web: TypeScript + Three.js; phone and desktop browser first.
- Blender: reproducible asset conversion / procedural geometry.
- Search + routing: shared, renderer-agnostic packages.
- Godot: import compatibility spike, not a competing full client in M0.
- Tools: **pnpm or Homebrew only; no npm / npx / yarn**.
- Keep Ikebukuro and Shinjuku station data and test fixtures separate.

## Working agreements

- Opus 5.5 is engineering lead; Codex is an implementation collaborator.
- Public data first. Maintain provenance, coverage, licensing, update date and confidence for each source.
- Offline/field capture fills **identified gaps**, subject to facility rules and privacy safeguards.
- Every phase reports test evidence, decisions, open risks and next steps in GitHub.
- Re-read merged `main` and the latest handoff after each merge.

## Project documents

- [Product vision](docs/product-vision.md)
- [Architecture](docs/architecture.md)
- [Source register & rights](docs/research/source-register.md)
- [M0 acceptance](docs/acceptance.md)
- [Handoff](docs/HANDOFF.md)

Project reference: [GTEki Research & World Bible on Notion](https://app.notion.com/p/3ffd7d8b390781568122c2dae6005de2).

## Data and licensing

**A public code repository is not blanket permission to redistribute downloaded maps, proprietary station diagrams, commercial brands, photos, or unlicensed 3D assets.** Do not commit third-party source files until their exact license and attribution/redistribution conditions have been verified. No open-source license has yet been selected for this repository.
