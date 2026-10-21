import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreetBackdrop, atStreetTop, footingLevel, isOutdoors, roleOf } from "./streetBackdrop.ts";

describe("street backdrop", () => {
  it("is outdoors only with a street floor, open sky and a walker near street height", () => {
    expect(isOutdoors(31.3, 32.5, false)).toBe(true);
    expect(isOutdoors(31.3, 32.5, true)).toBe(false); // under a canopy or ceiling
    expect(isOutdoors(27.9, 32.5, false)).toBe(false); // deep open stairwell
    expect(isOutdoors(31.3, null, false)).toBe(false); // no street floor
  });

  it("blends the station fog to haze outdoors and restores the exact fog object underground", () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x1b1915, 25, 180);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera();
    const b = new StreetBackdrop();
    for (let i = 0; i < 120; i++) b.update(scene, camera, new THREE.Vector3(0, 32, 0), true, 1 / 60);
    expect(b.active).toBe(true);
    expect(scene.fog).not.toBe(fog);
    expect((scene.fog as THREE.Fog).far).toBeGreaterThan(200);
    expect(b.group.visible).toBe(true);
    for (let i = 0; i < 240; i++) b.update(scene, camera, new THREE.Vector3(0, 28, 0), false, 1 / 60);
    expect(scene.fog).toBe(fog);
    expect(fog.near).toBe(25);
    expect(b.group.visible).toBe(false);
    b.dispose();
  });
});

describe("level footing", () => {
  it("is level on flat floor and not on a stair, a ramp or a tilted face", () => {
    expect(footingLevel("floor", 1, false)).toBe(true);
    expect(footingLevel("stairs_ramps", 1, true)).toBe(false);
    expect(footingLevel("floor", 0.95, true)).toBe(false);
    expect(footingLevel("stairs_ramps_2", 1, true)).toBe(false);
    expect(footingLevel("Escalator", 1, true)).toBe(false);
  });

  it("keeps the previous answer on crack bridges and when the ground ray misses", () => {
    expect(footingLevel("walk_bridges", 1, false)).toBe(false);
    expect(footingLevel("walk_bridges", 1, true)).toBe(true);
    expect(footingLevel("floor", null, false)).toBe(false);
  });

  it("finds the role on the mesh or its nearest tagged ancestor", () => {
    const parent = new THREE.Group();
    parent.userData.gteki_role = "stairs_ramps";
    const mesh = new THREE.Mesh();
    parent.add(mesh);
    expect(roleOf(mesh)).toBe("stairs_ramps");
    mesh.name = "Mesh001"; // an arbitrary name never masks an inherited tag
    expect(roleOf(mesh)).toBe("stairs_ramps");
    mesh.userData.gteki_role = "floor";
    expect(roleOf(mesh)).toBe("floor");
  });
});

describe("street tops", () => {
  const tops = [new THREE.Vector3(10, 33.17, -4)];
  it("counts the exit's street-level node as level ground, not the flight below it", () => {
    expect(atStreetTop(new THREE.Vector3(10.5, 33.17, -3), tops)).toBe(true);
    expect(atStreetTop(new THREE.Vector3(10.3, 32.93, -3.3), tops)).toBe(false); // last tread but one
    expect(atStreetTop(new THREE.Vector3(10.3, 32.93, -3.3), tops, true)).toBe(true); // level floor there would count
    expect(atStreetTop(new THREE.Vector3(10, 32.5, -2.5), tops)).toBe(false);
    expect(atStreetTop(new THREE.Vector3(14, 33.17, -4), tops)).toBe(false);
  });
  it("accepts level floor at street height nearby, never an open landing lower down", () => {
    expect(atStreetTop(new THREE.Vector3(30, 33.2, -4), tops, true)).toBe(true);
    expect(atStreetTop(new THREE.Vector3(12, 30.59, -4), tops, true)).toBe(false);
  });
});
