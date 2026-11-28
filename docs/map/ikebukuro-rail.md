---
area: ikebukuro-rail
owner: rail-scaffold-ikebukuro
updated: 2026-11-28 JST
---
# Ikebukuro rail preview

`stations/ikebukuro/gteki/scene.ts` applies the rail bundle after the department-store pilot when the web registry loads `?next=1`. Each `stations/ikebukuro/data/rail/<lane>.json` with a matching `stations/ikebukuro/scene/rail/<lane>.ts` contributes floors, graph edges and paid platform POIs. Lane identifiers must be unique across the station. A public gate with a routable POI uses its first connector node. Unplaced endpoints and platforms stay out of routing. For positioned gates, set `level` or match a level's elevation. Use `waypoints` for intermediate nodes and `via` for bends between nodes, in station ENU.

Ikebukuro and Shinjuku share the lane schema, filename matching and chunk lifecycle in `packages/scene-api/src/rail-registry.ts`. The scene module's default builder receives the context, lane data and base scene. It returns a root, walkable meshes, optional colliders and camera blockers, and a disposer. In Ikebukuro the registry loads the chunk when the walker comes within 12 m of a lane node. The explorer generates the public seam to North Gate with the existing concourse and uses the lane's walkable meshes for the rest of the JR extension.

The JR lane is `stations/ikebukuro/data/rail/jr.json`. It joins eight numbered platform faces on four islands to Central 1, Central 2, South, North and Metropolitan. Central 1 and South share a paid hall with a lift to each island. The preview approaches use existing public graph anchors, with authored geometry between the anchors and the North and Metropolitan thresholds.

Each lane supplies a `publication` record with the usual station data-file fields except `path`, which the web build derives from the lane's location. The build checks the lane record under the same rights rules as any other station data file.
