import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import type { Edge, StationBundle } from "@gteki/schema";
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
const esola = rolloutData.stores.find(row => row.id === "esola-ikebukuro")!;
const esolaApproach = esola.streetApproach!;
const plan = () => depatoLayout({
  store: { ...store, floors: store.floors.filter((f,i,all) => ["B1", "1F"].includes(f.level) && all.findIndex(other => other.level === f.level) === i) },
  footprint, elevations: { "1F": 32.2 },
  poiId: "shop-ikb-seibu-honten", sourceId: "sogo-seibu-ikebukuro-floorguide-2026-10",
  entrances: [{ level: "B1", point: [15,70], outsideNode: "sp_e" }, { level: "1F", point: [49.365,122.5], outsideNode: "depato-seibu-street" }],
});

// Instance placement only: the accepted kit materials, lights and proportions are shared.
const rolloutPlans = () => rolloutData.stores.map(row => {
  const store = floorData.stores.find(s => s.id === row.id)!;
  const layout = depatoLayout({ ...row, footprint: row.footprint as PlanPoint[],
    entrances: row.entrances.map(e=>({ ...e, point: e.point as PlanPoint, inward: e.inward as PlanPoint })),
    store: { ...store, floors: store.floors.filter((f,i,all) =>
      ["B2","B1","1F"].includes(f.level) && all.findIndex(other => other.level === f.level) === i)
      // Tobu's illustrative counter labels must fit the shared 1024px atlas.
      .map(f => row.id === "tobu-ikebukuro" ? { ...f, tenants: f.tenants.slice(0,40) } : f) } });
  // Keep accepted counter positions when a station entrance tie is skipped.
  if (row.skippedEntrances) layout.counters = layout.counters.filter(([,z]) =>
    !row.skippedEntrances.some(e => Math.abs(e.point[1]! - z) < 4));
  // n_h__n_c spans (66,-113)–(71.5,-116.5). Reserve its bounds plus
  // 0.5m walker clearance and the shared counter's 0.55m/2m half extents.
  if (row.id === "ikebukuro-parco") layout.counters = layout.counters.filter(([x,z]) =>
    x < 64.95 || x > 72.55 || z < -119 || z > -110.5);
  return layout;
});

