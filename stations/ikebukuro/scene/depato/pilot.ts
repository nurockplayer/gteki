import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import type { Edge, Poi, StationBundle } from "@gteki/schema";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import footprintData from "../../data/depato-footprint.json";
import floorData from "../../data/depato-floors.json";
import rolloutData from "../../data/depato-rollout.json";
import { depatoBundle, depatoLayout, type PlanPoint } from "./layout.ts";
import { buildDepatoInterior } from "./interior.ts";

// PLATEAU context low GLB, ctx_bldg_t01_00: southern store wing of the connected
// station building, clipped at z=70/180 and x=0 (authored internal partitions).
// Source vertices are unchanged; this is a footprint, not a copied store floor plan.
const footprint = footprintData.footprint as PlanPoint[];
const store = floorData.stores.find(s => s.id === "seibu-ikebukuro")!;
const tobuId = "tobu-ikebukuro";
const upperBank = { transfer: "8F", x: -70, from: -142, to: -130 };
const towerPlate: PlanPoint[] = [[-78, -145], [-51, -145], [-52, -118], [-78, -118]];
const lift = {
  x: -75.5, z: -120.5, entrance: "1F", destinations: ["11F", "12F", "13F", "14F", "15F"],
  source: "https://www.tobu-dept.jp/ikebukuro/event/detail/8830",
};
// Street waypoints from the Exit 18 stair top around the northwest corner to the existing retail apron.
const tobuApproach = [
  [-108, -155, 33.14], [-120, -150, 33.09], [-125, -122, 32.98],
  [-126, -81, 32.8], [-125, -49, 32.68],
];
const plan = () => depatoLayout({
  store: { ...store, floors: store.floors.filter((f,i,all) => ["B1", "1F"].includes(f.level) && all.findIndex(other => other.level === f.level) === i) },
  footprint, elevations: { "1F": 32.2 },
  poiId: "shop-ikb-seibu-honten", sourceId: "sogo-seibu-ikebukuro-floorguide-2026-10",
  entrances: [{ level: "B1", point: [15,70], outsideNode: "sp_e" }, { level: "1F", point: [49.365,122.5], outsideNode: "depato-seibu-street" }],
});

// Instance placement only: the accepted kit materials, lights and proportions are shared.
const rolloutPlans = () => rolloutData.stores.map(row => {
  const store = floorData.stores.find(s => s.id === row.id)!;
  const footprint = row.footprint as PlanPoint[];
  const tobu = row.id === tobuId;
  const layout = depatoLayout({ ...row, footprint,
    entrances: row.entrances.map(e=>({ ...e, point: e.point as PlanPoint, inward: e.inward as PlanPoint })),
    ...(tobu ? { upperBank, lift, floorFootprint: (level: string) => Number.parseInt(level) >= 9 ? towerPlate : footprint } : {}),
    store: { ...store, floors: store.floors.filter((f,i,all) =>
      (tobu || ["B2","B1","1F"].includes(f.level)) && all.findIndex(other => other.level === f.level) === i)
      // Tobu's illustrative counter labels must fit the shared 1024px atlas.
      .map(f => tobu ? { ...f, tenants: f.tenants.slice(0,40) } : f) } });
  // Keep accepted counter positions when a station entrance tie is skipped.
  if (row.skippedEntrances) for (const {level} of layout.floors) {
    const plate = layout.plate(level);
    plate.counters = plate.counters.filter(([,z]) =>
      !row.skippedEntrances.some(e => Math.abs(e.point[1]! - z) < 4));
  }
  if (tobu) {
    const terrace = layout.plate("8F");
    terrace.counters = terrace.counters.filter(([x,z])=>x>-106 || z<-105 || z>-79);
  }
  // n_h__n_c spans (66,-113)–(71.5,-116.5). Reserve its bounds plus
  // 0.5m walker clearance and the shared counter's 0.55m/2m half extents.
  if (row.id === "ikebukuro-parco") layout.plate("B1").counters = layout.counters.filter(([x,z]) =>
    x < 64.95 || x > 72.55 || z < -119 || z > -110.5);
  return layout;
});

