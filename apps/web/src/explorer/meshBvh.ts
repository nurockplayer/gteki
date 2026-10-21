import * as THREE from "three";
import { TriangleBvh } from "./triangleBvh.ts";

/**
 * One tree per geometry, shared by every mesh that uses it; dropped with the geometry. Built only at
 * load, with the buffer versions it was built from: a geometry edited in place since then (or swapped
 * in later) has no current tree, so it does not occlude labels (rather than occluding where it used to
 * be) and is ray-tested triangle by triangle again. A tree is in the geometry's own (local) space, so
 * moving, rotating or scaling a mesh never invalidates it.
 */
const bvhCache = new WeakMap<THREE.BufferGeometry, { bvh: TriangleBvh; version: string; buffers: object[] }>();

const attributeVersion = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) =>
  (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data.version : (a as THREE.BufferAttribute).version;
const bufferVersion = (g: THREE.BufferGeometry) => `${attributeVersion(g.getAttribute("position"))}:${g.getIndex()?.version ?? -1}`;
/** Every object whose replacement changes the triangles: position (and its interleaved data) and index. */
const bufferIds = (g: THREE.BufferGeometry): object[] => {
  const position = g.getAttribute("position");
  const data = (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (position as THREE.InterleavedBufferAttribute).data : null;
  return [position, data ?? position, g.getIndex() ?? g];
};

export function currentBvh(g: THREE.BufferGeometry): TriangleBvh | null {
  const entry = bvhCache.get(g);
  // A geometry that lost its positions has no triangles to test.
  if (!entry || !g.getAttribute("position")) return null;
  // Same buffers (identity, as attributes and interleaved data can be replaced) at the same versions as at build time.
  return entry.version === bufferVersion(g) && bufferIds(g).every((b, i) => b === entry.buffers[i]) ? entry.bvh : null;
}

export function cacheBvh(g: THREE.BufferGeometry): void {
  if (currentBvh(g)) return;
  bvhCache.set(g, { bvh: TriangleBvh.build(g.getAttribute("position"), g.getIndex()), version: bufferVersion(g), buffers: bufferIds(g) });
}

type ComputeIntersections = (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[], rayLocalSpace: THREE.Ray) => void;
/** three's per-triangle loop behind Mesh.raycast (r186): every triangle in the draw range (per group with a material array). */
const computeIntersections = (THREE.Mesh.prototype as unknown as { _computeIntersections: ComputeIntersections })._computeIntersections;

/**
 * A plain static mesh the tree can stand in for: three's own Mesh.raycast and vertex positions (no skinning,
 * instancing, batching or morphing), whole triangles only (draw range, groups and buffer in steps of 3).
 */
function treeable(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh !== true || mesh.raycast !== THREE.Mesh.prototype.raycast || mesh.getVertexPosition !== THREE.Mesh.prototype.getVertexPosition) return false;
  const geometry = mesh.geometry;
  if (!geometry?.getAttribute("position") || geometry.morphAttributes.position?.length) return false;
  const whole = (n: number) => n === Infinity || n % 3 === 0;
  const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  if (total % 3 !== 0 || !whole(geometry.drawRange.start) || !whole(geometry.drawRange.count)) return false;
  return !Array.isArray(mesh.material) || geometry.groups.every((g) => whole(g.start) && whole(g.count));
}

const treeFor = (object: THREE.Object3D): TriangleBvh | null => (treeable(object) ? currentBvh(object.geometry) : null);

/** Build the trees `objects` (castTargets) are ray-tested with. Returns what they cost. */
export function prepareRayTrees(objects: readonly THREE.Object3D[]): { trees: number; triangles: number; bytes: number; buildMs: number } {
  const started = performance.now();
  const trees = new Set<TriangleBvh>();
  for (const object of objects) {
    if (!treeable(object)) continue;
    cacheBvh(object.geometry);
    trees.add(currentBvh(object.geometry)!);
  }
  const buildMs = performance.now() - started;
  let triangles = 0, bytes = 0;
  for (const tree of trees) { triangles += tree.triangleCount; bytes += tree.byteLength; }
  return { trees: trees.size, triangles, bytes, buildMs };
}

const sphere = new THREE.Sphere();
const localRay = new THREE.Ray();
const inverse = new THREE.Matrix4();
const sphereHitAt = new THREE.Vector3();
const linear = new THREE.Matrix3();
const step = new THREE.Vector3();
const candidates: number[] = [];

/**
 * `object.raycast(raycaster, intersects)`, with a static mesh's tree choosing which triangles three tests.
 * Up to the per-triangle loop this is three's Mesh.raycast verbatim (bounding sphere, local ray, bounding
 * box); then three's own loop runs once per candidate triangle, narrowed to it by the draw range (and the
 * group), in three's order. So hits, their distances, points, faces and order are exactly three's: the tree
 * only skips triangles the ray cannot touch.
 */
export function raycastObject(object: THREE.Object3D, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const tree = treeFor(object);
  if (!tree) {
    object.raycast(raycaster, intersects);
    return;
  }
  const mesh = object as THREE.Mesh;
  const { geometry, material, matrixWorld } = mesh;
  if (material === undefined) return;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  sphere.copy(geometry.boundingSphere!).applyMatrix4(matrixWorld);
  localRay.copy(raycaster.ray).recast(raycaster.near);
  if (sphere.containsPoint(localRay.origin) === false) {
    if (localRay.intersectSphere(sphere, sphereHitAt) === null) return;
    if (localRay.origin.distanceToSquared(sphereHitAt) > (raycaster.far - raycaster.near) ** 2) return;
  }
  inverse.copy(matrixWorld).invert();
  localRay.copy(raycaster.ray).applyMatrix4(inverse);
  if (geometry.boundingBox !== null && localRay.intersectsBox(geometry.boundingBox) === false) return;

  // A hit's world distance is `scale` × its local ray parameter (the local direction is a unit vector).
  const scale = step.copy(localRay.direction).applyMatrix3(linear.setFromMatrix4(matrixWorld)).length();
  const tMax = raycaster.far === Infinity || !(scale > 0) ? Infinity : (raycaster.far / scale) * (1 + 1e-6) + 1e-6;
  const { origin: o, direction: d } = localRay;
  candidates.length = 0;
  tree.rayCandidates(o.x, o.y, o.z, d.x, d.y, d.z, tMax, candidates);
  if (candidates.length === 0) return;
  candidates.sort((a, b) => a - b);

  const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  const range = geometry.drawRange;
  const { start: rangeStart, count: rangeCount } = range;
  const groups = geometry.groups;
  const test = (start: number, end: number) => {
    for (const t of candidates) {
      const j = t * 3;
      if (j < start || j >= end) continue;
      range.start = j;
      range.count = 3;
      computeIntersections.call(mesh, raycaster, intersects, localRay);
    }
  };
  try {
    if (Array.isArray(material)) {
      for (const group of groups) {
        geometry.groups = [group];
        test(Math.max(group.start, rangeStart), Math.min(total, group.start + group.count, rangeStart + rangeCount));
      }
    } else {
      test(Math.max(0, rangeStart), Math.min(total, rangeStart + rangeCount));
    }
  } finally {
    range.start = rangeStart;
    range.count = rangeCount;
    geometry.groups = groups;
  }
}
