# 池袋駅 Ikebukuro — station lane

Real, searchable, navigable Ikebukuro Station for GTEki. Two slices are routable on a verified
graph and walkable in a lit, signed, populated 3D scene:

- **Slice 1**: the public B1 Central Passage from the JR Central Gates east to Exits
  27/34/35/36/37/42/43.
- **Slice 2**: the passage along the JR east side down to the South Passage's east end, Exit 38
  (東口（南）), and the south-east corridor to Exits 41, 40 and 39.
- **Slice 3**: the passage along the JR east side north to the North Passage and Exit 22
  (東口（北）), then down to the passage between the Ikebukuro Shopping Park blocks and Exits 26,
  28, 32 and 33.

**Status: NOT YET ACCEPTED.** Desk-verified, not field-verified. Opening hours are unknown. This
is not a whole-station model (see [coverage gaps](docs/coverage-gaps.md)).

## Run it

```sh
pnpm install                      # in stations/ikebukuro
pnpm dev                          # station preview harness: http://localhost:5173
pnpm typecheck
```

- **Preview harness** ([preview/main.ts](preview/main.ts)): third-person walk.
  - Controls: WASD/arrows, Shift to run, mouse drag or wheel for the camera, left-half touch joystick.
  - URL params: `?spawn=<nodeId>` (`c_mid`, `c_e2`, `sp_e`, `n_h`), `?q=mobile` (low quality, 2k lightmap,
    no post FX).
- **Shared explorer** (core lane, `apps/web`): discovers `gteki/` automatically. Search, route,
  guided walk and free walk run there.
- **Capture tooling** (dev only): `gt.capture(name)` and `gt.walkCapture(...)` write frames to
  `build/captures/`.

## Layout

| Path | What | Truth or presentation |
|---|---|---|
| `data/graph.src.json` | Hand-authored nodes, edges, POIs, access facts, sources and coverage | truth (source) |
| `gteki/station.json`, `graph.json`, `pois.json` | `gteki.station/0.1` bundle built by `pipeline/build_station.py` | truth (built) |
| `gteki/scene.ts` → `scene/*.ts` | `gteki.scene/0.1` scene: materials, signs, crowd, lighting | presentation |
| `gteki/assets/` | `ikebukuro_b1.glb` (geometry + collision), `ikebukuro_b1_lit.glb` (+ UV1, fixtures), lightmap WebP 4k/2k | presentation |
| `scene/signage.json`, `scene/crowd_lanes.json` | Derived from the verified graph and the PLATEAU walkable grid | presentation |
| `pipeline/` | Reproducible data and asset build (stdlib Python + Blender) | — |
| `docs/` | G0 source audit, coverage gaps, evidence | — |

## Reproduce

Tools: Homebrew `blender` (5.2 LTS), `webp`, `imagemagick`, `godot` (optional); pnpm.

```sh
sh pipeline/fetch_sources.sh      # PLATEAU GML + metadata (sha256-checked) into data-cache/
pnpm build:data                   # GML -> ENU JSON -> GLB -> verified graph -> signage
pnpm bake:lighting                # 4096 Cycles lightmap (Metal GPU ~5 min; DEVICE=CPU works) -> WebP
```

`build_station.py` exits non-zero if any edge fails geometry validation or if a POI points at a
missing node. An edge is `verified` only when **both** of these hold:

- every 0.5 m sample lies on surveyed floor or stair treads, with no wall crossing at body
  height (geometry evidence);
- the edge cites an official access fact (access evidence).

## Sources and rights

| Source | Use | Rights |
|---|---|---|
| PLATEAU CityGML ubld 53394576 (Toshima, LOD4.1, 2023 survey) | all geometry, assets and walkable grid | CC BY 4.0. Credit "PLATEAU (MLIT)", modified |
| Toshima underground guide map (2022) | facts only: which opening is which exit or gate | reference-only, `usage: facts-only` |
| Tokyo Metro Ikebukuro yard map (2026-03) | facts only: exit numbers, gate names | reference-only, `usage: facts-only` |

- No operator maps, logos, photos or typefaces are in the repo.
- Signs use GTEki's own style: charcoal panels and yellow exit badges.
- Every texture is procedural, generated at runtime.
- Light fixtures, crowd and haze are GTEki art direction, declared in each asset's `derivation`.

## Acceptance record (quality contract G0–G4)

