import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createAvatar } from "../avatar.ts";
import { BONE, NECK, SURFACE } from "./mesh.ts";

describe("hair clearance around the neck", () => {
  it.each([0, 30])("has an inward-facing hair surface behind the neck, rather than an exposed rim, at distance %i", distance => {
    let longCuts = 0;
    for (let outfit = 0; outfit < 8; outfit++) {
      const avatar = createAvatar(THREE, outfit);
      try {
        avatar.setDistance(distance);
        const mesh = avatar.object.children[0] as THREE.SkinnedMesh;
        const uv = mesh.geometry.getAttribute("uv"), positions = mesh.geometry.getAttribute("position");
        let bottom = Infinity;
        for (let i = 0; i < uv.count; i++) if (Math.floor(uv.getX(i) * 8) === SURFACE.hair) bottom = Math.min(bottom, positions.getY(i));
        // Select by actual length, not outfit/style identifiers. Every cut
        // reaching the neck needs a visible inside to its rear hair volume.
        if (bottom >= NECK.y + NECK.ry) continue;
        longCuts++;
        avatar.object.updateMatrixWorld(true); mesh.skeleton.update();
        const low = Math.max(bottom, NECK.collarY), y = low + (NECK.y + NECK.ry - low) * 0.6;
        for (const side of [-1, 1]) {
          const origin = new THREE.Vector3(side * NECK.rx * 1.4, y, -0.2).applyMatrix4(mesh.matrixWorld);
          const direction = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
          const hits = new THREE.Raycaster(origin, direction).intersectObject(mesh);
          const hairHit = hits.find(hit => hit.face && Math.floor(uv.getX(hit.face.a) * 8) === SURFACE.hair);
          expect(hairHit, `inside hair volume for outfit ${outfit}, side ${side}`).toBeDefined();
        }
      } finally {
        avatar.dispose();
      }
    }
    expect(longCuts).toBeGreaterThanOrEqual(3);
  });

  it.each([0, 30])("keeps every style behind the neck plane in bind and gait extremes at distance %i", distance => {
    let checked = 0;
    for (let outfit = 0; outfit < 8; outfit++) {
      const avatar = createAvatar(THREE, outfit);
      try {
        avatar.setDistance(distance);
        avatar.object.position.set(4, 2, -3);
        avatar.object.rotation.y = 0.6;
        const mesh = avatar.object.children[0] as THREE.SkinnedMesh;
        const head = mesh.skeleton.bones[BONE.head]!;
        const headBind = mesh.skeleton.boneInverses[BONE.head]!.clone().invert();
        const point = new THREE.Vector3(), toNeckBind = new THREE.Matrix4();
        const uv = mesh.geometry.getAttribute("uv");
        const hair = Array.from({ length: uv.count }, (_, i) => i)
          .filter(i => Math.floor(uv.getX(i) * 8) === SURFACE.hair);
        expect(hair.length).toBeGreaterThan(20);

        function check(): void {
          avatar.object.updateMatrixWorld(true);
          mesh.skeleton.update();
          // The neck is skinned to the head. Compare in its bind frame so the
          // bound follows neck pitch/rotation and each outfit's height scale.
          toNeckBind.copy(head.matrixWorld).invert().premultiply(headBind).multiply(mesh.matrixWorld);
          for (const i of hair) {
            mesh.getVertexPosition(i, point).applyMatrix4(toNeckBind);
            // This covers the requested collar-to-chin band and the rest of
            // the anatomical neck up to its ellipsoid top, with no style list.
            if (point.y < NECK.collarY || point.y > NECK.y + NECK.ry) continue;
            checked++;
            expect(point.z, `outfit ${outfit}, vertex ${i}, y=${point.y}`)
              .toBeGreaterThanOrEqual(NECK.z - 0.000002);
          }
        }

        check();
        // Sample complete settled walk/run cycles, including both leg-swing
        // extremes, hip sway and the counter-rotating head/shoulder extremes.
        for (const speed of [1.45, 3.6]) {
          for (let frame = 0; frame < 90; frame++) avatar.update(1 / 60, speed);
          for (let frame = 0; frame < 120; frame++) {
            avatar.update(1 / 60, speed);
            check();
          }
        }
      } finally {
        avatar.dispose();
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
