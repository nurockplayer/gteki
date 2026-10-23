# #49 escalator shell street-level repair

Candidate starts at `15ac6bbe`, branch `claude/shinjuku-b6-shell-49` (PR #298). Local work only; no push or GitHub mutation.

## Diagnosis

The resumed uncommitted `fix-scratch/diagnose.mts` built the original scene and repeated `scene-hook.test.ts`'s vertical roof/cap raycasts. All 84 near-street roofed-link samples were inspected. Four failed, all on `e:4bee1c5e3544452db681f9aeccfe2346`:

| t | Station x, y, z | First drawn shell roof z / triangle | Camera cap z |
| --- | --- | --- | --- |
| 0.5 | -3.135, -13.135, -3.900 | -0.500000 / 17 | -0.180000 |
| 0.7 | -1.521, -12.197, -2.340 | 1.060000 / 17 | 3.000000 |
| 0.8 | -0.714, -11.728, -1.560 | 1.840000 / 20 | 3.000000 |
| 0.9 | 0.093, -11.259, -0.780 | 2.620000 / 15 | 3.000000 |

The scratch diagnostic also enumerated every shell triangle within 3 m in plan of each failed sample and the supplied platform→exit2 t=162.5 position (-54.2, 141.7, -3.3). The following are original merged-batch, zero-based triangle indices; side triangles include explicit back faces. Ranges are complete triangle vertex z ranges, not heights interpolated at the sample.

| Sample | Batch | Nearby triangles | Triangle indices | Vertex z range (m) |
| --- | --- | --- | --- | --- |
| 0.5 | escalator-shell-sides | 54 | 33–51, 53–55, 58, 63–66, 711–729, 731–733, 736, 741–744 | -5.400000 … 3.901400 |
| 0.5 | escalator-shell-soffits | 14 | 6–11, 13–15, 17–21 | -4.901400 … 3.901400 |
| 0.7 | escalator-shell-sides | 62 | 33–51, 53–56, 58, 60, 63–68, 711–729, 731–734, 736, 738, 741–746 | -5.400000 … 3.901400 |
| 0.7 | escalator-shell-soffits | 16 | 6–21 | -4.901400 … 3.901400 |
| 0.8 | escalator-shell-sides | 68 | 33–60, 63–68, 711–738, 741–746 | -5.400000 … 3.901400 |
| 0.8 | escalator-shell-soffits | 16 | 6–21 | -4.901400 … 3.901400 |
| 0.9 | escalator-shell-sides | 54 | 33, 36–39, 41, 43–44, 46–47, 49–60, 64–68, 711, 714–717, 719, 721–722, 724–725, 727–738, 742–746 | -5.400000 … 3.901400 |
| 0.9 | escalator-shell-soffits | 15 | 6–8, 10–21 | -4.901400 … 3.901400 |
| platform→exit2 t=162.5 | escalator-shell-sides | 0 | none | none |
| platform→exit2 t=162.5 | escalator-shell-soffits | 0 | none | none |

No shell triangle was within that radius of the supplied exit2 position. This local diagnostic therefore does not establish which projected surface caused its reported black band. Browser/GPU reproduction was forbidden by this brief; the visual screenshot claim remains unverified here.

Raw before/after diagnostic data and scripts remain in the task's uncommitted `fix-scratch/` directory: `/private/tmp/claude-501/-Users-tachikoma-Developer-gteki--claude-worktrees-sjk-visual/b86d325d-f612-4108-bf31-f199ab67911b/scratchpad/b6-shell-49/fix-scratch` (`<scratch>` in the commands below).

## Rule

`escalatorShellGeometry` mirrors the street slab underside at -0.18 m and clips all shell soffits and side panels to -0.181 m. The 1 mm margin keeps Float32 renderer-Y vertices strictly below -0.18 m. Sloping soffits are clipped against an affine height half-plane; sides are clipped in their along-wall/height plane rather than flattening their vertices.

For each escalator run, existing `levels[].ceilings` and `layout.soffits` take precedence wherever their footprint covers the shell and their affine height is at or below its top. Polygon difference removes those soffit regions; the corresponding side regions are removed too. Existing footprints retain holes, and affine height crossings split the overlap. The existing footprint is retained for side cutting, because intersection with the shell strip would put each side exactly on the wall cutter's excluded boundary. All cuts operate on temporary render geometry.

Tests cover strict underground vertices, all 84 roofed-link samples, footprint holes and sloping height crossings for both shell batches, retained enclosure coverage, clear graph passages, and the unchanged physical buffers.

## Validation and digests

The post-fix diagnostic reports **84 samples, zero failures**. Shell side vertices range from -44.094482 to -0.200000 m; soffit vertices range from -39.793438 to -4.288443 m. Every vertex is below the street slab underside.

| Rendered triangles | Before | After |
| --- | ---: | ---: |
| Shell sides (including back faces) | 1,356 | 96 |
| Shell soffits | 127 | 97 |
| Shell total | 1,483 | 193 |
| Whole-scene visual total, each quality | 226,414 | 225,124 |
| Visible wall material group | 15,396 | 14,136 |
| Visible ceiling material group | 4,507 | 4,477 |

Both low and high quality have these visual hash changes:

- Walls: `edd4bca7c69052f5a7c9add6898052796aacab781faf490856a135213a6e46f8` → `9b67d4d5d9e8d3e57b8c983500812fda169c23e3ef14837af76a581df1f81018`.
- Ceilings: `6b92b49f1e15628005faed88755a650f3b202df3ac72ccccca2106d81737e5f1` → `412c1d7fba34cb41647311ff8a69a5a1eab00d6f78f60eafd07b59a3ecf4f4da`.

`refresh.mts` asserted deep equality of every nonvisual field and every other visual material group before emitting the new fixture. A second recursive comparison confirmed that only those eight visual count/hash values differ. Physics remains walkable 433, colliders 2, cameraBlockers 3, walls 14,479.

Geometry lifetime capture: 36,503 retired geometries observed, zero retained, 138 live unchanged. Final geometry bytes: **13,356,060 → 13,296,864** (-59,196 B). Whole-geometry hash: `42587af6f363f6b8f262d4018a1ba5b80a2d34c503bc0b686b04af6046bfb2c9` → `04a401299e738f05b134fee6053a71f95965131d5b1837fceddee863391046c4`. Only the visual byte/hash expectations and associated comment changed in `geometry-lifetime.test.ts`.

Every runtime command was serialized with `lockf -k /tmp/gteki-local-test.lock`; lock contention was allowed to wait through the other lane's blocks. Before each command, `memory_pressure | tail -1` showed at least 20% free (36%, 47%, 54%, 43%, 45% for the first five commands; 35% before run-scenes) and `vm_stat -c 3 5` showed zero interval swapouts. No command was killed or restarted.

Commands completed:

- `lockf -k /tmp/gteki-local-test.lock pnpm exec tsx <scratch>/diagnose.mts`: PASS, original 84 samples / four failures captured in `before.json`.
- `lockf -k /tmp/gteki-local-test.lock pnpm --filter ./stations/shinjuku typecheck`: PASS.
- `lockf -k /tmp/gteki-local-test.lock pnpm exec tsx <scratch>/refresh.mts <scratch>/before.json`: PASS, post-fix diagnostic and guarded full-digest capture (`after.json`, `new.scene-digest.json`).
- `lockf -k /tmp/gteki-local-test.lock pnpm exec node --expose-gc --import tsx stations/shinjuku/test/helpers/retained-geometry.ts`: PASS, values above (`retained.json`).

- `lockf -k /tmp/gteki-local-test.lock pnpm exec vitest run stations/shinjuku/test/scene-hook.test.ts stations/shinjuku/test/escalator-shell.test.ts stations/shinjuku/test/geometry-lifetime.test.ts stations/shinjuku/test/scene-digest.test.ts --maxWorkers=1`: **PASS, four files / 21 tests**, 47.17 s. This includes the existing camera-cap negative controls and clear graph-passage checks, plus the new vertex and footprint/height regressions.
- `git diff --check` and `git diff --cached --check`: PASS.

- `lockf -k /tmp/gteki-local-test.lock bash packages/godot/run-scenes.sh shinjuku`: **PASS (exit 0)** with Godot `4.7.2.stable.official.ed1daf0bf`: 63 scene snapshot checks, 905 look-profile checks, and HQ lighting check (`lightmap off`, two lights, mask `0xffffffff`, 112 drawing meshes on WORLD_LAYER).

### Headless summary and limits

Export: 17.60 MiB GLB, 573 meshes, 433 walkable, two colliders, two camera-blocker-only meshes, five see-through meshes, three spawn points, 14,479 source walls, 11 export warnings. The export's role priority deduplicates one collider/camera-blocker mesh, explaining the two camera-blocker-only meshes versus three in the source scene. Godot instantiates 14,379 wall shapes after omitting 18 zero-length and 82 inverted-band walls under its existing band rule. Source physical lists and bytes did not change.

**No look-fingerprint mismatch was flagged**: all 905 look checks passed, including the assertion that every material mapping matches its recorded fingerprint, and no fingerprint mismatch warning appears in the log or exported warnings.

The command also emitted non-fatal diagnostics: `user://logs` could not be written, `check_hide_edge_cases` at `run_scene_tests.gd:82` emitted an out-of-bounds surface-index error, and SDFGI reported that it requires Forward+. These did not change the command's exit status or PASS results and are retained in `run-scenes.log`. Export warnings cover static instancing, role deduplication, an empty viewer probe, omitted textures/blank canvases, stubbed PMREM, absent audio, proxy-based roles, normalized normals, unsupported ShaderMaterial, and unsupported lights. No Godot source or look-authority file was modified.

Only the requested headless export generated ignored cache files under `packages/godot/.cache/`; all committed edits are under `stations/shinjuku/`. No build server, browser, heavy test, whole-repository test, push, or GitHub operation was run.

