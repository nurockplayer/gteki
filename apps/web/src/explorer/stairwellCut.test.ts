import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import type { Edge } from "@gteki/schema";
import { cutStairwells, stairwellWells } from "./stairwellCut.ts";
import { resolveWalls } from "./walker.ts";

const bundle = (mode: Edge["mode"] = "stairs") => createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode, lengthM: 10.77 })]);
const flight = (geometry: { x: number; y: number; z: number }[]) =>
  createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode: "stairs", lengthM: 10.77, geometry })]);
const traversable = () => true;

/** Two floors 4 m apart with a ceiling slab, an upper slab and a straight flight under x 0→10. */
function scene() {
  const root = new THREE.Group();
  const material = () => new THREE.MeshBasicMaterial();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), material()); floor.position.set(5, -0.1, 0); floor.name = "floor";
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), material()); ceiling.position.set(5, 2.7, 0); ceiling.name = "ceiling";
  const upper = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 6), material()); upper.position.set(5, 3.9, 0); upper.name = "upper-floor";
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
    // The flight's nosing line is clear for 2.1 m straight up.
    for (let x = 1; x <= 9; x += 1) expect(up(root, x, 0.4 * x)).toHaveLength(0);
    // A face outside the footprint stays solid, and both landings keep their walking surface.
    expect(up(root, 5, 1, 2.5).length).toBeGreaterThan(0);
    expect(down(root, 5, 1).some((hit) => Math.abs(hit.point.y) < 1e-6)).toBe(true);
    expect(down(root, 5, 5).some((hit) => Math.abs(hit.point.y - 4) < 1e-6)).toBe(true);
    // Collision is the same geometry: nothing left to hit up the well.
    expect(up(ceiling, 5, 2)).toHaveLength(0);
    expect(up(upper, 5, 2)).toHaveLength(0);
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

  it("keeps a flat landing piece closed and only cuts the flights either side", () => {
    // Bottom 0 → 4 flight to 2 m, a flat landing 4 → 7 at 2 m, then the flight 7 → 10 up to 4 m.
    const landing = flight([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 2 }, { x: 7, y: 0, z: 2 }, { x: 10, y: 0, z: 4 }]);
    const wells = stairwellWells(landing, traversable);
    expect(wells).toHaveLength(1);
    expect(wells[0]!.rects).toHaveLength(2);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "high" });
    // The slab over the landing stays solid; both flights are clear for 2.1 m.
    expect(up(s.root, 5.5, 2).length).toBeGreaterThan(0);
    expect(up(s.root, 2, 0.8)).toHaveLength(0);
    expect(up(s.root, 9, 3.2)).toHaveLength(0);
    result.dispose();
  });

  it("leaves no edge band on the seam between two pieces of one flight", () => {
    const split = flight([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 2 }, { x: 10, y: 0, z: 4 }]);
    const wells = stairwellWells(split, traversable);
    expect(wells[0]!.rects).toHaveLength(2);
    const s = scene();
    const result = cutStairwells(s.root, wells, { tier: "high" });
    // Two pieces, three open sides each (the shared side is skipped), three slab levels.
    expect(result.bandTriangles).toBe(2 * 3 * 3 * 2);
    result.dispose();
  });

  it("uses a 2.2 m square shaft plan for an elevator", () => {
    const wells = stairwellWells(bundle("elevator"), traversable);
    expect(wells).toHaveLength(1);
    expect(wells[0]!.rects).toHaveLength(1);
    expect(wells[0]!.rects[0]!.halfLength * 2).toBeCloseTo(2.2);
    expect(wells[0]!.rects[0]!.halfWidth * 2).toBeCloseTo(2.2);
  });
});
