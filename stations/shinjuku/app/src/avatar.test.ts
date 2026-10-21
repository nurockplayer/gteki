import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createAvatar } from "./avatar.ts";

describe("commuter avatar", () => {
  it("uses smooth adult silhouettes, grounded feet and at most 18 single-material meshes", () => {
    const avatar = createAvatar(THREE);
    const heights = new Set<number>();
    for (let colorway = 0; colorway < 8; colorway++) {
      avatar.setColorway(colorway);
      const bounds = new THREE.Box3().setFromObject(avatar.object);
      const height = bounds.max.y - bounds.min.y;
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(height).toBeGreaterThanOrEqual(1.6);
      expect(height).toBeLessThanOrEqual(1.8);
      expect(height / (0.232 * avatar.object.scale.y)).toBeCloseTo(7.3, 1);
      heights.add(height);
      let meshes = 0;
      let capsules = 0;
      avatar.object.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        meshes++;
        expect(part.geometry).not.toBeInstanceOf(THREE.BoxGeometry);
        expect(part.material).toBeInstanceOf(THREE.MeshStandardMaterial);
        // Multiple material groups would defeat the draw-call budget.
        expect(Array.isArray(part.material)).toBe(false);
        if (part.geometry instanceof THREE.CapsuleGeometry) {
          capsules++;
          expect(part.geometry.parameters.radialSegments).toBeGreaterThanOrEqual(10);
          expect(part.geometry.parameters.radialSegments).toBeLessThanOrEqual(12);
        }
      });
      expect(meshes).toBeLessThanOrEqual(18);
      expect(capsules).toBe(8);
      const torso = avatar.object.getObjectByName("tailoredTorso") as THREE.Mesh;
      expect(torso.geometry).toBeInstanceOf(THREE.LatheGeometry);
      const skin = avatar.object.getObjectByName("headSkin") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const hair = avatar.object.getObjectByName("hairCap") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(skin.material.roughness).toBe(0.55);
      expect(hair.material.roughness).toBe(0.6);
      // The forehead remains exposed; hair wraps farther down the nape.
      const positions = hair.geometry.getAttribute("position");
      let front = Infinity;
      let back = Infinity;
      for (let i = 0; i < positions.count; i++) {
        if (positions.getZ(i) < -0.05) front = Math.min(front, positions.getY(i));
        if (positions.getZ(i) > 0.05) back = Math.min(back, positions.getY(i));
      }
      expect(front).toBeGreaterThan(back + 0.05);
    }
    expect(heights.size).toBe(8);
    avatar.dispose();
  });

  it("stands at the origin at commuter scale, and animates at idle, walking and running speeds", () => {
    const avatar = createAvatar(THREE);
    const bounds = new THREE.Box3().setFromObject(avatar.object);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y - bounds.min.y).toBeGreaterThanOrEqual(1.6);
    expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(1.85);

    const knee = avatar.object.getObjectByName("leftKnee")!;
    let maxKneeBend = 0;
    for (const speed of [0, 0.05, 0.8, 1.4, 2.2, 3.5, 5, 0]) {
      for (let frame = 0; frame < 120; frame++) {
        avatar.update(1 / 60, speed);
        maxKneeBend = Math.max(maxKneeBend, Math.abs(knee.rotation.x));
        bounds.setFromObject(avatar.object);
        expect(bounds.min.y).toBeGreaterThan(-0.006);
      }
      bounds.setFromObject(avatar.object);
      expect(bounds.max.y - bounds.min.y).toBeGreaterThanOrEqual(1.6);
      expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(1.85);
      expect(avatar.object.position.toArray()).toEqual([0, 0, 0]);
      avatar.object.traverse((part) => {
        expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true);
        if (part instanceof THREE.Mesh) expect(part.castShadow).toBe(true);
      });
    }
    expect(maxKneeBend).toBeGreaterThan(0.6);
    avatar.dispose();
  });

  it("lifts the feet further when ascending stairs", () => {
    const ascending = createAvatar(THREE);
    const descending = createAvatar(THREE);
    let ascendingLift = 0;
    let descendingLift = 0;
    const position = new THREE.Vector3();
    for (let frame = 0; frame < 240; frame++) {
      ascending.update(1 / 60, 1.2, { onStairs: true, climbing: 1 });
      descending.update(1 / 60, 1.2, { onStairs: true, climbing: -1 });
      if (frame > 120) {
        ascendingLift = Math.max(ascendingLift, ascending.object.getObjectByName("leftAnkle")!.getWorldPosition(position).y);
        descendingLift = Math.max(descendingLift, descending.object.getObjectByName("leftAnkle")!.getWorldPosition(position).y);
      }
    }
    expect(ascendingLift).toBeGreaterThan(descendingLift + 0.08);
    ascending.dispose();
    descending.dispose();
  });

  it("switches all commuter colorways and reserves the backpack for the player", () => {
    const avatar = createAvatar(THREE);
    const backpack = avatar.object.getObjectByName("backpack")!;
    const shoulderBag = avatar.object.getObjectByName("shoulderBag")!;
    const torso = avatar.object.getObjectByName("tailoredTorso") as THREE.Mesh;
    const jacketGeometry = torso.geometry;
    const colors = new Set<number>();
    for (let colorway = 0; colorway < 8; colorway++) {
      avatar.setColorway(colorway);
      expect(backpack.visible).toBe(colorway === 0);
      expect(shoulderBag.visible).toBe([2, 5, 6, 7].includes(colorway));
      expect(torso.geometry === jacketGeometry).toBe(![2, 7].includes(colorway));
      const shoulder = avatar.object.getObjectByName("leftShoulder")!;
      const sleeve = shoulder.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      colors.add(sleeve.material.color.getHex());
      expect(sleeve.material.roughness).toBe(0.85);
    }
    expect(colors.size).toBe(8);
    avatar.setColorway(0);
    expect(backpack.visible).toBe(true);
    avatar.setColorway(-6);
    expect(shoulderBag.visible).toBe(true);
    avatar.setColorway(Number.NaN);
    expect(backpack.visible).toBe(true);
    avatar.dispose();
  });

  it("shares geometry across a crowd without sharing materials or disposing live resources", () => {
    const avatars = Array.from({ length: 24 }, (_, i) => createAvatar(THREE, i % 8));
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    // Visit every cached outfit, including the accessories hidden on suits.
    const first = avatars[0]!;
    for (let colorway = 0; colorway < 8; colorway++) {
      first.setColorway(colorway);
      first.object.traverse((part) => {
        if (part instanceof THREE.Mesh) {
          geometries.add(part.geometry);
          materials.add(part.material);
        }
      });
    }
    const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, "dispose"));
    const materialDisposals = [...materials].map((material) => vi.spyOn(material, "dispose"));
    const survivor = avatars[23]!;
    const firstSleeve = first.object.getObjectByName("leftShoulder")!.children[0] as THREE.Mesh;
    const survivorSleeve = survivor.object.getObjectByName("leftShoulder")!.children[0] as THREE.Mesh;
    expect(firstSleeve.geometry).toBe(survivorSleeve.geometry);
    expect(firstSleeve.material).not.toBe(survivorSleeve.material);
    for (const avatar of avatars) {
      avatar.object.traverse((part) => {
        if (part instanceof THREE.Mesh) expect(geometries.has(part.geometry)).toBe(true);
      });
    }
    first.dispose();
    first.dispose();
    for (const dispose of materialDisposals) expect(dispose).toHaveBeenCalledOnce();
    for (const dispose of geometryDisposals) expect(dispose).not.toHaveBeenCalled();
    for (const avatar of avatars.slice(1, -1)) avatar.dispose();
    survivor.setColorway(0);
    survivor.update(1 / 60, 3.5, { onStairs: true, climbing: 1 });
    for (const dispose of geometryDisposals) expect(dispose).not.toHaveBeenCalled();
    survivor.dispose();
    for (const dispose of geometryDisposals) expect(dispose).toHaveBeenCalledOnce();
    const replacement = createAvatar(THREE);
    const newSleeve = replacement.object.getObjectByName("leftShoulder")!.children[0] as THREE.Mesh;
    expect(newSleeve.geometry).not.toBe(firstSleeve.geometry);
    replacement.dispose();
  });

  it("disposes the last avatar's resources once, including hidden accessories", () => {
    const avatar = createAvatar(THREE, 4);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    avatar.object.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      geometries.add(part.geometry);
      if (Array.isArray(part.material)) part.material.forEach((surface) => materials.add(surface));
      else materials.add(part.material);
    });
    const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, "dispose"));
    const materialDisposals = [...materials].map((surface) => vi.spyOn(surface, "dispose"));
    expect(geometryDisposals.length).toBeGreaterThan(0);
    avatar.dispose();
    avatar.dispose();
    for (const dispose of [...geometryDisposals, ...materialDisposals]) expect(dispose).toHaveBeenCalledOnce();
  });
});
