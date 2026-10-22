import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneFromGlbRoles, seeThroughMeshes, type StationScene } from "@gteki/scene-api";
import { AMBIENT_ROLES, CAMERA_ROLES, COLLIDER_ROLES, SEE_THROUGH_ROLES, WALKABLE_ROLES, bakeInstancedMeshes, categoryOf, dropDynamicObjects, stripTextures, tagLightmaps, tagSceneRoles } from "./scene-roles.ts";
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

  it("reads visibility through the original parent chain, not through the proxy it is attached to (#232)", () => {
    // A drawn mesh the scene lists but keeps outside root, under an invisible parent. Attaching it to the visible
    // proxy group must not make it look drawn again.
    const hiddenParent = new THREE.Group();
    hiddenParent.visible = false;
    const tile = named("tile", "collider");
    hiddenParent.add(tile);
    const root = new THREE.Group();
    tagSceneRoles({ root, walkable: [], colliders: [tile], dispose() {} } as unknown as StationScene);
    expect(tile.parent?.name).toBe("gteki_collision_proxies");
    expect(tile.userData).toMatchObject({ gteki_role: "collider", gteki_collision_only: true, gteki_hidden: true });
  });
});

/** Two triangles in two material groups (0..2 → material 0, 3..5 → material 1). */
function twoGroups(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), 3));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  return geometry;
}

function multiMaterial(visible: [boolean, boolean], name = "part"): THREE.Mesh {
  const mesh = new THREE.Mesh(twoGroups(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial({ visible: visible[1] })]);
  (mesh.material as THREE.Material[])[0]!.visible = visible[0];
  mesh.name = name;
  return mesh;
}

describe("multi-material visibility (#232)", () => {
  it("leaves an all-visible multi-material mesh untouched", () => {
    const part = multiMaterial([true, true]);
    const root = new THREE.Group();
    root.add(part);
    const summary = tagSceneRoles({ root, walkable: [], colliders: [part], dispose() {} } as unknown as StationScene);
    expect(root.children).toEqual([part]);
    expect((part.material as THREE.Material[]).length).toBe(2);
    expect(part.geometry.groups.length).toBe(2);
    expect(part.userData.gteki_hidden).toBeUndefined();
    expect(summary).toMatchObject({ meshes: 1, collider: 1, hidden: 0, collisionOnly: 0 });
    expect(summary.warnings).toEqual([]);
  });

  it("moves the invisible groups of a partially invisible mesh to a hidden sibling, keeping every triangle", () => {
    const part = multiMaterial([true, false]);
    const root = new THREE.Group();
    root.add(part);
    const summary = tagSceneRoles({ root, walkable: [], colliders: [part], dispose() {} } as unknown as StationScene);
    const sibling = root.children.find((o) => o !== part) as THREE.Mesh;
    expect(sibling.name).toBe("part_hidden_materials");
    // The drawn part keeps the visible material only; the hidden sibling carries the invisible one.
    expect((part.material as THREE.Material[]).length).toBe(1);
    expect((part.material as THREE.Material[])[0]!.visible).toBe(true);
    expect(part.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
    expect((sibling.material as THREE.Material[]).length).toBe(1);
    expect((sibling.material as THREE.Material[])[0]!.visible).toBe(false);
    expect(sibling.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
    // Same triangles in total, and each part keeps the mesh's position and role.
    const total = (part.geometry.index!.count + sibling.geometry.index!.count) / 3;
    expect(total).toBe(2);
    expect(sibling.userData).toMatchObject({ gteki_hidden: true, gteki_role: "collider", gteki_collision_only: true });
    expect(part.userData).toMatchObject({ gteki_role: "collider" });
    expect(part.userData.gteki_hidden).toBeUndefined();
    expect(summary).toMatchObject({ meshes: 2, collider: 2, hidden: 1, collisionOnly: 1 });
    expect(summary.warnings.some((w) => w.includes("only some materials visible"))).toBe(true);
  });

  it("splits a listed mesh outside root and attaches both parts to the proxy group", () => {
    const part = multiMaterial([true, false]);
    const root = new THREE.Group();
    const summary = tagSceneRoles({ root, walkable: [], colliders: [part], dispose() {} } as unknown as StationScene);
    const proxies = root.children.find((o) => o.name === "gteki_collision_proxies") as THREE.Group;
    expect(proxies.children).toHaveLength(2);
    expect(proxies.children.map((o) => (o.userData as { gteki_hidden?: boolean }).gteki_hidden === true)).toEqual([false, true]);
    expect(summary).toMatchObject({ meshes: 2, collider: 2, hidden: 1, collisionOnly: 1 });
  });

  it("does not split an all-invisible multi-material mesh: the whole mesh is hidden", () => {
    const part = multiMaterial([false, false]);
    const root = new THREE.Group();
    root.add(part);
    const summary = tagSceneRoles({ root, walkable: [], colliders: [part], dispose() {} } as unknown as StationScene);
    expect(root.children).toEqual([part]);
    expect((part.material as THREE.Material[]).length).toBe(2);
    expect(part.userData).toMatchObject({ gteki_hidden: true, gteki_role: "collider", gteki_collision_only: true });
    expect(summary).toMatchObject({ meshes: 1, collider: 1, hidden: 1, collisionOnly: 1 });
  });
});

describe("tagLightmaps", () => {
  const lightmap = () => {
    const texture = new THREE.Texture();
    texture.userData.gteki_uri = "assets/lightmap.webp";
    texture.channel = 1;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    return texture;
  };
  const lit = (texture: THREE.Texture, intensity = 4.41) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ lightMap: texture, lightMapIntensity: intensity }));

  it("records the material state: flagged surfaces and the one texture the scene used", () => {
    const texture = lightmap();
    const root = new THREE.Group();
    const floor = lit(texture);
    const mixed = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [new THREE.MeshBasicMaterial(), new THREE.MeshStandardMaterial({ lightMap: texture, lightMapIntensity: 4.41 })]);
    root.add(floor, mixed, named("wall"));
    expect(tagLightmaps(root)).toEqual({ uri: "assets/lightmap.webp", channel: 1, color_space: "srgb", flip_y: false, light_map_intensity: 4.41, meshes: 2, surfaces: 2 });
    expect(floor.userData.gteki_lightmap_surfaces).toEqual([0]);
    expect(mixed.userData.gteki_lightmap_surfaces).toEqual([1]);
    expect(root.children[2]!.userData.gteki_lightmap_surfaces).toBeUndefined();
  });

  it("returns null when no material carries a lightmap", () => {
    const root = new THREE.Group();
    root.add(named("wall"));
    expect(tagLightmaps(root)).toBeNull();
  });

  it("throws rather than guess when the scene disagrees or the texture origin is unknown", () => {
    const two = new THREE.Group();
    two.add(lit(lightmap()), lit(lightmap()));
    expect(() => tagLightmaps(two)).toThrow(/2 distinct lightmap textures/);
    const disagreement = new THREE.Group();
    const shared = lightmap();
    disagreement.add(lit(shared, 1), lit(shared, 2));
    expect(() => tagLightmaps(disagreement)).toThrow(/disagree on lightMapIntensity/);
    const anonymous = new THREE.Group();
    anonymous.add(lit(new THREE.Texture()));
    expect(() => tagLightmaps(anonymous)).toThrow(/no recorded source URI/);
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
