import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { pawShadowState, placePawShadows } from "./contactShadow.ts";

describe("pawShadowState", () => {
  it("fades from contact to a raised paw", () => {
    expect(pawShadowState(2, 2)).toBe(0.5);
    expect(pawShadowState(2.01, 2)).toBeCloseTo(0.5);
    expect(pawShadowState(2.035, 2)).toBeCloseTo(0.25);
    expect(pawShadowState(2.06, 2)).toBeCloseTo(0);
    expect(pawShadowState(2.1, 2)).toBe(0);
  });
});


it("places shadows beneath paws on a rotated and translated avatar", () => {
  const avatar = new THREE.Group();
  avatar.position.set(3, 2, -4);
  avatar.rotation.y = 0.8;
  const rig = new THREE.Group();
  avatar.add(rig);
  const names = ["forepaw_L", "forepaw_R", "hindpaw_L", "hindpaw_R"];
  const paws = names.map((name, i) => {
    const paw = new THREE.Object3D();
    paw.name = name;
    paw.position.set(i * 0.2 - 0.3, i % 2 ? 0.06 : 0.01, i * -0.1);
    rig.add(paw);
    return paw;
  });
  const shadows = names.map(() => new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
  avatar.updateMatrixWorld(true);
  placePawShadows(shadows, rig, avatar, 2);
  paws.forEach((paw, i) => {
    const local = avatar.worldToLocal(paw.getWorldPosition(new THREE.Vector3()));
    expect(shadows[i]!.position.x).toBeCloseTo(local.x, 6);
    expect(shadows[i]!.position.z).toBeCloseTo(local.z, 6);
    expect(shadows[i]!.position.y).toBe(0.012);
    expect(shadows[i]!.material.opacity).toBeCloseTo(i % 2 ? 0 : 0.5, 6);
  });
});
