# Greybox passages and vertical connectors (design)

Date 2026-10-29 22:5x JST, approved 2026-10-29 23:0x JST with four additions (marked ★). Director ruling of 2026-10-29 22:4x JST, which replaces ruling A's "dashed band only". Owner retest: routes walk through darkness where the scene has no model, and float in the air where a level change has no elevator.

## Goal
Every routable edge that runs where the station scene has no model gets a procedural "greybox" built from the navigation graph. A level change gets a procedural connector instead of the avatar floating. Everything generated is labelled approximate: the legend and HUD say 「示意，非實測」 / "Approximate, not surveyed". It never claims real geometry.

## Where it hooks in
- New module `apps/web/src/explorer/greybox.ts`. It is pure apart from three.js, with its own tests. Its input is the bundle, the router's traversable edges and a `hasFloor(p)` probe; it returns a `THREE.Group` and `{ walkable, colliders, stats }`.
- Built once per station in `Explorer.loadStation()`, after the scene, its ground targets and the colliders are wired. The router check and the stale-load check work as usual, the same as the rest of `loadStation`. It is not rebuilt per route, so routes, walking and the minimap all see the same world.
- The `hasFloor` probe is the one `showRoute()` already uses for `unmodelledRuns` (a floor within 1 m of the route height), sampled every 0.5 m like the audit. The probe moves into a shared helper so the two can't drift apart.
- `sceneGap` edges are always treated as unmodelled.
- Stations without a scene (the graph view) are unchanged; `graphView.ts` already draws walk surfaces there.

## Passages (ticket A)
- Unmodelled runs are found per edge, at least 1 m long, plus 0.5 m of overlap into the modelled scene at each end, so the seam has no slit.
- Each run is built as a floor slab, two side walls and a ceiling.
  - Width: `attributes.width.m` when present; otherwise the conservative `MODE_WIDTH` from `graphView.ts`.
  - Clear height: 2.6 m.
- Junctions: runs that meet at a node share a floor patch, a disc of the larger width, and the walls are not built inside it.
- A wall is skipped where a scene collider already lies within 0.3 m, so it doesn't fight the scene's own wall at the seam.
- The greybox floor joins the walk ground targets, and its walls join the colliders and camera blockers, so the walker stands on it and the follow camera stays inside.
- Look:
  - One neutral concrete material, with a vertex-colour darkening toward the corners in place of AO.
  - The ceiling has an emissive light strip along the centreline every 6 m. There are no real lights, so the lighting cost doesn't change.
  - A thin amber kerb line along the floor edge keeps the "not modelled" signal.
  - The overview x-ray route keeps the dashed band.
- ★ Lit by itself: the shell is a `MeshLambertMaterial` with emissive ≥ 0.35 of its base colour, so it reads even where the scene has no lights. Acceptance samples canvas luminance along the route; the dark share must be close to 0.
- ★ Portal frames: where a run starts at a modelled wall (the audit's class C, 82 routed edges), a door frame (jambs, lintel, amber reveal) is placed at the wall hit. Collision is opened locally: the walker's wall test ignores scene colliders inside the frame's opening box, so the walker passes through the doorway, not a wall.

## Vertical connectors (ticket B)
Built only for vertical edges with no scene model at either end, or where the edge's own geometry has no floor:
- **Elevator:** a shaft box (glass front, steel frame) spanning the two floors, landing doors on each floor, and a car mesh. During walk and guide, the car's height follows the avatar on that edge, so the avatar rides it instead of floating. When idle, the car parks at the lower landing.
- **Stairs / escalator:** a procedural flight along the edge polyline.
  - Riser count comes from the rise ÷ 0.18 m (stairs) or a 30° pitch (escalator).
  - Escalators get treads, a balustrade and a handrail; stairs get treads, nosing and rails.
  - The style follows `vertical_hero` (`docs/visual/vertical-gap.md` items 2 and 4); w6:p13 is to be asked before dispatch.
- **Ramp:** a sloped greybox passage.

## Delivery split (2026-10-30 JST)
The design ships in three PRs, and each one is complete on its own:
- **Ticket A (#630):** passages, portal frames with locally opened walker collision, the legend, and the QA hooks.
  - Vertical edges get no geometry in A.
  - The scene wall at a portal is still drawn and still blocks the follow camera.
- **Ticket B:** the vertical connectors above.
- **#631:** cuts the scene wall's triangles open at each portal at load. That opens the rendered wall, the camera rays and the colliders together, and the door panel goes.

## Known limits (accepted, ticket A)
- **Portal collision.** Inside a portal's opening box, every wall-like hit on an original scene collider is exempt (normal within 30° of horizontal), whichever mesh it comes from.
  - A wall-like scene obstacle standing inside the opening box is therefore passable too.
  - Floors, ceilings and non-wall hits still block.
  - Accepted 2026-10-30 JST: #631 cuts the wall geometry itself at load, and after that the exemption is only a safety net.

## Privacy ★
Greybox geometry is built at runtime from the graph that is already loaded, and is never written to disk. Nothing built from a private graph may go into a public asset, a GLB export, a snapshot fixture or a CI artifact. Tests use synthetic bundles only.

## Budget (both tickets together)
- **Draw calls:** A and B keep separate per-floor batches; B adds at most 3 meshes per floor plus one per elevator car. The extra draw calls are accepted (lead decision 2026-10-30 JST); phone merges B's floors.
- **Triangles:** 150 k on high tier and 100 k on low tier for the passages and connectors of a whole station. With five merged meshes the GPU cost at these counts is small. Drop lights, kerbs, then ceilings when over the tier budget; retain floors and walls even if they alone exceed it. Phone treads drop to one quad per 3 steps.
- **Textures:** none new (procedural only); GPU memory below 2 MiB of vertex buffers.
- **Build time at load:** synchronous in ticket A. Headless on the private build: Ikebukuro 68–88 ms, Shinjuku 308–433 ms. Accepted 2026-10-30 JST. Spawn-first, per-frame slices are #632, for when device acceptance shows a stall.
- **Shadows:** none on any tier.

## Acceptance
- **Unit tests:**
  - run detection, overlap, junction patch and wall skip;
  - width fallback;
  - elevator car height follows guide progress;
  - stats stay within budget on both stations.
- **Audit:** `route-clip-audit` gains a mode that counts greybox floor as floor. With the private build, all routed edges should audit clean apart from class C seams that the greybox now covers.
- **Real game screenshots, before and after,** at desktop 1280×800 and phone 390×844:
  - the 西武池袋本店 routes, plus the Shinjuku S03 area (the 3 #623 edges);
  - through `orb-test --heavy --host`, only while the Owner is away.
- ★ Numeric check, via a QA hook along the route polyline (every 0.5 m), in the Owner's two scenarios: samples with no floor under the walker = 0, vertical moves without a connector = 0, dark-pixel share at guide stops close to 0.
- HUD legend chip shows 「示意，非實測」 while a greybox is in view.

## Not in scope
Real geometry for these spaces (#623 and the field items), and changes to graph data.
