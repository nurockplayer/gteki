---
area: ikebukuro-rail
owner: rail-scaffold-ikebukuro
updated: 2026-11-26 JST
---
# Ikebukuro rail preview

`stations/ikebukuro/gteki/scene.ts` applies the rail bundle after the department-store pilot when the web registry loads `?next=1`. Each `stations/ikebukuro/data/rail/<lane>.json` with a matching `stations/ikebukuro/scene/rail/<lane>.ts` contributes floors, graph edges and paid platform POIs. Lane identifiers must be unique across the station. A public gate with a routable POI uses its first connector node. Unplaced endpoints and platforms stay out of routing. For positioned gates, set `level` or match a level's elevation. Use `waypoints` for intermediate nodes and `via` for bends between nodes, in station ENU.

Ikebukuro and Shinjuku share the lane schema, filename matching and chunk lifecycle in `packages/scene-api/src/rail-registry.ts`. The scene module's default builder receives the context, lane data and base scene. It returns a root, walkable meshes, optional colliders and camera blockers, and a disposer. In Ikebukuro the registry loads the chunk when the walker comes within 12 m of a lane node. The explorer uses the lane's walkable meshes and skips its own corridor generation for those edges.

The JR lane is `stations/ikebukuro/data/rail/jr.json` with its first playable island, Yamanote platforms 5 and 6, reached from JR Central Gates 1 and 2. Paid geometry is authored. The public approaches use the existing B1 graph. The station preview, data and scene hooks leave flag-off routing and rendering on their baseline paths.

Each lane supplies a `publication` record with the usual station data-file fields except `path`, which the web build derives from the lane's location. The build checks the lane record under the same rights rules as any other station data file.
