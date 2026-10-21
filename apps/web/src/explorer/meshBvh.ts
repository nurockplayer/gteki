import * as THREE from "three";
import { TriangleBvh } from "./triangleBvh.ts";

type Position = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * Everything the triangles are read from. Identity alone is not enough: `BufferAttribute.copy()` (and
 * assigning `array`, `itemSize`, `offset`, ...) changes the data under the same attribute without
 * bumping its version.
 */
interface Source {
  position: Position;
  data: THREE.InterleavedBuffer | null;
  positionArray: THREE.TypedArray;
  positionVersion: number;
  itemSize: number;
  offset: number;
  stride: number;
  count: number;
  normalized: boolean;
  index: THREE.BufferAttribute | null;
  indexArray: THREE.TypedArray | null;
  indexVersion: number;
  indexCount: number;
  indexNormalized: boolean;
}
interface CachedTree extends Source { bvh: TriangleBvh }
/**
 * One tree per geometry, shared by every mesh that uses it; dropped with the geometry. Built only at
 * load, with the buffers it was built from (see Source): a geometry edited in place since then (or swapped
 * in later) has no current tree, so it does not occlude labels (rather than occluding where it used to
 * be) and is ray-tested triangle by triangle again. A tree is in the geometry's own (local) space, so
 * moving, rotating or scaling a mesh never invalidates it.
 */
const bvhCache = new WeakMap<THREE.BufferGeometry, CachedTree>();

const dataOf = (a: Position) => ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data : null);

function sourceOf(position: Position, index: THREE.BufferAttribute | null): Source {
  const data = dataOf(position);
  const interleaved = position as THREE.InterleavedBufferAttribute;
  return {
    position, data,
    positionArray: data ? data.array : (position as THREE.BufferAttribute).array,
    positionVersion: data ? data.version : (position as THREE.BufferAttribute).version,
    itemSize: position.itemSize, offset: data ? interleaved.offset : 0, stride: data ? data.stride : position.itemSize,
    count: position.count, normalized: position.normalized,
    index, indexArray: index?.array ?? null, indexVersion: index?.version ?? -1, indexCount: index?.count ?? -1, indexNormalized: index?.normalized ?? false,
  };
}

/** Checked on every ray test, so it allocates nothing. */
function unchanged(e: Source, position: Position, index: THREE.BufferAttribute | null): boolean {
  if (position !== e.position || index !== e.index) return false;
  const data = dataOf(position);
  if (data !== e.data) return false;
  if (data) {
    if (data.array !== e.positionArray || data.version !== e.positionVersion || data.stride !== e.stride || (position as THREE.InterleavedBufferAttribute).offset !== e.offset) return false;
  } else {
    const plain = position as THREE.BufferAttribute;
    if (plain.array !== e.positionArray || plain.version !== e.positionVersion) return false;
  }
  if (position.itemSize !== e.itemSize || position.count !== e.count || position.normalized !== e.normalized) return false;
  return index === null || (index.array === e.indexArray && index.version === e.indexVersion && index.count === e.indexCount && index.normalized === e.indexNormalized);
}

export function currentBvh(g: THREE.BufferGeometry): TriangleBvh | null {
  const entry = bvhCache.get(g);
  // A geometry that lost its positions has no triangles to test.
  const position = g.attributes.position;
  return entry && position && unchanged(entry, position, g.index) ? entry.bvh : null;
}

export function cacheBvh(g: THREE.BufferGeometry): void {
  if (currentBvh(g)) return;
  const position = g.getAttribute("position");
  bvhCache.set(g, { ...sourceOf(position, g.getIndex()), bvh: TriangleBvh.build(position, g.getIndex()) });
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

/** Below this, three's loop over every triangle is cheaper than asking a tree. */
const SMALL_MESH_TRIANGLES = 32;

/**
 * `object.raycast(raycaster, intersects)`, with a static mesh's tree choosing which triangles three tests.
 * Up to the per-triangle loop this is three's Mesh.raycast verbatim (bounding sphere, local ray, bounding
 * box); then three's own loop runs once per candidate triangle, narrowed to it by the draw range (and the
 * group), in three's order. So hits, their distances, points, faces and order are exactly three's: the tree
 * only skips triangles the ray cannot touch.
 */
export function raycastObject(object: THREE.Object3D, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const mesh = object as THREE.Mesh;
  // Anything with its own raycast (instanced, batched, skinned, sprites, lines) runs it unchanged.
  if (mesh.isMesh !== true || mesh.raycast !== THREE.Mesh.prototype.raycast) {
    object.raycast(raycaster, intersects);
    return;
  }
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
  const tree = treeable(mesh) ? currentBvh(geometry) : null;
  if (!tree || tree.triangleCount <= SMALL_MESH_TRIANGLES) {
    computeIntersections.call(mesh, raycaster, intersects, localRay);
    return;
  }

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