/** Called before the host creates search/router; the flag-off bundle is never modified. */
export function previewBundle(bundle: StationBundle): StationBundle {
  const street = { id: "depato-seibu-street", floorId: "street", position: { x: 56, y: -122.5, z: 32.5 }, kind: "junction" as const, inOut: "outside" as const, sourceRefs: [] };
  const streets = rolloutData.stores.map(row => ({ ...street, id: row.street.id,
    position: { x: row.street.point[0]!, y: -row.street.point[1]!, z: row.elevations["1F"] } }));
  const exit = bundle.nodes.find(n => n.id === esolaApproach.exitNode)!;
  const approach = esolaApproach.waypoints.map(([x,y,z], i) => ({
    ...street, id: `depato-esola-approach-${i}`, position: { x: x!, y: -z!, z: y! },
  }));
  const route = [exit, ...approach, streets.find(n => n.id === esola.street.id)!];
  const evidence = { sourceIds: [esolaApproach.sourceId], checkedDate: "2026-11-25",
    method: "Preview street walk aligned to PLATEAU roads and the operator's above-ground approach map" };
  const edges: Edge[] = route.slice(1).map((to, i) => {
    const from = route[i]!;
    const a = from.position, b = to.position;
    return { id: `${from.id}__${to.id}`, from: from.id, to: to.id, direction: "both", mode: "walk",
      lengthM: Math.hypot(b.x-a.x,b.y-a.y,b.z!-a.z!), geometry: [a,b], paid: false, crossesFareBoundary: false,
      wheelchair: null, steps: false, hours: null, closed: false, verification: "verified",
      geometryEvidence: evidence, accessEvidence: evidence };
  });
  return rolloutPlans().reduce(depatoBundle, depatoBundle({
    ...bundle, nodes: [...bundle.nodes, street, ...streets, ...approach], edges: [...bundle.edges, ...edges],
  }, plan()));
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
  // Esola sits outside the station shell; its entrance cuts are in the context assets below.
  const stationRollout = layouts.slice(1).filter(p => p.input.store.id !== esola.id);
  const rolloutRooms = stationRollout.flatMap(p => {
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
  const rolloutDoors=stationRollout.flatMap(p=>p.input.entrances.map(e=>{
    const outside=ctx.bundle.nodes.find(n=>n.id===e.outsideNode)!,a=ctx.enuToRenderer({...outside.position,z:outside.position.z!}),y=p.height(e.level);
    const cut=volume(Math.min(a[0],e.point[0])-2.1,Math.max(a[0],e.point[0])+2.1,
      Math.min(a[2],e.point[1])-2.1,Math.max(a[2],e.point[1])+2.1,y-0.1,y+4.1);
    if(outside.inOut === "outside") cut.accepts = normal => Math.abs(normal.y) < 0.5;
    return cut;
  }));
  const tobu = layouts.find(p => p.input.store.id === "tobu-ikebukuro")!;
  const { x, to, width } = tobu.stair;
  const b1 = tobu.height("B1");
  // The original station partitions cross the escalator landing and its turn into the west aisle.
  const tobuLanding = volume(x - 4.5, x + width / 2, to - 0.5, to + 2.5, b1 - 0.1, b1 + 3.1);
  tobuLanding.rejectsMesh = mesh => !["wall", "windows", "windows_solid", "doors", "doors_solid"].includes(mesh.userData.gteki_role);
  const [doorX, doorZ] = esola.entrances[0]!.point as PlanPoint;
  const doorY = esola.elevations["1F"];
  const esolaDoor = volume(doorX - 0.4, doorX + 0.4, doorZ - 2, doorZ + 2, doorY - 0.1, doorY + 2.8);
  // Both tiers retain a context panel about 6.5 m west of the kit door, plus a duplicate face at the door.
  // Open the street panel before the context builds its camera blockers from that same geometry.
  const entryMinZ = -7.55, entryMaxZ = -3.15;
  const esolaVestibule = volume(-180, -178.9, entryMinZ, entryMaxZ, doorY - 0.1, doorY + 3.1);
  esolaVestibule.accepts = normal => Math.abs(normal.y) < 0.5;
  const facadeNorth = { x: -179.74, z: -7.8737 }, facadeSouth = { x: -179.2285, z: -2.7569 };
  const facadePoint = (z: number) => ({
    x: facadeNorth.x + (z - facadeNorth.z) * (facadeSouth.x - facadeNorth.x) / (facadeSouth.z - facadeNorth.z),
    y: -z,
  });
  const esolaJambs = [[facadeNorth.z, entryMinZ], [entryMaxZ, facadeSouth.z]].map(([a, b]) => ({
    source: "esola-street-facade", a: facadePoint(a!), b: facadePoint(b!), zMin: doorY - 0.1, zMax: doorY + 3.1,
  }));
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri.includes("ikebukuro_landmarks_next.glb")) {
      loaded.scene.updateMatrixWorld(true);
      cutRegions(loaded.scene.getObjectByName("esola")!, [esolaDoor], resources);
    }
    if (uri.includes("ikebukuro_context_")) {
      loaded.scene.updateMatrixWorld(true);
      cutRegions(loaded.scene.getObjectByName("ctx_bldg_t00_00")!, [esolaVestibule, esolaDoor], resources);
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
  // PLATEAU roads stay visual. A narrow continuous support strip follows the authored street route.
  const route = [esolaApproach.exitNode, ...esolaApproach.waypoints.map((_, i) => `depato-esola-approach-${i}`), esola.street.id].map(id => {
    const { position } = ctx.bundle.nodes.find(n => n.id === id)!;
    return new THREE.Vector3(...ctx.enuToRenderer({ ...position, z: position.z! }));
  });
  const start = route[0]!, end = route.at(-1)!;
  start.addScaledVector(start.clone().sub(route[1]!).setY(0).normalize(), 0.35);
  const [inwardX, inwardZ] = esola.entrances[0]!.inward as PlanPoint;
  end.addScaledVector(new THREE.Vector3(inwardX, 0, inwardZ), 0.35);
  const strip = route.map((point, i) => {
    const tangent = route[Math.min(i + 1, route.length - 1)]!.clone().sub(route[Math.max(i - 1, 0)]!).setY(0).normalize();
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x).multiplyScalar(1.8);
    return [point.clone().add(side), point.clone().sub(side)] as const;
  });
  const pavementGeometry = new THREE.BufferGeometry();
  pavementGeometry.setAttribute("position", new THREE.Float32BufferAttribute(strip.slice(1).flatMap(([c,d], i) => {
    const [a,b] = strip[i]!;
    return [a,b,c,b,d,c].flatMap(p => p.toArray());
  }), 3));
  pavementGeometry.computeVertexNormals();
  const pavementMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const esolaPavement = new THREE.Mesh(pavementGeometry, pavementMaterial);
  esolaPavement.name = "depato-esola-street-support";
  esolaPavement.visible = false;
  esolaPavement.userData.gteki_role = "floor";
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(p=>[p.input.store.name.ja,p.input.store.name.en,...p.floors.flatMap(f=>[f.label.ja,f.label.en,...f.tenants.flatMap(t=>[t.ja,t.en])])]).join(""));
  const interiors = layouts.map(p=>buildDepatoInterior(ctx, p, scene.generatedMeshEnvMap));
  let avatar: {x:number;y:number;z:number}|null=null;
  const focus = scene.setCameraFocus;
  scene.root.add(...interiors.flatMap(i=>[i.root,i.connectorRoot]));
  const update = scene.update, dispose = scene.dispose;
  return { ...scene, walkable: [...scene.walkable, esolaPavement, ...interiors.flatMap(i=>i.walkable)], colliders: [...(scene.colliders ?? []), ...interiors.flatMap(i=>i.colliders)],
    cameraBlockers: [...(scene.cameraBlockers ?? []), ...interiors.flatMap(i=>i.cameraBlockers)],
    walls: [...(scene.walls ?? []), ...esolaJambs],
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
    dispose() { pavementGeometry.dispose(); pavementMaterial.dispose(); disposePortalCuts(resources); interiors.forEach(i=>i.dispose()); dispose(); },
  };
}
