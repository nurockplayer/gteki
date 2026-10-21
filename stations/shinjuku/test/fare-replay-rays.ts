/** Test-only spatial broad phase over the hook's actual static meshes.
 * Native Three Ray.intersectTriangle is the same primitive used by Mesh.raycast.
 * Keep the consumed point/distance/material-side/near/far semantics; omit UV/normal work.
 */
import * as THREE from "three";
interface Axis { x: number; z: number; min: number; max: number; radius: number }
interface Face { axes: Axis[]; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; minY: number; maxY: number; index: number; box: THREE.Box3 }
interface Node { box: THREE.Box3; faces?: Face[]; left?: Node; right?: Node }
export function accelerateRaycasts(objects: readonly THREE.Object3D[]) {
  const restores: (() => void)[] = [];
  for (const object of new Set(objects)) {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.geometry.groups.length) throw new Error("Replay requires plain static proxy meshes");
    const geometry = mesh.geometry, position = geometry.getAttribute("position"), index = geometry.index;
    const count = index?.count ?? position.count, range = geometry.drawRange;
    if (range.start !== 0 || range.count < count) throw new Error("Replay proxy uses a partial draw range");
    const faces: Face[] = [];
    const cells = new Map<string, Face[]>(), cell = .5;
    for (let i = 0; i < count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i);
      const b = new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2);
      const box = new THREE.Box3().setFromPoints([a, b, c]).expandByScalar(1e-8);
      const axes = [[-(b.z - a.z), b.x - a.x], [-(c.z - b.z), c.x - b.x], [-(a.z - c.z), a.x - c.x]].map(([x, z]) => {
        const values = [a, b, c].map(p => p.x * x! + p.z * z!);
        return { x: x!, z: z!, min: Math.min(...values) - 1e-8, max: Math.max(...values) + 1e-8, radius: cell / 2 * (Math.abs(x!) + Math.abs(z!)) };
      });
      faces.push({ a, b, c, box, axes, index: i / 3, minY: box.min.y, maxY: box.max.y });
    }
    const build = (fs: Face[]): Node => {
      const box = new THREE.Box3(); for (const f of fs) box.union(f.box);
      if (fs.length <= 8) return { box, faces: fs };
      const size = box.getSize(new THREE.Vector3()), axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
      fs.sort((a, b) => (a.box.min[axis] + a.box.max[axis]) - (b.box.min[axis] + b.box.max[axis]));
      const mid = Math.floor(fs.length / 2); return { box, left: build(fs.slice(0, mid)), right: build(fs.slice(mid)) };
    };
    const tree = build([...faces]), originalCast = mesh.raycast, inverse = mesh.matrixWorld.clone().invert();
    const ray = new THREE.Ray(), point = new THREE.Vector3(), worldPoint = new THREE.Vector3(), boxHit = new THREE.Vector3();
    const side = mesh.material.side, matrix = mesh.matrixWorld;
    const cellFaces = (x: number, z: number) => {
      const key = `${x},${z}`, known = cells.get(key); if (known) return known;
      const result: Face[] = [], minX = x * cell - 1e-8, maxX = (x + 1) * cell + 1e-8, minZ = z * cell - 1e-8, maxZ = (z + 1) * cell + 1e-8;
      const visit = (node: Node) => {
        if (node.box.max.x < minX || node.box.min.x > maxX || node.box.max.z < minZ || node.box.min.z > maxZ) return;
        if (node.faces) for (const f of node.faces) {
          if (f.box.max.x < minX || f.box.min.x > maxX || f.box.max.z < minZ || f.box.min.z > maxZ) continue;
          if (f.axes.some(axis => { const mid = (x + .5) * cell * axis.x + (z + .5) * cell * axis.z; return mid + axis.radius < axis.min || mid - axis.radius > axis.max; })) continue;
          result.push(f);
        } else { visit(node.left!); visit(node.right!); }
      };
      visit(tree); cells.set(key, result); return result;
    };
    const seen = new Set<Face>();
    const cast = (f: Face, caster: THREE.Raycaster, hits: THREE.Intersection[], minY: number, maxY: number) => {
        if (f.maxY < minY || f.minY > maxY) return;
        const hit = side === THREE.BackSide ? ray.intersectTriangle(f.c, f.b, f.a, true, point) : ray.intersectTriangle(f.a, f.b, f.c, side === THREE.FrontSide, point);
        if (!hit) return;
        worldPoint.copy(point).applyMatrix4(matrix);
        const distance = worldPoint.distanceTo(caster.ray.origin);
        if (distance < caster.near || distance > caster.far) return;
        hits.push({ distance, point: worldPoint.clone(), object: mesh, faceIndex: f.index });
      };
    mesh.raycast = (caster, hits) => {
      ray.copy(caster.ray).applyMatrix4(inverse);
      const e = inverse.elements, d = caster.ray.direction;
      const scale = Math.hypot(e[0]! * d.x + e[4]! * d.y + e[8]! * d.z, e[1]! * d.x + e[5]! * d.y + e[9]! * d.z, e[2]! * d.x + e[6]! * d.y + e[10]! * d.z);
      const far = caster.far * scale, near = caster.near * scale;
      const minY = Math.min(ray.origin.y + ray.direction.y * near, ray.origin.y + ray.direction.y * far) - 1e-8;
      const maxY = Math.max(ray.origin.y + ray.direction.y * near, ray.origin.y + ray.direction.y * far) + 1e-8;
      const x0 = Math.floor(Math.min(ray.origin.x + ray.direction.x * near, ray.origin.x + ray.direction.x * far) / cell);
      const x1 = Math.floor(Math.max(ray.origin.x + ray.direction.x * near, ray.origin.x + ray.direction.x * far) / cell);
      const z0 = Math.floor(Math.min(ray.origin.z + ray.direction.z * near, ray.origin.z + ray.direction.z * far) / cell);
      const z1 = Math.floor(Math.max(ray.origin.z + ray.direction.z * near, ray.origin.z + ray.direction.z * far) / cell);
      if (Number.isFinite(far) && (x1 - x0 + 1) * (z1 - z0 + 1) <= 256) {
        seen.clear();
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const face of cellFaces(x, z)) if (!seen.has(face)) { seen.add(face); cast(face, caster, hits, minY, maxY); }
      } else {
        const visit = (node: Node) => { if (!ray.intersectBox(node.box, boxHit)) return; if (node.faces) for (const f of node.faces) cast(f, caster, hits, minY, maxY); else { visit(node.left!); visit(node.right!); } };
        visit(tree);
      }
    };
    restores.push(() => { mesh.raycast = originalCast; });
  }
  return () => { for (const restore of restores) restore(); };
}

