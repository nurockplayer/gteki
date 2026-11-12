/** Original street context. Geometry is merged per material; facade detail uses mipmaps.
 * Surface-only sun and haze are evaluated in these materials, so station lighting
 * and underground fog are untouched. Everything is explicitly render-only except
 * the exported obstacle segments, which the integration hook adds to WalkWorld.
 */
import * as THREE from "three";
import polygonClipping, { type Polygon } from "polygon-clipping";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import type { Layout, XY, XYZ } from "./layout.ts";
import type { SurfaceData } from "./surface-data.ts";
import { surfaceBuildingFootprints, surfaceColumns, surfaceEntrances, surfacePadWalls, surfaceCanopyWalls, surfaceRoofs, surfaceStairShafts, surfaceVisibleIn } from "./surface-layout.ts";
import { daylight, facadeTexture, hash, pavingTexture, skyMaterial } from "./surface-materials.ts";
import { inside, strip, surfaceKerbs, surfaceLampRails, surfacePaving, surfaceStreets } from "./surface-street.ts";
import { OEDO_MAGENTA } from "./palette.ts";
import { stableHypot } from "./stable-hypot.ts";
export { surfaceWalls } from "./surface-layout.ts";
export type { SurfaceData } from "./surface-data.ts";

/** The legacy light batch spans all floors. Remove only its floating street
 * ceiling strips when replacing the generic level-0 cap with entrance roofs. */
export function trimSurfaceCeilingFixtures(root: THREE.Group, materials: THREE.Material[]) {
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || !materials.includes(child.material as THREE.Material)) continue;
    const g = child.geometry, index = g.index, positions = g.attributes.position!;
    if (!index) continue;
    const keep: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (!ids.every(id => positions.getY(id) > 2.3)) keep.push(...ids);
    }
    g.setIndex(keep); g.computeBoundingBox(); g.computeBoundingSphere();
  }
}

const pos = (p: XY, z: number) => new THREE.Vector3(p.x, z, -p.y);
function shape(rings: number[][][]) {
  const s = new THREE.Shape(rings[0]!.map((p) => new THREE.Vector2(p[0]!, p[1]!)));
  for (const r of rings.slice(1)) s.holes.push(new THREE.Path(r.map((p) => new THREE.Vector2(p[0]!, p[1]!))));
  return s;
}
function flat(rings: number[][][], z: number) {
  const g = new THREE.ShapeGeometry(shape(rings));
  g.rotateX(-Math.PI / 2); g.translate(0, z, 0);
  return g;
}
function quad(a: XY, b: XY, bottom: number, top: number, inset = 0) {
  const g = new THREE.BufferGeometry();
  const dx = b.x - a.x, dy = b.y - a.y, L = stableHypot(dx, dy) || 1;
  const nx = dy / L * inset, ny = -dx / L * inset;
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x + nx, bottom, -a.y - ny, b.x + nx, bottom, -b.y - ny, b.x + nx, top, -b.y - ny, a.x + nx, top, -a.y - ny], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L, 0, L, top - bottom, 0, top - bottom], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return g;
}
/**
 * One horizontal glazing sheet (a single polygon, not a thin box): the glass material is translucent, double
 * sided and non-depth-writing, so a 28 mm box showed its top and bottom faces stacked, a ghosted double
 * exposure from the follow camera below. A lone double-sided sheet composites exactly once from either side.
 */
