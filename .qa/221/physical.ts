import fs from 'node:fs';
import { createHash } from 'node:crypto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_k, x) => x instanceof Map ? [...x] : x)).digest('hex');
export function physicalSnapshot(scene: any, layout: any) {
  const meshes = (objects: any[]) => objects.map(o => ({ type: o.type, matrix: o.matrixWorld.toArray(),
    position: o.geometry ? Array.from(o.geometry.attributes.position.array) : null,
    index: o.geometry?.index ? Array.from(o.geometry.index.array) : null,
    children: o.children?.map((c: any) => ({ matrix: c.matrixWorld.toArray(), position: c.geometry ? Array.from(c.geometry.attributes.position.array) : null })) }));
  const { shaftFinishes: _visible, shaftFascias: _fascias, ...physicalLayout } = layout;
  const gates = ['navmesh-fallback.json', 'navmesh-clip-baseline.json', 'navmesh-suspect.json', 'navmesh-paths.json', 'navmesh-gate-reset.json'];
  return { walkable: hash(meshes(scene.walkable)), colliders: hash(meshes(scene.colliders ?? [])),
    cameraBlockers: hash(meshes(scene.cameraBlockers ?? [])), walls: hash(scene.walls), layout: hash(physicalLayout),
    gates: Object.fromEntries(gates.filter(f => fs.existsSync(`stations/shinjuku/${f}`)).map(f => [f, hash(fs.readFileSync(`stations/shinjuku/${f}`, 'utf8'))])) };
}
