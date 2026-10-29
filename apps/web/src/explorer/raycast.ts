import * as THREE from "three";
import { raycastObject } from "./meshBvh.ts";
import { portalDepthAxis, portalWidthAxis, type Box } from "./greybox.ts";

const clippedPortals = new WeakMap<THREE.Object3D, readonly Box[]>();
export function setClippedPortals(mesh: THREE.Object3D, boxes: readonly Box[]): void { clippedPortals.set(mesh, boxes); }
export function clearClippedPortals(mesh: THREE.Object3D): void { clippedPortals.delete(mesh); }
export function hasClippedPortals(mesh: THREE.Object3D): boolean { return clippedPortals.has(mesh); }
export function portalWallNormal(normal: THREE.Vector3, box: Box): boolean { return Math.abs(normal.dot(box.wallNormal ?? box.along)) >= Math.sqrt(3) / 2; }
export function portalPassable(hit: THREE.Intersection): boolean {
  if (!hit.face) return false;
  const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
  return clippedPortals.get(hit.object)?.some(box => portalWallNormal(normal, box) && hit.point.y >= box.center.y + 0.05 && hit.point.y <= box.center.y + box.height && Math.abs(hit.point.clone().sub(box.center).dot(portalWidthAxis(box))) <= box.width / 2 && Math.abs(hit.point.clone().sub(box.center).dot(portalDepthAxis(box))) <= box.depth / 2) ?? false;
}

/**
 * The meshes a list of scene objects stands for when ray-tested. A scene's `walkable` / `colliders` are
 * `Object3D[]`, so floors and walls may arrive nested inside a `THREE.Group`. A listed Mesh stands for
 * itself only (a GLB's classified lists name every physical mesh, so a "visual" child under a floor stays
 * visual); a listed non-mesh stands for every Mesh below it. Nothing else counts (sprites, lines, helpers
 * and labels never do; a three.js helper and everything below it is pruned, even though some helpers are
 * meshes, and so is a listed object inside one), and a subtree the scene filed in the other list keeps that classification.
 */
export function castTargets(objects: readonly THREE.Object3D[], filedElsewhere: readonly THREE.Object3D[] = []): THREE.Object3D[] {
  const own = new Set(objects);
  const other = new Set(filedElsewhere.filter((o) => !own.has(o)));
  const out = new Set<THREE.Object3D>();
  const visit = (o: THREE.Object3D) => {
    if (other.has(o) || isHelper(o)) return;
    if ((o as THREE.Mesh).isMesh) out.add(o);
    for (const child of o.children) visit(child);
  };
  for (const o of objects) {
    // A listed mesh may be part of a helper (an ArrowHelper's cone that a GLB role pass picked up).
    if (insideHelper(o)) continue;
    if ((o as THREE.Mesh).isMesh) {
      out.add(o);
      for (const child of o.children) if (child.userData.portalInstanceCopy) out.add(child);
    } else visit(o);
  }
  return [...out];
}

/**
 * three.js helpers, core and addons: their `type` names a Helper (PointLightHelper is a Mesh, ArrowHelper
 * holds one, LightProbeGridHelperWebGL is an InstancedMesh), or they flag themselves (`isViewHelper`).
 */
function isHelper(o: THREE.Object3D): boolean {
  if (o.type.includes("Helper")) return true;
  const flags = o as unknown as Record<string, unknown>;
  return Object.keys(o).some((k) => /^is\w*Helper$/.test(k) && flags[k] === true);
}

function insideHelper(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (isHelper(x)) return true;
  return false;
}

/** Hits against precomputed `castTargets` (each target tested on its own, never its descendants). */
/** The explorer's ray-test sets, built once per loaded scene. */
export interface ExplorerTargets {
  /** Ground under the walker (walkable surfaces). */
  ground: THREE.Object3D[];
  /** Walls the walker bumps into. */
  collider: THREE.Object3D[];
  /** Walls and floors: the street probe's sky test. Camera-only blockers never hide the sky. */
  sky: THREE.Object3D[];
  /** What the follow camera stops at: walls, floors and camera-only blockers (which add, never replace). */
  camera: THREE.Object3D[];
  /** The camera-only blocker meshes, so a hit on one may pull the camera closer than its usual minimum. */
  blockers: ReadonlySet<THREE.Object3D>;
}

