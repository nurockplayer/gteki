/** Small, scene-independent Recast entry point used by the navmesh spike. */
import { pathToFileURL } from "node:url";
import { init, NavMeshQuery } from "recast-navigation";
import { generateTiledNavMesh } from "recast-navigation/generators";
import { WALKER_BODY } from "@gteki/scene-api";

/** Positions are renderer coordinates; triangle indices must have upward-facing floors. */
export async function bakeNavmesh(positions: readonly number[], indices: readonly number[]) {
  await init();
  const cs = 0.1, ch = 0.1;
  return generateTiledNavMesh(positions, indices, {
    cs, ch, tileSize: 128,
    walkableRadius: Math.ceil(WALKER_BODY.radiusM / cs),
    walkableHeight: Math.ceil(1.7 / ch),
    walkableClimb: Math.floor(0.3 / ch + 1e-6),
    walkableSlopeAngle: 40,
  });
}

/** Detour may return a partial path as success; accept only paths reaching the snapped end. */
export function completePath(query: NavMeshQuery, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
  const extents = { x: 1, y: 1, z: 1 };
  const start = query.findClosestPoint(from, { halfExtents: extents });
  const end = query.findClosestPoint(to, { halfExtents: extents });
  if (!start.success || !start.polyRef || !end.success || !end.polyRef) return null;
  const result = query.computePath(start.point, end.point, { halfExtents: extents });
  const last = result.path.at(-1);
  if (!result.success || !last || Math.hypot(last.x - end.point.x, last.y - end.point.y, last.z - end.point.z) > 0.01) return null;
  return result.path;
}

// The station scene bake is not implemented yet. Never silently report a successful bake.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("Station navmesh bake is not implemented; no output was written.");
  process.exitCode = 1;
}
