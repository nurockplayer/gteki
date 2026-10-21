import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { glbPrimitivePlugin, sceneFromGlbRoles, seeThroughMeshes } from "@gteki/scene-api";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { LightProbeGridHelperWebGL } from "three/addons/helpers/LightProbeGridHelperWebGL.js";
import { LightProbeGridWebGL } from "three/addons/lighting/LightProbeGridWebGL.js";
import { clampDistance, FOLLOW, followDistance, followPose } from "./followCamera.ts";
import { castAll, castCamera, castTargets, cuttableSigns, explorerTargets, keepBelowBlockers } from "./raycast.ts";

const plane = (y: number) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  mesh.position.y = y;
  return mesh;
};
const down = () => new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0));

describe("castTargets", () => {
  it("finds a floor mesh nested inside a scene group", () => {
    const floor = plane(0);
    const group = new THREE.Group();
    group.add(new THREE.Group().add(floor));
    group.updateMatrixWorld(true);
    const hit = castAll(down(), castTargets([group]))[0];
    expect(hit?.object).toBe(floor);
    expect(hit?.point.y).toBeCloseTo(0);
  });

  it("never ray-tests sprites, lines or helpers below a listed floor", () => {
    const floor = plane(0);
    floor.add(new THREE.Sprite(new THREE.SpriteMaterial()));
    const grid = new THREE.GridHelper(10, 10);
    grid.position.y = 0.3;
    grid.visible = false;
    floor.add(grid);
    floor.updateMatrixWorld(true);
    // A Sprite's raycast throws without a camera; it must not be reached at all.
    expect(castTargets([floor])).toEqual([floor]);
    expect(castAll(down(), castTargets([floor]))[0]?.point.y).toBeCloseTo(0);
  });

  it("keeps a wall parented under a floor out of the ground cast", () => {
    const floor = plane(0);
    const wall = plane(0.6);
    floor.add(wall);
    floor.updateMatrixWorld(true);
    expect(castAll(down(), castTargets([floor], [wall]))[0]?.point.y).toBeCloseTo(0);
    expect(castTargets([wall], [floor])).toEqual([wall]);
  });

  it("prunes three.js helpers, including the ones that are meshes or hold meshes", () => {
    const floor = plane(0);
    const light = new THREE.PointLight();
    light.position.y = 1;
    const group = new THREE.Group().add(floor, light);
    const pointHelper = new THREE.PointLightHelper(light, 0.5);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.5, 0), 3);
    group.add(pointHelper, arrow);
    group.updateMatrixWorld(true);
    expect(castTargets([group])).toEqual([floor]);
    expect(castTargets([pointHelper, floor])).toEqual([floor]);
    expect(castAll(down(), castTargets([group]))[0]?.object).toBe(floor);
  });

  it("prunes addon helpers whose type has a suffix, and helpers that only flag themselves", () => {
    const floor = plane(0);
    // The real addon: an InstancedMesh of probe spheres around y = 1.
    const grid = new LightProbeGridWebGL(2, 2, 2, 2, 2, 2);
    grid.position.y = 1;
    const probes = new LightProbeGridHelperWebGL(grid, 0.5);
    expect((probes as THREE.Object3D as THREE.Mesh).isMesh).toBe(true);
    const view = new THREE.Object3D().add(plane(2));
    (view as unknown as { isViewHelper: boolean }).isViewHelper = true;
    const group = new THREE.Group().add(floor, probes, view);
    group.updateMatrixWorld(true);
    expect(castTargets([group])).toEqual([floor]);
    expect(castAll(down(), castTargets([group]))[0]?.object).toBe(floor);
  });

  it("drops helper parts that a GLB role pass lists directly", () => {
    // A floor-role group holding the floor and an upward arrow: the role pass lists the arrow's cone as walkable.
    const floor = plane(0);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 3);
    const group = new THREE.Group().add(floor, arrow);
    group.name = "floor";
    const root = new THREE.Group().add(group);
    root.updateMatrixWorld(true);
    const roles = sceneFromGlbRoles(root, { assetRole: "visual" });
    expect(roles.walkable.length).toBeGreaterThan(1);
    expect(castTargets(roles.walkable, roles.colliders)).toEqual([floor]);
    const ray = new THREE.Raycaster(new THREE.Vector3(0.01, 5, 0), new THREE.Vector3(0, -1, 0));
    expect(castAll(ray, castTargets(roles.walkable, roles.colliders))[0]?.object).toBe(floor);
  });

  it("keeps a GLB's visual child of a floor out of every cast", () => {
    const floor = plane(0);
    floor.name = "floor";
    const sign = plane(0.8);
    sign.userData = { gteki_role: "visual" };
    floor.add(sign);
    const root = new THREE.Group().add(floor);
    root.updateMatrixWorld(true);
    const roles = sceneFromGlbRoles(root, { assetRole: "visual" });
    expect(roles.walkable).toEqual([floor]);
    expect(castTargets(roles.walkable, roles.colliders)).toEqual([floor]);
    expect(castAll(down(), castTargets(roles.walkable, roles.colliders))[0]?.point.y).toBeCloseTo(0);
  });
});