export function explorerTargets(walkable: readonly THREE.Object3D[], colliders: readonly THREE.Object3D[], cameraBlockers: readonly THREE.Object3D[] = []): ExplorerTargets {
  // A blocker nested in a floor or wall group stays camera-only; one listed explicitly in both lists keeps both.
  const ground = castTargets(walkable, [...colliders, ...cameraBlockers]);
  const collider = castTargets(colliders, [...walkable, ...cameraBlockers]);
  const sky = [...new Set([...collider, ...ground])];
  const blockers = castTargets(cameraBlockers, [...walkable, ...colliders]);
  // A mesh listed both as a wall and as a camera blocker is tested once.
  const camera = [...new Set([...sky, ...blockers])];
  return { ground, collider, sky, camera, blockers: new Set(blockers) };
}

/**
 * `ray.intersectObjects(targets, false)`, with each static mesh's tree (prepareRayTrees, built at load) picking
 * the triangles three tests: the same hits in the same order, without testing every triangle of a merged mesh.
 */
export function castAll(ray: THREE.Raycaster, targets: readonly THREE.Object3D[]): THREE.Intersection[] {
  const hits: THREE.Intersection[] = [];
  for (const object of targets) if (object.layers.test(ray.layers)) raycastObject(object, ray, hits);
  return hits.filter(hit => !portalPassable(hit)).sort((a, b) => a.distance - b.distance);
}

const TWO_SIDED = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

/**
 * Ray-test `targets` like castAll, but meshes in `twoSided` (camera blockers) are hit from both sides
 * whatever their material says, so a ceiling stops the camera from below however its normals face, whether
 * it came from a GLB role or a scene module (Godot enables back-face collision to match). Their materials
 * are swapped only for the duration of the test and never changed.
 */
export function castCamera(ray: THREE.Raycaster, targets: readonly THREE.Object3D[], twoSided: ReadonlySet<THREE.Object3D>): THREE.Intersection[] {
  if (twoSided.size === 0) return castAll(ray, targets);
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  for (const object of targets) {
    if (!twoSided.has(object)) continue;
    const mesh = object as THREE.Mesh;
    saved.set(mesh, mesh.material);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => TWO_SIDED) : TWO_SIDED;
  }
  try {
    return castAll(ray, targets);
  } finally {
    for (const [mesh, material] of saved) mesh.material = material;
  }
}

/**
 * Keep a smoothed camera position on the pivot's side of every camera-only blocker: if the segment from
 * the pivot to `position` crosses one, `position` is pulled in to `clearance` in front of it (to the pivot
 * at most). Interpolation toward a clamped target can otherwise sweep the camera through a ceiling while
 * the walker turns. Mutates and returns `position`.
 */
export function keepBelowBlockers(pivot: THREE.Vector3, position: THREE.Vector3, blockers: readonly THREE.Object3D[], clearance: number, ray = new THREE.Raycaster()): THREE.Vector3 {
  if (blockers.length === 0) return position;
  const offset = position.clone().sub(pivot);
  const length = offset.length();
  if (length < 1e-9) return position;
  ray.set(pivot, offset.divideScalar(length));
  ray.near = 0;
  ray.far = length + clearance;
  const hit = castCamera(ray, blockers, new Set(blockers))[0];
  if (hit) position.copy(pivot).addScaledVector(offset, Math.min(length, Math.max(0, hit.distance - clearance)));
  return position;
}

/**
 * The see-through (sign) meshes the camera cut may fade: never one that is walkable, a collider, a camera
 * blocker or any camera target. A mesh that is both a sign and a camera blocker stops the camera and stays solid.
 */
export function cuttableSigns(signs: readonly THREE.Object3D[], solids: readonly (readonly THREE.Object3D[])[]): THREE.Object3D[] {
  const solid = new Set(solids.flat());
  return signs.filter((o) => !solid.has(o));
}
