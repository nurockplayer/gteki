---
area: depato-interior
owner: depato-interior-pilot
updated: 2026-11-22 JST
---
# Department-store interior preview

`stations/ikebukuro/scene/depato/layout.ts` generates circulation, counter positions and a preview bundle from a store, renderer-space footprint, known elevations and entrances. It accepts any number of floors, uses 4.5 m spacing when elevations are absent, and connects successive floors by stairs. Aisles, counter placements and entrance ties are authored preview geometry, not surveyed navigation.

`stations/ikebukuro/scene/depato/interior.ts` builds collision geometry and creates three visual batches on approach: shell/stairs, instanced counters and one 512 px name atlas. It uses the shared landmark sign and door palette.

`stations/ikebukuro/scene/depato/pilot.ts` selects B1/1F from `stations/ikebukuro/data/depato-floors.json`, supplies the south-wing context footprint in `stations/ikebukuro/data/depato-footprint.json`, opens the station/context shells, and attaches the kit through `stations/ikebukuro/gteki/scene.ts`. Only the next preview loads it. The floor file follows the shared version-1 contract and is replaceable by the floor-data run.

The optional `StationSceneModule.previewBundle` hook is applied in `apps/web/src/registry.ts` before search/router construction when `StationEntry.load(true)` is requested. The UI passes its existing next flag. Default loads use the original bundle and scene.
