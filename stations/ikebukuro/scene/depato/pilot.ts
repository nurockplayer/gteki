import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import footprintData from "../../data/depato-footprint.json";
import floorData from "../../data/depato-floors.json";
import rolloutData from "../../data/depato-rollout.json";
import { depatoBundle, depatoLayout, type PlanPoint, type DepatoInput } from "./layout.ts";
import { buildDepatoInterior } from "./interior.ts";

// PLATEAU context low GLB, ctx_bldg_t01_00: southern store wing of the connected
// station building, clipped at z=70/180 and x=0 (authored internal partitions).
// Source vertices are unchanged; this is a footprint, not a copied store floor plan.
const footprint = footprintData.footprint as PlanPoint[];
const store = floorData.stores.find(s => s.id === "seibu-ikebukuro")!;
const plan = () => depatoLayout({
  store: { ...store, floors: store.floors.filter((f,i,all) => ["B1", "1F"].includes(f.level) && all.findIndex(other => other.level === f.level) === i) },
  footprint, elevations: { "1F": 32.2 },
  poiId: "shop-ikb-seibu-honten", sourceId: "sogo-seibu-ikebukuro-floorguide-2026-10",
  entrances: [{ level: "B1", point: [15,70], outsideNode: "sp_e" }, { level: "1F", point: [49.365,122.5], outsideNode: "depato-seibu-street" }],
});

// Instance placement only: the accepted kit materials, lights and proportions are shared.
const rolloutPlans = () => rolloutData.stores.map(row => {
  const store = floorData.stores.find(s => s.id === row.id)!;
  return depatoLayout({ ...row, store: { ...store, floors: store.floors.filter((f,i,all) =>
    ["B2","B1","1F"].includes(f.level) && all.findIndex(other => other.level === f.level) === i) } } as DepatoInput);
});

/** Called before the host creates search/router; the flag-off bundle is never modified. */
export function previewBundle(bundle: StationBundle): StationBundle {
  const street = { id: "depato-seibu-street", floorId: "street", position: { x: 56, y: -122.5, z: 32.5 }, kind: "junction" as const, inOut: "outside" as const, sourceRefs: [] };
  const streets = rolloutData.stores.map(row => ({ ...street, id: row.street.id,
    position: { x: row.street.point[0]!, y: -row.street.point[1]!, z: row.elevations["1F"] } }));
  return rolloutPlans().reduce(depatoBundle, depatoBundle({ ...bundle, nodes: [...bundle.nodes, street, ...streets] }, plan()));
}