/** Called before the host creates search/router; the flag-off bundle is never modified. */
export function previewBundle(bundle: StationBundle): StationBundle {
  const street = { id: "depato-seibu-street", floorId: "street", position: { x: 56, y: -122.5, z: 32.5 }, kind: "junction" as const, inOut: "outside" as const, sourceRefs: [] };
  const layout = plan();
  const streets = rolloutData.stores.map(row => ({ ...street, id: row.street.id,
    position: { x: row.street.point[0]!, y: -row.street.point[1]!, z: row.elevations["1F"] } }));
  const approach = tobuApproach.map(([x,z,y],i) => ({
    ...street, id: `depato-tobu-approach-${i}`, position: {x:x!, y:-z!, z:y!},
  }));
  const route = [bundle.nodes.find(n=>n.id==="x18")!, ...approach, streets.find(n=>n.id==="depato-tobu-street")!];
  const approachEdges: Edge[] = route.slice(1).map((b,i) => {
    const a = route[i]!;
    return { id: `${a.id}__${b.id}`, from:a.id, to:b.id, direction:"both", mode:"walk",
      lengthM:Math.hypot(b.position.x-a.position.x,b.position.y-a.position.y,b.position.z!-a.position.z!),
      geometry:[a.position,b.position], paid:false, crossesFareBoundary:false, wheelchair:true, steps:false,
      hours:null, closed:false, verification:"geometry_only", accessEvidence:null,
      geometryEvidence:{sourceIds:[],method:"Authored street approach from the modeled Exit 18 landing to the Tobu preview entrance",checkedDate:"2026-11-28"},
    };
  });
  const preview = rolloutPlans().reduce(depatoBundle, depatoBundle({
    ...bundle, nodes: [...bundle.nodes, street, ...streets, ...approach], edges:[...bundle.edges,...approachEdges],
  }, layout));
  const tobu = floorData.stores.find(s=>s.id===tobuId)!;
  const tobuFloors: Poi[] = tobu.floors.map(floor=>{
    const goal = preview.nodes.find(n=>n.id===`depato-${tobuId}-${floor.level}-aisle`)!;
    return {
      id:`${tobuId}-${floor.level}`,category:"shop",floorId:goal.floorId,displayPosition:goal.position,connectorNodeIds:[goal.id],
      names:[{lang:"ja",text:`${tobu.name.ja} ${floor.level}`},{lang:"en",text:`${tobu.name.en} ${floor.level}`}],
      aliases:[{lang:"ja",text:floor.label.ja},{lang:"en",text:floor.label.en}],paid:false,
      evidence:{sourceIds:[],method:`Public Tobu floor directory; preview circulation is illustrative. ${floor.source}`,checkedDate:floor.read},
    };
  });
  const original = bundle.pois.find(p => p.id === layout.input.poiId)!;
  return { ...preview, pois: [...preview.pois, ...tobuFloors].map(p => p.id !== layout.input.poiId ? p : {
    ...p, floorId: original.floorId, displayPosition: original.displayPosition, connectorNodeIds: [layout.input.entrances[0]!.outsideNode],
    evidence: {
      sourceIds: [...original.evidence.sourceIds, layout.input.sourceId, "toshima-underground-guide-2022"],
      method: "STATION_TIE: official South Passage and B1 South Entrance names; the connector is the verified public passage junction. The doorway coordinates and interior continuation are illustrative.",
      checkedDate: "2026-11-24",
    },
    notes: [
      { lang: "ja", text: "確認済みの案内は南通路までです。西武B1の入口の位置と店内経路は現地未確認です。" },
      { lang: "en", text: "Verified station directions end in the South Passage. The Seibu B1 entrance position and interior path are unsurveyed." },
    ],
  }) };
}

