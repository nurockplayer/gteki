import {reportViewer} from './viewer.ts';
import fs from 'node:fs';
import * as T from '../../packages/godot/node_modules/three/build/three.module.js';
import { enuToRenderer } from '../../packages/geo/src/index.ts';
import { nodeDisplayZ } from '../../packages/navigation/src/index.ts';
import { WALKER_BODY } from '../../packages/scene-api/src/index.ts';
import { loadScene, cutSceneProbe } from '../../packages/godot/src/route-clip-audit.ts';
import { navmeshBundle } from '../../packages/godot/src/navmesh-input.ts';
import { castAll, castTargets } from '../../apps/web/src/explorer/raycast.ts';
import { prepareRayTrees } from '../../apps/web/src/explorer/meshBvh.ts';
import { FOV } from '../../apps/web/src/explorer/followCamera.ts';
import { prepareLayout } from '../../stations/shinjuku/scene/build-cache.ts';
import { planBundle } from '../../stations/shinjuku/gteki/scene.ts';
import { slabGeometry, soffitGeometry, escalatorShellGeometry } from '../../stations/shinjuku/scene/build.ts';
import { soffitHeight, pointInRings, type Soffit } from '../../stations/shinjuku/scene/layout.ts';
import { applyLivePipeline } from './live-pipeline.ts';
import { physicalSnapshot } from './physical.ts';

