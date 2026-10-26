---
area: data/gis
owner: data-research lead
updated: 2026-10-26 20:26 JST
---

# GIS evidence: acquisitions, CRS, S03

## What it does

`tools/gis` is a standalone package (its own `package.json`, lockfile and `pnpm-workspace.yaml`; Node 26) that downloads public GIS sources into an **external store**, hashes them, and writes **counts-only receipts** into `docs/gis/`. The repo is public, so `docs/gis/**` never holds a literal source field value (#124): only schema keys, counts, hashes, CRS/bbox statistics and our own statuses.

Three parts matter to the data lane:

- **`docs/gis/acquisitions/`**: one JSON per `source_id`: URL, HTTP status, bytes, `sha256`, `store_path`, timestamps (UTC). It is the provenance of every download. Sources are declared in `tools/gis/sources/sources.yaml`.
- **`docs/gis/crs/`**: one frame declaration per station dataset (`<station>-<source>-v0.json` + `.md`): which coordinate frame each member uses, the evidence, and a `verification` verdict.
- **`docs/gis/s03/`**: receipts for the Tokyo S03 新宿駅周辺 dataset: transform check, positions, held nav graph and held route diagnostic. S03 is what could make Shinjuku's JR / Odakyu / Keio gates routable.

## Main files and functions

| Path | Role |
| --- | --- |
| `tools/gis/src/cli.ts` | Command dispatcher (`pnpm --dir tools/gis gis <cmd>`) |
| `tools/gis/src/acquire.ts`, `common.ts` | Download + hash; store root from `GTEKI_GIS_STORE` (default ~/.gteki/gis-store) |
| `tools/gis/src/crs.ts`, `crs-declaration.ts` | Frame round-trip and declarations |
| `tools/gis/src/s03-transform.ts`, `s03-positions.ts`, `s03-paths.ts` | S03 affines, Check A containment |
| `tools/gis/src/s03-nav-graph.ts`, `-route.ts`, `-publish.ts` | Held graph with reason codes; route diagnostic; publish gate (#557) |
| `tools/gis/README.md` | Full command reference; "S03 drawing-transform evidence" section |
| `docs/gis/rights/README.md` | Generated per-source rights verdicts (`gis rights-report`) |
| `docs/gis/crs/shinjuku-s03-v0.{json,md}` | S03 frames: level GeoJSON WGS84; Path GeoJSON UNKNOWN local; `v5_nav` venue-local mx, my + two affines |
| `docs/gis/s03/nav-graph-2450f32f7a247690beee.json` | Latest held graph receipt (#553, 2026-10-26 18:52 JST) |
| `docs/gis/s03/nav-route-215c1edcad609d9dfba4.json` | Latest held route receipt |
| `docs/research/lines/s03-*-2026-10-26.md` | Desk residue that feeds field items 50–54 |

## Data flow

```
sources.yaml ─ gis acquire ─▶ <store>/raw/<sha256>/<file>      (never in the repo)
                    └──────▶ docs/gis/acquisitions/<source_id>.json
store bytes ─ inspect-* / crs-roundtrip / s03-* ─▶ <store>/out/* (private detail)
                                              └──▶ docs/gis/{inventory,crs,s03,...}/*.json (counts, hashes)
S03 v5_nav ─▶ s03-nav-graph (held, reason codes per edge) ─▶ s03-nav-graph-route (diagnostic)
          ─▶ s03-nav-graph-publish --publish  (refuses on any reason code, unsigned HOLD, unverified floor tie)
```

**S03 state (2026-10-26 18:52 JST):** CRS closed: the `v5_nav` frame is VERIFIED for internal consistency (#547; Mercator fit ≤0.123 m vs the affine chain, director ruling). Floor order now comes from level id + printed z (#553). Remaining codes: `CHECK_B_RESIDUAL_UNVERIFIED` 2249 edges, `CHECK_A_CONTAINMENT_FAIL` 22, `CROSS_LEVEL_DEVICE_UNKNOWN` 1. **Routable gate pairs: 0.** Check B needs independent control points, which only the field can give (items 52–54).

## Tests CI runs and regenerating data

```sh
pnpm --dir tools/gis gis acquire --all            # online; writes acquisitions/*.json
pnpm --dir tools/gis gis acquire --all --offline  # re-verify store hashes only
pnpm --dir tools/gis gis crs-roundtrip ikebukuro-plateau-ubld-v0
pnpm --dir tools/gis gis s03-transform-check
pnpm --dir tools/gis gis s03-nav-graph
pnpm --dir tools/gis gis s03-nav-graph-route --run <run_id> [--from <poi> --to <poi>]
pnpm --dir tools/gis gis s03-nav-graph-publish --run <run_id>      # dry gate; add --publish to write
pnpm --dir tools/gis gis check-poi-literals       # literal-leak guard (needs GTEKI_GIS_STORE)
pnpm --dir tools/gis gis rights-report            # regenerates docs/gis/rights/README.md

# Tests, as CI runs them (gis-test.yml, only on tools/gis/** changes; Node 26)
orb-test -- sh -c 'cd tools/gis && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test'
```

`test:real` (`GTEKI_GIS_REAL=1`) needs the full store and is not run in CI; for a cached replay set `GTEKI_GIS_OFFLINE=1` (README "Reproduce the complete real run"). The store is not in orb-test containers: pass it with `--env GTEKI_GIS_STORE=...` from a copy inside the worktree, and delete the copy afterwards.

## Pitfalls

- **Never commit a source value** under `docs/gis/**`, not even a station or shop name from S03/S10/PLATEAU-related. Run `check-poi-literals` before a GIS docs PR.
- Acquisition and container timestamps are **UTC**; convert before quoting in JST.
- `sha256` in a receipt pins exact bytes; a re-download that changes bytes is a new vintage, not an overwrite (`docs/gis/vintages/`).
- S03's `v5_nav` frame is verified **only** for `v5_nav`; Path GeoJSON stays UNKNOWN local. Don't reuse the affines elsewhere.
- Lifting the S03 HOLD alone does not route anything; every edge still carries Check B.
- Tests that pinned receipt SHAs were removed (#543); compare counts, not hashes.
- Never mount hand-made Docker volumes for tools/gis/node_modules (10-26 cleanup); use orb-test.
- MLIT R2 indoor Shinjuku is login-gated: GAP, no GET.

## Related PRs and issues

- S03: #542, #543, #546 (desk pass), #547 (CRS verified), #550 (reason codes), #551 (Check B scouting), #552 (`dz` residue), #553 (floor z), #557 (publish gate)
- Rights in GIS: #124 (no source values in Git)
- Notes: [[gis]] (tool internals, gteki-fa) · [[data-stations]] · [[data-research-lines]] · [[data-rights]]
