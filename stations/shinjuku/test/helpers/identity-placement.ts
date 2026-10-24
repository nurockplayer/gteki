import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import type { Layout, WalkWorld } from "../../scene/layout.ts";
import { identitySightline, platformIdentityCandidate, type PlatformIdentitySlot } from "../../scene/identity-placement.ts";

type Size = { width: number; height: number; depth: number };
type Box = { min: [number, number, number]; max: [number, number, number] };

/** Casing margin: 2 cm in width, 2.5 cm in depth. Hangers: 8 mm radial margin;
 * their last 2 mm meet the ceiling rather than being tested as an intersection. */
export function identityHardwareBoxes(size: Size, rodLength: number): THREE.Box3[] {
  const { width, height } = size;
  return [new THREE.Box3(new THREE.Vector3(-width / 2 - 0.04, -height / 2 - 0.02, -0.06),
    new THREE.Vector3(width / 2 + 0.04, height / 2 + 0.02, 0.06)),
  ...[-width * 0.35, width * 0.35].map(x => new THREE.Box3(
    new THREE.Vector3(x - 0.02, height / 2, -0.02),
    new THREE.Vector3(x + 0.02, height / 2 + rodLength - 0.002, 0.02)))];
}

/** Static and instanced geometry, in root-local coordinates. Glass also blocks hardware;
 * only opaque meshes block reading rays. No geometry or scene ownership is changed. */
export function identityObstacles(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name.startsWith("identity")) return;
    const materials = [mesh.material].flat();
    if (materials.some(m => m.visible && m.opacity > 0)) meshes.push(mesh);
  });
  return {
    sightline(eye: THREE.Vector3, target: THREE.Vector3) {
      return identitySightline(root, eye, target);
    },
    hardwareBlocker(board: THREE.Object3D, boxes: THREE.Box3[]) {
      const inverse = board.matrix.clone().invert().multiply(rootInverse);
      const triangle = new THREE.Triangle(), instance = new THREE.Matrix4();
      for (const mesh of meshes) {
        const g = mesh.geometry, position = g.getAttribute("position"), index = g.index;
        if (!position) continue;
        if (!g.boundingBox) g.computeBoundingBox();
        for (let n = 0; n < (mesh instanceof THREE.InstancedMesh ? mesh.count : 1); n++) {
          const matrix = inverse.clone().multiply(mesh.matrixWorld);
          if (mesh instanceof THREE.InstancedMesh) { mesh.getMatrixAt(n, instance); matrix.multiply(instance); }
          const bounds = g.boundingBox!.clone().applyMatrix4(matrix);
          const nearby = boxes.filter(box => box.intersectsBox(bounds));
          if (!nearby.length) continue;
          for (let i = 0; i < (index?.count ?? position.count); i += 3) {
            for (const [j, v] of [triangle.a, triangle.b, triangle.c].entries())
              v.fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(matrix);
            if (nearby.some(box => box.intersectsTriangle(triangle))) return mesh.name || mesh.type;
          }
        }
      }
      return null;
    },
  };
}

/** Offline CPU qualification only: never imported by the scene builder. */
export function searchPlatformIdentityPlacement(bundle: StationBundle, layout: Layout, world: WalkWorld, root: THREE.Group, size: Size, nameBox: Box) {
  const obstacles = identityObstacles(root);
  const attempts = [];
  for (const direction of ["toward midpoint", "away from midpoint"] as const) {
    for (let step = 16; step <= 36; step++) {
      const slot: PlatformIdentitySlot = { direction, offsetM: step / 2 };
      const candidate = platformIdentityCandidate(bundle, layout, world, root, size, nameBox, slot);
      if (!candidate) throw new Error("Missing platform identity POI, connector, floor or valid slab");
      const geometryBlocker = obstacles.hardwareBlocker(candidate.board, identityHardwareBoxes(size, candidate.ceilingZ - candidate.top));
      const pass = candidate.checks.pass && geometryBlocker === null;
      attempts.push({ ...candidate.checks, geometryBlocker, pass });
      if (pass) return { ...candidate, attempts };
    }
  }
  throw new Error(`No qualifying platform identity placement: ${JSON.stringify(attempts)}`);
}
