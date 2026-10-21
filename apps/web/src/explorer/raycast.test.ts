import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneFromGlbRoles } from "@gteki/scene-api";
import { LightProbeGridHelperWebGL } from "three/addons/helpers/LightProbeGridHelperWebGL.js";
import { LightProbeGridWebGL } from "three/addons/lighting/LightProbeGridWebGL.js";
import { castAll, castTargets } from "./raycast.ts";

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
