/** Test-only broad phase. Leaves still call Three's native raycast on the hook's actual mesh.
 * Triangle coordinates, materials, transforms, near/far and results are unchanged.
 */
import * as THREE from "three";
interface Node { box: THREE.Box3; start: number; count: number; left?: Node; right?: Node }
export function accelerateRaycasts(objects: readonly THREE.Object3D[]) {
  const restores: (() => void)[] = [];
  for (const object of new Set(objects)) {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) throw new Error("Replay requires the hook's plain proxy meshes");
    const geometry = mesh.geometry, position = geometry.getAttribute("position");
    const originalIndex = geometry.index, originalRange = { ...geometry.drawRange }, originalCast = mesh.raycast;
    if (geometry.groups.length) throw new Error("Unexpected proxy material groups");
    const indices = originalIndex ? Array.from(originalIndex.array) : Array.from({ length: position.count }, (_, i) => i);
    const triangles = Array.from({ length: indices.length / 3 }, (_, i) => {
      const vertices = indices.slice(i * 3, i * 3 + 3), box = new THREE.Box3();
      for (const index of vertices) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, index));
      return { vertices, box, center: box.getCenter(new THREE.Vector3()) };
    });
    const ordered: number[] = [];
    const build = (ts: typeof triangles): Node => {
      const box = new THREE.Box3(); for (const t of ts) box.union(t.box);
      const node: Node = { box, start: ordered.length, count: ts.length * 3 };
      if (ts.length <= 16) { for (const t of ts) ordered.push(...t.vertices); return node; }
      const size = box.getSize(new THREE.Vector3()), axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
      ts.sort((a, b) => a.center[axis] - b.center[axis]);
      const mid = Math.floor(ts.length / 2); node.left = build(ts.slice(0, mid)); node.right = build(ts.slice(mid));
      return node;
    };
    const tree = build(triangles); geometry.setIndex(ordered);
    const inverse = new THREE.Matrix4(), localRay = new THREE.Ray(), hit = new THREE.Vector3(), worldHit = new THREE.Vector3();
    mesh.raycast = (caster, hits) => {
      inverse.copy(mesh.matrixWorld).invert(); localRay.copy(caster.ray).applyMatrix4(inverse);
      const visit = (node: Node) => {
        if (!localRay.intersectBox(node.box, hit)) return;
        if (!node.box.containsPoint(localRay.origin) && worldHit.copy(hit).applyMatrix4(mesh.matrixWorld).distanceTo(caster.ray.origin) > caster.far) return;
        if (node.left && node.right) { visit(node.left); visit(node.right); }
        else { geometry.setDrawRange(node.start, node.count); THREE.Mesh.prototype.raycast.call(mesh, caster, hits); }
      };
      visit(tree); geometry.setDrawRange(originalRange.start, originalRange.count);
    };
    restores.push(() => { mesh.raycast = originalCast; geometry.setIndex(originalIndex); geometry.setDrawRange(originalRange.start, originalRange.count); });
  }
  return () => { for (const restore of restores) restore(); };
}

/** Broad-phase target selection; the selected objects are the original hook meshes. */
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
  return (ray: THREE.Raycaster) => {
    const out: THREE.Object3D[] = [];
    const visit = (node: Branch) => {
      if (!ray.ray.intersectBox(node.box, hit)) return;
      if (!node.box.containsPoint(ray.ray.origin) && hit.distanceTo(ray.ray.origin) > ray.far) return;
      if (node.objects) out.push(...node.objects); else { visit(node.left!); visit(node.right!); }
    };
    visit(tree); return out;
  };
}
