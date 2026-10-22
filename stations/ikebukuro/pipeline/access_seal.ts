// Walker checks for scene/access_fences.json: from verified floor, the explorer's walker never reaches
// floor outside the routable coverage areas.
//
// checkOutline certifies the seal: wherever surveyed floor lies near the outline of the routable areas,
// fence panels cover the outline with no gap, however narrow, at every height the walker's collision
// rays can be at there. checkSeal then floods the station from every graph node with the explorer's
// walker rules (apps/web/src/explorer: collision rays at 0.5 and 1.2 m reaching step + 0.3 m, step up
// 0.45 m, step down 0.9 m) over the lit GLB's floor and stairs plus walk bridges, against walls,
// barriers, transport, ceilings and the fences, keeping every distinct floor level it reaches. Doors,
// windows and portal closures count as open, which is the strict choice: the scene makes most of them
// solid. Any flooded point outside every routable area is an escape. A lattice flood alone cannot see
// a gap narrower than its step; the outline check can.
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";

export const WALKER = { radiusM: 0.3, stepUpM: 0.45, stepDownM: 0.9, rayHeightsM: [0.5, 1.2] } as const;
export interface Fence { a: number[]; b: number[]; z0: number; z1: number }
export interface SealResult { seeds: number; flooded: number; escapes: number[][] }
/** Floor is looked for this far off the outline, both sides (m), as in pipeline/build_access.py. */
export const PROBE_M = [0.05, 0.3, 0.6] as const;
type XY = { x: number; y: number };

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => JSON.parse(fs.readFileSync(ROOT + p, "utf8"));
const R = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y); // ENU -> renderer frame
THREE.Mesh.prototype.raycast = acceleratedRaycast;

function bake(parts: [THREE.BufferGeometry, THREE.Matrix4][]): THREE.Mesh {
  const pos: number[] = [], v = new THREE.Vector3();
  for (const [g, m] of parts) {
    const p = g.attributes.position!, ix = g.index, n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p as THREE.BufferAttribute, ix ? ix.getX(i) : i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  computeBoundsTree.call(geo);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function quads(list: THREE.Vector3[][]): [THREE.BufferGeometry, THREE.Matrix4] {
  const pos: number[] = [];
  for (const q of list) for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k]!.x, q[k]!.y, q[k]!.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return [g, new THREE.Matrix4()];
}

export function inPoly(x: number, y: number, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The lit station GLB's meshes as [geometry, world matrix] pairs per gteki_role. */
export async function glbRoles(): Promise<Map<string, [THREE.BufferGeometry, THREE.Matrix4][]>> {
  const buf = fs.readFileSync(ROOT + "gteki/assets/ikebukuro_b1_lit.glb");
  const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "", res, rej));
  gltf.scene.updateMatrixWorld(true);
  const roles = new Map<string, [THREE.BufferGeometry, THREE.Matrix4][]>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = (m.userData.gteki_role as string | undefined) ?? m.name;
    (roles.get(role) ?? roles.set(role, []).get(role)!).push([m.geometry, m.matrixWorld]);
  });
  return roles;
}

/** Heights of the mesh's surfaces under (x, y) between z0 and z1 (ENU). */
export function heightsAt(mesh: THREE.Mesh, x: number, y: number, z0: number, z1: number): number[] {
  const ray = new THREE.Raycaster(R(x, y, z1), new THREE.Vector3(0, -1, 0), 0, z1 - z0);
  return ray.intersectObject(mesh, false).map((h) => h.point.y);
}

export { bake, read, R };

export const committed = (): Fence[] => read("scene/access_fences.json").fences;
export const routable = (): XY[][] =>
  (read("gteki/station.json").coverage.areas as { status: string; polygon?: XY[] }[])
    .filter((a) => a.status === "routable" && a.polygon).map((a) => a.polygon!);

let walkable: Promise<THREE.Mesh> | undefined;
/** Floor the walker can stand on: the GLB's floor and stairs plus the walk bridges. */
function walkMesh(): Promise<THREE.Mesh> {
  return (walkable ??= glbRoles().then((roles) => {
    const parts = ["floor", "stairs_ramps"].flatMap((n) => roles.get(n) ?? []);
    parts.push(quads((read("scene/walk_bridges.json").quads as number[][][]).map((q) => q.map((p) => R(p[0]!, p[1]!, p[2]!)))));
    return bake(parts);
  }));
}

/**
 * Gaps in the fences along the outline of the routable areas. The outline is sampled every `step` m;
 * at each sample with floor within PROBE_M on either side, for every such floor height h, the panels
 * on that outline edge whose height band holds both collision rays (h + 0.5 and h + 1.2 m) must
 * together cover the outline from `step` before the sample to `step` after it (exact interval union,
 * so a 1 mm gap counts). Edges shared by two routable areas are inside the union and need no fence.
 */
