import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createAvatar } from "./avatar.ts";
import { sampleFoot, strideLength, type FootPose } from "./characters/gait.ts";

const getMesh = (avatar: ReturnType<typeof createAvatar>) => avatar.object.children[0] as THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
function posedBounds(mesh: THREE.SkinnedMesh): THREE.Box3 {
  mesh.parent!.updateMatrixWorld(true);
  mesh.skeleton.update();
  mesh.computeBoundingBox();
  return mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
}

describe("procedural commuter", () => {
  it("uses one smooth indexed skinned mesh, adult proportions and a bounded near/far budget for every outfit", () => {
    const avatar = createAvatar(THREE), heights = new Set<number>(), hairs = new Set<string>();
    for (let i = 0; i < 8; i++) {
      avatar.setColorway(i);
      const mesh = getMesh(avatar), bounds = posedBounds(mesh), height = bounds.max.y - bounds.min.y;
      heights.add(height); hairs.add(avatar.object.userData.hair);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(height).toBeGreaterThan(1.65);
      expect(height).toBeLessThan(1.85);
      // The 23.6 cm head excludes hairstyle volume; a receding crown and a
      // textured crop naturally give different visible height/head ratios.
      expect(height / (0.236 * avatar.object.scale.y)).toBeGreaterThan(7.4);
      expect(height / (0.236 * avatar.object.scale.y)).toBeLessThan(7.7);
      let meshes = 0;
      avatar.object.traverse(part => { if (part instanceof THREE.Mesh) meshes++; });
      expect(meshes).toBe(1);
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh.material.vertexColors).toBe(true);
      expect(mesh.geometry.groups).toHaveLength(0);
      expect(mesh.geometry.index!.count / 3).toBeLessThan(4000);
      expect(mesh.castShadow).toBe(true);
      const weights = mesh.geometry.getAttribute("skinWeight"), normals = mesh.geometry.getAttribute("normal");
      let blended = 0;
      for (let v = 0; v < weights.count; v++) {
        expect(weights.getX(v) + weights.getY(v)).toBeCloseTo(1, 6);
        if (weights.getX(v) > 0 && weights.getY(v) > 0) blended++;
        expect([normals.getX(v), normals.getY(v), normals.getZ(v)].every(Number.isFinite)).toBe(true);
      }
      expect(blended).toBeGreaterThan(70);
      avatar.setDistance(30);
      expect(getMesh(avatar).geometry.index!.count / 3).toBeLessThan(1400);
      avatar.setDistance(0);
    }
    expect(heights.size).toBe(8);
    expect(hairs.size).toBe(8);
    expect(avatar.object.userData.outfit).toContain("coat");
    avatar.setColorway(-8);
    expect(avatar.object.userData.outfit).toContain("backpack");
    avatar.setColorway(Number.NaN);
    expect(avatar.object.userData.outfit).toContain("backpack");
    avatar.dispose();
  });

  it("keeps idle, walking, running and blended poses finite with soles above the floor", () => {
    const avatar = createAvatar(THREE), mesh = getMesh(avatar);
    let kneeBend = 0;
    for (const speed of [0, 0.05, 0.8, 1.45, 2.2, 3.6, 0]) {
      for (let f = 0; f < 90; f++) {
        avatar.update(1 / 60, speed);
        kneeBend = Math.max(kneeBend, Math.abs(avatar.object.getObjectByName("leftKnee")!.rotation.x));
        const bounds = posedBounds(mesh);
        expect(bounds.min.y).toBeGreaterThan(-0.008);
        expect(bounds.max.y).toBeGreaterThan(1.56);
        avatar.object.traverse(part => expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      }
    }
    expect(kneeBend).toBeGreaterThan(0.8);
    expect(avatar.object.position.toArray()).toEqual([0, 0, 0]);
    avatar.update(1000, Number.NaN, { climbing: Number.NaN });
    avatar.update(Number.NaN, 1);
    avatar.update(-1, 1);
    expect(posedBounds(mesh).min.y).toBeGreaterThan(-0.008);
    avatar.dispose();
  });

  it.each([0, 3, 4, 6])("plants stance feet without sliding at 1.45 m/s, including height scale (outfit %i)", (outfit) => {
    const avatar = createAvatar(THREE, outfit);
    const ankle = avatar.object.getObjectByName("leftAnkle")!;
    const p = new THREE.Vector3(), before = new THREE.Vector3();
    let planted = false, samples = 0;
    for (let f = 0; f < 420; f++) {
      avatar.update(1 / 120, 1.45);
      avatar.object.position.z -= 1.45 / 120;
      avatar.object.updateMatrixWorld(true);
      ankle.getWorldPosition(p);
      const contact = Math.abs(p.y - 0.09 * avatar.object.scale.y) < 0.0005;
      if (f > 180 && contact && planted) {
        expect(p.distanceTo(before)).toBeLessThan(0.001);
        samples++;
      }
      planted = contact;
      before.copy(p);
    }
    expect(samples).toBeGreaterThan(50);
    avatar.dispose();
  });

  it("ties stance phase to distance at walk/run speeds and returns continuously at toe-off", () => {
    const a: FootPose = { z: 0, lift: 0, pitch: 0, planted: false }, b = { ...a };
    for (const speed of [0.7, 1.45, 3.6]) {
      const running = speed === 3.6 ? 1 : 0;
      const stride = strideLength(running), stance = 0.6 - running * 0.2;
      sampleFoot(0.2, stride, stance, running, 0, 0, a);
      sampleFoot(0.2 + speed / stride / 120, stride, stance, running, 0, 0, b);
      expect(a.planted && b.planted).toBe(true);
      expect(b.z - a.z).toBeCloseTo(speed / 120, 8);
      sampleFoot(stance - 1e-6, stride, stance, running, 0, 0, a);
      sampleFoot(stance + 1e-6, stride, stance, running, 0, 0, b);
      expect(Math.abs(a.z - b.z)).toBeLessThan(0.00001);
      expect(Math.abs(a.lift - b.lift)).toBeLessThan(0.00001);
    }
  });

  it("raises knees further uphill and leans with the climbing sign", () => {
    const up = createAvatar(THREE), down = createAvatar(THREE);
    let upLift = 0, downLift = 0;
    const position = new THREE.Vector3();
    for (let f = 0; f < 240; f++) {
      up.update(1 / 60, 1.2, { onStairs: true, climbing: 1 });
      down.update(1 / 60, 1.2, { onStairs: true, climbing: -1 });
      if (f > 120) {
        upLift = Math.max(upLift, up.object.getObjectByName("leftAnkle")!.getWorldPosition(position).y);
        downLift = Math.max(downLift, down.object.getObjectByName("leftAnkle")!.getWorldPosition(position).y);
      }
    }
    expect(upLift).toBeGreaterThan(downLift + 0.08);
    expect(up.object.getObjectByName("spine")!.rotation.x).toBeLessThan(down.object.getObjectByName("spine")!.rotation.x);
    up.dispose(); down.dispose();
  });

  it("switches LOD with hysteresis and freezes bones beyond 60 m", () => {
    const avatar = createAvatar(THREE), near = getMesh(avatar).geometry;
    avatar.setDistance(28);
    const far = getMesh(avatar).geometry;
    expect(far).not.toBe(near);
    avatar.setDistance(24);
    expect(getMesh(avatar).geometry).toBe(far);
    avatar.setColorway(2);
    expect(avatar.object.userData.lod).toBe("far");
    avatar.setDistance(22);
    expect(avatar.object.userData.lod).toBe("near");
    avatar.setDistance(61);
    const knee = avatar.object.getObjectByName("leftKnee")!, before = knee.quaternion.clone();
    avatar.update(1 / 60, 3.6);
    expect(knee.quaternion.equals(before)).toBe(true);
    avatar.setDistance(60);
    avatar.update(1 / 60, 3.6);
    expect(knee.quaternion.equals(before)).toBe(false);
    avatar.dispose();
  });

  it.each([2, 3, 6, 7])("keeps the hem loop continuous and level through opposing leg motion (outfit %i)", outfit => {
    const avatar = createAvatar(THREE, outfit), mesh = getMesh(avatar);
    const loop = mesh.geometry.userData.hemLoop as number[];
    expect(loop.length).toBeGreaterThanOrEqual(12);
    const p = new THREE.Vector3(), edgeLengths: number[] = [];
    const vertices = loop.map(i => mesh.getVertexPosition(i, new THREE.Vector3()).clone());
    for (let i = 0; i < loop.length; i++) edgeLengths.push(vertices[i]!.distanceTo(vertices[(i + 1) % loop.length]!));
    for (const speed of [1.45, 3.6]) for (let f = 0; f < 120; f++) {
      avatar.update(1 / 60, speed);
      avatar.object.updateMatrixWorld(true); mesh.skeleton.update();
      const posed = loop.map(i => mesh.getVertexPosition(i, p).clone());
      // A closed hem may sway and expand, but cannot tear, form a V, or
      // alternate its height with the left/right thighs.
      for (let i = 0; i < loop.length; i++) expect(posed[i]!.distanceTo(posed[(i + 1) % loop.length]!)).toBeLessThan(edgeLengths[i]! * 1.7);
      expect(Math.max(...posed.map(p => p.y)) - Math.min(...posed.map(p => p.y))).toBeLessThan(0.025);
    }
    avatar.dispose();
  });

  it("samples distinct matte fabric, skin, hair and shoe roughness from one shared atlas", () => {
    const avatar = createAvatar(THREE), mesh = getMesh(avatar);
    const atlas = mesh.material.roughnessMap as THREE.DataTexture;
    expect(atlas.image.width).toBe(8);
    expect(atlas.image.height).toBe(1);
    expect(mesh.material.transparent).toBe(false);
    const uv = mesh.geometry.getAttribute("uv");
    const pixels = new Set<number>();
    for (let i = 0; i < uv.count; i++) pixels.add(Math.floor(uv.getX(i) * 8));
    for (const pixel of [0, 1, 2, 3, 4, 6]) expect(pixels.has(pixel)).toBe(true);
    const bytes = atlas.image.data!;
    expect(bytes[1]).toBeGreaterThan(bytes[2 * 4 + 1]!); // cloth > hair
    expect(bytes[1]).toBeGreaterThan(bytes[3 * 4 + 1]!); // cloth > shoes
    avatar.dispose();
  });

  it("shares all outfit/LOD resources, owns skeletons, and releases the last reference exactly once", () => {
    const first = createAvatar(THREE), survivor = createAvatar(THREE);
    const geometries = new Set<THREE.BufferGeometry>();
    for (let i = 0; i < 8; i++) for (const distance of [0, 30]) {
      first.setDistance(distance); first.setColorway(i);
      geometries.add(getMesh(first).geometry);
    }
    const disposals = [...geometries].map(g => vi.spyOn(g, "dispose"));
    const material = vi.spyOn(getMesh(first).material, "dispose");
    const atlas = vi.spyOn(getMesh(first).material.roughnessMap!, "dispose");
    const skeleton = vi.spyOn(getMesh(first).skeleton, "dispose");
    first.setDistance(0); first.setColorway(0);
    expect(getMesh(first).geometry).toBe(getMesh(survivor).geometry);
    expect(getMesh(first).material).toBe(getMesh(survivor).material);
    expect(getMesh(first).skeleton).not.toBe(getMesh(survivor).skeleton);
    first.dispose(); first.dispose();
    expect(skeleton).toHaveBeenCalledOnce();
    for (const dispose of [...disposals, material, atlas]) expect(dispose).not.toHaveBeenCalled();
    survivor.update(1 / 60, 1.45);
    survivor.dispose(); survivor.dispose();
    for (const dispose of [...disposals, material, atlas]) expect(dispose).toHaveBeenCalledOnce();
    const replacement = createAvatar(THREE);
    expect(geometries.has(getMesh(replacement).geometry)).toBe(false);
    replacement.dispose();
  });
});
