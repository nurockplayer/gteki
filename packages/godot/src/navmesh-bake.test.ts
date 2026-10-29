import { describe, expect, it } from "vitest";
import { NavMeshQuery } from "recast-navigation";
import { bakeNavmesh, completePath } from "./navmesh-bake.ts";
import { validateLinkSnap, verticalLinkCandidates } from "./navmesh-links.ts";

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
  it("accepts the finer sweep grid and rejects invalid settings", async () => {
    const { positions, indices } = rooms(true);
    const result = await bakeNavmesh(positions, indices, { cellSizeM: 0.1, climbM: 0.45, radiusM: 0.2 });
    expect(result.success).toBe(true);
    if (result.success) result.navMesh.destroy();
    await expect(bakeNavmesh(positions, indices, { cellSizeM: 0 })).rejects.toThrow();
    await expect(bakeNavmesh(positions, indices, { climbM: -1 })).rejects.toThrow();
  });
  it("builds a one-way off-mesh candidate and retains it through a bake", async () => {
    const { positions, indices } = rooms(false);
    const base = await bakeNavmesh(positions, indices);
    if (!base.success) throw new Error(base.error);
    const query = new NavMeshQuery(base.navMesh);
    const points: Record<string, {x:number;y:number;z:number}> = { a:{x:3,y:0,z:2}, b:{x:5,y:0,z:2}, high:{x:5,y:3,z:2} };
    const result = verticalLinkCandidates([
      { id:"one", mode:"stairs", from:"a", to:"b", direction:"forward" },
      { id:"missing", mode:"elevator", from:"a", to:"high", direction:"both" },
      { id:"walk", mode:"walk", from:"a", to:"b", direction:"both" },
    ], id => points[id], query, () => true);
    expect(result.candidates.map(c => c.edgeId)).toEqual(["one"]);
    expect(result.failed).toEqual([{ edgeId:"missing", reason:"snap_failed" }]);
    expect(result.candidates[0]!.connection.bidirectional).toBe(false);
    const unsafe = verticalLinkCandidates([{ id:"blocked", mode:"stairs", from:"a", to:"b", direction:"both" }], id => points[id], query, id => id !== "b");
    expect(unsafe.failed).toEqual([{ edgeId:"blocked", reason:"unsafe_snap" }]);
    query.destroy(); base.navMesh.destroy();
    const linked = await bakeNavmesh(positions, indices, { offMeshConnections: result.candidates.map(c => c.connection) });
    if (!linked.success) throw new Error(linked.error);
    const linkedQuery = new NavMeshQuery(linked.navMesh);
    expect(completePath(linkedQuery, points.a!, points.b!)).not.toBeNull();
    expect(completePath(linkedQuery, points.b!, points.a!)).toBeNull();
    linkedQuery.destroy(); linked.navMesh.destroy();
  });
});

it("rejects a vertical link snap across a scene wall", async () => {
  const THREE = await import("three");
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8,8).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  floor.updateMatrixWorld(true);
  const probe = { ground:[floor], collider:[], walls:[{a:{x:0,y:-2},b:{x:0,y:2},zMin:0,zMax:2}] };
  expect(validateLinkSnap(probe,{x:-0.5,y:0,z:0},{x:0.5,y:0,z:0})).toBe("wall");
  expect(validateLinkSnap(probe,{x:0.1,y:0,z:0},{x:0.5,y:0,z:0})).toBeNull();
  floor.geometry.dispose(); floor.material.dispose();
});

it("rejects a snap across an unsupported floor gap", async () => {
  const THREE = await import("three");
  const makeFloor=(x:number) => { const m=new THREE.Mesh(new THREE.PlaneGeometry(2,4).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); m.position.x=x; m.updateMatrixWorld(true); return m; };
  const left=makeFloor(-2), right=makeFloor(2);
  expect(validateLinkSnap({ground:[left,right],collider:[],walls:[]},{x:-1.5,y:0,z:0},{x:1.5,y:0,z:0})).toBe("floor");
  left.geometry.dispose(); right.geometry.dispose(); left.material.dispose(); right.material.dispose();
});

