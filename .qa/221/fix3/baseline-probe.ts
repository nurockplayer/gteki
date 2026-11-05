// 2026-11-05 JST, #221 player-view re-check: where do the deep (m1..m6) bucket-a escape rays go?
// Two camera states are compared for the same 786 rays (faceable, on a walkable flight, not a head-band crossing):
//   asLoaded  the scene as buildScene + the Explorer portal/stair cut leave it (no camera culling)
//   viewer    the app's draw-nothing viewer probe + update at that eye, i.e. exactly what the escape scan used
// A ray that misses in `asLoaded` leaves the built station through a real gap; one that hits only in `asLoaded`
// was culled out of the audit's draw set. Rays that miss in both get a ±12° cone probe that names the nearest
// surfaces around the opening (mesh name, material, spaceId).
import fs from 'node:fs';
import * as T from '../../../packages/godot/node_modules/three/build/three.module.js';
import { loadScene } from '../../../packages/godot/src/route-clip-audit.ts';
import { navmeshBundle } from '../../../packages/godot/src/navmesh-input.ts';
import { castAll } from '../../../apps/web/src/explorer/raycast.ts';
import { prepareRayTrees } from '../../../apps/web/src/explorer/meshBvh.ts';
import { applyLivePipeline } from '../live-pipeline.ts';
import { opaqueScene } from '../escape/opaque.ts';
import { reportViewer } from '../viewer.ts';

if (process.env.GTEKI_PRIVATE_DIR) throw new Error('Public data only');
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }) + ' JST';
const rays: { edgeId: string; sample: number; direction: number; eye: number[]; dir: number[] }[] =
  JSON.parse(fs.readFileSync('.qa/221/player-view/deep-rays.json', 'utf8'));
const { bundle } = await navmeshBundle('shinjuku');
const scene = await loadScene('shinjuku', bundle, 'high');
applyLivePipeline(bundle, scene);
console.log(stamp(), 'scene loaded, rays', rays.length);

const asLoaded = opaqueScene(scene.root);
const asLoadedRow = (r: typeof rays[number]) => {
  const ray = new T.Raycaster(new T.Vector3(...(r.eye as [number, number, number])), new T.Vector3(...(r.dir as [number, number, number])), 0.001, 25);
  const hit = asLoaded.cast(ray);
  return hit ? { distance: hit.distance, y: hit.point.y, point: hit.point.toArray() } : null;
};
const loadedHits = rays.map(asLoadedRow);
console.log(stamp(), 'asLoaded misses', loadedHits.filter(h => !h).length, 'of', rays.length);

// Same rebuild-on-draw-state-change loop as the escape scan, so `viewer` reproduces its result exactly.
const viewerCamera = new T.PerspectiveCamera();
let opaque: ReturnType<typeof opaqueScene> | undefined, drawState = '';
const viewAt = (p: T.Vector3) => {
  viewerCamera.position.copy(p);
  const next = reportViewer(scene, viewerCamera);
  if (next !== drawState) {
    for (const m of opaque?.meshes ?? []) { m.geometry.dispose(); m.material.dispose(); }
    opaque = opaqueScene(scene.root);
    drawState = next;
  }
  return opaque!;
};
const viewerHits = rays.map(r => {
  const o = viewAt(new T.Vector3(...(r.eye as [number, number, number])));
  const ray = new T.Raycaster(new T.Vector3(...(r.eye as [number, number, number])), new T.Vector3(...(r.dir as [number, number, number])), 0.001, 25);
  const hit = o.cast(ray);
  return hit ? { distance: hit.distance, y: hit.point.y, point: hit.point.toArray() } : null;
});
console.log(stamp(), 'viewer misses', viewerHits.filter(h => !h).length, 'of', rays.length);

// Name the surfaces around still-open rays: 12 cone directions at 12 degrees, first hit within 25 m, from the source meshes.
const sourceOf = (hit: T.Intersection) => {
  const m = hit.object as T.Mesh;
  const mat = Array.isArray(m.material) ? m.material[hit.face!.materialIndex] : m.material;
  return { name: m.name, material: mat?.name ?? mat?.type ?? '', spaceId: (m.userData?.spaceId as string | undefined) ?? null, distance: hit.distance };
};
const cone: { index: number; edgeId: string; eye: number[]; hit: ReturnType<typeof sourceOf> | null; probe: ReturnType<typeof sourceOf>[] }[] = [];
rays.forEach((r, index) => {
  if (viewerHits[index]) return;
  const eye = new T.Vector3(...(r.eye as [number, number, number])), dir = new T.Vector3(...(r.dir as [number, number, number])).normalize();
  const up = Math.abs(dir.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
  const right = new T.Vector3().crossVectors(dir, up).normalize(), realUp = new T.Vector3().crossVectors(right, dir).normalize();
  const probe: ReturnType<typeof sourceOf>[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6, tilt = T.MathUtils.degToRad(12);
    const d = dir.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(right, Math.sin(tilt) * Math.cos(a)).addScaledVector(realUp, Math.sin(tilt) * Math.sin(a)).normalize();
    const hit = asLoaded.original(new T.Raycaster(eye, d, 0.001, 25));
    if (hit) probe.push(sourceOf(hit));
  }
  cone.push({ index, edgeId: r.edgeId, eye: r.eye, hit: null, probe });
});
fs.writeFileSync('.qa/221/fix3/before-gap.json', JSON.stringify({
  timestamp: stamp(), rays: rays.length,
  asLoadedMisses: loadedHits.filter(h => !h).length, viewerMisses: viewerHits.filter(h => !h).length,
  asLoadedHits: loadedHits.filter(h => h).slice(0, 40), cone,
}, null, 2) + '\n');
const byEdge = new Map<string, { rays: number; asLoadedMiss: number; viewerMiss: number }>();
rays.forEach((r, i) => {
  const e = byEdge.get(r.edgeId) ?? { rays: 0, asLoadedMiss: 0, viewerMiss: 0 };
  e.rays++; if (!loadedHits[i]) e.asLoadedMiss++; if (!viewerHits[i]) e.viewerMiss++;
  byEdge.set(r.edgeId, e);
});
for (const [edge, e] of byEdge) console.log(stamp(), edge.slice(0, 12), JSON.stringify(e));
scene.dispose();
console.log(stamp(), 'PASS');
