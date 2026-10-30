import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { Edge } from "@gteki/schema";
import { cutStairwells, stairwellWells } from "./stairwellCut.ts";
import { resolveWalls } from "./walker.ts";

const bundle = (mode: Edge["mode"] = "stairs") => createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode, lengthM: 10.77 })]);
const flight = (geometry: { x: number; y: number; z: number }[]) =>
  createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode: "stairs", lengthM: 10.77, geometry })]);
/** A flight whose geometry ends at `end` (the upper node), so a landing can follow the top of the flight. */
const landed = (geometry: { x: number; y: number; z: number }[], end = { x: 12, y: 0, z: 4 }) => {
  const built = createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode: "stairs", lengthM: 12, geometry })]);
  return { ...built, nodes: built.nodes.map((node) => node.id === "upper" ? { ...node, position: end } : node) };
};
/** A flight of the given rise: the upper node sits at `rise` metres (node heights win over floor elevations). */
const lowBundle = (rise: number) => {
  const built = createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode: "stairs", lengthM: 10.77 })]);
  return { ...built, nodes: built.nodes.map((node) => node.id === "upper" ? { ...node, position: { x: 10, y: 0, z: rise } } : node) };
};
const traversable = () => true;

/** Two floors 4 m apart with a ceiling slab, an upper slab and a straight flight under x 0→10. */
function scene() {
  const root = new THREE.Group();
  const material = () => new THREE.MeshBasicMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), material()); floor.position.set(5, -0.1, 0); floor.name = "floor";
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), material()); ceiling.position.set(5, 2.7, 0); ceiling.name = "ceiling";
  // A real slab: the walking top face at 4.0 m and its underside at 3.6 m.
  const upper = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 6), material()); upper.position.set(5, 3.8, 0); upper.name = "upper-floor";
  root.add(floor, ceiling, upper); root.updateMatrixWorld(true);
  return { root, floor, ceiling, upper };
}

const up = (mesh: THREE.Object3D, x: number, y: number, z = 0) =>
  new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0), 0, 2.1).intersectObject(mesh, true);
const down = (mesh: THREE.Object3D, x: number, y: number, z = 0) =>
  new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh, true);

const cut = (opts: Partial<Parameters<typeof cutStairwells>[2]> = {}) => {
  const s = scene();
  const originals = { floor: s.floor.geometry, ceiling: s.ceiling.geometry, upper: s.upper.geometry };
  const wells = stairwellWells(bundle(), traversable);
  return { ...s, originals, wells, result: cutStairwells(s.root, wells, { tier: "high", ...opts }) };
};

