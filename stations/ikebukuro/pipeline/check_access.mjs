// Walker check for scene/access_fences.json: no mouth of an access link reaches another by walking.
//
// build_access.py places fences on the 0.5 m gridnav grid, which keeps clear of walls and so is
// stricter than the explorer's walker. This floods surveyed floor outside the routable areas
// with the walker's own rules (apps/web/src/explorer: collision rays at 0.5 and 1.2 m reaching
// step + 0.3 m, step up 0.45 m, step down 0.9 m) on the lit GLB plus walk bridges and fences,
// from each mouth group of every link in build/access_links.json, and fails if any flood comes
// within 0.6 m of another group's mouth. Mouth cells under a fence (within 0.45 m) belong to
// neither side and are dropped. Doors and portals count as open, which is the strict choice.
//
//   node pipeline/check_access.mjs [step=0.1]
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { acceleratedRaycast, computeBoundsTree } from "three-mesh-bvh";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(ROOT + p, "utf8"));
const STEP = Number(process.argv[2] ?? 0.1);
const STEP_UP = 0.45, STEP_DOWN = 0.9, RADIUS = 0.3, REACH = 0.6, FENCE_CLEAR = 0.45;

THREE.Mesh.prototype.raycast = acceleratedRaycast;
const R = (x, y, z) => new THREE.Vector3(x, z, -y); // ENU -> renderer frame

const buf = fs.readFileSync(ROOT + "gteki/assets/ikebukuro_b1_lit.glb");
const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", res, rej));
gltf.scene.updateMatrixWorld(true);

const walkParts = [], colParts = [];
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const role = o.userData.gteki_role ?? o.name;
  if (role === "floor" || role === "stairs_ramps") walkParts.push([o.geometry, o.matrixWorld]);
  if (["wall", "barriers", "transport", "ceiling"].includes(role)) colParts.push([o.geometry, o.matrixWorld]);
});
const quads = (list) => {
  const pos = [];
  for (const q of list) for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k].x, q[k].y, q[k].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return [g, new THREE.Matrix4()];
};
walkParts.push(quads(read("scene/walk_bridges.json").quads.map((q) => q.map((p) => R(...p)))));
const fences = read("scene/access_fences.json").fences;
colParts.push(quads(fences.map((f) => [R(f.a[0], f.a[1], f.z0), R(f.b[0], f.b[1], f.z0), R(f.b[0], f.b[1], f.z1), R(f.a[0], f.a[1], f.z1)])));

const bake = (parts) => {
  const pos = [], v = new THREE.Vector3();
  for (const [g, m] of parts) {
    const p = g.attributes.position, ix = g.index, n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, ix ? ix.getX(i) : i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.boundsTree = computeBoundsTree.call(geo);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
};
const walk = bake(walkParts), coll = bake(colParts);
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const down = new THREE.Vector3(0, -1, 0);

const ground = (x, y, fromZ) => {
  ray.set(R(x, y, fromZ), down);
  ray.far = STEP_UP + STEP_DOWN + 0.1;
  const hit = ray.intersectObject(walk, false)[0];
  return hit ? hit.point.y : null;
};
const blocked = (p, q) => {
  const d = q.clone().sub(p), len = d.length();
  d.divideScalar(len);
  for (const h of [0.5, 1.2]) {
    ray.set(p.clone().add(new THREE.Vector3(0, h, 0)), d);
    ray.far = len + RADIUS;
    if (ray.intersectObject(coll, false).length) return true;
  }
  return false;
};

const { routable, links } = read("build/access_links.json");
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const inR = (x, y) => routable.some((p) => inPoly(x, y, p));
const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
};
const underFence = ([x, y, z]) => fences.some((f) => z > f.z0 - 0.5 && z < f.z1 && segDist(x, y, f.a, f.b) < FENCE_CLEAR);
const dirs = [...Array(8)].map((_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
const key = (x, y) => `${Math.round(x / STEP)},${Math.round(y / STEP)}`;

let leaks = 0;
for (const [li, link] of links.entries()) {
  const groups = link.groups.map((g) => g.filter((c) => !underFence(c)));
  for (const [gi, group] of groups.entries()) {
    const targets = new Map();
    for (const [x, y, z] of groups.filter((_, h) => h !== gi).flat()) {
      const k = `${Math.floor(x)},${Math.floor(y)}`;
      (targets.get(k) ?? targets.set(k, []).get(k)).push([x, y, z]);
    }
    const nearTarget = (x, y, z) => {
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const [tx, ty, tz] of targets.get(`${Math.floor(x) + a},${Math.floor(y) + b}`) ?? [])
            if (Math.hypot(tx - x, ty - y) < REACH && Math.abs(tz - z) < REACH) return true;
      return false;
    };
    const seen = new Set(), queue = [];
    for (const c of group) if (!seen.has(key(c[0], c[1]))) { seen.add(key(c[0], c[1])); queue.push(c); }
    let hit = null;
    for (let head = 0; head < queue.length && !hit; head++) {
      const [x, y, z] = queue[head];
      for (const [dx, dy] of dirs) {
        const X = x + dx * STEP, Y = y + dy * STEP, k = key(X, Y);
        if (seen.has(k) || inR(X, Y) || blocked(R(x, y, z), R(X, Y, z))) continue;
        const g = ground(X, Y, z + STEP_UP + 0.05);
        if (g === null || g - z > STEP_UP || g - z < -STEP_DOWN) continue;
        seen.add(k);
        queue.push([X, Y, g]);
        if (nearTarget(X, Y, g)) { hit = [X, Y, g].map((v) => +v.toFixed(2)); break; }
      }
    }
    console.log(`link ${li} mouths ${gi + 1}/${groups.length}: ${group.length} cells, flooded ${seen.size}, ` +
      (hit ? `LEAK at ${JSON.stringify(hit)}` : "sealed"));
    if (hit) leaks++;
  }
}
console.log(leaks ? `FAIL: ${leaks} leak(s)` : `ok: ${links.length} link(s) sealed for the walker`);
process.exit(leaks ? 1 : 0);
