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

/** Same physical board: overlapping world bounds, or sibling faces named <id> and <id>:back. */
export function identityBoardObjects(board: IdentityBoard, boards: readonly IdentityBoard[]): THREE.Object3D[] {
  const bounds = new THREE.Box3().setFromObject(board.object);
  const faceId = (o: THREE.Object3D) => o.name.replace(/:back$/, "");
  return boards.filter((b) => b === board || bounds.intersectsBox(new THREE.Box3().setFromObject(b.object)) ||
    (board.object.parent !== null && b.object.parent === board.object.parent && b.object.name !== board.object.name && !!faceId(board.object) && faceId(b.object) === faceId(board.object)))
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

/**
 * One pass per chip over regions sorted by y0 (the caller sorts once per label re-check).
 * Merge forbidden vertical intervals for this chip's horizontal span; choose the nearest clear
 * position above, otherwise below. Disjoint boards must not push an endpoint past the viewport.
 * Offsets are absolute from the original anchor, so repeated passes never accumulate them.
 */
export function protectIdentityChip(chip: ScreenRect, selected: boolean, regionsByTop: readonly ScreenRect[]): { hidden: boolean; offsetY: number } {
  if (!regionsByTop.some((r) => intersectsRect(chip, r))) return { hidden: false, offsetY: 0 };
  if (!selected) return { hidden: true, offsetY: 0 };
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
  return { hidden: false, offsetY: (start >= 0 ? start : end) - chip.y0 };
}