/** A binary glTF (GLB) with its buffer in the BIN chunk, so parsing needs no fetch. */
const glb = (json: object, bin: Float32Array): ArrayBuffer => {
  const pad = (bytes: Uint8Array, fill: number) => {
    const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
    out.set(bytes);
    return out;
  };
  const jsonChunk = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binChunk = pad(new Uint8Array(bin.buffer), 0);
  const out = new ArrayBuffer(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  const view = new DataView(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, jsonChunk.length).set(jsonChunk);
  const binAt = 20 + jsonChunk.length;
  view.setUint32(binAt, binChunk.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  new Uint8Array(out, binAt + 8, binChunk.length).set(binChunk);
  return out;
};

describe("camera-only blockers", () => {
  const ceiling = (y: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.y = y;
    mesh.updateMatrixWorld(true);
    return mesh;
  };

  it("stop the follow camera under a ceiling that is neither wall nor floor", () => {
    const floor = plane(0);
    floor.updateMatrixWorld(true);
    const slab = ceiling(2.6);
    const head = new THREE.Vector3(0, 1.6, 0);
    // Looking down 40°: the camera rises behind the walker, through a 2.6 m ceiling unless it is a blocker.
    const pose = followPose(head, 0, -0.7);
    const wanted = FOLLOW.defaultDistance;
    const distanceWith = (targets: THREE.Object3D[]) => {
      const ray = new THREE.Raycaster(pose.pivot, pose.back, 0, wanted + FOLLOW.clearance);
      return clampDistance(wanted, castAll(ray, targets)[0]?.distance ?? null);
    };
    const without = explorerTargets([floor], []);
    const withBlocker = explorerTargets([floor], [], [slab]);
    expect(pose.pivot.clone().addScaledVector(pose.back, distanceWith(without.camera)).y).toBeGreaterThan(2.6);
    const clamped = distanceWith(withBlocker.camera);
    expect(clamped).toBeLessThan(wanted);
    expect(pose.pivot.clone().addScaledVector(pose.back, clamped).y).toBeLessThan(2.6);
  });

  it("keep the camera below a low ceiling even at the steepest pitch", () => {
    // Feet at 0, ceiling at 2.0 m, pitch -1.1: the ceiling is ~0.4 m behind the pivot, inside the usual minimum.
    const slab = ceiling(2.0);
    const head = new THREE.Vector3(0, 1.6, 0);
    const pose = followPose(head, 0, -1.1);
    const t = explorerTargets([], [], [slab]);
    const hit = castAll(new THREE.Raycaster(pose.pivot, pose.back, 0, FOLLOW.defaultDistance + FOLLOW.clearance), t.camera)[0]!;
    expect(hit.distance).toBeLessThan(FOLLOW.minDistance + FOLLOW.clearance);
    const dist = clampDistance(FOLLOW.defaultDistance, hit.distance, t.blockers.has(hit.object));
    expect(pose.pivot.clone().addScaledVector(pose.back, dist).y).toBeLessThan(2.0);
    // Walls keep the usual minimum.
    expect(clampDistance(FOLLOW.defaultDistance, hit.distance, false)).toBe(FOLLOW.minDistance);
  });

  it("bound the camera even behind a nearer wall", () => {
    // Pitch -0.7, a wall 0.32 m behind the walker and a ceiling at 2.0 m: the wall is hit first, and its
    // usual minimum alone would hold the camera above the ceiling.
    const head = new THREE.Vector3(0, 1.6, 0);
    const pose = followPose(head, 0, -0.7);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.z = 0.32;
    wall.updateMatrixWorld(true);
    const slab = ceiling(2.0);
    const t = explorerTargets([], [wall], [slab]);
    const hits = castAll(new THREE.Raycaster(pose.pivot, pose.back, 0, FOLLOW.defaultDistance + FOLLOW.clearance), t.camera);
    expect(hits.map((h) => h.object)).toEqual([wall, slab]);
    const dist = followDistance(FOLLOW.defaultDistance, hits.map((h) => ({ distance: h.distance, cameraOnly: t.blockers.has(h.object) })));
    expect(pose.pivot.clone().addScaledVector(pose.back, dist).y).toBeLessThan(2.0);
    // Without a blocker the wall clamp is unchanged.
    expect(followDistance(FOLLOW.defaultDistance, [{ distance: hits[0]!.distance, cameraOnly: false }])).toBe(clampDistance(FOLLOW.defaultDistance, hits[0]!.distance));
    expect(followDistance(2, [])).toBe(2);
  });

  it("keep the smoothed camera below a ceiling while the walker turns (frame-stepped)", () => {
    // A 2.6 m slab over x ≥ 0 only; the walker stands at x = -0.1 looking down (-0.7) and turns 180° in 2 s.
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(Math.PI / 2).translate(20, 0, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    slab.position.y = 2.6;
    slab.updateMatrixWorld(true);
    const t = explorerTargets([], [], [slab]);
    const head = new THREE.Vector3(-0.1, 1.6, 0);
    const camera = followPose(head, Math.PI / 2, -0.7).pivot.clone().addScaledVector(followPose(head, Math.PI / 2, -0.7).back, FOLLOW.defaultDistance);
    const dt = 1 / 60;
    let crossed = 0;
    let crossedUnconstrained = 0;
    const loose = camera.clone();
    for (let frame = 0; frame <= 120; frame++) {
      const yaw = Math.PI / 2 - (Math.PI * frame) / 120;
      const pose = followPose(head, yaw, -0.7);
      const ray = new THREE.Raycaster(pose.pivot, pose.back, 0, FOLLOW.defaultDistance + FOLLOW.clearance);
      const hits = castAll(ray, t.camera).map((h) => ({ distance: h.distance, cameraOnly: t.blockers.has(h.object) }));
      const desired = pose.pivot.clone().addScaledVector(pose.back, followDistance(FOLLOW.defaultDistance, hits));
      const k = 1 - Math.exp(-dt * 10);
      camera.lerp(desired, k);
      loose.lerp(desired, k);
      keepBelowBlockers(pose.pivot, camera, [...t.blockers], FOLLOW.clearance);
      const through = (p: THREE.Vector3) => {
        const offset = p.clone().sub(pose.pivot);
        const r = new THREE.Raycaster(pose.pivot, offset.clone().normalize(), 0, offset.length());
        return castAll(r, [slab]).length > 0;
      };
      if (through(camera)) crossed++;
      if (through(loose)) crossedUnconstrained++;
    }
    expect(crossedUnconstrained).toBeGreaterThan(0);
    expect(crossed).toBe(0);
  });

  it("stay camera-only when nested inside a floor or wall group", () => {
    const tread = plane(0);
    const sign = ceiling(2.4);
    const floors = new THREE.Group().add(tread, sign);
    const pole = plane(1);
    const sign2 = ceiling(2.5);
    const walls = new THREE.Group().add(pole, sign2);
    const t = explorerTargets([floors], [walls], [sign, sign2]);
    expect(t.ground).toEqual([tread]);
    expect(t.collider).toEqual([pole]);
    expect(t.sky).not.toContain(sign);
    expect(t.sky).not.toContain(sign2);
    expect(t.camera).toEqual(expect.arrayContaining([tread, pole, sign, sign2]));
    expect([...t.blockers]).toEqual([sign, sign2]);
  });

  it("add to walls and floors for the camera only, and are tested once when also a wall", () => {
    const floor = plane(0);
    const wall = plane(1);
    const cap = ceiling(2.6);
    const sign = ceiling(2.2);
    const t = explorerTargets([floor], [wall, cap], [cap, sign]);
    expect(t.ground).toEqual([floor]);
    expect(t.collider).toEqual([wall, cap]);
    expect(t.sky).toEqual([wall, cap, floor]);
    expect(t.camera).toEqual([wall, cap, floor, sign]);
    expect(t.camera.filter((o) => o === cap)).toHaveLength(1);
  });

  it("never hide the sky for the street probe (a sign over an exit stair)", () => {
    const tread = plane(0);
    tread.updateMatrixWorld(true);
    const sign = ceiling(2.4);
    const t = explorerTargets([tread], [], [sign]);
    const up = new THREE.Raycaster(new THREE.Vector3(1.3, 1.6, 2.1), new THREE.Vector3(0, 1, 0), 0, 30);
    expect(castAll(up, t.sky)).toHaveLength(0);
    expect(castAll(up, t.camera)).toHaveLength(1);
  });

  it("are classified from GLB roles, hidden unless colliders are shown, and never collide in a collision asset", () => {
    const root = new THREE.Group();
    const slab = plane(2.6);
    slab.name = "camera_blocker_b1";
    const tagged = plane(2.7);
    tagged.userData = { gteki_role: " Camera_Blocker " };
    const ceilingNamed = plane(2.8);
    ceilingNamed.name = "ceiling";
    root.add(slab, tagged, ceilingNamed);
    const roles = sceneFromGlbRoles(root, { assetRole: "visual+collision" });
    expect(roles.cameraBlockers).toEqual([slab, tagged]);
    expect(roles.colliders).toEqual([ceilingNamed]);
    expect(slab.visible).toBe(false);
    expect(tagged.visible).toBe(false);
    const shown = plane(2.6);
    shown.name = "camera_blocker";
    sceneFromGlbRoles(new THREE.Group().add(shown), { showColliders: true });
    expect(shown.visible).toBe(true);
  });

  it("win over the sign role: a mesh that is both is a camera stop and is never dithered", () => {
    // A scene module lists a sign mesh as a camera blocker explicitly.
    const root = new THREE.Group();
    const signFace = ceiling(2.4);
    signFace.name = "sign_face";
    const plainSign = ceiling(2.3);
    plainSign.name = "sign_hanging";
    root.add(signFace, plainSign);
    const t = explorerTargets([], [], [signFace]);
    expect(seeThroughMeshes(root)).toEqual([signFace, plainSign]);
    const cut = cuttableSigns(seeThroughMeshes(root), [[], [], [signFace], t.camera]);
    expect(cut).toEqual([plainSign]);
    expect(t.camera).toContain(signFace);
    expect(t.camera).not.toContain(plainSign);
    expect(t.sky).not.toContain(signFace);
  });

  it("follow a mesh's own GLB role over an inherited one, so a sign is never classified as a blocker", () => {
    const root = new THREE.Group();
    const blockerGroup = new THREE.Group();
    blockerGroup.name = "camera_blocker_soffit";
    const signUnder = plane(2.4);
    signUnder.name = "sign_exit";
    const slabUnder = plane(2.6);
    blockerGroup.add(signUnder, slabUnder);
    const signGroup = new THREE.Group();
    signGroup.name = "signage";
    const capInSigns = plane(2.7);
    capInSigns.userData = { gteki_role: "camera_blocker" };
    signGroup.add(capInSigns);
    root.add(blockerGroup, signGroup);
    const roles = sceneFromGlbRoles(root);
    expect(roles.cameraBlockers).toEqual([slabUnder, capInSigns]);
    expect(seeThroughMeshes(root)).toEqual([signUnder]);
    expect(signUnder.visible).toBe(true);
  });

  it("hide only their own geometry, so a sign mesh below a blocker mesh stays drawn", () => {
    const material = new THREE.MeshBasicMaterial();
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
    slab.name = "camera_blocker_slab";
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    sign.name = "sign_exit";
    slab.add(sign);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
    leaf.name = "camera_blocker_leaf";
    const root = new THREE.Group().add(slab, leaf);
    const roles = sceneFromGlbRoles(root);
    expect(roles.cameraBlockers).toEqual([slab, leaf]);
    expect(seeThroughMeshes(root)).toEqual([sign]);
    expect(slab.visible).toBe(true);
    expect((slab.material as THREE.Material).visible).toBe(false);
    // The shared material is copied, never changed, so the sign still draws.
    expect(material.visible).toBe(true);
    expect(sign.visible && (sign.material as THREE.Material).visible).toBe(true);
    expect(leaf.visible).toBe(false);
    // A hidden blocker still stops the camera.
    root.updateMatrixWorld(true);
    const t = explorerTargets([], [], roles.cameraBlockers);
    expect(castAll(new THREE.Raycaster(new THREE.Vector3(0.5, 0.5, 3), new THREE.Vector3(0, 0, -1)), t.camera)[0]?.object).toBe(slab);
  });

  it("stop the camera from below a one-sided ceiling whose normals face up, from a GLB role or a scene module", () => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
    const upward = () => {
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), material);
      slab.position.y = 2.6;
      slab.updateMatrixWorld(true);
      return slab;
    };
    const up = () => new THREE.Raycaster(new THREE.Vector3(1.3, 1.6, 2.1), new THREE.Vector3(0, 1, 0), 0, 5);
    const glb = upward();
    glb.name = "camera_blocker_up";
    const roles = sceneFromGlbRoles(new THREE.Group().add(glb));
    const direct = upward();
    const wallOnly = upward();
    for (const blockers of [roles.cameraBlockers, [direct]]) {
      const t = explorerTargets([], [wallOnly], blockers);
      // A one-sided wall is still tested as authored; only blockers are two-sided.
      expect(castAll(up(), [wallOnly])).toHaveLength(0);
      expect(castCamera(up(), t.camera, t.blockers).map((h) => h.object)).toEqual([blockers[0]]);
      expect(keepBelowBlockers(new THREE.Vector3(1.3, 1.6, 2.1), new THREE.Vector3(1.3, 4, 2.1), [...t.blockers], FOLLOW.clearance).y).toBeLessThan(2.6);
    }
    // Materials are never changed.
    expect([glb.material, direct.material]).toEqual([material, material]);
    expect(material.side).toBe(THREE.FrontSide);
  });

  it("keep a multi-primitive GLB node's role on its generated primitive meshes (as Godot's one node)", async () => {
    // One triangle buffer shared by two primitives; mesh resources named like other roles.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const mesh = (name: string) => ({ name, primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 } }] });
    const json = {
      asset: { version: "2.0" },
      scene: 0,
      // A second, disjoint scene: GLTFLoader prunes its associations per scene, the flag must not depend on them.
      scenes: [{ nodes: [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 16] }, { nodes: [3] }],
      nodes: [
        { name: "slab", mesh: 0, extras: { gteki_role: "camera_blocker" } },
        { name: "panel", mesh: 1 },
        { name: "single", mesh: 2 },
        { name: "other_scene", mesh: 1 },
        // One primitive, but a camera / light attachment makes GLTFLoader wrap the mesh in the node's Group.
        { name: "lit_slab", mesh: 3, camera: 0, extras: { gteki_role: "camera_blocker" } },
        { name: "lamp_slab", mesh: 3, extensions: { KHR_lights_punctual: { light: 0 } }, extras: { gteki_role: "camera_blocker" } },
        // A plain single-primitive node keeps its own name and extras.
        { name: "floor_plain", mesh: 3 },
        // An unnamed single-primitive node under a blocker never takes a role from its mesh resource's name.
        { name: "camera_blocker_parent", children: [8] },
        { mesh: 3 },
        // Mesh-level extras never give a role (as in Godot); a node's own extras do.
        { name: "deck", mesh: 4 },
        { mesh: 4, extras: { gteki_role: "camera_blocker" } },
        // Unnamed camera / light nodes take no role from their resources' names or extras.
        { name: "camera_blocker_canopy", children: [12, 14] },
        { camera: 1, children: [13] },
        { name: "canopy_deck", mesh: 4 },
        { extensions: { KHR_lights_punctual: { light: 1 } }, children: [15] },
        { name: "lamp_deck", mesh: 4 },
        // GLTFLoader sanitises this name to "camera_blocker_slab"; only the authored name counts (as in Godot).
        { name: "camera blocker slab", mesh: 4 },
      ],
      cameras: [{ type: "perspective", perspective: { yfov: 1, znear: 0.1 } }, { name: "sign_camera", type: "perspective", perspective: { yfov: 1, znear: 0.1 }, extras: { gteki_role: "floor" } }],
      extensionsUsed: ["KHR_lights_punctual"],
      extensions: { KHR_lights_punctual: { lights: [{ type: "point" }, { name: "sign_lamp", type: "point" }] } },
      meshes: [mesh("sign_panel"), mesh("floor_panel"), { name: "floor_single", primitives: [{ attributes: { POSITION: 0 } }] }, { name: "sign_one", primitives: [{ attributes: { POSITION: 0 } }] }, { name: "board", extras: { gteki_role: "floor" }, primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: positions.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 0, 1] }],
    };
    const gltf = await new GLTFLoader().register(glbPrimitivePlugin).parseAsync(glb(json, positions), "");
    expect(gltf.scenes).toHaveLength(2);
    // Load once, place a clone (the documented scene-module workflow): the clone keeps the protection.
    for (const scene of [gltf.scene, gltf.scene.clone()]) {
      const parts = scene.getObjectByName("slab")!.children;
      expect(parts.map((o) => o.name)).toEqual(["sign_panel", "sign_panel_1"]);
      const wrapped = ["lit_slab", "lamp_slab"].map((name) => scene.getObjectByName(name)!.children.find((o) => (o as THREE.Mesh).isMesh)!);
      // Named after the mesh resource ("sign_one…"), not the node.
      expect(wrapped.every((o) => o.name.startsWith("sign_one"))).toBe(true);
      const plain = scene.getObjectByName("floor_plain")!;
      expect((plain as THREE.Mesh).isMesh).toBe(true);
      const unnamed = scene.getObjectByName("camera_blocker_parent")!.children[0]!;
      expect(unnamed.name.startsWith("sign_one")).toBe(true);
      const deck = scene.getObjectByName("deck")!;
      const taggedNode = scene.children.find((o) => o !== deck && (o as THREE.Mesh).isMesh && o.userData.gteki_role === "camera_blocker")!;
      const canopy = ["canopy_deck", "lamp_deck"].map((name) => scene.getObjectByName(name)!);
      const roles = sceneFromGlbRoles(scene);
      expect(roles.cameraBlockers).toEqual([...parts, ...wrapped, unnamed, taggedNode, ...canopy]);
      expect(roles.walkable).toEqual([plain]);
      expect(scene.getObjectByName("camera_blocker_slab")!.visible).toBe(true);
      expect(seeThroughMeshes(scene)).toEqual([]);
    }
    expect(sceneFromGlbRoles(gltf.scenes[1]!).walkable).toEqual([]);
    const node = (name: string) => gltf.scene.getObjectByName(name)!;
    // An untagged node never takes a role from its mesh resource's name ("floor_panel" under "panel").
    expect(sceneFromGlbRoles(node("panel")).walkable).toEqual([]);
    // A single-primitive mesh is the node itself and keeps its node name ("single", no role).
    expect(node("single").type).toBe("Mesh");
  });

  it("hide only their own geometry when a light hangs below them", () => {
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial());
    slab.name = "camera_blocker_lit";
    const lamp = new THREE.PointLight();
    slab.add(lamp);
    sceneFromGlbRoles(new THREE.Group().add(slab));
    expect(slab.visible).toBe(true);
    expect((slab.material as THREE.Material).visible).toBe(false);
    expect(lamp.visible).toBe(true);
  });
});