export async function checkOutline(fences: Fence[] = committed(), step = 0.05): Promise<string[]> {
  const walk = await walkMesh(), polys = routable();
  const inside = (x: number, y: number) => polys.some((p) => inPoly(x, y, p));
  const [lo, hi] = [WALKER.rayHeightsM[0], WALKER.rayHeightsM[WALKER.rayHeightsM.length - 1]!];
  const gaps: string[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i]!, B = poly[(i + 1) % poly.length]!, L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1e-6) continue;
      const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
      let nx = uy, ny = -ux;
      if (inPoly((A.x + B.x) / 2 + nx * 0.05, (A.y + B.y) / 2 + ny * 0.05, poly)) [nx, ny] = [-nx, -ny];
      // Panels on this edge's line, as intervals of the edge parameter t.
      const along = fences.flatMap((f) => {
        const off = (p: number[]) => Math.abs((p[0]! - A.x) * nx + (p[1]! - A.y) * ny);
        if (off(f.a) > 2e-3 || off(f.b) > 2e-3) return [];
        const ta = (f.a[0]! - A.x) * ux + (f.a[1]! - A.y) * uy, tb = (f.b[0]! - A.x) * ux + (f.b[1]! - A.y) * uy;
        return [{ t0: Math.min(ta, tb), t1: Math.max(ta, tb), z0: f.z0, z1: f.z1 }];
      });
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k <= n; k++) {
        const t = (L * k) / n, x = A.x + ux * t, y = A.y + uy * t;
        if (inside(x + nx * 0.05, y + ny * 0.05)) continue;
        const hs = PROBE_M.flatMap((d) => [-d, d]).flatMap((d) => heightsAt(walk, x + nx * d, y + ny * d, -100, 300));
        for (const h of new Set(hs.map((z) => Math.round(z * 100) / 100))) {
          let reach = Math.max(0, t - step);
          const end = Math.min(L, t + step);
          const spans = along.filter((s) => s.z0 <= h + lo && s.z1 >= h + hi).sort((a, b) => a.t0 - b.t0);
          for (const s of spans) if (s.t0 <= reach && s.t1 > reach) reach = s.t1;
          if (reach < end) {
            gaps.push(`(${(A.x + ux * reach).toFixed(3)}, ${(A.y + uy * reach).toFixed(3)}) floor ${h}: no fence`);
            break;
          }
        }
      }
    }
  }
  return gaps;
}

/** Flood at `step` m; `fences` defaults to the committed scene/access_fences.json. Stops after `maxEscapes`. */
export async function checkSeal(step: number, fences: Fence[] = committed(), maxEscapes = 5): Promise<SealResult> {
  const roles = await glbRoles();
  const colParts = ["wall", "barriers", "transport", "ceiling"].flatMap((n) => roles.get(n) ?? []);
  if (fences.length) colParts.push(quads(fences.map((f) => [R(f.a[0]!, f.a[1]!, f.z0), R(f.b[0]!, f.b[1]!, f.z0), R(f.b[0]!, f.b[1]!, f.z1), R(f.a[0]!, f.a[1]!, f.z1)])));
  const walk = await walkMesh(), coll = bake(colParts);
  const ray = new THREE.Raycaster();
  (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);

  const ground = (x: number, y: number, fromZ: number): number | null => {
    ray.set(R(x, y, fromZ), down);
    ray.far = WALKER.stepUpM + WALKER.stepDownM + 0.1;
    const hit = ray.intersectObject(walk, false)[0];
    return hit ? hit.point.y : null;
  };
  const blocked = (p: THREE.Vector3, q: THREE.Vector3): boolean => {
    const d = q.clone().sub(p), len = d.length();
    d.divideScalar(len);
    for (const h of WALKER.rayHeightsM) {
      ray.set(p.clone().addScaledVector(up, h), d);
      ray.far = len + WALKER.radiusM;
      if (ray.intersectObject(coll, false).length) return true;
    }
    return false;
  };

  const polys = routable();
  const inside = (x: number, y: number) => polys.some((p) => inPoly(x, y, p));
  // Lattice moves (8 neighbours), so every flooded point is a lattice point and the key is exact in plan.
  // Heights are kept to 1 cm: stacked levels and stair treads under one point stay separate states.
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  const key = (i: number, j: number, z: number) => `${i},${j},${Math.round(z * 100)}`;
  const nodes = read("gteki/graph.json").nodes as { position: { x: number; y: number; z: number } }[];
  const seen = new Set<string>(), queue: number[][] = [], escapes: number[][] = [];
  for (const { position: p } of nodes) {
    // Each node joins the lattice at its nearest point, if the walker can step there from the node.
    const i = Math.round(p.x / step), j = Math.round(p.y / step), X = i * step, Y = j * step;
    const moved = Math.hypot(X - p.x, Y - p.y) > 1e-9;
    const g = moved ? ground(X, Y, p.z + WALKER.stepUpM + 0.05) : p.z;
    if (g === null || (moved && blocked(R(p.x, p.y, p.z), R(X, Y, p.z)))) continue;
    const k = key(i, j, g);
    if (!seen.has(k)) { seen.add(k); queue.push([i, j, g]); }
  }
  for (let head = 0; head < queue.length && escapes.length < maxEscapes; head++) {
    const [i, j, z] = queue[head] as [number, number, number];
    for (const [di, dj] of dirs) {
      const I = i + di, J = j + dj, X = I * step, Y = J * step;
      if (blocked(R(i * step, j * step, z), R(X, Y, z))) continue;
      const g = ground(X, Y, z + WALKER.stepUpM + 0.05);
      if (g === null || g - z > WALKER.stepUpM || g - z < -WALKER.stepDownM) continue;
      const k = key(I, J, g);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([I, J, g]);
      if (!inside(X, Y)) escapes.push([X, Y, g].map((v) => +v.toFixed(2)));
    }
  }
  return { seeds: nodes.length, flooded: queue.length, escapes };
}