/** One station hook: wrap context loading, open the station shell and attach the reusable kit. */
export async function buildPilotScene(ctx: SceneContext, base: BuildScene) {
  const THREE = ctx.THREE, layout = plan(), layouts = [layout, ...rolloutPlans()];
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const volume = (left: number, right: number, front: number, back: number, low: number, high: number): CutRegion => ({
    key: {}, bounds: new THREE.Box3(new THREE.Vector3(left, low, front), new THREE.Vector3(right, high, back)), clip: null,
    rejectsMesh: mesh => {
      for (let o: import("three").Object3D | null = mesh; o; o = o.parent)
        if (["sign", "barriers"].includes(o.userData.gteki_role ?? o.name)) return true;
      return false;
    },
    planes: [p => p.x-left, p => right-p.x, p => p.z-front, p => back-p.z, p => p.y-low, p => high-p.y], accepts: () => true,
  });
  const room = volume(0,54,69.9,180,27.6,36.1);
  const entrance = volume(13,17,60,72,27.6,30.8);
  const streetDoors=layout.input.entrances.filter(e=>ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!.inOut==="outside").map(e=>{
    const outside=ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!,p=ctx.enuToRenderer({...outside.position,z:outside.position.z!});
    const front=Math.abs(e.point[1]-layout.bounds.front)<0.1,y=layout.height(e.level);
    return volume(Math.min(e.point[0],p[0])- (front?2.1:0.2),Math.max(e.point[0],p[0])+(front?2.1:3),
      Math.min(e.point[1],p[2])-(front?0.2:2.1),Math.max(e.point[1],p[2])+(front?3:2.1),y+0.01,y+4.1);
  });
  const rolloutRooms = layouts.slice(1).flatMap(p => {
    const points=p.input.footprint.map(([x,z])=>new THREE.Vector2(x,z));
    // A street-only tie opens the street shell and leaves the station concourses intact.
    const firstCutFloor = p.input.entrances.some(e => e.level !== "1F") ? p.floors[0]!.level : "1F";
    const minY = p.height(firstCutFloor) - 0.1, maxY = p.height("1F") + 4.1;
    return THREE.ShapeUtils.triangulateShape(points,[]).map(indices=>{
      const tri=indices.map(i=>points[i]!);
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
    const cut=volume(Math.min(a[0],e.point[0])-2.1,Math.max(a[0],e.point[0])+2.1,
      Math.min(a[2],e.point[1])-2.1,Math.max(a[2],e.point[1])+2.1,y-0.1,y+4.1);
    if(outside.inOut === "outside") cut.accepts = normal => Math.abs(normal.y) < 0.5;
    return cut;
  }));
  const tobu = layouts.find(p => p.input.store.id === tobuId)!;
  const { x, to, width } = tobu.stair;
  const b1 = tobu.height("B1");
  // The original station partitions cross the escalator landing and its turn into the west aisle.
  const tobuLanding = volume(x - 4.5, x + width / 2, to - 0.5, to + 2.5, b1 - 0.1, b1 + 3.1);
  tobuLanding.rejectsMesh = mesh => !["wall", "windows", "windows_solid", "doors", "doors_solid"].includes(mesh.userData.gteki_role);
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri.includes("ikebukuro_context_")) {
      loaded.scene.updateMatrixWorld(true);
      cutRegions(loaded.scene, [room, ...streetDoors, ...rolloutRooms, ...rolloutDoors], resources);
      // Fill the missing visual pavement between Tobu's 32.41 m apron and the PLATEAU road.
      const pavement = new THREE.BufferGeometry();
      pavement.setAttribute("position", new THREE.Float32BufferAttribute([
        -118.6, 32.39, -26, -125, 32.78, -26, -125, 32.78, -14,
        -118.6, 32.39, -26, -125, 32.78, -14, -118.6, 32.39, -14,
      ], 3));
      pavement.computeVertexNormals();
      const road = loaded.scene.getObjectByName("ctx_road_t00_01") as import("three").Mesh;
      const forecourt = new THREE.Mesh(pavement, road.material);
      forecourt.name = "ctx_road_tobu_forecourt";
      loaded.scene.add(forecourt);
    }
    return loaded;
  } });
  // The background catalog adds merged stair nosings; cut them after attachment too.
  await scene.settled?.();
  scene.root.updateMatrixWorld(true);
  cutRegions([scene.root, ...scene.walkable, ...(scene.colliders ?? [])], [room, entrance, ...rolloutRooms, ...rolloutDoors, tobuLanding], resources);
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(p=>[p.input.store.name.ja,p.input.store.name.en,...p.floors.flatMap(f=>[f.label.ja,f.label.en,...f.tenants.flatMap(t=>[t.ja,t.en])])]).join(""));
  const interiors = layouts.map(p=>buildDepatoInterior(ctx, p, scene.generatedMeshEnvMap));
  const road = new THREE.BufferGeometry();
  const roadNodes = ["x18", ...tobuApproach.map((_,i)=>`depato-tobu-approach-${i}`), "depato-tobu-street"]
    .map(id=>ctx.bundle.nodes.find(n=>n.id===id)!.position)
    .map(p=>new THREE.Vector3(...ctx.enuToRenderer({...p,z:p.z!})));
  const sides = roadNodes.map((p,i)=>{
    const a=roadNodes[Math.max(0,i-1)]!, b=roadNodes[Math.min(roadNodes.length-1,i+1)]!;
    const offset=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize().multiplyScalar(1.6);
    return [p.clone().add(offset),p.clone().sub(offset)] as const;
  });
  road.setAttribute("position",new THREE.Float32BufferAttribute(sides.slice(1).flatMap(([c,d],i)=>{
    const [a,b]=sides[i]!;
    return [a,b,d,a,d,c].flatMap(p=>p.toArray());
  }),3));
  road.computeVertexNormals();
  const pavement = new THREE.Mesh(road,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  pavement.visible=false;
  pavement.userData.gteki_role="floor";
  let avatar: {x:number;y:number;z:number}|null=null;
  const focus = scene.setCameraFocus;
  scene.root.add(...interiors.flatMap(i=>[i.root,i.connectorRoot]));
  const update = scene.update, dispose = scene.dispose;
  return { ...scene, walkable: [...scene.walkable,pavement,...interiors.flatMap(i=>i.walkable)], colliders: [...(scene.colliders ?? []), ...interiors.flatMap(i=>i.colliders)],
    interactables: [...(scene.interactables ?? []),...interiors.flatMap(i=>i.interactables)],
    cameraBlockers: [...(scene.cameraBlockers ?? []), ...interiors.flatMap(i=>i.cameraBlockers)],
    setCameraFocus: (...args: Parameters<NonNullable<StationScene["setCameraFocus"]>>) => { focus?.(...args); avatar=args[3] ?? null; interiors.forEach(i=>i.setAvatar(avatar)); },
    update: (dt: number, elapsed: number, camera?: import("three").Camera) => { update?.(dt,elapsed,camera); if(camera){
      const cp=camera.getWorldPosition(new THREE.Vector3()),p=avatar??{x:cp.x,y:cp.y-2,z:cp.z};
      const distances=layouts.map(l=>l.contains([p.x,p.z]) && p.y>=l.height(l.floors[0]!.level)-1 && p.y<=l.height(l.floors.at(-1)!.level)+4.1 ? 0 :
        Math.min(...l.input.entrances.map(e=>Math.hypot(p.x-e.point[0],p.z-e.point[1],p.y-l.height(e.level)))));
      const active=distances.indexOf(Math.min(...distances));
      // Release the previous store before a neighbour allocates its detail.
      interiors.forEach((i,n)=>{if(n!==active)i.update(camera,dt,elapsed,false);});
      interiors[active]!.update(camera,dt,elapsed);
    } },
    dispose() { road.dispose(); pavement.material.dispose(); disposePortalCuts(resources); interiors.forEach(i=>i.dispose()); dispose(); },
  };
}
