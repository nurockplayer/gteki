import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { accelerateRaycasts } from "./fare-replay-rays.ts";
import { conservativeWalls, lazySurfaceGrid } from "./fare-replay-audit.ts";
import { surfaceGrid, type Patch } from "./fare-boundary-audit.ts";
import { resolveWalls, type Segment2 } from "../../../apps/web/src/explorer/walker.ts";
import { hitNormal } from "../../../apps/web/src/explorer/bodyCollision.ts";

describe("replay broad phases preserve the native operations", () => {
  it("enumerates the identical lattice heights without rasterising distant street cells", () => {
    const patches: Patch[] = [0, .00001, 2].map(z => ({
      rings: [[{ x: -2.1, y: -1 }, { x: 3.2, y: -1 }, { x: 2.7, y: 3.1 }, { x: -1, y: 2 }]],
      height: p => z + p.x * .1,
    }));
    const eager = surfaceGrid(patches), lazy = lazySurfaceGrid(patches);
    for (let x = -15; x < 15; x++) for (let y = -15; y < 15; y++) {
      const key = `${x},${y}`;
      expect(lazy.get(key)).toEqual(eager.get(key) ?? []);
    }
  });
  it("keeps Three hit points, clipping, material sides and wall-slide normals under static transforms", () => {
    for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) {
      const geometry = new THREE.BoxGeometry(2, 3, 4); geometry.clearGroups();
      const material = new THREE.MeshBasicMaterial({ side });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(1.3, -2.7, .8); mesh.rotation.set(.2, -.4, .3); mesh.scale.set(1.2, .7, 1.8);
      mesh.updateMatrixWorld(true);
      const rays = Array.from({ length: 160 }, (_, i) => {
        const origin = new THREE.Vector3(Math.sin(i * 1.7) * 7, Math.cos(i * .73) * 6 - 2, Math.cos(i * 1.1) * 8);
        const target = i % 3 ? mesh.position : mesh.position.clone().add(new THREE.Vector3(4, -2, 1));
        return new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), i % 5 * .4, i % 7 ? 20 : 2);
      });
      const hits = (ray: THREE.Raycaster) => ray.intersectObject(mesh).map(h => {
        const n = hitNormal(h, ray.ray.direction); // what slideAlong consumes: must not fall back to -dir
        return [h.distance, h.point.x, h.point.y, h.point.z, n.x, n.y, n.z].map(v => Math.round(v * 1e9) / 1e9);
      });
      const expected = rays.map(hits), restore = accelerateRaycasts([mesh]);
      try { expect(rays.map(hits)).toEqual(expected); }
      finally { restore(); geometry.dispose(); material.dispose(); }
    }
  });
  it("retains every wall needed by ordered cascading circle push-outs", () => {
    let state = 0x47ea12;
    const random = () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 2 ** 32);
    for (let fixture = 0; fixture < 30; fixture++) {
      const walls: Segment2[] = Array.from({ length: 40 }, () => {
        const ax = random() * 3 - 1.5, az = random() * 3 - 1.5, angle = random() * Math.PI * 2, length = random() * 1.5;
        return { ax, az, bx: ax + Math.cos(angle) * length, bz: az + Math.sin(angle) * length, yMin: -1, yMax: 3 };
      });
      for (let x = -1; x <= 1; x += .25) for (let z = -1; z <= 1; z += .25) {
        const selected = conservativeWalls(x - 1e-9, x + .25 + 1e-9, z - 1e-9, z + .25 + 1e-9, .3, walls);
        for (const dx of [0, .125, .25]) for (const dz of [0, .125, .25])
          expect(resolveWalls(x + dx, z + dz, .3, 0, 1.7, selected)).toEqual(resolveWalls(x + dx, z + dz, .3, 0, 1.7, walls));
      }
    }
  });
});
