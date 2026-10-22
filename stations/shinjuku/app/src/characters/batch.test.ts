import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createAvatar } from "../avatar.ts";
import { createCharacterBatch } from "./batch.ts";

const getMesh = (avatar: ReturnType<typeof createAvatar>) => avatar.object.children[0] as THREE.SkinnedMesh;

describe("skinned character batch", () => {
  it("preserves each independent posed rig, outfit scale, placement, and rotation", () => {
    const avatars = [createAvatar(THREE, 0), createAvatar(THREE, 3), createAvatar(THREE, 6)];
    const batch = createCharacterBatch(THREE);
    const parent = new THREE.Group();
    parent.position.set(8, -4, 6);
    parent.rotation.y = 0.3;
    parent.add(batch.object, ...avatars.map(a => a.object));
    avatars[0]!.object.position.set(-3, 0, 1);
    avatars[1]!.object.position.set(2, 0, -4);
    avatars[1]!.object.rotation.y = 0.7;
    avatars[2]!.object.position.set(0, 0, 3);
    avatars[2]!.object.rotation.y = -1.2;
    avatars[2]!.update(0.35, 1.45);
    avatars[1]!.update(0.2, 3.6);
    parent.updateMatrixWorld(true);
    batch.sync(avatars);
    const merged = batch.object;
    for (const avatar of avatars) {
      avatar.object.updateMatrixWorld(true);
      getMesh(avatar).skeleton.update();
    }
    merged.updateMatrixWorld(true);
    merged.skeleton.update();

    let vertexOffset = 0;
    const actual = new THREE.Vector3(), expected = new THREE.Vector3(), local = new THREE.Vector3();
    for (const avatar of avatars) {
      const source = getMesh(avatar), count = source.geometry.getAttribute("position").count;
      for (const vertex of [0, Math.floor(count * 0.31), Math.floor(count * 0.79), count - 1]) {
        source.getVertexPosition(vertex, local);
        expected.copy(local).applyMatrix4(source.matrixWorld);
        merged.getVertexPosition(vertexOffset + vertex, actual).applyMatrix4(merged.matrixWorld);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-5);
      }
      vertexOffset += count;
    }
    expect(merged.geometry.groups).toHaveLength(0);
    expect(merged.skeleton.bones).toHaveLength(avatars.length * getMesh(avatars[0]!).skeleton.bones.length);
    expect(avatars.every(avatar => !getMesh(avatar).visible)).toBe(true);
    batch.dispose();
    avatars.forEach(avatar => avatar.dispose());
  });

  it("rebuilds only when the pool or an outfit/LOD geometry changes", () => {
    const first = createAvatar(THREE, 0), second = createAvatar(THREE, 1), third = createAvatar(THREE, 2);
    const batch = createCharacterBatch(THREE);
    batch.sync([first, second]);
    const initial = batch.object.geometry;
    const releasedGeometry = vi.spyOn(initial, "dispose");
    const releasedSkeleton = vi.spyOn(batch.object.skeleton, "dispose");
    batch.sync([first, second]);
    expect(batch.object.geometry).toBe(initial);
    batch.sync([first, second, third]);
    expect(batch.object.geometry).not.toBe(initial);
    expect(releasedGeometry).toHaveBeenCalledOnce();
    expect(releasedSkeleton).toHaveBeenCalledOnce();
    expect(batch.object.skeleton.bones).toHaveLength(42);
    batch.sync([first, second]);
    expect(getMesh(third).visible).toBe(true);
    second.setDistance(30);
    batch.sync([first, second]);
    const far = batch.object.geometry;
    expect(far).not.toBe(initial);
    first.setColorway(4);
    batch.sync([first, second]);
    expect(batch.object.geometry).not.toBe(far);
    const sourceGeometry = getMesh(first).geometry, material = getMesh(first).material;
    const sourceGeometryDispose = vi.spyOn(sourceGeometry, "dispose");
    const materialDispose = vi.spyOn(material as THREE.Material, "dispose");
    batch.dispose(); batch.dispose();
    expect(sourceGeometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
    first.dispose(); second.dispose(); third.dispose();
  });

  it("keeps one material and filters hidden or off-camera avatars to complete index slices", () => {
    const near = createAvatar(THREE, 0), far = createAvatar(THREE, 1), hidden = createAvatar(THREE, 2);
    far.object.position.x = 50;
    hidden.object.visible = false;
    const batch = createCharacterBatch(THREE);
    batch.sync([near, far, hidden]);
    const geometry = batch.object.geometry;
    const fullIndexCount = geometry.index!.count;
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 1.2, 8);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld(true);
    batch.prepare(camera);
    expect(batch.object.material).toBe(getMesh(near).material);
    expect(geometry.groups).toHaveLength(0);
    expect(geometry.drawRange.count).toBe(getMesh(near).geometry.index!.count);
    expect(geometry.drawRange.count).toBeLessThan(fullIndexCount);

    near.object.visible = false;
    far.object.position.x = 0;
    batch.sync([near, far, hidden]);
    batch.object.onBeforeRender(null as never, null as never, camera, geometry, batch.object.material as THREE.Material, null as never);
    expect(geometry.drawRange.count).toBe(getMesh(far).geometry.index!.count);
    far.object.visible = false;
    batch.prepare(camera);
    expect(batch.object.visible).toBe(false);
    far.object.visible = true;
    batch.prepare(camera);
    expect(batch.object.visible).toBe(true);
    batch.dispose();
    expect(getMesh(near).visible).toBe(true);
    [near, far, hidden].forEach(avatar => avatar.dispose());
  });

  it("keeps an empty or disabled crowd out of the renderer and releases its owned resources once", () => {
    const batch = createCharacterBatch(THREE);
    batch.sync([]);
    expect(batch.object.visible).toBe(false);
    const avatar = createAvatar(THREE);
    batch.sync([avatar]);
    const geometry = vi.spyOn(batch.object.geometry, "dispose");
    const skeleton = vi.spyOn(batch.object.skeleton, "dispose");
    batch.sync([]);
    expect(batch.object.visible).toBe(false);
    expect(geometry).toHaveBeenCalledOnce();
    expect(skeleton).toHaveBeenCalledOnce();
    const empty = vi.spyOn(batch.object.geometry, "dispose");
    batch.dispose(); batch.dispose();
    expect(empty).toHaveBeenCalledOnce();
    avatar.dispose();
  });
});