/** Broad-phase target selection; selected objects are the original hook meshes. */
export function nearbyTargets(objects: readonly THREE.Object3D[]) {
  type Branch = { box: THREE.Box3; objects?: THREE.Object3D[]; left?: Branch; right?: Branch };
  const rows = objects.map(object => {
    const mesh = object as THREE.Mesh; mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(1e-7);
    return { object, box, center: box.getCenter(new THREE.Vector3()) };
  });
  const build = (items: typeof rows): Branch => {
    const box = new THREE.Box3(); for (const i of items) box.union(i.box);
    if (items.length <= 4) return { box, objects: items.map(i => i.object) };
    const size = box.getSize(new THREE.Vector3()), axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
    items.sort((a, b) => a.center[axis] - b.center[axis]); const half = Math.floor(items.length / 2);
    return { box, left: build(items.slice(0, half)), right: build(items.slice(half)) };
  };
  const tree = build(rows), hit = new THREE.Vector3();
  const visit = (node: Branch, ray: THREE.Raycaster, out: THREE.Object3D[]) => {
    if (!ray.ray.intersectBox(node.box, hit)) return;
    if (!node.box.containsPoint(ray.ray.origin) && hit.distanceTo(ray.ray.origin) > ray.far) return;
    if (node.objects) out.push(...node.objects); else { visit(node.left!, ray, out); visit(node.right!, ray, out); }
  };
  return (ray: THREE.Raycaster) => { const out: THREE.Object3D[] = []; visit(tree, ray, out); return out; };
}
