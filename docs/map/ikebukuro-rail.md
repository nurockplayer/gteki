---
area: ikebukuro-rail
owner: rail-scaffold-ikebukuro
updated: 2026-11-26 JST
---
# Ikebukuro rail preview

`stations/ikebukuro/gteki/scene.ts` applies the rail bundle after depato and Sunshine when the web registry loads `?next=1`. Each `stations/ikebukuro/data/rail/<lane>.json` with a matching `stations/ikebukuro/scene/rail/<lane>.ts` contributes floors, graph edges and paid platform POIs. Lane identifiers must be unique across the station. A public gate with a routable POI uses its first connector node. Unplaced endpoints and platforms stay out of routing. For positioned gates, set `level` or match a level's elevation. Use `waypoints` for intermediate nodes and `via` for bends between nodes, in station ENU.

The scene module's default builder receives the loaded scene context and base scene. It returns a root, walkable meshes, optional colliders and camera blockers, and a disposer. The registry calls it when the camera approaches a lane node within 12 m and keeps the geometry until station unload. The explorer uses the lane's walkable meshes and skips its own corridor generation for those edges.

The sample is `stations/ikebukuro/data/rail/jr-yamanote.json` with a representative platform from JR Central Gates 1 and 2. Paid geometry is authored. The public approaches use the existing B1 graph. The station preview, data and scene hooks leave flag-off routing and rendering on their baseline paths.