it("connects two separate floors using a stair link", async () => {
  const positions=[0,0,0, 0,0,4, 4,0,4, 4,0,0, 0,3,0, 0,3,4, 4,3,4, 4,3,0];
  const indices=[0,1,2,0,2,3,4,5,6,4,6,7];
  const base=await bakeNavmesh(positions,indices);
  if (!base.success) throw new Error(base.error);
  const query=new NavMeshQuery(base.navMesh);
  const points={a:{x:2,y:0,z:2},b:{x:2,y:3,z:2}};
  const built=verticalLinkCandidates([{id:"stair",mode:"stairs",from:"a",to:"b",direction:"both"}],id=>points[id as keyof typeof points],query,()=>true);
  expect(built.candidates).toHaveLength(1);
  query.destroy(); base.navMesh.destroy();
  const linked=await bakeNavmesh(positions,indices,{offMeshConnections:built.candidates.map(c=>c.connection)});
  if (!linked.success) throw new Error(linked.error);
  const q=new NavMeshQuery(linked.navMesh);
  const { queryPathWithLinks }=await import("./navmesh-audit.ts");
  const found = queryPathWithLinks(linked.navMesh,q,points.a,points.b);
  expect(found?.some(p=>p.link?.userId===1)).toBe(true);
  q.destroy(); linked.navMesh.destroy();
});

it("attaches a fallback connector from a snapped neighbour", async () => {
  const positions=[0,0,0,0,0,4,4,0,4,4,0,0,0,3,0,0,3,4,4,3,4,4,3,0];
  const indices=[0,1,2,0,2,3,4,5,6,4,6,7];
  const base=await bakeNavmesh(positions,indices); if (!base.success) throw new Error(base.error);
  const query=new NavMeshQuery(base.navMesh), points={a:{x:7,y:0,z:2},neighbor:{x:2,y:0,z:2},b:{x:2,y:3,z:2}};
  const snapped=query.findClosestPoint(points.neighbor,{halfExtents:{x:1.5,y:0.6,z:1.5}});
  const built=verticalLinkCandidates([{id:"stairs",mode:"stairs",from:"a",to:"b",direction:"both"}],id=>points[id as keyof typeof points],query,()=>true,id=>id==="a" ? {point:snapped.point,neighborId:"neighbor",edgeId:"walk"} : null);
  expect(built.candidates[0]?.fallback?.from?.neighborId).toBe("neighbor");
  query.destroy(); base.navMesh.destroy();
  const linked=await bakeNavmesh(positions,indices,{offMeshConnections:built.candidates.map(c=>c.connection)}); if (!linked.success) throw new Error(linked.error);
  const q=new NavMeshQuery(linked.navMesh), {queryPathWithLinks}=await import("./navmesh-audit.ts");
  expect(queryPathWithLinks(linked.navMesh,q,snapped.point,points.b)?.some(p=>p.link?.userId===1)).toBe(true);
  q.destroy(); linked.navMesh.destroy();
});

it("bakes a greybox floor and keeps its shell as obstacles", async () => {
  const THREE = await import("three");
  const { buildGreybox } = await import("../../../apps/web/src/explorer/greybox.ts");
  const { appendMeshes, triangleKey } = await import("./navmesh-bake.ts");
  const bundle = { floors:[{id:"f",renderElevationM:0}], nodes:[{id:"a",floorId:"f",position:{x:0,y:0,z:0}},{id:"b",floorId:"f",position:{x:10,y:0,z:0}}], edges:[{id:"e",from:"a",to:"b",mode:"walk"}] } as never;
  const grey = buildGreybox(bundle, () => true, () => false, { colliderNear:()=>false, wallHit:()=>null }, "low", true);
  grey.root.updateMatrixWorld(true);
  const data = grey.navFloors!, geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data,3));
  const a = new THREE.Vector3(...data.slice(0,3) as [number,number,number]);
  const b = new THREE.Vector3(...data.slice(3,6) as [number,number,number]);
  const c = new THREE.Vector3(...data.slice(6,9) as [number,number,number]);
  expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
  const floor = new THREE.Mesh(geometry); floor.updateMatrixWorld(true);
  const positions: number[] = [], indices: number[] = [], keys = new Set<string>();
  for (let i=0; i+8<data.length; i+=9) keys.add(triangleKey(data.slice(i,i+9)));
  appendMeshes([floor],positions,indices,false);
  appendMeshes(grey.colliders,positions,indices,true,new Map(),keys);
  const baked = await bakeNavmesh(positions,indices);
  if (!baked.success) throw new Error(baked.error);
  const query = new NavMeshQuery(baked.navMesh);
  expect(completePath(query,{x:1,y:0,z:0},{x:9,y:0,z:0})).not.toBeNull();
  expect(completePath(query,{x:5,y:0,z:0},{x:5,y:0,z:3})).toBeNull();
  query.destroy(); baked.navMesh.destroy(); geometry.dispose();
});