function glazingSheet(center: XY, u: XY, halfWidth: number, halfLength: number, z: number) {
  const g = new THREE.PlaneGeometry(halfWidth * 2, halfLength * 2);
  g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(u.x, -u.y)); g.translate(center.x, z, -center.y);
  return g;
}
function beam(a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number) {
  const d = b.clone().sub(a), g = new THREE.BoxGeometry(width, d.length(), depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
/** Builds the street layer and returns only what the live scene keeps. The construction lives in its own
 * function on purpose: any closure that survives (visibility update, setViewer, dispose, the sky hook)
 * keeps the whole scope it was defined in reachable, and this scope holds the street polygons, building
 * footprints and every source geometry (#72). The survivors are created in buildSurface, whose scope
 * holds nothing else. */
export function buildSurface(surface: SurfaceData, layout: Layout, opts: { bundle: StationBundle; quality: "low" | "high" }) {
  const { root, resources, visibility } = assembleSurface(surface, layout, opts);
  const dome = root.getObjectByName("surface-sky")!;
  dome.onBeforeRender = (_renderer, _scene, camera) => { dome.position.copy(camera.position); dome.updateMatrixWorld(); };
  let disposed = false, viewer: XYZ | null = null;
  // A host can veto the layer with root.userData.suppressed (the explorer's overview looks down on the
  // underground model, which the street would cover); every re-evaluation, including the per-render
  // setViewer from the viewer probe, honours it.
  const update = (_dt: number, _t: number) => { root.visible = root.userData.suppressed !== true && viewer !== null && surfaceVisibleIn(visibility, viewer); };
  return { root, update, setViewer(p: XYZ) { viewer = { ...p }; update(0, 0); }, dispose() { if (disposed) return; disposed = true; for (const r of resources) r.dispose(); resources.clear(); root.clear(); } };
}
function assembleSurface(surface: SurfaceData, layout: Layout, opts: { bundle: StationBundle; quality: "low" | "high" }) {
  const root = new THREE.Group(); root.name = "surface-render-only"; root.visible = false;
  root.userData.attribution = surface.attribution;
  const resources = new Set<{ dispose(): void }>();
  const track = <T extends { dispose(): void }>(r: T) => (resources.add(r), r);
  const mats = {
    ground: track(daylight("#f2eee5", track(pavingTexture()))), asphalt: track(daylight("#ffffff",track(pavingTexture(true)))),
    stone: track(daylight("#b7b8b2")), steel: track(daylight("#aebcc2",null,.25)),
    glass: track(daylight("#8aafb9",null,.8)), roof: track(daylight("#899493")),
    paint: track(daylight("#dfdfd2")), tactile: track(daylight("#c7a64c")),
    leaf: track(daylight("#60754b")),
    facades: Array.from({length:5},(_,i)=>{const m=track(daylight("#ffffff",track(facadeTexture(i)),i===0?.65:.24));m.vertexColors=true;return m;}),
  };
  if (opts.quality === "low") for (const material of mats.facades) {
    const source = material.map!.image as HTMLCanvasElement;
    const canvas = document.createElement("canvas");
    canvas.width = source.width / 2;
    canvas.height = source.height / 2;
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, canvas.width, canvas.height);
    material.map!.image = canvas;
  }
  mats.glass.transparent = true; mats.glass.opacity = .38; mats.glass.depthWrite = false;
  const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  const add = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    let batch = batches.get(key); if (!batch) { batch = { material, geometries: [] }; batches.set(key, batch); } batch.geometries.push(geometry);
  };
  const texturedFlat=(rings:number[][][],z:number,scale:number)=>{const g=flat(rings,z),uv=g.attributes.uv!;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)/scale,uv.getY(i)/scale);return g;};
  const streets=surfaceStreets(surface,layout,opts.bundle);
  // Adjacent road/paving polygons, not nearly coplanar overlays: avoids distant
  // depth fighting and gives the asphalt a small, deliberate kerb depression.
  const paving=surfacePaving(surface,layout,opts.bundle);
  for(const poly of paving)add("ground",texturedFlat(poly,-.012,3.2),mats.ground);
  for(const poly of streets.asphalt)add("asphalt",texturedFlat(poly,-.06,5),mats.asphalt);
... (+146 lines) [see remaining: rtk proxy git show cbadcbc2:stations/shinjuku/scene/surface.ts | tail -n +121]
