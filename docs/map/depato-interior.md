---
area: depato-interior
owner: depato-interior-pilot
updated: 2026-11-23 JST
---
# Department-store interior preview

`stations/ikebukuro/scene/depato/layout.ts` generates circulation, counter positions and a preview bundle from a store, renderer-space footprint, known elevations and entrances. It accepts any number of floors, uses 4.5 m spacing when elevations are absent, and connects successive floors by paired station-family escalators. Aisles, counter placements and entrance ties are authored preview geometry, not surveyed navigation.

`stations/ikebukuro/scene/depato/interior.ts` builds collision geometry and loads within 40 m of an entrance, unloads on departure and draws the active floor plus the far escalator landing while riding. The neutral AD kit uses instanced showcases, food, downlights and figures; one 1024 px name atlas; baked warm pools and paired escalators. It uses the shared landmark sign and door palette.

`stations/ikebukuro/scene/depato/pilot.ts` selects B1/1F from `stations/ikebukuro/data/depato-floors.json`, supplies the south-wing context footprint in `stations/ikebukuro/data/depato-footprint.json`, opens the station/context shells, and attaches the kit through `stations/ikebukuro/gteki/scene.ts`. Only the next preview loads it. The floor file follows the shared version-1 contract and is replaceable by the floor-data run.

The station module’s optional `previewBundle` export is applied in `apps/web/src/registry.ts` before search/router construction when `StationEntry.load(true)` is requested. The UI passes its existing next flag. Default loads use the original bundle and scene.
