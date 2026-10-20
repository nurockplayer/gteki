# 池袋駅 Ikebukuro — station lane

Real, searchable, navigable Ikebukuro Station for GTEki. **Slice 1** is the public B1 Central
Passage from the JR Central Gates east to Exits 27/34/35/36/37/42/43: routable on a verified
graph, and walkable in a lit, signed, populated 3D scene.

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
  - URL params: `?spawn=<nodeId>`, `?q=mobile` (low quality, 2k lightmap, no post FX).
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
| **G1** geometry | **PASS** for slice 1 | Real-scale PLATEAU geometry, identity transform, z = TP height. Walker stays on floor, climbs Exit 35 stairs (TP 27.0 → 30.1 m), is blocked by walls and by openings into unmodelled space. No verified edge crosses a wall or opening at 1 m. Godot 4.7 headless import keeps roles and UV2 (`pipeline/godot_probe.gd`). |
| **G2** routing | **PASS (desk)** | 18/18 edges verified, 461 m. Shared-core `parseStationFiles` returns ok; the only warnings are 8 deliberately search-only POIs. JR Central Gate 2 → Exit 35 = 193 m, 6 steps, stale and hours-unknown flags shown ([explorer](docs/evidence/explorer-route-jrc2-exit35.jpg)). Negative case: the step-free profile fails safely (`no_path`). |
| **G3** quality (L2) | **GAP**: candidate, not yet claimed | See "G3 detail" below. |
| **G4** delivery | **HOLD** | PR open; Owner approval needed before merging, and before any real-world navigation claim. |

### G3 detail

Done so far:

- Baked GI lighting.
- Procedural materials.
- Data-driven double-sided signage.
- Ambient crowd.
- Exit daylight.
- A recorded 121 s walk, landmark (JR Central Gate 2) → Exit 35 ([video](docs/evidence/walk-jr-central-gate2-to-exit35.mp4)).
- An independent Astra High critique, addressed in `ca399cb`.

Remaining before claiming L2:

- Licensed or procedural ambient sound.
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

**Measured** (harness, Apple Silicon, Chromium):
- quality "low": 56 draw calls and 111k triangles per frame;
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

## Next

1. Field visit with the [survey checklist](docs/coverage-gaps.md).
2. Ambient sound.
3. Slice 2: South Passage (exits 38–41).
4. North-east (exits 26–33).
5. West (Tobu side).
6. Street level.
7. Step-free routes, once lift evidence exists.