/** One station hook: wrap context loading, open the station shell and attach the reusable kit. */
export async function buildPilotScene(ctx: SceneContext, base: BuildScene) {
  const THREE = ctx.THREE, layout = plan(), layouts = [layout, ...rolloutPlans()];
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const volume = (left: number, right: number, front: number, back: number, low: number, high: number): CutRegion => ({
    key: {}, bounds: new THREE.Box3(new THREE.Vector3(left, low, front), new THREE.Vector3(right, high, back)), clip: null,
    planes: [p => p.x-left, p => right-p.x, p => p.z-front, p => back-p.z, p => p.y-low, p => high-p.y], accepts: () => true,
  });
  const room = volume(0,54,69.9,180,27.6,36.1);
  const entrance = volume(13,17,60,72,27.6,30.8);
  entrance.rejectsMesh = mesh => mesh.parent?.userData.gteki_role === "sign";
  const streetDoors=layout.input.entrances.filter(e=>ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!.inOut==="outside").map(e=>{
    const outside=ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!,p=ctx.enuToRenderer({...outside.position,z:outside.position.z!});
    const front=Math.abs(e.point[1]-layout.bounds.front)<0.1,y=layout.height(e.level);
    return volume(Math.min(e.point[0],p[0])- (front?2.1:0.2),Math.max(e.point[0],p[0])+(front?2.1:3),
      Math.min(e.point[1],p[2])-(front?0.2:2.1),Math.max(e.point[1],p[2])+(front?3:2.1),y+0.01,y+4.1);
  });
  const rolloutRooms = layouts.slice(1).flatMap(p => {
    const points=p.input.footprint.map(([x,z])=>new THREE.Vector2(x,z));
    return THREE.ShapeUtils.triangulateShape(points,[]).map(indices=>{
      const tri=indices.map(i=>points[i]!), minY=p.height(p.floors[0]!.level)-0.1, maxY=p.height("1F")+4.1;
      const cut=volume(Math.min(...tri.map(v=>v.x))-0.01,Math.max(...tri.map(v=>v.x))+0.01,
        Math.min(...tri.map(v=>v.y))-0.01,Math.max(...tri.map(v=>v.y))+0.01,minY,maxY);
      const cross=(a:import("three").Vector2,b:import("three").Vector2,x:number,z:number)=>(b.x-a.x)*(z-a.y)-(b.y-a.y)*(x-a.x);
      const sign=Math.sign(cross(tri[0]!,tri[1]!,tri[2]!.x,tri[2]!.y));
      cut.planes=[v=>v.y-minY,v=>maxY-v.y,...tri.map((a,i)=>{
        const b=tri[(i+1)%3]!;return (v:import("three").Vector3)=>sign*cross(a,b,v.x,v.z);
      })];
      return cut;
    });
  });
  const rolloutDoors=layouts.slice(1).flatMap(p=>p.input.entrances.map(e=>{
    const outside=ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!,a=ctx.enuToRenderer({...outside.position,z:outside.position.z!}),y=p.height(e.level);
    return volume(Math.min(a[0],e.point[0])-2.1,Math.max(a[0],e.point[0])+2.1,
      Math.min(a[2],e.point[1])-2.1,Math.max(a[2],e.point[1])+2.1,y-0.1,y+4.1);
  }));
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri.includes("ikebukuro_context_")) { loaded.scene.updateMatrixWorld(true); cutRegions(loaded.scene, [room, ...streetDoors, ...rolloutRooms, ...rolloutDoors], resources); }
    return loaded;
  } });
  // The background catalog adds merged stair nosings; cut them after attachment too.
  await scene.settled?.();
  scene.root.updateMatrixWorld(true);
  cutRegions([scene.root, ...scene.walkable, ...(scene.colliders ?? [])], [room, entrance, ...rolloutRooms, ...rolloutDoors], resources);
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(p=>p.floors.flatMap(f=>[f.label.ja,...f.tenants.map(t=>t.ja)])).join(""));
  const interiors = layouts.map(p=>buildDepatoInterior(ctx, p, scene.generatedMeshEnvMap));
  let avatar: {x:number;y:number;z:number}|null=null;
  const focus = scene.setCameraFocus;
  scene.root.add(...interiors.map(i=>i.root));
  const update = scene.update, dispose = scene.dispose;
  return { ...scene, walkable: [...scene.walkable, ...interiors.flatMap(i=>i.walkable)], colliders: [...(scene.colliders ?? []), ...interiors.flatMap(i=>i.colliders)],
    cameraBlockers: [...(scene.cameraBlockers ?? []), ...interiors.flatMap(i=>i.cameraBlockers)],
    setCameraFocus: (...args: Parameters<NonNullable<StationScene["setCameraFocus"]>>) => { focus?.(...args); avatar=args[3] ?? null; interiors.forEach(i=>i.setAvatar(avatar)); },
    update: (dt: number, elapsed: number, camera?: import("three").Camera) => { update?.(dt,elapsed,camera); if(camera){
      const cp=camera.getWorldPosition(new THREE.Vector3()),p=avatar??{x:cp.x,y:cp.y-2,z:cp.z};
      const distances=layouts.map(l=>l.contains([p.x,p.z]) && p.y>=l.height(l.floors[0]!.level)-1 && p.y<=l.height("1F")+4.1 ? 0 :
        Math.min(...l.input.entrances.map(e=>Math.hypot(p.x-e.point[0],p.z-e.point[1],p.y-l.height(e.level)))));
      const active=distances.indexOf(Math.min(...distances));
      // Release the previous store before a neighbour allocates its detail.
      interiors.forEach((i,n)=>{if(n!==active)i.update(camera,dt,elapsed,false);});
      interiors[active]!.update(camera,dt,elapsed);
    } },
    dispose() { disposePortalCuts(resources); interiors.forEach(i=>i.dispose()); dispose(); },
  };
}
