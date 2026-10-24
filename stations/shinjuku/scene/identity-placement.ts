import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import { pointInRings, soffitHeight, type Layout, type LevelLayout, type WalkWorld, type XYZ } from "./layout.ts";

type Size = { width: number; height: number; depth: number };
type Box = { min: [number, number, number]; max: [number, number, number] };

/** The existing bounded wall/roof check, shared by access, gate and platform boards. */
export function identityClearance(board: THREE.Object3D, floor: number, level: LevelLayout, layout: Layout, world: WalkWorld, size: Size) {
  const { width, height } = size;
  board.updateMatrixWorld(true);
  let wallsClear = true, roofClear = true, minimumRoofClearance = Infinity;
  const footprint = [[-width / 2 - 0.04, -0.06], [width / 2 + 0.04, -0.06], [width / 2 + 0.04, 0.06], [-width / 2 - 0.04, 0.06]];
  for (const y of [-height / 2 - 0.02, 0, height / 2 + 0.02]) {
    const corners = footprint.map(([x, z]) => board.localToWorld(new THREE.Vector3(x, y, z)));
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
      if (world.firstWallHit({ x: a.x, y: -a.z }, { x: b.x, y: -b.z }, a.y) < 1) wallsClear = false;
    }
  }
  for (let i = 0; i <= 10; i++) for (const z of [-0.06, 0, 0.06]) {
    const p = board.localToWorld(new THREE.Vector3((-0.5 + i / 10) * (width + 0.08), height / 2 + 0.02, z));
    const enu = { x: p.x, y: -p.z };
    for (const roof of [...level.ceilings, ...layout.soffits]) {
      if (!pointInRings(enu, roof.rings)) continue;
      const h = soffitHeight(roof, enu);
      if (h <= floor + 1.8) continue;
      minimumRoofClearance = Math.min(minimumRoofClearance, h - p.y);
      if (h - p.y < 0.08) roofClear = false;
    }
  }
  return { wallsClear, roofClear, minimumRoofClearance };
}

/** A data-relative placement qualified by the full ordered search in CPU tests. */
export const PLATFORM_IDENTITY_SLOT = { direction: "away from midpoint", offsetM: 8 } as const;
export type PlatformIdentitySlot = { direction: "toward midpoint" | "away from midpoint"; offsetM: number };

/** Only the reading ray is needed at runtime; hardware triangle scans live in test/helpers. */
export function identitySightline(root: THREE.Group, eye: THREE.Vector3, target: THREE.Vector3) {
  root.updateMatrixWorld(true);
  const opaque: THREE.Mesh[] = [];
  root.traverseVisible(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !mesh.name.startsWith("identity") && [mesh.material].flat().some(m => m.visible && !m.transparent)) opaque.push(mesh);
  });
  const origin = root.localToWorld(eye.clone()), delta = root.localToWorld(target.clone()).sub(origin);
  return new THREE.Raycaster(origin, delta.clone().normalize(), 0, delta.length() - 0.001)
    .intersectObjects(opaque, false)[0]?.object.name ?? null;
}

