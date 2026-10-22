import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneFromGlbRoles, seeThroughMeshes, type StationScene } from "@gteki/scene-api";
import { AMBIENT_ROLES, CAMERA_ROLES, COLLIDER_ROLES, SEE_THROUGH_ROLES, WALKABLE_ROLES, bakeInstancedMeshes, categoryOf, dropDynamicObjects, stripTextures, tagSceneRoles } from "./scene-roles.ts";
import { approximateTextWidth } from "./headless-dom.ts";

const named = (name: string, role?: string) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = name;
  if (role) mesh.userData.gteki_role = role;
  return mesh;
};

describe("role vocabulary", () => {
  it("matches scene-api's classification for every role", () => {
    for (const [roles, bucket] of [[WALKABLE_ROLES, "walkable"], [COLLIDER_ROLES, "colliders"], [CAMERA_ROLES, "cameraBlockers"]] as const) {
      for (const role of roles) {
        const root = new THREE.Group();
        root.add(named("x", role));
        expect(sceneFromGlbRoles(root, { showColliders: true })[bucket], role).toHaveLength(1);
      }
    }
    for (const role of SEE_THROUGH_ROLES) {
      const root = new THREE.Group();
      root.add(named("x", role));
      expect(seeThroughMeshes(root), role).toHaveLength(1);
    }
    const root = new THREE.Group();
    root.add(named("x", "ceiling"));
    expect(sceneFromGlbRoles(root, { showColliders: true })).toEqual({ walkable: [], colliders: [], cameraBlockers: [] });
  });

  it("matches the Godot loader's constants", () => {
    const gd = readFileSync(new URL("../addons/gteki/gteki_assets.gd", import.meta.url), "utf8");
    const list = (name: string) => JSON.parse((new RegExp(`^const ${name} = (\\[.*\\])$`, "m").exec(gd) ?? [])[1] ?? "null") as string[];
    expect(list("WALKABLE")).toEqual([...WALKABLE_ROLES]);
    expect(list("COLLIDER")).toEqual([...COLLIDER_ROLES]);
    expect(list("CAMERA")).toEqual([...CAMERA_ROLES]);
    expect(list("SEE_THROUGH")).toEqual([...SEE_THROUGH_ROLES]);
  });
});

describe("tagSceneRoles", () => {
  it("takes roles from the scene's lists, flags undrawn proxies and demotes replaced drawings", () => {
    const root = new THREE.Group();
    const drawnFloor = named("floor"); // visual copy of something the scene collides with elsewhere
    const proxy = named("p");
    proxy.visible = false;
    const sign = named("s");
    const group = new THREE.Group();
    group.userData.gteki_role = "sign";
    group.add(sign);
    const outside = named("tile"); // listed but not under root (Ikebukuro raycast tiles)
    outside.visible = false;
    root.add(drawnFloor, proxy, group);
    const scene = { root, walkable: [proxy], colliders: [outside], dispose() {} } as unknown as StationScene;
    const summary = tagSceneRoles(scene);
    expect(proxy.userData).toMatchObject({ gteki_role: "walkable", gteki_collision_only: true });
    expect(outside.userData).toMatchObject({ gteki_role: "collider", gteki_collision_only: true });
    expect(outside.parent?.name).toBe("gteki_collision_proxies");
    expect(drawnFloor.userData).toMatchObject({ gteki_role: "visual", gteki_source_role: "floor" });
    expect(sign.userData.gteki_role).toBe("sign");
    expect(summary).toMatchObject({ meshes: 4, walkable: 1, collider: 1, camera_blocker: 0, see_through: 1, collisionOnly: 2, replacedByCollision: 1 });
  });

  it("flags every source mesh that is not drawn, listed or not (Codex P2 on #184)", () => {
    const root = new THREE.Group();
    const hiddenHelper = named("helper", "access_fences_collider"); // invisible original, collided through tiles elsewhere
    hiddenHelper.visible = false;
    const hiddenMaterial = named("m", "walk_bridges");
    (hiddenMaterial.material as THREE.Material).visible = false;
    const group = new THREE.Group();
    group.visible = false;
    const underHidden = named("child");
    group.add(underHidden);
    const drawn = named("drawn");
    const tile = named("tile"); // the listed stand-in for the hidden helper
    tile.visible = false;
    root.add(hiddenHelper, hiddenMaterial, group, drawn);
    const summary = tagSceneRoles({ root, walkable: [], colliders: [tile], dispose() {} } as unknown as StationScene);
    expect(hiddenHelper.userData.gteki_hidden).toBe(true);
    expect(hiddenMaterial.userData.gteki_hidden).toBe(true);
    expect(underHidden.userData.gteki_hidden).toBe(true);
    expect(tile.userData.gteki_hidden).toBe(true);
    expect(drawn.userData.gteki_hidden).toBeUndefined();
    expect(summary.hidden).toBe(4);
    // Hidden originals keep their own roles and do not inflate the collision counts.
    expect(hiddenHelper.userData.gteki_role).toBe("access_fences_collider");
    expect(summary).toMatchObject({ collider: 1, walkable: 0, collisionOnly: 1 });
  });

  it("keeps an own vocabulary role such as stairs_ramps", () => {
    const stairs = named("st", "stairs_ramps");
    const root = new THREE.Group();
    root.add(stairs);
    tagSceneRoles({ root, walkable: [stairs], dispose() {} } as unknown as StationScene);
    expect(stairs.userData.gteki_role).toBe("stairs_ramps");
  });
});

describe("snapshot helpers", () => {
  it("bakes instances, drops ambient content, strips textures", () => {
    const root = new THREE.Group();
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), 3);
    for (let i = 0; i < 3; i++) instanced.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 10, 0, 0));
    const crowd = named("crowd", AMBIENT_ROLES[0]);
    root.add(instanced, crowd);
    expect(bakeInstancedMeshes(root)).toBe(1);
    const baked = root.children.find((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && o !== crowd) as THREE.Mesh;
    expect(baked.geometry.getAttribute("position").count).toBe(72);
    expect(new THREE.Box3().setFromBufferAttribute(baked.geometry.getAttribute("position") as THREE.BufferAttribute).max.x).toBeCloseTo(20.5);
    expect(dropDynamicObjects(root)).toEqual(["crowd"]);
    expect(stripTextures(root)).toBe(1);
    expect(categoryOf("camera_blocker")).toBe("camera_blocker");
  });

  it("estimates text width from the CSS font size", () => {
    expect(approximateTextWidth("600 20px sans-serif", "出口")).toBe(40);
    expect(approximateTextWidth("10px x", "Exit")).toBeCloseTo(22.4);
  });
});