// Paths are relative to .qa/221; package imports resolve via the root tsconfig.
const liveOnly = process.argv.includes('--live');
const out = liveOnly ? '.qa/221/live' : '.qa/221';
fs.mkdirSync(out, { recursive: true });
if (process.env.GTEKI_PRIVATE_DIR) throw new Error('Public data only: unset GTEKI_PRIVATE_DIR');
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }) + ' JST';
const log = (s: string) => console.log(`${stamp()} ${s}`);
const width = 32, height = 18;
const inputs = [
  { floor: 'm6', node: 'n:34dc769bdb5b49d083a211ff541f435d', headings: [353, 83, 173, 263], controls: [83, 173, 263] },
  { floor: 'm1', node: 'n:399c24bf916c45f197e22e812433aed9', headings: [150, 240, 330], controls: [] },
  { floor: 'm2_5', node: 'n:3d154fc290ac43c992ec8de105c82997', headings: [71, 341], controls: [] },
  { floor: 'm3', node: 'n:e26f39c2df0f4f3b82b9163d2230d4c8', headings: [83, 263, 353], controls: [] },
  { floor: 'm1', node: 'n:fb5671d1edba4c91ad50438c830827a9', headings: [68, 158, 248, 338], controls: [] },
];
log('Loading public high-quality scene');
const { bundle, privateBuild } = await navmeshBundle('shinjuku');
const scene = await loadScene('shinjuku', bundle, 'high');
log('Scene loaded');
const plan = JSON.parse(fs.readFileSync('stations/shinjuku/data/plan.json', 'utf8'));
const { layout } = prepareLayout(planBundle(bundle), plan, { reuse: true, verifyGeneratedInput: true });
fs.writeFileSync(`${out}/physical.json`, JSON.stringify(physicalSnapshot(scene, layout), null, 2));
const shell = escalatorShellGeometry(layout, bundle);
const sources: Soffit[] = [
  ...layout.levels.flatMap(l => l.ceilings.map(s => ({ ...s, floorId: l.floorId, kind: 'landing' as const }))),
  ...layout.soffits.filter(s => !layout.shaftFinishes || !/^shaft-(roof|invert|collar):/.test(s.spaceId)), ...(layout.shaftFinishes ?? []), ...shell.finishes,
];
shell.sides?.dispose(); shell.soffits?.dispose();
// Reconstruct finishUnderground's ordered shaft groups, so a merged ceiling hit retains its input edges.
const ends = (r: typeof layout.runs[number]) => r.a.z < r.b.z ? [r.a, r.b] : [r.b, r.a];
const joined = (a: typeof layout.runs[number], b: typeof layout.runs[number]) => {
  if (a.mode !== b.mode) return false;
  const [al, ah] = ends(a), [bl, bh] = ends(b);
  const ad = { x: ah.x - al.x, y: ah.y - al.y }, bd = { x: bh.x - bl.x, y: bh.y - bl.y };
  const an = Math.hypot(ad.x, ad.y), bn = Math.hypot(bd.x, bd.y);
  if (an < 1e-6 || bn < 1e-6 || (ad.x * bd.x + ad.y * bd.y) / an / bn < 0.995) return false;
  if (Math.hypot(ad.x * (ah.z - al.z) / an ** 2 - bd.x * (bh.z - bl.z) / bn ** 2,
    ad.y * (ah.z - al.z) / an ** 2 - bd.y * (bh.z - bl.z) / bn ** 2) >= 0.025) return false;
  const distance = (p: any, q: any) => Math.hypot(p.x - q.x, p.y - q.y);
  return Math.abs(ah.z - bl.z) < 0.3 && distance(ah, bl) < 1.65 || Math.abs(bh.z - al.z) < 0.3 && distance(bh, al) < 1.65
    || Math.abs(al.z - bl.z) < 0.35 && Math.abs(ah.z - bh.z) < 0.35 && distance(al, bl) < 3.6 && distance(ah, bh) < 3.6;
};
const remaining = new Set(layout.runs.filter(r => Math.min(r.a.z, r.b.z) < -0.5)), shafts: typeof layout.runs[] = [];
while (remaining.size) {
  const seed = remaining.values().next().value!; remaining.delete(seed); const group = [seed];
  for (let i = 0; i < group.length; i++) for (const r of [...remaining]) if (group.some(g => joined(g, r))) { group.push(r); remaining.delete(r); }
  shafts.push(group);
}
const vk = (v: T.Vector3) => v.toArray().map(n => n.toFixed(3)).join(',');
const tk = (vs: T.Vector3[]) => vs.map(vk).sort().join('|');
const triangles = new Map<string, Set<string>>();
for (const s of sources) {
  const g = soffitGeometry(s), p = g.getAttribute('position'), ix = g.index;
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const key = tk([0, 1, 2].map(j => new T.Vector3().fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j)));
    const ids = triangles.get(key) ?? new Set(); ids.add(s.spaceId); triangles.set(key, ids);
  }
  g.dispose();
}
const feet = new Map<string, { position: T.Vector3; displayZ: number; groundY: number }>();
const groundTargets = castTargets(scene.walkable, scene.colliders ?? []);
prepareRayTrees(groundTargets);
for (const input of inputs) {
  const n = bundle.nodes.find(n => n.id === input.node)!;
  const z = nodeDisplayZ(n, bundle.floors.find(f => f.id === n.floorId)).z;
  const [rx, ry, rz] = enuToRenderer({ x: n.position.x, y: n.position.y, z });
  const groundRay = new T.Raycaster(new T.Vector3(rx, ry + 1.5, rz), new T.Vector3(0, -1, 0), 0, 4);
  const hit = castAll(groundRay, groundTargets)[0];
  if (!hit) throw new Error(`walkFrom groundAt failed: ${input.node}`);
  feet.set(input.node, { position: new T.Vector3(rx, hit.point.y, rz), displayZ: z, groundY: hit.point.y });
}
function chain(o: T.Object3D) {
  const a = [];
  for (let p: T.Object3D | null = o; p; p = p.parent) a.push({ id: p.id, name: p.name, type: p.type, userData: p.userData });
  return a;
}
function visible(o: T.Object3D) {
  for (let p: T.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
function sourceOf(hit: T.Intersection, normal: T.Vector3, matrix: T.Matrix4): { ids: string[]; match: string } {
  const mesh = hit.object as T.Mesh;
  const material = Array.isArray(mesh.material) ? mesh.material[hit.face!.materialIndex] : mesh.material;
  if (material?.name !== 'mat.ceiling') return { ids: [], match: 'non-ceiling' };
  const p = mesh.geometry.getAttribute('position');
  const key = tk([hit.face!.a, hit.face!.b, hit.face!.c].map(i => new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix)));
  const exact = triangles.get(key);
  if (exact) return { ids: [...exact], match: 'triangle-vertices-1mm' };
  const xy = { x: hit.point.x, y: -hit.point.z };
  const ids = sources.filter(s => Math.abs(soffitHeight(s, xy) - hit.point.y) < 0.003 && pointInRings(xy, s.rings)
    && Math.abs(Math.abs(normal.dot(new T.Vector3(s.slope?.x ?? 0, -1, -(s.slope?.y ?? 0)).normalize())) - 1) < 0.001).map(s => s.spaceId);
  return { ids: [...new Set(ids)], match: ids.length ? 'affine-plane-and-footprint' : 'unmatched-ceiling' };
}
const summaries: any[] = [], owners = new Set<string>();
const manifest = new Map<number, any>();
for (const stage of liveOnly ? ['app-portals-and-stairwells'] : ['built', 'app-stairwell-cut']) {
  if (stage === 'app-portals-and-stairwells') {
    log('Applying high-quality Explorer portal + live scene pipeline; scene-only visual ray targets');
    const ground = applyLivePipeline(bundle, scene);
    for (const input of inputs) {
      const foot = feet.get(input.node)!;
      const ray = new T.Raycaster(new T.Vector3(foot.position.x, foot.displayZ + 1.5, foot.position.z), new T.Vector3(0, -1, 0), 0, 4);
      const hit = castAll(ray, ground)[0];
      if (!hit) throw new Error(`Live app groundAt failed: ${input.node}`);
      log(`Live standing ${input.node}: groundY=${hit.point.y}, delta=${hit.point.y - foot.groundY}`);
      foot.position.y = hit.point.y; foot.groundY = hit.point.y;
    }
  }
  if (stage === 'app-stairwell-cut') {
    log('Applying route-clip cutSceneProbe (scene only; no runtime greybox)');
    cutSceneProbe(scene, bundle, 'high'); scene.root.updateMatrixWorld(true);
  }
  const meshes: T.Mesh[] = [];
  scene.root.traverse(o => {
    const m = o as T.Mesh;
    if (!m.isMesh || !m.geometry.getAttribute('position')) return;
    const materials = Array.isArray(m.material) ? m.material : [m.material];
    if (!materials.some(m => m.visible && m.opacity > 0 && m.colorWrite)) return;
    const box = new T.Box3().setFromObject(m);
    if (inputs.some(i => box.distanceToPoint(feet.get(i.node)!.position.clone().add(new T.Vector3(0, WALKER_BODY.eyeM, 0))) <= 8)) meshes.push(m);
    if (!manifest.has(m.id)) manifest.set(m.id, { id: m.id, chain: chain(m), materials: materials.map(m => ({ name: m.name, type: m.type, side: m.side, transparent: m.transparent, opacity: m.opacity })) });
  });
  log(`${stage}: preparing trees for ${meshes.length} nearby visible meshes`);
  prepareRayTrees(meshes);
  const fd = fs.openSync(`${out}/hits-${stage}.jsonl`, 'w');
  for (const input of inputs) for (const heading of input.headings) {
    const foot = feet.get(input.node)!;
    const camera = new T.PerspectiveCamera(FOV.firstPerson, 16 / 9, 0.05, 8);
    camera.position.copy(foot.position).add(new T.Vector3(0, WALKER_BODY.eyeM, 0));
    const yaw = -heading * Math.PI / 180;
    camera.lookAt(camera.position.clone().add(new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))));
    camera.updateMatrixWorld(true);
    reportViewer(scene,camera);
    const targets = meshes.filter(m => visible(m) && new T.Box3().setFromObject(m).distanceToPoint(camera.position) <= 8);
    const ray = new T.Raycaster(); ray.near = camera.near; ray.far = 8;
    const groups = new Map<string, any>(); let hitCount = 0, firstSlanted = 0;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      ray.setFromCamera(new T.Vector2(2 * (col + 0.5) / width - 1, 1 - 2 * (row + 0.5) / height), camera);
      const hits = castAll(ray, targets).filter(hit => {
        const m = hit.object as T.Mesh;
        const mat = Array.isArray(m.material) ? m.material[hit.face!.materialIndex] : m.material;
        return mat?.visible && !mat.transparent && mat.opacity > 0 && mat.colorWrite;
      });
      for (const [rank, hit] of hits.entries()) {
        if (!hit.face) continue;
        const mesh = hit.object as T.Mesh;
        const matrix = mesh.matrixWorld.clone();
        if (hit.instanceId !== undefined) { const im = new T.Matrix4(); (mesh as T.InstancedMesh).getMatrixAt(hit.instanceId, im); matrix.multiply(im); }
        const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(matrix)).normalize();
        const slope = Math.acos(Math.min(1, Math.abs(normal.y))) * 180 / Math.PI;
        const slanted = slope >= 10 && slope <= 80;
        const source = slanted ? sourceOf(hit, normal, matrix) : { ids: [], match: 'not-slanted' };
        const material = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
        const record = { stage, node: input.node, heading, control: input.controls.includes(heading), row, col, rank,
          meshId: mesh.id, meshName: mesh.name, material: material?.name ?? '', instanceId: hit.instanceId, faceIndex: hit.faceIndex,
          normal: normal.toArray(), slope, distance: hit.distance, point: hit.point.toArray(), slanted, source };
        // Full chain/userData are losslessly joined by meshId to meshes.json, to avoid repeating fixture metadata per ray.
        fs.writeSync(fd, JSON.stringify(record) + '\n'); hitCount++;
        if (!slanted) continue;
        for (const id of source.ids) owners.add(id);
        if (rank === 0) firstSlanted++;
        const owner = source.ids.join(' + ') || `${mesh.name || '(unnamed)'} [${material?.name || material?.type}]`;
        const key = `${mesh.id}|${owner}|${Math.round(slope * 10) / 10}`;
        const group = groups.get(key) ?? { meshId: mesh.id, meshName: mesh.name, material: material?.name, owner, match: source.match,
          slopeMin: slope, slopeMax: slope, minDistance: hit.distance, maxDistance: hit.distance, hits: 0, firstHits: 0,
          minCol: col, maxCol: col, minRow: row, maxRow: row, firstCells: [], sample: record };
        group.hits++; if (rank === 0) { group.firstHits++; group.firstCells.push([col, row]); }
        group.slopeMin = Math.min(group.slopeMin, slope); group.slopeMax = Math.max(group.slopeMax, slope);
        group.minDistance = Math.min(group.minDistance, hit.distance); group.maxDistance = Math.max(group.maxDistance, hit.distance);
        group.minCol = Math.min(group.minCol, col); group.maxCol = Math.max(group.maxCol, col);
        group.minRow = Math.min(group.minRow, row); group.maxRow = Math.max(group.maxRow, row);
        groups.set(key, group);
      }
    }
    const view = { stage, node: input.node, floor: input.floor, heading, control: input.controls.includes(heading), camera: camera.position.toArray(),
      feet: foot.position.toArray(), displayZ: foot.displayZ, groundY: foot.groundY, rays: width * height, hitCount, firstSlanted, groups: [...groups.values()] };
    summaries.push(view);
    log(`${stage} ${input.floor} ${input.node.slice(0, 10)} ${heading}°: ${hitCount} hits, ${firstSlanted} first slanted rays, ${groups.size} groups`);
  }
  fs.closeSync(fd);
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify({ timestamp: stamp(), privateBuild, grid: [width, height], fov: FOV.firstPerson, aspect: 16 / 9, views: summaries }, null, 2));
}
fs.writeFileSync(`${out}/meshes.json`, JSON.stringify([...manifest.values()], null, 2));
fs.writeFileSync(`${out}/sources.json`, JSON.stringify(sources.filter(s => owners.has(s.spaceId)).map(s => ({ ...s,
  cornerHeights: s.rings.map(r => r.map(p => soffitHeight(s, p))),
  relatedRuns: /^shaft-(roof|invert):/.test(s.spaceId) ? shafts[Number(s.spaceId.split(':')[1])] : layout.runs.filter(r => s.spaceId.includes(r.edgeId) || (s.origin && Math.hypot(r.a.x - s.origin.x, r.a.y - s.origin.y) < 0.01) || (s.origin && Math.hypot(r.b.x - s.origin.x, r.b.y - s.origin.y) < 0.01)),
  nodeChecks: inputs.map(input => { const p = feet.get(input.node)!.position; const xy = { x: p.x, y: -p.z }; return { node: input.node, withinFootprint: pointInRings(xy, s.rings), panelY: soffitHeight(s, xy), floorY: p.y, clearance: soffitHeight(s, xy) - p.y }; }),
})), null, 2));
fs.writeFileSync(`${out}/inputs.json`, JSON.stringify(inputs.map(i => ({ ...i,
  nodeData: bundle.nodes.find(n => n.id === i.node),
  incidentEdges: bundle.edges.filter(e => e.from === i.node || e.to === i.node).map(e => ({ ...e,
    fromNode: bundle.nodes.find(n => n.id === e.from), toNode: bundle.nodes.find(n => n.id === e.to),
    fromZ: layout.nodeZ.get(e.from), toZ: layout.nodeZ.get(e.to) })),
})), null, 2));
scene.dispose();
log(`PASS: ${summaries.length} view/stage grids; ${owners.size} source owners; every hit recorded within 8 m`);
