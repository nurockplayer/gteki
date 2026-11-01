import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { NavMeshQuery } from "recast-navigation";
import { bakeNavmesh } from "./navmesh-bake.ts";
import { floorSnapPath, queryCompletePath, snapNode } from "./navmesh-audit.ts";
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

it("uses the authored connector even when Detour chooses the other link", async () => {
  const { buildConnectorPath } = await import("@gteki/navigation");
  const { queryPathWithLinks } = await import("./navmesh-audit.ts");
  const positions=[0,0,0,0,0,6,6,0,6,6,0,0,0,3,0,0,3,6,6,3,6,6,3,0];
  const indices=[0,1,2,0,2,3,4,5,6,4,6,7];
  const baked=await bakeNavmesh(positions,indices,{offMeshConnections:[
    {startPosition:{x:4,y:0,z:2},endPosition:{x:4,y:3,z:2},radius:0.3,bidirectional:true,area:0,flags:1,userId:1},
    {startPosition:{x:2,y:0,z:2},endPosition:{x:2,y:3,z:2},radius:0.3,bidirectional:true,area:0,flags:1,userId:2},
  ]});
  if (!baked.success) throw new Error(baked.error);
  const query=new NavMeshQuery(baked.navMesh), from={x:2,y:0,z:2}, to={x:2,y:3,z:2};
  expect(queryPathWithLinks(baked.navMesh,query,from,to)?.some(p=>p.link?.userId===2)).toBe(true);
  const line=[{x:2,y:-2,z:0,zKnown:true,floorId:"low",stepIndex:0},{x:3,y:-2,z:1.5,zKnown:true,floorId:"low",stepIndex:0},{x:2,y:-2,z:3,zKnown:true,floorId:"high",stepIndex:0}];
  const result=buildConnectorPath(query,from,to,line,()=>true);
  expect(result.reason).toBeNull();
  expect(result.points?.map(p=>p.x)).toEqual([2,2,3,2,2]);
  expect(result.points?.every(p=>p.connector)).toBe(true);
  expect(buildConnectorPath(query,from,to,line,()=>false).reason).toBe("snap_failed");
  query.destroy(); baked.navMesh.destroy();
});

it("rejects connector joins over 0.6 m", async () => {
  const { buildConnectorPath } = await import("@gteki/navigation");
  const {positions,indices}=fixture(true), baked=await bakeNavmesh(positions,indices);
  if (!baked.success) throw new Error(baked.error);
  const query=new NavMeshQuery(baked.navMesh), from={x:2,y:0,z:2}, to={x:3,y:0,z:2};
  const line=[{x:2.61,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0},{x:3,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0}];
  expect(buildConnectorPath(query,from,to,line,()=>true).reason).toBe("join_gap");
  query.destroy(); baked.navMesh.destroy();
});


it("rejects a connector snap across a wall", async () => {
  const { buildConnectorPath } = await import("@gteki/navigation");
  const { validateLinkSnap } = await import("./navmesh-links.ts");
  const {positions,indices,probe}=fixture(false), baked=await bakeNavmesh(positions,indices);
  if (!baked.success) throw new Error(baked.error);
  const query=new NavMeshQuery(baked.navMesh), from={x:3.8,y:0,z:2}, to={x:6,y:0,z:2};
  const hit=query.findClosestPoint(to,{halfExtents:{x:1.5,y:0.6,z:1.5}});
  vi.spyOn(query,"findClosestPoint").mockReturnValue({...hit,point:{x:4.2,y:0,z:2}});
  const line=[{x:3.8,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0},{x:6,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0}];
  expect(buildConnectorPath(query,from,to,line,(node,snap)=>validateLinkSnap(probe,node,snap)===null).reason).toBe("snap_failed");
  query.destroy(); baked.navMesh.destroy();
});

describe("floorSnapPath", () => {
  // Flat to x=2, then a 1:4 ramp up to x=6 (1 m high), flat after.
  const floor = (p: { x: number }) => p.x <= 2 ? 0 : p.x >= 6 ? 1 : (p.x - 2) / 4;
  it("snaps every vertex to the floor and adds points where the floor bends between vertices", () => {
    const out = floorSnapPath([{ x:0, y:0, z:0.4 }, { x:8, y:0, z:0.4 }], floor);
    expect(out[0]).toEqual({ x:0, y:0, z:0 });
    expect(out.at(-1)).toEqual({ x:8, y:0, z:1 });
    expect(out.every(p => Math.abs(p.z - floor(p)) < 1e-9)).toBe(true);
    // Between consecutive points the straight line stays within 0.05 m of the floor wherever the span is over 0.25 m.
    for (let i = 1; i < out.length; i++) {
      const a = out[i-1]!, b = out[i]!;
      if (b.x - a.x <= 0.25) continue;
      for (let t = 0.1; t < 1; t += 0.1) { const x = a.x + (b.x - a.x) * t; expect(Math.abs(a.z + (b.z - a.z) * t - floor({ x }))).toBeLessThan(0.05 + 1e-9); }
    }
    expect(out.map(p => p.x)).toEqual([...out.map(p => p.x)].sort((m, n) => m - n));
  });
  it("adds nothing on a flat floor or a uniform ramp", () => {
    expect(floorSnapPath([{ x:0, y:0, z:0.3 }, { x:2, y:0, z:0.3 }], floor)).toEqual([{ x:0, y:0, z:0 }, { x:2, y:0, z:0 }]);
    expect(floorSnapPath([{ x:2, y:0, z:0 }, { x:6, y:0, z:0 }], floor)).toHaveLength(2);
  });
});
