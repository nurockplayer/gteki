import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneFromGlbRoles } from "./index.ts";

function fixture(): { root: THREE.Group; floor: THREE.Mesh; wall: THREE.Mesh; plain: THREE.Mesh } {
  const root = new THREE.Group();
  const mk = (name: string) => { const m = new THREE.Mesh(new THREE.BoxGeometry()); m.name = name; root.add(m); return m; };
  return { root, floor: mk("floor"), wall: mk("wall"), plain: mk("plain_box") };
}

describe("manifest asset roles (PR #15 Codex review 8)", () => {
  it("a visual asset classifies only tagged meshes", () => {
    const f = fixture();
    const r = sceneFromGlbRoles(f.root, { assetRole: "visual" });
    expect(r.walkable).toEqual([f.floor]);
    expect(r.colliders).toEqual([f.wall]);
    expect(f.plain.visible).toBe(true);
  });

  it("a visual+collision asset makes untagged meshes collide but keeps them drawn", () => {
    const f = fixture();
    const r = sceneFromGlbRoles(f.root, { assetRole: "visual+collision" });
    expect(r.walkable).toEqual([f.floor]);
    expect(new Set(r.colliders)).toEqual(new Set([f.wall, f.plain]));
    expect(f.plain.visible).toBe(true);
  });

  it("a collision asset collides everywhere untagged and is never drawn", () => {
    const f = fixture();
    const r = sceneFromGlbRoles(f.root, { assetRole: "collision" });
    expect(new Set(r.colliders)).toEqual(new Set([f.wall, f.plain]));
    expect([f.floor, f.wall, f.plain].every((m) => !m.visible)).toBe(true);
  });

  it("a mesh inheriting a walkable group role stays walkable in a collision asset (Godot parity)", () => {
    const root = new THREE.Group();
    const group = new THREE.Group(); group.name = "floor"; root.add(group);
    const child = new THREE.Mesh(new THREE.BoxGeometry()); child.name = "plain_box"; group.add(child);
    const r = sceneFromGlbRoles(root, { assetRole: "visual+collision" });
    expect(r.walkable).toEqual([child]);
    expect(r.colliders).toEqual([]);
  });

  it("a wall group's untagged child collides and a floor_001 mesh is walkable (Godot parity fixture)", () => {
    const root = new THREE.Group();
    const wallGroup = new THREE.Group(); wallGroup.name = "wall_group"; wallGroup.userData.gteki_role = "wall"; root.add(wallGroup);
    const wallChild = new THREE.Mesh(new THREE.BoxGeometry()); wallChild.name = "wall_child"; wallGroup.add(wallChild);
    const floor001 = new THREE.Mesh(new THREE.BoxGeometry()); floor001.name = "floor_001"; root.add(floor001);
    const r = sceneFromGlbRoles(root, { assetRole: "visual+collision" });
    expect(r.colliders).toEqual([wallChild]);
    expect(r.walkable).toEqual([floor001]);
  });

  it("normalises roles like Godot: trimmed, lowercased, empty means absent", () => {
    const root = new THREE.Group();
    const group = new THREE.Group(); group.userData.gteki_role = " FLOOR "; root.add(group);
    const child = new THREE.Mesh(new THREE.BoxGeometry()); child.name = "plain_box"; child.userData.gteki_role = ""; group.add(child);
    const r = sceneFromGlbRoles(root, { assetRole: "visual+collision" });
    expect(r.walkable).toEqual([child]);
    expect(r.colliders).toEqual([]);
  });
});

describe("roles survive a real glTF import (PR #15 Codex re-review)", () => {
  it("matches dot-suffixed authored names that GLTFLoader sanitises", async () => {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    // A self-contained GLB: one triangle in the BIN chunk, shared by three nodes named as Blender
    // names duplicates.
    const bin = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer);
    const json = new TextEncoder().encode(JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ name: "floor.001", mesh: 0 }, { name: "wall.001", mesh: 0 }, { name: "collider.001", mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 0, 1] }],
      bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
      buffers: [{ byteLength: bin.byteLength }],
    }));
    const pad = (n: number) => (n + 3) & ~3;
    const jsonLen = pad(json.byteLength);
    const binLen = pad(bin.byteLength);
    const glb = new ArrayBuffer(12 + 8 + jsonLen + 8 + binLen);
    const view = new DataView(glb);
    const bytes = new Uint8Array(glb);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.byteLength, true);
    view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(0x20, 20, 20 + jsonLen); bytes.set(json, 20);
    view.setUint32(20 + jsonLen, binLen, true); view.setUint32(24 + jsonLen, 0x004e4942, true);
    bytes.set(bin, 28 + jsonLen);
    const loaded = await new GLTFLoader().parseAsync(glb, "");
    const byName = (n: string) => { let hit: THREE.Object3D | undefined; loaded.scene.traverse((o) => { if (o.userData.name === n) hit = o; }); return hit!; };
    const r = sceneFromGlbRoles(loaded.scene);
    expect(r.walkable).toEqual([byName("floor.001")]);
    expect(new Set(r.colliders)).toEqual(new Set([byName("wall.001"), byName("collider.001")]));
    expect(byName("collider.001").visible).toBe(false);
  });
});
