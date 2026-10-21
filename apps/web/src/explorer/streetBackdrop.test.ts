import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreetBackdrop, isOutdoors, trackLevel } from "./streetBackdrop.ts";

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
  it("is false while climbing a stair and true after walking on flat ground", () => {
    const st = { anchor: new THREE.Vector3(0, 30, 0), level: false };
    // A stair: 0.3 m tread, 0.17 m riser.
    for (let i = 1; i <= 10; i++) st.level = trackLevel(st, new THREE.Vector3(0, 30 + i * 0.17, -i * 0.3));
    expect(st.level).toBe(false);
    for (let i = 1; i <= 10; i++) st.level = trackLevel(st, new THREE.Vector3(0, 31.7, -3 - i * 0.3));
    expect(st.level).toBe(true);
  });

  it("treats a teleport as landing on level ground", () => {
    const st = { anchor: new THREE.Vector3(0, 28, 0), level: false };
    expect(trackLevel(st, new THREE.Vector3(80, 32.5, 10))).toBe(true);
  });
});
