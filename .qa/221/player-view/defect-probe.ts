// 2026-11-05 JST, #221: numeric check for the escalator-area defects quality patrol #837 reported.
// For every saved deep-escalator escape ray, take ALL draw-triangle hits within 25 m from the source meshes
// (`opaqueScene().source`, real names, cull side respected) and flag the pairs whose first two surfaces are
// within 1 mm of each other: coplanar overlapping faces are what produce the checkerboard z-fighting, and the
// mesh names say which surfaces. Rays with no hit at all are the void escapes (see-through gap candidates).
import fs from 'node:fs';
import * as T from '../../../packages/godot/node_modules/three/build/three.module.js';
import { loadScene } from '../../../packages/godot/src/route-clip-audit.ts';
import { navmeshBundle } from '../../../packages/godot/src/navmesh-input.ts';
import { castAll } from '../../../apps/web/src/explorer/raycast.ts';
import { applyLivePipeline } from '../live-pipeline.ts';
import { opaqueScene } from '../escape/opaque.ts';

if (process.env.GTEKI_PRIVATE_DIR) throw new Error('Public data only');
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }) + ' JST';
const rays: { edgeId: string; sample: number; direction: number; eye: number[]; dir: number[] }[] =
  JSON.parse(fs.readFileSync('.qa/221/player-view/deep-rays.json', 'utf8'));
const { bundle } = await navmeshBundle('shinjuku');
const scene = await loadScene('shinjuku', bundle, 'high');
applyLivePipeline(bundle, scene);
const opaque = opaqueScene(scene.root);
console.log(stamp(), 'scene loaded, rays', rays.length, 'source meshes', opaque.source.length);

const visible = (h: T.Intersection) => {
  const m = h.object as T.Mesh;
  const mat = Array.isArray(m.material) ? m.material[h.face!.materialIndex!] : m.material;
  return !!(mat?.visible && !mat.transparent && mat.opacity > 0);
};
const nameOf = (h: T.Intersection) => (h.object as T.Mesh).name || (h.object as T.Mesh).type;

const COP = 0.001; // 1 mm: coplanar overlap
let noHit = 0, single = 0;
const pairs = new Map<string, { count: number; example: number[] }>();
const samples: { edgeId: string; gapMm: number; a: string; b: string; point: number[] }[] = [];
for (const r of rays) {
  const eye = new T.Vector3(...(r.eye as [number, number, number]));
  const ray = new T.Raycaster(eye, new T.Vector3(...(r.dir as [number, number, number])), 0.001, 25);
  const hits = castAll(ray, opaque.source).filter(visible);
  if (!hits.length) { noHit++; continue; }
  if (hits.length < 2) { single++; continue; }
  const a = hits[0]!, b = hits[1]!;
  const gapMm = Math.abs(b.distance - a.distance) * 1000;
  if (gapMm > 1) { single++; continue; }
  const na = `${nameOf(a)}|${(a.object as T.Mesh).uuid.slice(0, 8)}`, nb = `${nameOf(b)}|${(b.object as T.Mesh).uuid.slice(0, 8)}`;
  const key = na < nb ? `${na} <> ${nb}` : `${nb} <> ${na}`;
  const e = pairs.get(key) ?? { count: 0, example: a.point.toArray().map((v) => Math.round(v * 100) / 100) };
  e.count++; pairs.set(key, e);
  if (samples.length < 40) samples.push({ edgeId: r.edgeId, gapMm: Math.round(gapMm * 1000) / 1000, a: na, b: nb, point: a.point.toArray().map((v) => Math.round(v * 100) / 100) });
}
const top = [...pairs.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, 20)
  .map(([key, v]) => ({ pair: key, rays: v.count, example: v.example }));
console.log(stamp(), 'noHit', noHit, 'single', single, 'coplanar-pair rays', rays.length - noHit - single, 'pairs', pairs.size);
for (const t of top) console.log(stamp(), t.rays, t.pair, JSON.stringify(t.example));
fs.writeFileSync('.qa/221/player-view/defect-probe.json', JSON.stringify({ timestamp: stamp(), rays: rays.length, noHit, single, coplanar: top, samples }, null, 2) + '\n');
scene.dispose();
console.log(stamp(), 'PASS');
