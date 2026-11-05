// #221 fix-3 diagnosis, 2026-11-05 JST: distinguish a missing shell from the 25 m ray horizon.
import fs from 'node:fs';
import * as T from '../../../packages/godot/node_modules/three/build/three.module.js';
import { loadScene } from '../../../packages/godot/src/route-clip-audit.ts';
import { navmeshBundle } from '../../../packages/godot/src/navmesh-input.ts';
import { planBundle } from '../../../stations/shinjuku/gteki/scene.ts';
import { prepareLayout } from '../../../stations/shinjuku/scene/build-cache.ts';
import { escalatorShellGeometry } from '../../../stations/shinjuku/scene/build.ts';
import { applyLivePipeline } from '../live-pipeline.ts';
import { opaqueScene } from '../escape/opaque.ts';
const rays = JSON.parse(fs.readFileSync('.qa/221/player-view/deep-rays.json', 'utf8'));
const { bundle } = await navmeshBundle('shinjuku');
const scene = await loadScene('shinjuku', bundle, 'high');
const { layout } = prepareLayout(planBundle(bundle), JSON.parse(fs.readFileSync('stations/shinjuku/data/plan.json', 'utf8')), { reuse: true });
const shell = escalatorShellGeometry(layout, planBundle(bundle));
const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
const roof = new T.Mesh(shell.soffits!, material);
applyLivePipeline(bundle, scene);
const opaque = opaqueScene(scene.root);
const byEdge: Record<string, any> = {};
const rows = rays.map((r: any) => {
  const ray = new T.Raycaster(new T.Vector3(...r.eye), new T.Vector3(...r.dir), .001, 250);
  const hit = opaque.cast(ray);
  const source = opaque.original(ray);
  const m = source?.object as T.Mesh | undefined;
  const mat = m && (Array.isArray(m.material) ? m.material[source!.face!.materialIndex] : m.material);
  const row = byEdge[r.edgeId] ??= { rays: 0, miss25: 0, miss250: 0, distances: [], upperRoof: [] };
  row.rays++; if (!hit || hit.distance > 25) row.miss25++; if (!hit) row.miss250++;
  if (hit && hit.distance > 25) row.distances.push(hit.distance);
  return { ...r, hit: hit && { distance: hit.distance, point: hit.point.toArray(), name: m?.name, material: mat?.name } };
});
for (const [edge, row] of Object.entries(byEdge)) {
  const r = layout.runs.find(r => r.edgeId === edge)!;
  row.run = r;
  for (const fraction of [.1, .5, .9, 1]) {
    const t = r.a.z < r.b.z ? fraction : 1 - fraction;
    const p = new T.Vector3(r.a.x + (r.b.x-r.a.x)*t, r.a.z + (r.b.z-r.a.z)*t + 2.45, -(r.a.y+(r.b.y-r.a.y)*t));
    const ray = new T.Raycaster(p, new T.Vector3(0, 1, 0), .001, 4);
    const shellHit = ray.intersectObject(roof)[0];
    const drawnHit = opaque.original(ray);
    row.upperRoof.push({ fraction, shell: shellHit?.distance ?? null, drawn: drawnHit?.distance ?? null });
  }
  row.distanceRange = row.distances.length ? [Math.min(...row.distances), Math.max(...row.distances)] : [];
  delete row.distances;
  console.log(edge.slice(0,12), JSON.stringify(row));
}
fs.writeFileSync('.qa/221/fix3/diagnosis.json', JSON.stringify({ timestamp: new Date().toLocaleString('sv-SE', {timeZone: 'Asia/Tokyo'}) + ' JST', byEdge, rows }, null, 2)+'\n');
scene.dispose(); shell.sides?.dispose(); shell.soffits?.dispose(); material.dispose();
console.log('PASS diagnosis');
