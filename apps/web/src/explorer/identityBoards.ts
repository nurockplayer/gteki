import * as THREE from "three";
import type { IdentityBoardTag } from "@gteki/scene-api";

export interface IdentityBoard {
  object: THREE.Object3D;
  front: THREE.Vector3;
  regions: { kind: "name" | "arrow"; box: THREE.Box3 }[];
}
export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }

const tuple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** Malformed tags are ignored as a unit, never inferred from names or sign roles. */
export function parseIdentityBoard(object: THREE.Object3D): IdentityBoard | null {
  const raw: unknown = object.userData.gteki_identity;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const tag = raw as IdentityBoardTag;
  if (tag.front !== undefined && !tuple(tag.front)) return null;
  const normal = tag.front ?? [0, 0, 1];
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  const front = new THREE.Vector3(...normal).divideScalar(length);
  let regions: IdentityBoard["regions"] = [];
  if (tag.regions !== undefined) {
    if (!Array.isArray(tag.regions) || !tag.regions.length) return null;
    for (const r of tag.regions) {
      if (!r || (r.kind !== "name" && r.kind !== "arrow") || !tuple(r.min) || !tuple(r.max) || r.min.some((x, i) => x > r.max[i]!)) return null;
      regions.push({ kind: r.kind, box: new THREE.Box3(new THREE.Vector3(...r.min), new THREE.Vector3(...r.max)) });
    }
    if (!regions.some((r) => r.kind === "name")) return null;
  } else {
    // Compute bounds in the tagged object's frame, including transformed descendants (not a world AABB).
    object.updateWorldMatrix(true, true);
    const inverse = object.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)));
    });
    if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) return null;
    regions = [{ kind: "name", box }];
  }
  return { object, front, regions };
}

export function collectIdentityBoards(root: THREE.Object3D): IdentityBoard[] {
  const boards: IdentityBoard[] = [];
  root.traverse((o) => { const b = parseIdentityBoard(o); if (b) boards.push(b); });
  return boards;
}

export function withinObject(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = object; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Same physical board: sibling faces with overlapping world bounds or names <id> and <id>:back. */
export function identityBoardObjects(board: IdentityBoard, boards: readonly IdentityBoard[]): THREE.Object3D[] {
  const bounds = new THREE.Box3().setFromObject(board.object);
  const faceId = (o: THREE.Object3D) => o.name.replace(/:back$/, "");
  return boards.filter((b) => b === board ||
    (board.object.parent !== null && b.object.parent === board.object.parent &&
      (bounds.intersectsBox(new THREE.Box3().setFromObject(b.object)) ||
        (b.object.name !== board.object.name && !!faceId(board.object) && faceId(b.object) === faceId(board.object)))))
    .map((b) => b.object);
}

/** World-space corners of every name region; arrows do not affect framing size. */
export function identityNameCorners(board: IdentityBoard): THREE.Vector3[] {
  return board.regions.filter((r) => r.kind === "name").flatMap(({ box }) => {
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(board.object.matrixWorld));
    return corners;
  });
}

export function identityNameCentre(board: IdentityBoard): THREE.Vector3 {
  const bounds = new THREE.Box3();
  for (const r of board.regions) if (r.kind === "name") bounds.union(r.box);
  return bounds.getCenter(new THREE.Vector3()).applyMatrix4(board.object.matrixWorld);
}

/**
 * Five world-space points on the name's visible face — its centre and four corners inset 10 % — never a
 * point inside the box: a tag may be a metadata-only proxy while the plate itself is drawn by a merged
 * sign batch outside the tagged subtree, so a sample inside the plate would hit its own face.
 */
export function identityNameSamples(board: IdentityBoard, from: THREE.Vector3, inset = 0.1): THREE.Vector3[] {
  const bounds = new THREE.Box3();
  for (const r of board.regions) if (r.kind === "name") bounds.union(r.box);
  const centre = bounds.getCenter(new THREE.Vector3());
  const local = from.clone().applyMatrix4(board.object.matrixWorld.clone().invert());
  const d = local.clone().sub(centre);
  // The face the camera looks at most directly; a flat name box always picks its own plane.
  let axis: "x" | "y" | "z" = "z";
  let side = 1;
  let best = -Infinity;
  for (const a of ["x", "y", "z"] as const) {
    const score = Math.abs(d[a]) / Math.max((bounds.max[a] - bounds.min[a]) / 2, 1e-9);
    if (score > best) { best = score; axis = a; side = d[a] >= 0 ? 1 : -1; }
  }
  const face = centre.clone();
  face[axis] = side > 0 ? bounds.max[axis] : bounds.min[axis];
  const [u, v] = (["x", "y", "z"] as const).filter((a) => a !== axis);
  const halfU = ((bounds.max[u!] - bounds.min[u!]) / 2) * (1 - inset);
  const halfV = ((bounds.max[v!] - bounds.min[v!]) / 2) * (1 - inset);
  const points = [face];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const p = face.clone();
    p[u!] = centre[u!] + su * halfU;
    p[v!] = centre[v!] + sv * halfV;
    points.push(p);
  }
  return points.map((p) => p.applyMatrix4(board.object.matrixWorld));
}

