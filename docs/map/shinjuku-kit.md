---
area: shinjuku-kit
owner: vertical-kit
updated: 2026-11-03 JST
---
# Shinjuku vertical kit

- `stations/shinjuku/scene/kit/swap.ts` collects anchors, plans resident placements, builds batches and atomically removes the replaced static finishes.
- `stations/shinjuku/scene/kit/place.ts` keeps the 3 MB geometry / 8 MB texture guards station-wide; vertical triangles and draws are admitted at runtime.
- `stations/shinjuku/scene/kit/lod.ts` groups vertical runs by 96 m horizontal spatial cell (a bounded 2×2 merge of 48 m cells). Kit meshes retain floor/material batches; fallback finishes share their original materials across floors. Within each cell, kit and procedural finish groups are complementary. Enter at 24 m from the three-dimensional run bounds, leave at 32 m; nearest cells spend the 60k triangle / 30 draw budget first.
- `stations/shinjuku/scene/kit/ledger.ts` copies exactly the tagged procedural triangles for each fallback before hiding them in the original shared meshes.
- `stations/shinjuku/scene/build.ts` forwards the existing ENU viewer position to LOD, keeps fallback finishes out of the static merge and trims animated steps only at active kit combs. Collision and layout are unchanged.
- `stations/shinjuku/test/kit-lod.test.ts` covers clustering, paired visibility, hysteresis and budget admission; `stations/shinjuku/test/kit-bundle.test.ts` exercises the shipped GLB and physical-list parity.

Far runs retain procedural steps and balustrades. The default kit still dresses escalators only; opt-in stair nosings use the same mechanism. No Ikebukuro assets or scene code are changed. Fallback finishes use explicit complete index draw ranges: the existing static cutter excludes these, preserving the procedural geometry and preventing the alternate representation from generating extra slab bands or guard colliders. Near kit meshes keep their existing cut behavior. LOD finishes remain plain meshes, avoiding extracted one-instance copies. The existing viewer hook updates before animation so comb trimming follows the active representation.