/** Derive and cheaply validate one data-relative slot; no ordered search or hardware scan. */
export function platformIdentityCandidate(bundle: StationBundle, layout: Layout, world: WalkWorld, root: THREE.Group, size: Size, nameBox: Box, slot: PlatformIdentitySlot) {
  const poi = bundle.pois.find(p => p.id === "poi:platform:oedo");
  const node = bundle.nodes.find(n => n.id === poi?.connectorNodeIds[0]);
  const level = layout.levels.find(l => l.floorId === poi?.floorId);
  if (!poi || !node || !level) return null;
  const slab = level.slabs.find(s => s.category === "B029" && pointInRings(node.position, s.rings));
  if (!slab) return null;
  const ring = slab.rings[0];
  if (!ring || ring.length < 2) return null;
  let a = ring[0]!, b = ring[1]!, length = 0;
  for (const p of ring) for (const q of ring) {
    const distance = Math.hypot(q.x - p.x, q.y - p.y);
    if (distance > length) { a = p; b = q; length = distance; }
  }
  if (!Number.isFinite(length) || length <= 0) return null;
  const axis = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const across = { x: -axis.y, y: axis.x };
  const alongValues = ring.map(p => p.x * axis.x + p.y * axis.y);
  const acrossValues = ring.map(p => p.x * across.x + p.y * across.y);
  const middleAlong = (Math.min(...alongValues) + Math.max(...alongValues)) / 2;
  const middleAcross = (Math.min(...acrossValues) + Math.max(...acrossValues)) / 2;
  const nodeAlong = node.position.x * axis.x + node.position.y * axis.y;
  const toward = Math.sign(middleAlong - nodeAlong) || 1;
  const eye = new THREE.Vector3(node.position.x, level.z + 1.6, -node.position.y);
  const nameCenter = new THREE.Vector3(...nameBox.min).add(new THREE.Vector3(...nameBox.max)).multiplyScalar(0.5);
  const top = Math.min(level.z + 3.2, level.ceilingZ - 0.14); // includes the 2 cm casing above the plate
  const sign = slot.direction === "toward midpoint" ? toward : -toward;
  const along = nodeAlong + sign * slot.offsetM;
  const center: XYZ = { x: along * axis.x + middleAcross * across.x, y: along * axis.y + middleAcross * across.y, z: level.z };
  const facing = { x: -sign * axis.x, y: -sign * axis.y };
  const board = new THREE.Object3D();
  board.position.set(center.x, top - size.height / 2, -center.y);
  board.lookAt(board.position.x + facing.x, board.position.y, board.position.z - facing.y);
  board.updateMatrixWorld(true);
  const target = board.localToWorld(nameCenter.clone()), delta = target.clone().sub(eye);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(board.matrixWorld);
  const facingDot = normal.dot(delta.clone().negate().normalize());
  const blockedBy = identitySightline(root, eye, target);
  const clearance = identityClearance(board, level.z, level, layout, world, size);
  // Exact containment of the conservative casing rectangle, including slab holes.
  const footprint = [[-size.width / 2 - 0.04, -0.06], [size.width / 2 + 0.04, -0.06],
    [size.width / 2 + 0.04, 0.06], [-size.width / 2 - 0.04, 0.06]].map(([x, z]) => {
    const p = board.localToWorld(new THREE.Vector3(x, 0, z));
    return [p.x, -p.z] as [number, number];
  });
  const footprintInside = polygonClipping.difference([footprint], slab.rings.map(r => r.map(p => [p.x, p.y] as [number, number]))).length === 0;
  const headroom = board.position.y - size.height / 2 - 0.02 - level.z;
  const pass = blockedBy === null && facingDot >= 0.5 && clearance.wallsClear && clearance.roofClear && footprintInside
    && headroom >= 2.3 && top + 0.02 <= level.ceilingZ - 0.12 && delta.length() >= 4 && delta.length() <= 20;
  const checks = { ...slot, centerEnu: { ...center, z: board.position.y }, distance: delta.length(), facingDot,
    heading: (Math.atan2(delta.x, -delta.z) * 180 / Math.PI + 360) % 360,
    blockedBy, ...clearance, footprintInside, headroom, pass };
  return { nodeId: node.id, center, facing, top, board, ceilingZ: level.ceilingZ, checks };
}

let platformWarningReported = false;
export function warnPlatformIdentitySkipped() {
  if (platformWarningReported) return;
  platformWarningReported = true;
  console.warn("Skipping GTEki platform identity board: missing placement data or failed clearance checks");
}

/** Display-only hardware must never prevent the station from loading. */
export function platformIdentityPlacement(bundle: StationBundle, layout: Layout, world: WalkWorld, root: THREE.Group, size: Size, nameBox: Box) {
  const candidate = platformIdentityCandidate(bundle, layout, world, root, size, nameBox, PLATFORM_IDENTITY_SLOT);
  if (candidate?.checks.pass) return candidate;
  warnPlatformIdentitySkipped();
  return null;
}