it("includes a greybox landing pad in the baked navmesh", async () => {
  const THREE=await import("three"), {buildGreybox}=await import("../../../apps/web/src/explorer/greybox.ts"), {appendMeshes,triangleKey}=await import("./navmesh-bake.ts");
  const bundle={floors:[{id:"low",renderElevationM:0},{id:"high",renderElevationM:4}],nodes:[{id:"a",floorId:"low",position:{x:0,y:0,z:0}},{id:"b",floorId:"high",position:{x:0,y:0,z:4}}],edges:[{id:"stairs",from:"a",to:"b",mode:"stairs"}]} as never;
  const grey=buildGreybox(bundle,()=>true,p=>p.z<2,{colliderNear:()=>false,wallHit:()=>null},"low",true);
  expect(grey.stats.landingPads).toBe(1);
  const data=grey.navFloors!, geometry=new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(data,3));
  const floor=new THREE.Mesh(geometry); floor.updateMatrixWorld(true);
  const positions:number[]=[], indices:number[]=[], keys=new Set<string>();
  for (let i=0;i+8<data.length;i+=9) keys.add(triangleKey(data.slice(i,i+9)));
  appendMeshes([floor],positions,indices,false); appendMeshes(grey.colliders,positions,indices,true,new Map(),keys);
  const baked=await bakeNavmesh(positions,indices,{cellSizeM:0.1}); if (!baked.success) throw new Error(baked.error);
  const query=new NavMeshQuery(baked.navMesh), found=query.findClosestPoint({x:0,y:4,z:0},{halfExtents:{x:1,y:0.6,z:1}});
  expect(found.success && !!found.polyRef && Math.abs(found.point.y-4)<0.6).toBe(true);
  query.destroy(); baked.navMesh.destroy(); geometry.dispose();
});

it("cuts only the portal opening out of a scene collider", async () => {
  const THREE = await import("three");
  const { appendMeshes } = await import("./navmesh-bake.ts");
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8,4).rotateX(-Math.PI/2).translate(4,0,2));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.05,2.5,4)); wall.position.set(4,1.25,2);
  floor.updateMatrixWorld(true); wall.updateMatrixWorld(true);
  const opening = {center:new THREE.Vector3(4,0,2), along:new THREE.Vector3(1,0,0), across:new THREE.Vector3(0,0,1), width:1.6, depth:0.6, height:2.3};
  const positions: number[] = [], indices: number[] = [];
  appendMeshes([floor],positions,indices,false);
  appendMeshes([wall],positions,indices,true,new Map([[wall,[opening]]]));
  const baked = await bakeNavmesh(positions,indices);
  if (!baked.success) throw new Error(baked.error);
  const query = new NavMeshQuery(baked.navMesh);
  expect(completePath(query,{x:2,y:0,z:2},{x:6,y:0,z:2})).not.toBeNull();
  const detour = completePath(query,{x:2,y:0,z:0.5},{x:6,y:0,z:0.5});
  expect(detour).not.toBeNull();
  expect(detour!.some(p => p.z > 1.2)).toBe(true);
  query.destroy(); baked.navMesh.destroy(); floor.geometry.dispose(); wall.geometry.dispose();
});

it.each(["pillar","beam"])("bridges a passage blocked by a %s", async kind=>{
  const THREE=await import("three"), {appendMeshes,applyBridgeGeometry}=await import("./navmesh-bake.ts"), {bridgeGapGeometry}=await import("./navmesh-bridge.ts");
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,4).rotateX(-Math.PI/2).translate(4,0,2),new THREE.MeshBasicMaterial()); floor.updateMatrixWorld(true);
  const shape=kind==="pillar" ? new THREE.BoxGeometry(0.3,2.5,4) : new THREE.BoxGeometry(1,0.3,4);
  const obstacle=new THREE.Mesh(shape,new THREE.MeshBasicMaterial()); obstacle.position.set(4,kind==="pillar" ? 1.25 : 1.5,2); obstacle.updateMatrixWorld(true);
  const positions:number[]=[],indices:number[]=[]; appendMeshes([floor],positions,indices,false); appendMeshes([obstacle],positions,indices,true);
  const start={x:2,y:0,z:2},end={x:6,y:0,z:2},base=await bakeNavmesh(positions,indices,{cellSizeM:0.1,radiusM:0.3}); if(!base.success) throw new Error(base.error);
  const q0=new NavMeshQuery(base.navMesh); expect(completePath(q0,start,end)).toBeNull(); q0.destroy(); base.navMesh.destroy();
  const line=[{x:2,y:-2,z:0,floorId:"f",zKnown:true,stepIndex:0},{x:6,y:-2,z:0,floorId:"f",zKnown:true,stepIndex:0}];
  const bridge=bridgeGapGeometry(line,[{startM:1,endM:3,class:kind==="pillar" ? "scene_obstruction" : "low_ceiling"}],2);
  expect(bridge.openings.length).toBeGreaterThan(0); expect(bridge.openings[0]!.height).toBeCloseTo(2.25);
  applyBridgeGeometry(positions,indices,bridge);
  const rebuilt=await bakeNavmesh(positions,indices,{cellSizeM:0.1,radiusM:0.3}); if(!rebuilt.success) throw new Error(rebuilt.error);
  const q1=new NavMeshQuery(rebuilt.navMesh); expect(completePath(q1,start,end)).not.toBeNull(); q1.destroy(); rebuilt.navMesh.destroy();
  floor.geometry.dispose(); shape.dispose();
});

