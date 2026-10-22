import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreetBackdrop, atStreetTop, collectStreetContext, footingLevel, isOutdoors, roleOf, stationDrawsGround } from "./streetBackdrop.ts";

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

  it("snaps to the target on a teleport instead of easing daylight underground", () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x1b1915, 25, 180);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera();
    const top = new THREE.Vector3(0, 32, 0);
    const under = new THREE.Vector3(0, 20, 0);
    const b = new StreetBackdrop();
    for (let i = 0; i < 120; i++) b.update(scene, camera, top, true, 1 / 60);
    expect(b.active).toBe(true);
    // Walking down eases: still daylight one frame later.
    b.update(scene, camera, under, false, 1 / 60);
    expect(b.active).toBe(true);
    expect(b.group.visible).toBe(true);
    // Back to full daylight, then teleport underground: hidden and fog restored on that very call.
    for (let i = 0; i < 120; i++) b.update(scene, camera, top, true, 1 / 60);
    b.update(scene, camera, under, false, 1 / 60, false, true);
    expect(b.active).toBe(false);
    expect(b.group.visible).toBe(false);
    expect(scene.fog).toBe(fog);
    // A snap to street level shows it fully at once.
    b.update(scene, camera, top, true, 1 / 60, true, true);
    expect(b.active).toBe(true);
    expect(b.group.visible).toBe(true);
    expect((scene.fog as THREE.Fog).far).toBe(240);
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

describe("pavement plane yields to the station's street context", () => {
  const ctxMesh = () => {
    const m = new THREE.Mesh();
    m.userData.gteki_role = "context";
    return m;
  };

  it("finds a street-context group, or loose context-role meshes, once at attach", () => {
    const root = new THREE.Group();
    expect(collectStreetContext(root)).toEqual([]);
    expect(collectStreetContext(null)).toEqual([]);
    const group = new THREE.Group();
    group.name = "street-context";
    const inside = ctxMesh();
    group.add(inside);
    const loose = ctxMesh();
    root.add(group, loose, new THREE.Mesh());
    const found = collectStreetContext(root);
    expect(found).toContain(group);
    expect(found).toContain(loose);
    expect(found).not.toContain(inside); // already covered by its group
    expect(found).toHaveLength(2);
  });

  it("is true only while a context object and all its ancestors are visible", () => {
    expect(stationDrawsGround([])).toBe(false);
    const root = new THREE.Group();
    const group = new THREE.Group();
    group.name = "street-context";
    root.add(group);
    const found = collectStreetContext(root);
    expect(stationDrawsGround(found)).toBe(true);
    group.visible = false;
    expect(stationDrawsGround(found)).toBe(false);
    group.visible = true;
    root.visible = false;
    expect(stationDrawsGround(found)).toBe(false);
  });

  it("hides the plane while the context shows, and brings it back when the context is hidden", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const walker = new THREE.Vector3(0, 32.65, 0);
    const root = new THREE.Group();
    const ctx = new THREE.Group();
    ctx.name = "street-context";
    root.add(ctx);
    const b = new StreetBackdrop();
    const ground = () => b.group.getObjectByName("street-backdrop-ground")!;
    // Without a station context the plane shows on level street.
    b.attach(new THREE.Group());
    b.update(scene, camera, walker, true, 1 / 60, true, true);
    expect(ground().visible).toBe(true);
    // With a visible context it stays hidden, while the sky and fade carry on.
    b.attach(root);
    b.update(scene, camera, walker, true, 1 / 60, true, true);
    expect(ground().visible).toBe(false);
    expect(b.group.visible).toBe(true);
    expect(b.opacity).toBe(1);
    // Hiding the context group returns the plane.
    ctx.visible = false;
    b.update(scene, camera, walker, true, 1 / 60, true, true);
    expect(ground().visible).toBe(true);
    b.dispose();
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
