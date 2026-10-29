import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NavMeshQuery } from "recast-navigation";
import { bakeNavmesh } from "./navmesh-bake.ts";
import { queryCompletePath, snapNode } from "./navmesh-audit.ts";
import { auditPolyline, sceneProbe } from "./route-clip-audit.ts";

function fixture(open: boolean) {
  const positions: number[] = [], indices: number[] = [];
  const quad = (...corners: number[][]) => {
    const n = positions.length / 3;
    positions.push(...corners.flat()); indices.push(n,n+1,n+2,n,n+2,n+3);
  };
  quad([0,0,0], [0,0,4], [8,0,4], [8,0,0]);
  const walls: THREE.Mesh[] = [];
  const wall = (z0: number, z1: number) => {
    quad([4,0,z0], [4,2.5,z0], [4,2.5,z1], [4,0,z1]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.5, z1-z0), new THREE.MeshBasicMaterial());
    m.position.set(4, 1.25, (z0+z1)/2); walls.push(m);
  };
  if (open) { wall(0,1.2); wall(2.8,4); } else wall(0,4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8,4).rotateX(-Math.PI/2).translate(4,0,2), new THREE.MeshBasicMaterial());
  const root = new THREE.Group().add(floor,...walls); root.updateMatrixWorld(true);
  return { positions, indices, probe: sceneProbe({ root, walkable: [floor], colliders: walls, walls: [] } as never) };
}

describe("navmesh route audit", () => {
  it.each([true, false])("handles two rooms with door open=%s", async open => {
    const { positions, indices, probe } = fixture(open);
    const baked = await bakeNavmesh(positions, indices);
    if (!baked.success) throw new Error(baked.error);
    const query = new NavMeshQuery(baked.navMesh);
    const from = snapNode(query, { x:2, y:0, z:2 }), to = snapNode(query, { x:6, y:0, z:2 });
    expect(from).not.toBeNull(); expect(to).not.toBeNull();
    const path = queryCompletePath(query, from!, to!);
    if (open) {
      expect(path).not.toBeNull();
      const points = path!.map((p,i) => ({ x:p.x, y:-p.z, z:p.y, floorId:"f", zKnown:true, stepIndex:i-1 }));
      expect(auditPolyline(probe, points).wallHits).toBe(0);
    } else expect(path).toBeNull();
    query.destroy(); baked.navMesh.destroy();
  });
});
