import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { NavMeshQuery, type NavMesh } from "recast-navigation";
import { bakeNavmesh } from "./navmesh-bake.ts";
import { assertPrivateRegionsProvenance, auditGatePath, connectorFallbackPolyline, floorSnapPath, queryCompletePath, queryPathWithLinks, snapNode } from "./navmesh-audit.ts";
import { createRouter, routePolyline } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { auditPolyline, sceneProbe } from "./route-clip-audit.ts";

function fixture(open: boolean, width = 1.6) {
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
  if (open) { if (width < 4) { wall(0,2-width/2); wall(2+width/2,4); } } else wall(0,4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8,4).rotateX(-Math.PI/2).translate(4,0,2), new THREE.MeshBasicMaterial());
  const root = new THREE.Group().add(floor,...walls); root.updateMatrixWorld(true);
  return { positions, indices, probe: sceneProbe({ root, walkable: [floor], colliders: walls, walls: [] } as never) };
}

// Choose strict interior points from a real ground polygon; open floors can still tessellate into several polygons.
function gatePointsInsideOnePoly(nav: NavMesh) {
  for (let i=0;i<nav.getMaxTiles();i++) {
    const tile=nav.getTile(i), header=tile.header(); if (!header) continue;
    for (let j=0;j<header.polyCount();j++) {
      const poly=tile.polys(j); if (poly.getType() !== 0) continue;
      const vertices=Array.from({length:poly.vertCount()},(_,k)=>({x:tile.verts(poly.verts(k)*3),z:tile.verts(poly.verts(k)*3+2)}));
      const center=vertices.reduce((c,v)=>({x:c.x+v.x/vertices.length,z:c.z+v.z/vertices.length}),{x:0,z:0});
      const first=vertices[0]!;
      const last=vertices.reduce((best,v)=>Math.hypot(v.x-first.x,v.z-first.z)>Math.hypot(best.x-first.x,best.z-first.z) ? v : best,first);
      const inside=(v:typeof first)=>({x:center.x*0.8+v.x*0.2,y:0,z:center.z*0.8+v.z*0.2});
      return {a:inside(first),b:inside(last)};
    }
  }
  throw new Error("no walking polygon for wide gate fixture");
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


it.each([0.5,4])("audits directional gates only through their own links (opening %s)", async width => {
  const {positions,indices,probe}=fixture(true,width);
  const {verticalLinkCandidates,validateLinkSnap}=await import("./navmesh-links.ts");
  const points={a:{x:3,y:0,z:2},b:{x:5,y:0,z:2}};
  const base=await bakeNavmesh(positions,indices); if (!base.success) throw new Error(base.error);
  const query=new NavMeshQuery(base.navMesh);
  if (width === 4) Object.assign(points,gatePointsInsideOnePoly(base.navMesh));
  const candidates=verticalLinkCandidates([
    {id:"gate-out",mode:"gate",from:"a",to:"b",direction:"forward"},
    {id:"gate-in",mode:"gate",from:"b",to:"a",direction:"forward"},
  ],id=>points[id as keyof typeof points],query,(id,node,snap)=>validateLinkSnap(probe,node,snap)===null).candidates;
  expect(candidates).toHaveLength(2);
  query.destroy(); base.navMesh.destroy();
  const linked=await bakeNavmesh(positions,indices,{offMeshConnections:candidates.map(c=>c.connection)});
  if (!linked.success) throw new Error(linked.error);
  const q=new NavMeshQuery(linked.navMesh);
  const outCandidate=candidates.find(c=>c.edgeId === "gate-out")!, inCandidate=candidates.find(c=>c.edgeId === "gate-in")!;
  const out={connection:{...outCandidate.connection,userId:outCandidate.connection.userId!}};
  const incoming={connection:{...inCandidate.connection,userId:inCandidate.connection.userId!}};
  const line=[{x:points.a.x,y:-points.a.z,z:points.a.y,zKnown:true,floorId:"f",stepIndex:0},{x:points.b.x,y:-points.b.z,z:points.b.y,zKnown:true,floorId:"f",stepIndex:0}];
  const validate=(node:typeof points.a,snap:typeof points.a)=>validateLinkSnap(probe,node,snap)===null;
  if (width === 4) {
    expect(q.findClosestPoint(out.connection.startPosition).polyRef).toBe(q.findClosestPoint(out.connection.endPosition).polyRef);
    const walking=queryPathWithLinks(linked.navMesh,q,out.connection.startPosition,out.connection.endPosition);
    expect(walking).not.toBeNull();
    expect(walking!.some(p=>p.link)).toBe(false);
  }
  expect(auditGatePath(linked.navMesh,q,points.a,points.b,line,validate,out)).toMatchObject({missing:false,reason:null,pathRejection:null});
  const reverse=[...line].reverse();
  expect(auditGatePath(linked.navMesh,q,points.b,points.a,reverse,validate,incoming)).toMatchObject({missing:false,reason:null,pathRejection:null});
  expect(auditGatePath(linked.navMesh,q,points.a,points.b,line,validate,undefined)).toMatchObject({points:null,missing:true,reason:"no_path",pathRejection:"missing_link"});
  expect(auditGatePath(linked.navMesh,q,points.b,points.a,reverse,validate,out,true)).toMatchObject({points:null,missing:true,reason:"no_path",pathRejection:"wrong_link"});
  const mislabeled={connection:{...out.connection,userId:incoming.connection.userId!}};
  expect(auditGatePath(linked.navMesh,q,points.a,points.b,line,validate,mislabeled)).toMatchObject({points:null,missing:true,reason:"no_path",pathRejection:"wrong_link"});
  q.destroy(); linked.navMesh.destroy();
});


it("audits a two-way gate backwards even when both endpoints share a walking polygon", async () => {
  const {positions,indices,probe}=fixture(true,4);
  const base=await bakeNavmesh(positions,indices); if (!base.success) throw new Error(base.error);
  const {a:from,b:to}=gatePointsInsideOnePoly(base.navMesh);
  const q0=new NavMeshQuery(base.navMesh);
  const connection={startPosition:snapNode(q0,from)!,endPosition:snapNode(q0,to)!,radius:0.3,bidirectional:true,area:0,flags:1,userId:7};
  q0.destroy(); base.navMesh.destroy();
  const linked=await bakeNavmesh(positions,indices,{offMeshConnections:[connection]});
  if (!linked.success) throw new Error(linked.error);
  const q=new NavMeshQuery(linked.navMesh), {validateLinkSnap}=await import("./navmesh-links.ts");
  const line=[{x:to.x,y:-to.z,z:to.y,zKnown:true,floorId:"f",stepIndex:0},{x:from.x,y:-from.z,z:from.y,zKnown:true,floorId:"f",stepIndex:0}];
  const result=auditGatePath(linked.navMesh,q,to,from,line,(a,b)=>validateLinkSnap(probe,a,b)===null,{connection},true);
  expect(result).toMatchObject({missing:false,reason:null,pathRejection:null});
  expect([result.points![0]!,result.points!.at(-1)!].map(p=>[p.x,p.y,p.z])).toEqual([[connection.endPosition.x,-connection.endPosition.z,connection.endPosition.y],[connection.startPosition.x,-connection.startPosition.z,connection.startPosition.y]]);
  q.destroy(); linked.navMesh.destroy();
});


it("rejects the authored gate bend when the explorer route crosses a machine", async () => {
  const {positions,indices,probe}=fixture(true,0.5);
  const {verticalLinkCandidates,validateLinkSnap}=await import("./navmesh-links.ts");
  const {fallbackGate}=await import("./navmesh-fallback-audit.ts");
  const points={a:{x:3,y:0,z:2},b:{x:5,y:0,z:2}};
  const base=await bakeNavmesh(positions,indices); if (!base.success) throw new Error(base.error);
  const q0=new NavMeshQuery(base.navMesh);
  const candidate=verticalLinkCandidates([{id:"gate",mode:"gate",from:"a",to:"b",direction:"both"}],id=>points[id as keyof typeof points],q0,(_id,a,b)=>validateLinkSnap(probe,a,b)===null).candidates[0]!;
  expect(candidate).toBeDefined();
  q0.destroy(); base.navMesh.destroy();
  const linked=await bakeNavmesh(positions,indices,{offMeshConnections:[candidate.connection]});
  if (!linked.success) throw new Error(linked.error);
  const q=new NavMeshQuery(linked.navMesh), link={connection:{...candidate.connection,userId:candidate.connection.userId!}};
  const line=[{x:3,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0},{x:4.3,y:-1,z:0,zKnown:true,floorId:"f",stepIndex:0},{x:5,y:-2,z:0,zKnown:true,floorId:"f",stepIndex:0}];
  const result=auditGatePath(linked.navMesh,q,points.a,points.b,line,(a,b)=>validateLinkSnap(probe,a,b)===null,link);
  expect(result.missing).toBe(false);
  const collision=auditPolyline(probe,result.points!);
  expect(collision.wallHits).toBeGreaterThan(0);
  expect(fallbackGate({fallback:{failed:[]},unlisted:[],navmesh:{offFloor:0,noFloor:0,wallHits:0},connector:collision,incompleteRoutes:0}).ok).toBe(false);
  q.destroy(); linked.navMesh.destroy();
});

it("rejects stale private geometry even with an unchanged bundle and no suspect edges", async () => {
  const { privateRegionsSha256 } = await import("./navmesh-input.ts");
  const regions = [{ kind: "polygon" as const, level: "synthetic", y: 0, rings: [[{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]] }];
  const provenance = { privateRegionsSha256: privateRegionsSha256(regions) };
  expect(provenance.privateRegionsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(() => assertPrivateRegionsProvenance(provenance, structuredClone(regions))).not.toThrow();
  const changed = structuredClone(regions); changed[0]!.rings[0]![0]!.x = 1;
  expect(() => assertPrivateRegionsProvenance(provenance, changed)).toThrow(/private regions differ; rebake/);
  const withHole = structuredClone(regions);
  withHole[0]!.rings.push([{ x: 3, z: 3 }, { x: 7, z: 3 }, { x: 7, z: 7 }]);
  expect(() => assertPrivateRegionsProvenance(provenance, withHole)).toThrow(/rebake/);
  const withMask = [{ ...regions[0]!, exclusions: [[[{ x: 30, z: 30 }, { x: 31, z: 30 }, { x: 31, z: 31 }]]] }];
  expect(() => assertPrivateRegionsProvenance(provenance, withMask)).toThrow(/rebake/);
  expect(() => assertPrivateRegionsProvenance({}, regions)).toThrow(/rebake/);
  expect(() => assertPrivateRegionsProvenance(provenance, undefined)).toThrow(/rebake/);
  expect(() => assertPrivateRegionsProvenance({}, undefined)).not.toThrow();
});


it.each([false,true])("keeps a snap_failed stair fallback on the built floor (reversed %s)", async reversed => {
  const bundle=createSyntheticBundle([syntheticEdge("exit-stair","start","upper",{mode:"stairs"})]);
  // The built floor is flat for 5 m, then rises: its endpoint chord leaves the floor.
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,0,-1,0,0,1,5,0,1,5,0,-1,5,0,-1,5,0,1,10,4,1,10,4,-1],3));
  geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
  const floor=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const root=new THREE.Group().add(floor); root.updateMatrixWorld(true);
  const probe=sceneProbe({root,walkable:[floor],colliders:[],walls:[]} as never);
  // This navmesh has no polygon at either stair endpoint, as with an unattached connector.
  const baked=await bakeNavmesh([20,0,0,20,0,4,28,0,4,28,0,0],[0,1,2,0,2,3]);
  if (!baked.success) throw new Error(baked.error);
  const query=new NavMeshQuery(baked.navMesh);
  expect(snapNode(query,{x:0,y:0,z:0})).toBeNull();
  const route=createRouter(bundle).route(reversed ? "upper":"start",reversed ? "start":"upper");
  if (!route.ok) throw new Error(route.message);
  const raw=routePolyline(bundle,route);
  const {buildConnectorPath}=await import("@gteki/navigation");
  expect(buildConnectorPath(query,{x:0,y:0,z:0},{x:10,y:4,z:0},raw,()=>true).reason).toBe("snap_failed");
  expect(auditPolyline(probe,raw).offFloor).toBeGreaterThan(0);
  const paths=new Map([["exit-stair",[{x:0,y:0,z:0},{x:5,y:0,z:0},{x:10,y:0,z:4}]]]);
  const fallback=connectorFallbackPolyline(bundle,route,paths);
  expect(auditPolyline(probe,fallback)).toMatchObject({offFloor:0,noFloor:0,wallHits:0});
  expect(fallback.map(p=>[p.x,p.z])).toEqual(reversed ? [[10,4],[5,0],[0,0]]:[[0,0],[5,0],[10,4]]);
  // An audit fallback does not manufacture a runtime path for the missing snap.
  expect(routePolyline(bundle,route,paths,{})).toEqual([]);
  query.destroy(); baked.navMesh.destroy(); geometry.dispose(); floor.material.dispose();
});