it("does not bridge narrow gaps and makes 1.5 metre node pads",async()=>{
  const {bridgeGapGeometry,linkPadGeometry}=await import("./navmesh-bridge.ts");
  const line=[{x:0,y:0,z:0,floorId:"f",zKnown:true,stepIndex:0},{x:4,y:0,z:0,floorId:"f",zKnown:true,stepIndex:0}];
  const bridge=bridgeGapGeometry(line,[{startM:1,endM:2,class:"narrow"}],0.5);
  expect(bridge.openings).toEqual([]); expect(bridge.indices).toEqual([]);
  const pad=linkPadGeometry({x:0,y:2,z:0});
  expect(Math.max(...pad.positions.filter((_,i)=>i%3===0))-Math.min(...pad.positions.filter((_,i)=>i%3===0))).toBe(1.5);
  expect(pad.indices).toHaveLength(6);
});

it("connects a missing link landing with a pad and strip",async()=>{
  const {bridgeGapGeometry,linkPadGeometry}=await import("./navmesh-bridge.ts"), {applyBridgeGeometry}=await import("./navmesh-bake.ts");
  const positions=[0,0,0,0,0,4,4,0,4,4,0,0],indices=[0,1,2,0,2,3], p={x:5.5,y:0,z:2};
  const base=await bakeNavmesh(positions,indices,{cellSizeM:0.1,radiusM:0.3}); if(!base.success) throw new Error(base.error);
  const q0=new NavMeshQuery(base.navMesh), absent=q0.findClosestPoint(p,{halfExtents:{x:0.6,y:0.6,z:0.6}}),hit=q0.findClosestPoint(p,{halfExtents:{x:3,y:0.6,z:3}});
  expect(absent.polyRef).toBe(0); expect(hit.polyRef).not.toBe(0);
  const a={x:p.x,y:-p.z,z:p.y,floorId:"f",zKnown:true,stepIndex:0}, b={...a,x:hit.point.x,y:-hit.point.z,z:hit.point.y};
  const len=Math.hypot(a.x-b.x,a.y-b.y), strip=bridgeGapGeometry([a,b],[{startM:0,endM:len,class:"other"}],1.5),pad=linkPadGeometry(p);
  applyBridgeGeometry(positions,indices,strip); applyBridgeGeometry(positions,indices,pad); q0.destroy(); base.navMesh.destroy();
  const built=await bakeNavmesh(positions,indices,{cellSizeM:0.1,radiusM:0.3}); if(!built.success) throw new Error(built.error);
  const q1=new NavMeshQuery(built.navMesh), landed=q1.findClosestPoint(p,{halfExtents:{x:0.6,y:0.6,z:0.6}});
  expect(landed.polyRef).not.toBe(0); expect(completePath(q1,hit.point,p)).not.toBeNull(); q1.destroy(); built.navMesh.destroy();
});

it("does not open a wall or construct an overly steep landing strip",async()=>{
  const {linkStripGeometry}=await import("./navmesh-bridge.ts"),{auditPolyline}=await import("./route-clip-audit.ts");
  const probe={ground:[],collider:[],walls:[{a:{x:0,y:-2},b:{x:0,y:2},zMin:0,zMax:3}]};
  const p=(x:number,z:number)=>({x,y:0,z,floorId:"f",zKnown:true,stepIndex:0});
  expect(linkStripGeometry(probe,p(-1,0),p(1,0),auditPolyline).reason).toBe("wall");
  expect(linkStripGeometry({...probe,walls:[]},p(0,0),p(0.5,0.6),auditPolyline).reason).toBe("steep");
});