/** True when any name-region corner is at or behind the camera's near plane. */
export function identityNameBehind(board: IdentityBoard, camera: THREE.PerspectiveCamera): boolean {
  const matrix = camera.matrixWorldInverse.clone().multiply(board.object.matrixWorld);
  for (const r of board.regions) {
    if (r.kind !== "name") continue;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? r.box.max.x : r.box.min.x, i & 2 ? r.box.max.y : r.box.min.y, i & 4 ? r.box.max.z : r.box.min.z).applyMatrix4(matrix);
      if (p.z >= -camera.near) return true;
    }
  }
  return false;
}

export function identityFront(board: IdentityBoard): THREE.Vector3 {
  return board.front.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(board.object.matrixWorld)).normalize();
}

/** Project a local box, clipping its edges at near/far before division (including near-plane crossings). */
export function identityRegionRect(box: THREE.Box3, object: THREE.Object3D, camera: THREE.PerspectiveCamera, w: number, h: number): ScreenRect | null {
  const matrix = camera.matrixWorldInverse.clone().multiply(object.matrixWorld);
  const corners: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(matrix));
  const points = corners.filter((p) => p.z <= -camera.near && p.z >= -camera.far);
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
    if (i & bit) continue;
    const a = corners[i]!, b = corners[i | bit]!;
    for (const z of [-camera.near, -camera.far]) if ((a.z < z) !== (b.z < z)) points.push(a.clone().lerp(b, (z - a.z) / (b.z - a.z)));
  }
  if (!points.length) return null;
  const rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of points) {
    const ndc = p.clone().applyMatrix4(camera.projectionMatrix);
    const x = (ndc.x + 1) * w / 2, y = (1 - ndc.y) * h / 2;
    rect.x0 = Math.min(rect.x0, x); rect.x1 = Math.max(rect.x1, x);
    rect.y0 = Math.min(rect.y0, y); rect.y1 = Math.max(rect.y1, y);
  }
  return rect.x1 >= 0 && rect.x0 <= w && rect.y1 >= 0 && rect.y0 <= h ? rect : null;
}

export const intersectsRect = (a: ScreenRect, b: ScreenRect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** How far (CSS px) an unselected chip may be nudged off a name before it is hidden instead (#400). */
export const IDENTITY_NUDGE_MAX_PX = 24;

/**
 * One pass per chip over regions sorted by y0 (the caller sorts once per label re-check).
 * Merge forbidden vertical intervals for this chip's horizontal span, then choose a clear side.
 * An unselected chip is nudged to the nearest clear side when that is within IDENTITY_NUDGE_MAX_PX and
 * stays on screen; past that it is hidden for the frame. A selected chip is always moved, never hidden.
 * Disjoint boards must not push an endpoint past the viewport. Offsets are absolute from the
 * original anchor, so repeated passes never accumulate them. The final offset is clamped so a
 * selected chip stays inside the viewport even when the boards leave no room.
 */
export function protectIdentityChip(chip: ScreenRect, selected: boolean, regionsByTop: readonly ScreenRect[], viewportHeight: number): { hidden: boolean; offsetY: number } {
  if (!regionsByTop.some((r) => intersectsRect(chip, r))) return { hidden: false, offsetY: 0 };
  const height = chip.y1 - chip.y0;
  let start = Infinity, end = -Infinity;
  for (const r of regionsByTop) {
    if (chip.x0 >= r.x1 || chip.x1 <= r.x0) continue;
    const lo = r.y0 - height - 2, hi = r.y1 + 2;
    if (lo > end) {
      if (chip.y0 >= start && chip.y0 <= end) break;
      start = lo; end = hi;
    } else end = Math.max(end, hi);
  }
  if (!selected) {
    const above = start - chip.y0, below = end - chip.y0;
    const nearest = Math.abs(above) <= Math.abs(below) ? above : below;
    const onScreen = chip.y0 + nearest >= 0 && chip.y1 + nearest <= viewportHeight;
    return Math.abs(nearest) <= IDENTITY_NUDGE_MAX_PX && onScreen ? { hidden: false, offsetY: nearest } : { hidden: true, offsetY: 0 };
  }
  const offsetY = (start >= 0 ? start : end) - chip.y0;
  // Boards that leave no clear span must not push a selected chip past a viewport edge.
  return { hidden: false, offsetY: Math.max(-chip.y0, Math.min(offsetY, viewportHeight - chip.y1)) };
}