| Gate | Verdict | Evidence / remaining |
|---|---|---|
| **G0** evidence / rights | **PASS (desk)**, **HOLD (field)** | [G0 audit](docs/G0-source-audit.md); rights chain above. Field visit pending ([survey brief](docs/coverage-gaps.md)). |
| **G1** geometry | **PASS** for slices 1–3 | Real-scale PLATEAU geometry, identity transform, z = TP height. Walker stays on floor, climbs Exit 35 stairs (TP 27.0 → 30.1 m), is blocked by walls and by openings into unmodelled space. No verified edge crosses a wall or opening at 1 m. Slice 2 follows the surveyed level changes: South Passage TP 27.6 → 29.1 m (up) → 25.9 m (down), with exit stairs to TP 32.2–32.6 m. Slice 3: North Passage TP 28.5 m, down to TP 26.2 m between the shopping-park blocks, U-shaped Exit 28 stair via a TP 29.0 m landing. Godot 4.7 headless import keeps roles and UV2 (`pipeline/godot_probe.gd`). |
| **G2** routing | **PASS (desk)** | 44/44 edges verified, 1131 m. Shared-core `parseStationFiles` returns ok; the only warnings are 6 deliberately search-only POIs (Metro/Tobu gates, Exit 19). From JR Central Gate 2: Exit 35 = 197 m, Exit 38 = 242 m, Exit 41 = 291 m, Exit 40 = 369 m, Exit 39 = 425 m, Exit 22 = 173 m, Exit 26 = 224 m, Exit 28 = 244 m, Exit 33 = 270 m, Exit 32 = 278 m. Junction nodes sit at real decision points (e.g. just outside each JR gate), so narration reads "Go straight ~7 m / Turn left…" ([explorer](docs/evidence/explorer-route-jrc2-exit35.jpg)). Negative case: the step-free profile fails safely (`no_path`). |
| **G3** quality (L2) | **GAP**: candidate, not yet claimed | See "G3 detail" below. |
| **G4** delivery | **HOLD** | PR open; Owner approval needed before merging, and before any real-world navigation claim. |

### G3 detail

Done so far:

- Baked GI lighting.
- Procedural materials.
- Data-driven double-sided signage. Back faces group destinations by the turn taken at the
  junction (← / ↑ / →). Each sign is centred in the passage and trimmed to the clear width
  measured from PLATEAU walls at sign height.
- Ambient crowd.
- Procedural ambience (`scene/ambience.ts`), playing in the shared explorer through the host
  `ctx.audio` hook (verified against core `b0d14ac`: `__gteki.audio()` available and running,
  HUD mute works).
- Exit daylight.
- A recorded 121 s walk, landmark (JR Central Gate 2) → Exit 35 ([video](docs/evidence/walk-jr-central-gate2-to-exit35.mp4)).
- An independent Astra High critique, addressed in `ca399cb`.

Remaining before claiming L2:

- A real phone test (only emulated so far).
- A side-by-side reference review on site.
- An avatar pass in the explorer (core lane).

Evidence stills:

- [central passage](docs/evidence/01-central-passage-east.jpg)
- [JR gate](docs/evidence/02-jr-central-gate2.jpg)
- [east hall](docs/evidence/03-east-hall.jpg)
- [Exit 35 stairs](docs/evidence/04-exit35-stairs.jpg)
- [Exit 43](docs/evidence/05-se-corridor-exit43.jpg)
- [sign back](docs/evidence/06-sign-back.jpg)
- [phone (emulated)](docs/evidence/m01-central-passage-mobile.jpg)
- Slice 2: [JR east-side passage](docs/evidence/13-jr-east-passage.jpg),
  [South Passage east](docs/evidence/07-south-passage-east.jpg),
  [Exit 38 junction](docs/evidence/08-exit38-junction.jpg),
  [Exit 41 junction](docs/evidence/09-exit41-junction.jpg),
  [south-east corridor](docs/evidence/10-se-corridor.jpg), [Exit 40](docs/evidence/11-exit40.jpg),
  [Exit 39 stairs](docs/evidence/12-exit39-stairs.jpg)
- Slice 3: [North Passage, Exit 22](docs/evidence/15-north-passage-exit22.jpg),
  [stairs down to the shopping-park passage](docs/evidence/16-stairs-to-isp.jpg),
  [shopping-park passage](docs/evidence/17-isp-passage.jpg), [Exit 28 junction](docs/evidence/18-exit28.jpg)

**Measured** (harness, Apple Silicon, Chromium):
- quality "low": at most 68 draw calls and 124k triangles per frame (56 crowd agents, 68 signs);
- shipped assets: 9.5 MB at "high", with lightmap WebP 1.1 MB (4k) or 0.5 MB (2k).

## Deliberate simplifications

- **Light fixtures** are generated on a regular 2.4 × 3.0 m grid under surveyed ceilings. They are
  not surveyed positions, and the colour (4000 K) is art direction.
- **Materials** are generic procedural finishes: tiles, enamel panels, ceiling grid, granite
  stairs. They are not the station's actual finishes.
- **Shopfronts** are anonymous glowing glazing in PLATEAU window and door openings. No shop
  names or brands.
- **Signs** use GTEki's design, placed about 4 m along each verified edge from junctions. Their
  content is computed from the verified graph. Positions are not real sign locations.
- **Crowd** is ambient decoration on verified edges, clamped to surveyed walkable lanes. It is
  not a pedestrian-flow model.
- **Openings into unmodelled space** (fare areas, shops) render as a lit haze and block movement.
- **Exit stairs** end in a daylight portal. There is no street-level model yet.
- **Single risers** modelled as two floor levels (e.g. a 0.19 m step between landings on the
  Exit 39 stair) are passable on stair edges only, so walk-only and step-free routing stay
  strict.

## Next

1. Field visit with the [survey checklist](docs/coverage-gaps.md).
2. South Passage west: JR South Gate, Yurakucho Line South Passage East Gate (`gap-south-west`).
3. North-east, north part: exits 23–25 and 29–31 (`gap-ne-north`).
4. West (Tobu side).
5. Street level.
6. Step-free routes, once lift evidence exists.
