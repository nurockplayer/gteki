---
area: depato-interior
owner: depato-interior-pilot
updated: 2026-11-23 JST
---
# Department-store interior preview

`stations/ikebukuro/scene/depato/layout.ts` generates circulation, counter positions and a preview bundle from a store, renderer-space footprint, known elevations and entrances. It accepts any number of floors, uses 4.5 m spacing when elevations are absent, and connects successive floors by paired station-family escalators. Aisles, counter placements and entrance ties are authored preview geometry, not surveyed navigation.

`stations/ikebukuro/scene/depato/interior.ts` builds collision geometry and loads within 40 m of an entrance, unloads on departure and keeps both floor shells visible around the active floor and escalator landing. The shared preview kit uses instanced showcases, food and downlights; one 1024 px name atlas; baked warm pools and paired escalators. Shallow ceiling bays, a main-aisle cove, warm showcases and contrasting escalator finishes share baked materials without scene lights. Eight whole-body station people per floor use narrow counter-side paths off circulation. Camera-only well covers keep the follow boom above the upper landing. It uses the shared landmark sign and door palette.

`stations/ikebukuro/scene/depato/pilot.ts` selects B1/1F from `stations/ikebukuro/data/depato-floors.json`, supplies the south-wing context footprint in `stations/ikebukuro/data/depato-footprint.json`, opens the station/context shells, and attaches the kit through `stations/ikebukuro/gteki/scene.ts`. Only the next preview loads it. `stations/ikebukuro/data/depato-rollout.json` adds the source-backed Tobu and PARCO footprints, instance circulation and entrance directions; B2/B1/1F use the same kit. The hook releases the previous store before loading the nearest one, including the pilot. Esola, Lumine and the three Sunshine stores are skipped with entrance/coverage reasons in that file. The floor file is the authoritative version-1 contract from the parallel data run; the adapter selects the first occurrence of B1/1F because the annex repeats those levels. The sign-font subset includes the shared floor files.

The station module’s optional `previewBundle` export is applied in `apps/web/src/registry.ts` before search/router construction when `StationEntry.load(true)` is requested. The UI passes its existing next flag. Default loads use the original bundle and scene.

Sunshine City (2026-11-26 JST) lives in `stations/ikebukuro/scene/sunshine.ts`. The next preview adds surface routes from Exit 35 via Sunshine 60 Street to the west plaza and the three exterior doors. The street mesh and graph share the same authored centreline. The existing PLATEAU shaft supplies the Sunshine 60 skyline, while the official 1F directory identifies its lobby entrance, ALPA’s west entrance, and World Import Mart’s north-side entrance. The first interior batch opens ALPA and World Import Mart B1/1F and Sunshine 60 B2/B1/1F, with searchable floor concourses and representative escalators based on the official directory.

Shinjuku's `stations/shinjuku/scene/depato.ts` uses the same kit and routes searches to PLATEAU-fitted 1F doors. NEWoMan uses Exit 3, Takashimaya uses Exit 4, and the other nine stores use Exit 1. The approaches and entrance sources are recorded in `stations/shinjuku/data/depato-rollout.json`. Shinjuku's surface layer opens the preview doors and clears guard rails along the routes. Updated 2026-11-25 JST.
