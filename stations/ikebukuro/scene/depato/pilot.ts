import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import footprintData from "../../data/depato-footprint.json";
import floorData from "../../data/depato-floors.json";
import { depatoBundle, depatoLayout, type PlanPoint } from "./layout.ts";
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

/** Called before the host creates search/router; the flag-off bundle is never modified. */
export function previewBundle(bundle: StationBundle): StationBundle {
  const street = { id: "depato-seibu-street", floorId: "street", position: { x: 56, y: -122.5, z: 32.5 }, kind: "junction" as const, inOut: "outside" as const, sourceRefs: [] };
  return depatoBundle({ ...bundle, nodes: [...bundle.nodes, street] }, plan());
}

/** One station hook: wrap context loading, open the station shell and attach the reusable kit. */
export async function buildPilotScene(ctx: SceneContext, base: BuildScene) {
  const THREE = ctx.THREE, layout = plan();
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const volume = (left: number, right: number, front: number, back: number, low: number, high: number): CutRegion => ({
    key: {}, bounds: new THREE.Box3(new THREE.Vector3(left, low, front), new THREE.Vector3(right, high, back)), clip: null,
    planes: [p => p.x-left, p => right-p.x, p => p.z-front, p => back-p.z, p => p.y-low, p => high-p.y], accepts: () => true,
  });
  const room = volume(0,54,69.9,180,27.9,35.7);
  const entrance = volume(7,18,60,72,27.9,30.8);
  const streetDoor = volume(46,58,120.4,124.6,32.21,35.5);
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri.includes("ikebukuro_context_")) { loaded.scene.updateMatrixWorld(true); cutRegions(loaded.scene, [room, streetDoor], resources); }
    return loaded;
  } });
  scene.root.updateMatrixWorld(true);
  cutRegions([scene.root, ...scene.walkable, ...(scene.colliders ?? [])], [room, entrance], resources);
  await document.fonts.load('600 32px "GTEki Sign JP"', layout.floors.flatMap(f=>[f.label.ja,...f.tenants.map(t=>t.ja)]).join(""));
  const interior = buildDepatoInterior(ctx, layout, scene.generatedMeshEnvMap);
  const focus = scene.setCameraFocus;
  scene.root.add(interior.root);
  const update = scene.update, dispose = scene.dispose;
  return { ...scene, walkable: [...scene.walkable, ...interior.walkable], colliders: [...(scene.colliders ?? []), ...interior.colliders],
    setCameraFocus: (...args: Parameters<NonNullable<StationScene["setCameraFocus"]>>) => { focus?.(...args); interior.setAvatar(args[3] ?? null); },
    update: (dt: number, elapsed: number, camera?: import("three").Camera) => { update?.(dt,elapsed,camera); if (camera) interior.update(camera,elapsed); },
    dispose() { disposePortalCuts(resources); interior.dispose(); dispose(); },
  };
}
