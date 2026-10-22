import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StreetBackdrop, atStreetTop, STREET_RESCAN_S, STREET_SURFACE_FLAG, collectStreetSurfaces, footingLevel, isOutdoors, roleOf, stationDrawsGround } from "./streetBackdrop.ts";

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

describe("pavement plane yields to the station's street surfaces", () => {
  const flagged = <T extends THREE.Object3D>(o: T): T => {
    o.userData[STREET_SURFACE_FLAG] = true;
    return o;
  };
  const walker = new THREE.Vector3(0, 32.65, 0);
  const setup = () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const root = new THREE.Group();
    const b = new StreetBackdrop();
    const ground = () => b.group.getObjectByName("street-backdrop-ground")!;
    // One frame outdoors on level street; `dt` is the backdrop's clock (the re-scan period counts it).
    const frame = (dt = 1 / 60, teleport = false) => b.update(scene, camera, walker, true, dt, true, teleport);
    return { root, b, ground, frame };
  };

  it("collects flagged groups and meshes; names and roles alone never count", () => {
    const root = new THREE.Group();
    expect(collectStreetSurfaces(root)).toEqual([]);
    expect(collectStreetSurfaces(null)).toEqual([]);
    const named = new THREE.Group();
    named.name = "street-context";
    const role = new THREE.Mesh();
    role.userData.gteki_role = "context";
    const group = flagged(new THREE.Group());
    const inside = flagged(new THREE.Mesh());
    group.add(inside);
    const nestedHolder = new THREE.Group();
    const nested = flagged(new THREE.Mesh());
    nestedHolder.add(nested);
    const wrong = new THREE.Group();
    wrong.userData[STREET_SURFACE_FLAG] = "yes"; // only a literal true counts
    root.add(named, role, group, nestedHolder, wrong);
    const found = collectStreetSurfaces(root);
    expect(found).toHaveLength(2);
    expect(found).toContain(group);
    expect(found).toContain(nested);
    expect(found).not.toContain(inside); // covered by its flagged parent
  });

  it("counts only objects attached under the root with every ancestor visible", () => {
    const root = new THREE.Group();
    const holder = new THREE.Group();
    const surface = flagged(new THREE.Group());
    holder.add(surface);
    root.add(holder);
    const found = collectStreetSurfaces(root);
    expect(stationDrawsGround([], root)).toBe(false);
    expect(stationDrawsGround(found, root)).toBe(true);
    expect(stationDrawsGround(found, null)).toBe(false);
    surface.visible = false;
    expect(stationDrawsGround(found, root)).toBe(false);
    surface.visible = true;
    holder.visible = false; // invisible ancestor
    expect(stationDrawsGround(found, root)).toBe(false);
    holder.visible = true;
    root.visible = false;
    expect(stationDrawsGround(found, root)).toBe(false);
    root.visible = true;
    root.remove(holder); // detached but visible: nothing is drawn
    expect(surface.visible).toBe(true);
    expect(stationDrawsGround(found, root)).toBe(false);
  });

  it("hides the plane while a surface shows, and brings it back when it is hidden", () => {
    const { root, b, ground, frame } = setup();
    const surface = flagged(new THREE.Group());
    root.add(surface);
    b.attach(new THREE.Group());
    frame(1 / 60, true);
    expect(ground().visible).toBe(true); // no station surface: the plane shows
    b.attach(root); // scanned at attach
    frame();
    expect(ground().visible).toBe(false);
    expect(b.group.visible).toBe(true); // sky and haze carry on
    expect(b.opacity).toBeGreaterThan(0);
    surface.visible = false;
    frame();
    expect(ground().visible).toBe(true);
    b.dispose();
  });

  it("picks up a surface added after attach on the next re-scan, and drops it the same frame when removed", () => {
    const { root, b, ground, frame } = setup();
    b.attach(root);
    for (let i = 0; i < 120; i++) frame();
    expect(ground().visible).toBe(true);
    const surface = flagged(new THREE.Group());
    root.add(surface); // e.g. an async GLB arriving
    frame(1 / 60); // not due yet
    expect(ground().visible).toBe(true);
    frame(STREET_RESCAN_S); // due
    expect(ground().visible).toBe(false);
    root.remove(surface); // removal needs no re-scan
    frame(1 / 60);
    expect(ground().visible).toBe(true);
    root.add(surface); // a cached object that comes back is seen the same frame
    frame(1 / 60);
    expect(ground().visible).toBe(false);
    b.dispose();
  });

  it("is not fooled by a detached visible object or an unflagged buildings-only group, and sees a nested flagged mesh", () => {
    const { root, b, ground, frame } = setup();
    const detached = flagged(new THREE.Group());
    const buildings = new THREE.Group();
    buildings.name = "street-context";
    buildings.userData.gteki_role = "context";
    buildings.add(new THREE.Mesh());
    root.add(buildings);
    b.attach(root);
    frame(STREET_RESCAN_S);
    expect(detached.visible).toBe(true);
    expect(ground().visible).toBe(true);
    const deep = new THREE.Group();
    const mesh = flagged(new THREE.Mesh());
    deep.add(mesh);
    buildings.add(deep);
    frame(STREET_RESCAN_S);
    expect(ground().visible).toBe(false); // a nested flagged mesh counts, even under an unflagged group
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