describe("stairwell cuts", () => {
  it("cuts the slabs in the footprint's headroom band and leaves the landings and the surroundings", () => {
    const { root, floor, ceiling, upper, originals, result } = cut();
    expect(result.stats.wells).toBe(1);
    expect(result.stats.cutTriangles).toBeGreaterThan(0);
    expect(ceiling.geometry).not.toBe(originals.ceiling);
    expect(upper.geometry).not.toBe(originals.upper);
    expect(floor.geometry).toBe(originals.floor);
    // Slabs are cut where they are more than 0.3 m above the flight.
    expect(up(root, 3, 1.2)).toHaveLength(0);
    // A face outside the footprint stays solid, and both landings keep their walking surface.
    expect(up(root, 5, 1, 2.5).length).toBeGreaterThan(0);
    expect(down(root, 5, 1).some((hit) => Math.abs(hit.point.y) < 1e-6)).toBe(true);
    // Both faces of the upper slab are gone over the flight, in render and collision alike.
    expect(down(root, 5, 5).filter((hit) => hit.point.y > 3.5)).toHaveLength(0);
    expect(up(ceiling, 5, 2)).toHaveLength(0);
    expect(up(upper, 5, 2)).toHaveLength(0);
    // Beyond the top step the landing is untouched: its top face and underside are both there.
    expect(down(root, 12, 5).some((hit) => Math.abs(hit.point.y - 4) < 1e-6)).toBe(true);
    expect(up(root, 12, 3).some((hit) => Math.abs(hit.point.y - 3.6) < 1e-6)).toBe(true);
    result.dispose();
  });

  it("cuts a shared mesh on the CPU and never with a clipping plane", () => {
    const s = scene();
    const geometry = s.ceiling.geometry, material = s.ceiling.material as THREE.Material;
    const other = new THREE.Mesh(geometry, material); other.position.set(50, 2.7, 0);
    s.root.add(other); s.root.updateMatrixWorld(true);
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(result.stats.cutMeshes).toBe(2);
    expect(s.ceiling.geometry).not.toBe(geometry);
    expect(other.geometry).toBe(geometry);
    expect(material.clippingPlanes).toBeNull();
    expect(result.resources.clippedMeshes).toHaveLength(0);
    result.dispose();
  });

  it("reports a mesh over the vertex limit as skipped instead of cutting it", () => {
    const s = scene();
    const original = s.ceiling.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high", vertexLimit: 10 });
    expect(result.stats.cutTriangles).toBe(0);
    expect(result.stats.skippedMeshes).toBeGreaterThan(0);
    expect(result.skipped.some((entry) => entry.startsWith("ceiling"))).toBe(true);
    expect(s.ceiling.geometry).toBe(original);
    result.dispose();
  });

  it("rails the open sides of the upper well and leaves the arrival side open", () => {
    const { result } = cut();
    expect(result.walls).toHaveLength(3);
    expect(result.stats.railM).toBeCloseTo(10 + 10 + 2.2, 5);
    const feet = 4, body = 1.7;
    // A body reaching the rail line from the upper floor is pushed back out of the well.
    expect(resolveWalls(5, 1.2, 0.3, feet, body, result.walls).z).toBeCloseTo(1.4);
    // Walking off the top of the flight onto the floor is free: no rail on the arrival side.
    expect(resolveWalls(9.95, 0, 0.3, feet, body, result.walls).x).toBeCloseTo(9.95);
    // Below the upper floor there is no rail.
    expect(resolveWalls(5, 1.2, 0.3, 0, body, result.walls).z).toBeCloseTo(1.2);
    expect(result.finishTriangles + result.bandTriangles).toBeLessThan(2000);
    result.dispose();
  });

  it("merges the well edge into the greybox shell instead of adding a mesh", () => {
    const s = scene();
    const shellGeometry = new THREE.BufferGeometry();
    shellGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    shellGeometry.setAttribute("color", new THREE.Uint8BufferAttribute([255, 255, 255, 255, 255, 255, 255, 255, 255], 3, true));
    shellGeometry.setAttribute("normal", new THREE.Int8BufferAttribute([0, 0, 127, 0, 0, 127, 0, 0, 127], 3, true));
    const shell = new THREE.Mesh(shellGeometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    shell.name = "greybox-shell";
    const greyboxRoot = new THREE.Group(); greyboxRoot.add(shell);
    const before = shellGeometry.getAttribute("position").count;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high", greyboxRoot });
    expect(result.bandTriangles).toBeGreaterThan(0);
    expect(shellGeometry.getAttribute("position").count).toBe(before + result.bandTriangles * 3);
    expect(greyboxRoot.children).toHaveLength(1);
    expect(result.finish?.children.map((child) => child.name)).not.toContain("greybox-stairwell-band");
    result.dispose();
  });

  it("cuts the slab over an intermediate landing in an L stair", () => {
    const landing = flight([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 3, z: 2 }, { x: 10, y: 3, z: 4 }]);
    const wells = stairwellWells(landing, traversable);
    expect(wells).toHaveLength(1);
    expect(wells[0]!.rects).toHaveLength(3);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "high" });
    expect(up(s.ceiling, 4, 2, -1.5)).toHaveLength(0);
    expect(down(s.upper, 4, 5, -1.5)).toHaveLength(0);
    result.dispose();
  });

  it("preserves modelled treads while cutting the slab above them", () => {
    const s = scene();
    const treads: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 1), new THREE.MeshBasicMaterial());
      tread.position.set(i + 0.5, 0.4 * (i + 0.5) - 0.02, 0);
      s.root.add(tread); treads.push(tread);
    }
    s.root.updateMatrixWorld(true);
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "low" });
    for (let i = 0; i < treads.length; i++) {
      expect(down(treads[i]!, i + 0.5, 5).some(hit => Math.abs(hit.point.y - 0.4 * (i + 0.5)) < 1e-5)).toBe(true);
    }
    expect(down(s.upper, 3, 5).filter(hit => hit.point.y > 3.5)).toHaveLength(0);
    result.dispose();
  });

  it("rails the outer sides of both opened pieces and puts every rail in collision", () => {
    const split = flight([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 2 }, { x: 10, y: 0, z: 4 }]);
    const s = scene();
    const result = cutStairwells(s.root, stairwellWells(split, traversable), { tier: "low" });
    expect(result.walls).toHaveLength(5);
    expect(result.stats.railM).toBeCloseTo(22.2, 5);
    expect(result.walls.every(w => w.yMin === 4 && w.yMax === 5.1)).toBe(true);
    const rails = result.finish!.children.filter(child => child.name === "greybox-stairwell-rail");
    expect(rails).toHaveLength(1);
    expect(result.colliders).toContain(rails[0]);
    expect(resolveWalls(2, 1.2, 0.3, 4, 1.7, result.walls).z).toBeCloseTo(1.4);
    expect(resolveWalls(7, 1.2, 0.3, 4, 1.7, result.walls).z).toBeCloseTo(1.4);
    expect(resolveWalls(5, 0, 0.3, 4, 1.7, result.walls).x).toBeCloseTo(5);
    result.dispose();
  });

  it("leaves no edge band on the seam between two pieces of one flight", () => {
    const split = flight([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 2 }, { x: 10, y: 0, z: 4 }]);
    const wells = stairwellWells(split, traversable);
    expect(wells[0]!.rects).toHaveLength(2);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "high" });
    const band = result.finish!.getObjectByName("greybox-stairwell-band") as THREE.Mesh;
    const positions = band.geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i += 3) {
      expect([0, 1, 2].every(j => Math.abs(positions.getX(i + j) - 5) < 1e-6)).toBe(false);
    }
    result.dispose();
  });

  it("leaves no rail across the exit when the flight ends in a flat landing", () => {
    const withLanding = landed([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 4 }, { x: 12, y: 0, z: 4 }]);
    const wells = stairwellWells(withLanding, traversable);
    expect(wells).toHaveLength(1);
    expect(wells[0]!.rects).toHaveLength(1);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "low" });
    expect(result.walls).toHaveLength(3);
    expect(result.walls.some(w => Math.abs(w.ax - 10) < 1e-6 && Math.abs(w.bx - 10) < 1e-6)).toBe(false);
    // A walker along the centreline walks off the top unblocked, before and after the exit.
    for (const x of [9.5, 9.9, 10, 10.1, 10.5, 11.5]) expect(resolveWalls(x, 0, 0.3, 4, 1.7, result.walls).x).toBeCloseTo(x);
    result.dispose();
  });

  it("skips a connector whose top flight piece is too short for an arrival side", () => {
    // The last rising piece runs 0.3 m across the plan (from height 3.8 to 4.0), too short for a rectangle.
    const short = landed([{ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 3.8 }, { x: 9.3, y: 0, z: 4 }], { x: 9.3, y: 0, z: 4 });
    const wells = stairwellWells(short, traversable);
    expect(wells).toHaveLength(1);
    const s = scene();
    const ceilingOriginal = s.ceiling.geometry;
    const result = cutStairwells(s.root, wells, { tier: "high" });
    expect(result.stats.wells).toBe(0);
    expect(result.stats.skippedWells).toBe(1);
    expect(result.stats.cutTriangles).toBe(0);
    expect(result.walls).toHaveLength(0);
    expect(result.finish).toBeNull();
    expect(s.ceiling.geometry).toBe(ceilingOriginal);
    result.dispose();
  });

  it("cuts a collision proxy outside the root with the visible slab, and restores it on dispose", () => {
    const s = scene();
    const ceilingOriginal = s.ceiling.geometry;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), new THREE.MeshBasicMaterial());
    proxy.position.set(5, 2.7, 0); proxy.name = "ceiling-proxy"; proxy.updateMatrixWorld(true);
    const proxyOriginal = proxy.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high", collision: [proxy] });
    expect(proxy.geometry).not.toBe(proxyOriginal);
    expect(s.ceiling.geometry).not.toBe(ceilingOriginal);
    expect(up(proxy, 5, 2)).toHaveLength(0);
    expect(up(s.ceiling, 5, 2)).toHaveLength(0);
    result.dispose();
    expect(proxy.geometry).toBe(proxyOriginal);
  });

  it("removes both faces of an upper slab that runs past the footprint, the last 0.5 m included", () => {
    const s = scene();
    s.upper.userData.gteki_role = "floor";
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    for (const x of [7, 9.1, 9.6, 9.9]) {
      expect(down(s.root, x, 5).filter(hit => hit.point.y > 3.5)).toHaveLength(0);
      expect(down(s.upper, x, 5)).toHaveLength(0);
      expect(up(s.upper, x, 2)).toHaveLength(0);
    }
    // The slab past the footprint is still there.
    expect(down(s.root, 12, 5).some(hit => Math.abs(hit.point.y - 4) < 1e-6)).toBe(true);
    result.dispose();
  });

  it("keeps treads that lie entirely inside the footprint near the top", () => {
    const s = scene();
    const treads = [8, 9].map((i) => {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 1), new THREE.MeshBasicMaterial());
      tread.position.set(i + 0.5, 0.4 * (i + 0.5) - 0.02, 0);
      s.root.add(tread);
      return { i, tread, original: tread.geometry };
    });
    s.root.updateMatrixWorld(true);
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    for (const { i, tread, original } of treads) {
      expect(tread.geometry).toBe(original);
      expect(down(tread, i + 0.5, 5).some(hit => Math.abs(hit.point.y - 0.4 * (i + 0.5)) < 1e-5)).toBe(true);
    }
    result.dispose();
  });

  it("cuts a tessellated floor-role slab wholly inside the footprint over the last 0.5 m", () => {
    const s = scene();
    // At the upper floor's own level (4 m): a face on the walking surface itself (3.8 m here) is never cut.
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6, 8, 8).rotateX(-Math.PI / 2).translate(9.5, 4, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    slab.userData.gteki_role = "floor"; slab.name = "tessellated-floor";
    s.root.add(slab); s.root.updateMatrixWorld(true);
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(slab.geometry.getAttribute("position").count).toBe(0);
    expect(down(slab, 9.5, 5)).toHaveLength(0);
    expect(up(slab, 9.85, 2)).toHaveLength(0);
    result.dispose();
  });

  it("emits no band inside an L-shaped opening, and keeps bands on its outer edges", () => {
    const landing = flight([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 4, y: 3, z: 2 }, { x: 10, y: 3, z: 4 }]);
    const wells = stairwellWells(landing, traversable);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "high" });
    const band = result.finish!.getObjectByName("greybox-stairwell-band") as THREE.Mesh;
    const positions = band.geometry.getAttribute("position");
    const rects = wells[0]!.rects;
    // Strictly inside any piece of the opening (the boundary itself is allowed).
    const strictlyInside = (x: number, z: number) => rects.some((r) => {
      const d = (x - r.center.x) * r.along.x + (z - r.center.z) * r.along.z;
      const a = (x - r.center.x) * r.across.x + (z - r.center.z) * r.across.z;
      return Math.abs(d) < r.halfLength - 1e-3 && Math.abs(a) < r.halfWidth - 1e-3;
    });
    for (let i = 0; i < positions.count; i++) expect(strictlyInside(positions.getX(i), positions.getZ(i))).toBe(false);
    // The first flight's outer ends, on both long sides at x = 0, still carry bands.
    const vertex = (x: number, z: number) => { for (let i = 0; i < positions.count; i++) if (Math.abs(positions.getX(i) - x) < 1e-6 && Math.abs(positions.getZ(i) - z) < 1e-6) return true; return false; };
    expect(vertex(0, -1.1) && vertex(0, 1.1)).toBe(true);
    result.dispose();
  });

  it("cuts an unroled two-face slab that runs past the footprint, the last 0.5 m included", () => {
    const s = scene();
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    for (const x of [9.6, 9.9]) {
      expect(down(s.root, x, 5).filter(hit => hit.point.y > 3.5)).toHaveLength(0);
      expect(up(s.upper, x, 2)).toHaveLength(0);
    }
    result.dispose();
  });

  it("keeps an unroled stepped mesh with four tread levels inside the footprint, and an unroled plate inside it", () => {
    const s = scene();
    // Four horizontal quads at 3.40, 3.45, 3.50 and 3.55 m, all inside the footprint (x 9.1 to 9.9).
    const quads: number[] = [];
    [3.4, 3.45, 3.5, 3.55].forEach((y) => quads.push(9.1, y, -0.9, 9.9, y, -0.9, 9.9, y, 0.9, 9.1, y, -0.9, 9.9, y, 0.9, 9.1, y, 0.9));
    const stepsGeometry = new THREE.BufferGeometry();
    stepsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(quads, 3));
    const steps = new THREE.Mesh(stepsGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6, 4, 4).rotateX(-Math.PI / 2).translate(9.5, 3.6, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    s.root.add(steps, plate); s.root.updateMatrixWorld(true);
    const stepsOriginal = steps.geometry, plateOriginal = plate.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(steps.geometry).toBe(stepsOriginal);
    expect(plate.geometry).toBe(plateOriginal);
    result.dispose();
  });

  it("cuts a slab's modelled edge face inside the footprint, but keeps a wall rising above the slab", () => {
    const s = scene();
    const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
    const top = (x0: number, x1: number, y: number, z0: number, z1: number) => quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
    // A floor-role slab (3.6 to 4.0 m) with a lip inside the footprint at x = 9.5 and an end face beyond it at x = 11.
    const lip = quad([9.5, 3.6, -0.5], [9.5, 4.0, -0.5], [9.5, 4.0, 0.5], [9.5, 3.6, 0.5]);
    const end = quad([11, 3.6, -2], [11, 4.0, -2], [11, 4.0, 2], [11, 3.6, 2]);
    const slabGeometry = new THREE.BufferGeometry();
    slabGeometry.setAttribute("position", new THREE.Float32BufferAttribute([...top(-1, 11, 4, -2, 2), ...top(-1, 11, 3.6, -2, 2), ...lip, ...end], 3));
    const slab = new THREE.Mesh(slabGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    slab.userData.gteki_role = "floor";
    // A wall with no horizontal faces, rising from the slab's underside to 6 m, inside the footprint.
    const wall = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(9.5, 3.6, -0.5), new THREE.Vector3(9.5, 6, -0.5), new THREE.Vector3(9.5, 6, 0.5),
      new THREE.Vector3(9.5, 3.6, -0.5), new THREE.Vector3(9.5, 6, 0.5), new THREE.Vector3(9.5, 3.6, 0.5),
    ]), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    s.root.add(slab, wall); s.root.updateMatrixWorld(true);
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    // Horizontal ray from x = 7 at 3.8 m toward +x: the nearest hit is the end face at 11 m, not the lip at 9.5 m.
    const along = new THREE.Raycaster(new THREE.Vector3(7, 3.8, 0), new THREE.Vector3(1, 0, 0)).intersectObject(slab, true);
    expect(along[0]!.point.x).toBeCloseTo(11, 6);
    // The wall rises above the slab (its span 3.6 to 6 m is outside the slab levels), so it is kept.
    const beside = new THREE.Raycaster(new THREE.Vector3(7, 5, 0), new THREE.Vector3(1, 0, 0)).intersectObject(wall, true);
    expect(beside[0]!.point.x).toBeCloseTo(9.5, 6);
    result.dispose();
  });

  it("cuts a 1.2 m-rise flight under a floor slab", () => {
    const short = lowBundle(1.2);
    const wells = stairwellWells(short, traversable);
    expect(wells).toHaveLength(1);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 6), new THREE.MeshBasicMaterial());
    slab.position.set(5, 1.0, 0); slab.userData.gteki_role = "floor";
    const root = new THREE.Group(); root.add(slab); root.updateMatrixWorld(true);
    const original = slab.geometry;
    const result = cutStairwells(root, wells, { tier: "high" });
    expect(slab.geometry).not.toBe(original);
    expect(down(slab, 5, 5)).toHaveLength(0);
    expect(down(slab, 12.5, 5)[0]!.point.y).toBeCloseTo(1.2, 6);
    result.dispose();
  });

  it("changes nothing for a 1.2 m-rise flight with nothing above it, and adds no rail", () => {
    const wells = stairwellWells(lowBundle(1.2), traversable);
    expect(wells).toHaveLength(1);
    const s = scene();
    // Keep the floor and the upper slab (well above the headroom); drop the ceiling, which is within it.
    s.ceiling.removeFromParent();
    const floorOriginal = s.floor.geometry, upperOriginal = s.upper.geometry;
    const result = cutStairwells(s.root, wells, { tier: "high" });
    expect(s.floor.geometry).toBe(floorOriginal);
    expect(s.upper.geometry).toBe(upperOriginal);
    expect(result.stats.cutTriangles).toBe(0);
    expect(result.walls).toHaveLength(0);
    expect(result.finish).toBeNull();
    result.dispose();
  });

  it("keeps an intermediate landing 0.4 m below the upper floor, and still cuts the upper slab", () => {
    // Flight: up to a landing at 3.6 m (x 5 to 9), then a short last rise to the upper floor at 4 m.
    const stepped = flight([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 3.6 }, { x: 9, y: 0, z: 3.6 }, { x: 10, y: 0, z: 4 }]);
    const wells = stairwellWells(stepped, traversable);
    expect(wells[0]!.rects).toHaveLength(3);
    const s = scene();
    s.upper.userData.gteki_role = "floor";
    const landing = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6, 4, 2).rotateX(-Math.PI / 2).translate(7, 3.6, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    landing.userData.gteki_role = "floor";
    s.root.add(landing); s.root.updateMatrixWorld(true);
    const landingOriginal = landing.geometry;
    const result = cutStairwells(s.root, wells, { tier: "high" });
    expect(landing.geometry).toBe(landingOriginal);
    expect(down(s.upper, 9.5, 5).filter(hit => hit.point.y > 3.9)).toHaveLength(0);
    result.dispose();
  });

  it("cuts a downward-facing underside at the walking height, and keeps an upward landing there", () => {
    const s = scene();
    // Both at 3.8 m, inside the footprint, narrow in x so the walking surface stays within 5 cm of 3.8 m across them:
    // the landing faces up (kept); the underside faces down (cut).
    const landing = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.8, 1, 4).rotateX(-Math.PI / 2).translate(9.5, 3.8, 0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    landing.userData.gteki_role = "floor";
    const underside = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.8, 1, 4).rotateX(Math.PI / 2).translate(9.5, 3.8, -0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    underside.userData.gteki_role = "floor";
    s.root.add(landing, underside); s.root.updateMatrixWorld(true);
    const landingOriginal = landing.geometry, undersideOriginal = underside.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(landing.geometry).toBe(landingOriginal);
    expect(underside.geometry).not.toBe(undersideOriginal);
    result.dispose();
  });

  it("cuts both faces of a 1.0 m-thick floor slab that runs past the footprint, over the last 0.5 m", () => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(16, 1.0, 6), new THREE.MeshBasicMaterial());
    slab.position.set(5, 3.5, 0); slab.userData.gteki_role = "floor";
    const root = new THREE.Group(); root.add(slab); root.updateMatrixWorld(true);
    const result = cutStairwells(root, stairwellWells(bundle(), traversable), { tier: "high" });
    for (const x of [9.5, 9.9]) {
      expect(down(slab, x, 5).filter(hit => hit.point.y > 3.9)).toHaveLength(0);
      expect(up(slab, x, 2.0)).toHaveLength(0);
    }
    // Past the footprint the slab's top is still there.
    expect(down(slab, 12.5, 5)[0]!.point.y).toBeCloseTo(4, 6);
    result.dispose();
  });

  it("never cuts a stairs_ramps flight that passes above the footprint, but still cuts a ceiling there", () => {
    const s = scene();
    const flightAbove = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.8, 4, 4).rotateX(-Math.PI / 2).translate(2, 3, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    flightAbove.userData.gteki_role = "stairs_ramps";
    const ceilingAbove = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.8, 4, 4).rotateX(-Math.PI / 2).translate(7, 3, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    ceilingAbove.userData.gteki_role = "ceiling";
    s.root.add(flightAbove, ceilingAbove); s.root.updateMatrixWorld(true);
    const flightOriginal = flightAbove.geometry, ceilingOriginal = ceilingAbove.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    // Surface at x = 2 is 0.8 m; the flight at 3.0 m is well above the 0.3 m primary rule.
    expect(flightAbove.geometry).toBe(flightOriginal);
    expect(down(flightAbove, 2, 5).some(hit => Math.abs(hit.point.y - 3) < 1e-6)).toBe(true);
    expect(ceilingAbove.geometry).not.toBe(ceilingOriginal);
    result.dispose();
  });

  it("keeps a sloped ceiling 3.5 m above the walking surface, and cuts a ceiling only inside the 2.1 m headroom", () => {
    const s = scene();
    // Sloped with the flight from x = 2 to 10, always 3.5 m above the walking surface (y = 0.4 x).
    const sloped = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(2, 4.3, -0.9), new THREE.Vector3(10, 7.5, -0.9), new THREE.Vector3(10, 7.5, 0.9),
      new THREE.Vector3(2, 4.3, -0.9), new THREE.Vector3(10, 7.5, 0.9), new THREE.Vector3(2, 4.3, 0.9),
    ]), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    sloped.userData.gteki_role = "ceiling";
    // Flat at 2.6 m: above the headroom where the flight is low, under it where the flight has risen.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.8, 20, 2).rotateX(-Math.PI / 2).translate(5, 2.6, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    plate.userData.gteki_role = "ceiling";
    s.root.add(sloped, plate); s.root.updateMatrixWorld(true);
    const slopedOriginal = sloped.geometry, plateGeometry = plate.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(sloped.geometry).toBe(slopedOriginal);
    expect(down(sloped, 6, 9)[0]!.point.y).toBeCloseTo(0.4 * 6 + 3.5, 6);
    // Where the surface is at 1.2 m the plate is 1.4 m above it: cut. Where it is at 0.2 m it is 2.4 m above: kept.
    expect(down(plate, 3, 5)).toHaveLength(0);
    expect(down(plate, 0.5, 5)[0]!.point.y).toBeCloseTo(2.6, 6);
    expect(plate.geometry).not.toBe(plateGeometry);
    result.dispose();
  });

  it("cuts an unroled mesh's slab faces that run past the footprint, and keeps its tread levels inside", () => {
    const s = scene();
    const quad = (x0: number, x1: number, y: number, z0: number, z1: number) => [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
    // Slab: top at 4.0 and underside at 3.6 m, both running past the footprint on every side.
    // Treads: three levels (3.45, 3.50, 3.55 m) entirely inside it.
    const positions = [...quad(-1, 11, 4, -2, 2), ...quad(-1, 11, 3.6, -2, 2), ...quad(9.1, 9.9, 3.45, -0.5, 0.5), ...quad(9.1, 9.9, 3.5, -0.5, 0.5), ...quad(9.1, 9.9, 3.55, -0.5, 0.5)];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mixed = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    s.root.add(mixed); s.root.updateMatrixWorld(true);
    const original = mixed.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(mixed.geometry).not.toBe(original);
    // From above, the topmost face over the flight is the 3.55 m tread; the slab top is gone there.
    expect(down(mixed, 9.5, 5)[0]!.point.y).toBeCloseTo(3.55, 6);
    // From below, the lowest face is the 3.45 m tread: the slab underside is gone there.
    expect(up(mixed, 9.5, 3.0)[0]!.point.y).toBeCloseTo(3.45, 6);
    // Past the footprint the slab's top is untouched.
    expect(down(mixed, 10.5, 5)[0]!.point.y).toBeCloseTo(4, 6);
    result.dispose();
  });

  it("keeps a stairs_ramps tread and an unroled mesh wholly inside the footprint near the top", () => {
    const s = scene();
    const tread = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6, 8, 8).rotateX(-Math.PI / 2).translate(9.5, 3.7, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    tread.userData.gteki_role = "stairs_ramps";
    const unroled = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6, 8, 8).rotateX(-Math.PI / 2).translate(8.5, 3.4, 0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    s.root.add(tread, unroled); s.root.updateMatrixWorld(true);
    const treadOriginal = tread.geometry, unroledOriginal = unroled.geometry;
    const result = cutStairwells(s.root, stairwellWells(bundle(), traversable), { tier: "high" });
    expect(tread.geometry).toBe(treadOriginal);
    expect(unroled.geometry).toBe(unroledOriginal);
    expect(down(tread, 9.5, 5).some(hit => Math.abs(hit.point.y - 3.7) < 1e-6)).toBe(true);
    expect(down(unroled, 8.5, 5).some(hit => Math.abs(hit.point.y - 3.4) < 1e-6)).toBe(true);
    result.dispose();
  });

});
