import { describe, expect, it } from "vitest";
import { NavMeshQuery } from "recast-navigation";
import { bakeNavmesh, completePath } from "./navmesh-bake.ts";

// Two 4 m rooms divided by a wall. The doorway is 1.6 m wide when open.
function rooms(door: boolean) {
  const positions: number[] = [], indices: number[] = [];
  function quad(a: number[], b: number[], c: number[], d: number[]) {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  quad([0, 0, 0], [0, 0, 4], [8, 0, 4], [8, 0, 0]);
  const wall = (z0: number, z1: number) => quad([4, 0, z0], [4, 2.5, z0], [4, 2.5, z1], [4, 0, z1]);
  if (door) { wall(0, 1.2); wall(2.8, 4); } else wall(0, 4);
  return { positions, indices };
}

describe("navmesh spike", () => {
  it.each([true, false])("respects the doorway (open: %s)", async (door) => {
    const { positions, indices } = rooms(door);
    const result = await bakeNavmesh(positions, indices);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const query = new NavMeshQuery(result.navMesh);
    const path = completePath(query, { x: 2, y: 0, z: 2 }, { x: 6, y: 0, z: 2 });
    expect(path !== null).toBe(door);
    query.destroy();
    result.navMesh.destroy();
  });
});
