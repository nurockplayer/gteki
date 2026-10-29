import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { buildGreybox, createGreyboxBuilder, greyboxTriangleLimit, simplifyGreyboxRun, splitWallsAtOpenings, unmodelledRunsByEdge } from "./greybox.ts";
import { MODE_WIDTH } from "./graphView.ts";
import { resolveWalls } from "./walker.ts";

const bundle = {
  floors: [{ id: "f", renderElevationM: 0 }],
  nodes: [{ id: "a", floorId: "f", position: { x: 0, y: 0, z: 0 } }, { id: "b", floorId: "f", position: { x: 10, y: 0, z: 0 } }],
  edges: [{ id: "e", from: "a", to: "b", mode: "walk" }],
} as unknown as StationBundle;

describe("unmodelledRunsByEdge", () => {
  it("detects a floorless run and extends it into the adjacent samples", () => {
    const runs = unmodelledRunsByEdge(bundle, () => true, (p) => p.x <= 2 || p.x >= 6);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.points[0]!.x).toBe(2);
    expect(runs[0]!.points.at(-1)!.x).toBe(6);
    expect(unmodelledRunsByEdge(bundle, () => false, () => false)).toEqual([]);
  });

  it("finds a floorless span on a short edge even when its endpoints and midpoint have floor", () => {
    const short = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 4, y: 0, z: 0 } }] };
    const runs = unmodelledRunsByEdge(short, () => true, (p) => p.x < 0.25 || p.x > 1.75);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.points[0]!.x).toBe(0);
    expect(runs[0]!.points.at(-1)!.x).toBe(2);
  });

  it("finds a 1.5 m floorless middle on a 4 m edge", () => {
    const short = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 4, y: 0, z: 0 } }] };
    expect(unmodelledRunsByEdge(short, () => true, (p) => p.x < 1.25 || p.x > 2.75)).toHaveLength(1);
  });

  it("keeps a 1.2 m gap that only two 0.5 m samples fall in", () => {
    const short = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 4, y: 0, z: 0 } }] };
    expect(unmodelledRunsByEdge(short, () => true, (p) => p.x < 1.4 || p.x > 2.6)).toHaveLength(1);
  });

  it("forces a sceneGap edge to be unmodelled", () => {
    const forced = { ...bundle, edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    expect(unmodelledRunsByEdge(forced, () => true, () => true)[0]!.points.at(-1)!.x).toBe(10);
  });

  it("keeps a short forced edge and extends by arc length across short segments", () => {
    const short = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 0.4, y: 0, z: 0 } }], edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    expect(unmodelledRunsByEdge(short, () => true, () => true)).toHaveLength(1);
    const bent = { ...bundle, edges: [{ ...bundle.edges[0]!, geometry: Array.from({ length: 51 }, (_, i) => ({ x: i * 0.2, y: 0, z: 0 })) }] };
    const run = unmodelledRunsByEdge(bent, () => true, (p) => p.x < 2 || p.x > 4)[0]!;
    expect(run.points[0]!.x).toBeCloseTo(1.5);
    expect(run.points.at(-1)!.x).toBeCloseTo(4.5);
  });

  it("extends half a metre along a slope", () => {
    const slope = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 10, y: 0, z: 10 } }] };
    const bare: { x: number; y: number; z: number }[] = [];
    const runs = unmodelledRunsByEdge(slope, () => true, (p) => {
      const missing = p.x >= 2 && p.x <= 4;
      if (missing) bare.push(p);
      return !missing;
    });
    const first = runs[0]!.points[0]!;
    expect(Math.hypot(first.x - bare[0]!.x, first.y - bare[0]!.y, first.z - bare[0]!.z)).toBeCloseTo(0.5);
  });
});

describe("buildGreybox", () => {
  const emptyScene = { colliderNear: () => false, wallHit: () => null };
  it("uses the triangle limit for each tier", () => {
    expect(greyboxTriangleLimit("high")).toBe(150000);
    expect(greyboxTriangleLimit("low")).toBe(100000);
  });
  it("uses the mode width fallback and self-lit shell", () => {
    const result = buildGreybox(bundle, () => true, () => false, emptyScene, "high");
    const shell = result.root.getObjectByName("greybox-shell") as THREE.Mesh;
    shell.geometry.computeBoundingBox();
    expect(shell.geometry.boundingBox!.max.z - shell.geometry.boundingBox!.min.z).toBeCloseTo(MODE_WIDTH.walk!);
    const mat = shell.material as THREE.MeshLambertMaterial;
    expect(mat.side).toBe(THREE.DoubleSide);
    const position = shell.geometry.getAttribute("position"), normal = shell.geometry.getAttribute("normal");
    expect(Array.from({ length: position.count }, (_, i) => i).some((i) => Math.abs(position.getY(i) - 2.6) < 0.001 && normal.getY(i) < -0.9)).toBe(true);
    expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(0.35);
    expect(mat.emissive.r).toBeCloseTo(mat.color.r);
    const colors = shell.geometry.getAttribute("color");
    expect(Array.from({ length: colors.count }, (_, i) => colors.getX(i)).some((value) => value < 0.7)).toBe(true);
    expect(Array.from({ length: colors.count }, (_, i) => colors.getX(i)).some((value) => value > 0.95)).toBe(true);
    expect(shell.userData).toMatchObject({ greybox: true, approximate: true });
    expect(result.walkable).toContain(shell);
    expect(result.colliders).toContain(shell);
  });

  it("uses an explicit positive width", () => {
    const wide = { ...bundle, edges: [{ ...bundle.edges[0]!, attributes: { width: { m: 4 } } }] } as unknown as StationBundle;
    const result = buildGreybox(wide, () => true, () => false, emptyScene, "high");
    const shell = result.root.getObjectByName("greybox-shell") as THREE.Mesh;
    shell.geometry.computeBoundingBox();
    expect(shell.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(4);
  });

  it("makes a junction patch and keeps wall segments out of its disc", () => {
    const junction = { ...bundle, nodes: [...bundle.nodes, { ...bundle.nodes[1]!, id: "c", position: { x: 10, y: 10, z: 0 } }], edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "e2", from: "b", to: "c" }] };
    const result = buildGreybox(junction, () => true, () => false, emptyScene, "high");
    expect(result.stats.runs).toBe(2);
    for (const wall of result.wallSegments) {
      const mid = new THREE.Vector2((wall.ax + wall.bx) / 2 - 10, (wall.az + wall.bz) / 2);
      expect(mid.length()).toBeGreaterThanOrEqual(MODE_WIDTH.walk! / 2 - 1e-5);
    }
    const shell = result.root.getObjectByName("greybox-shell") as THREE.Mesh;
    result.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10.5, 1, 0.5), new THREE.Vector3(0, -1, 0), 0, 2);
    expect(ray.intersectObject(shell).some((hit) => Math.abs(hit.point.y) < 0.001)).toBe(true);
  });

  it("skips walls close to a collider", () => {
    const ordinary = buildGreybox(bundle, () => true, () => false, emptyScene, "high");
    const blocked = buildGreybox(bundle, () => true, () => false, { ...emptyScene, colliderNear: () => true }, "high");
    expect(ordinary.wallSegments.length).toBeGreaterThan(0);
    expect(blocked.wallSegments).toHaveLength(0);
  });

  it("omits only the two-metre wall piece next to a collider", () => {
    const long = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 40, y: 0, z: 0 } }] };
    const result = buildGreybox(long, () => true, () => false, { ...emptyScene, colliderNear: (p) => Math.abs(p.x - 19) < 0.01 }, "high");
    for (const sign of [-1, 1]) {
      const walls = result.wallSegments.filter((wall) => Math.sign(wall.az) === sign);
      expect(walls).toHaveLength(19);
      expect(walls.reduce((length, wall) => length + Math.hypot(wall.bx - wall.ax, wall.bz - wall.az), 0)).toBeCloseTo(38);
    }
  });

  it("uses local wall heights on a rising ramp", () => {
    const ramp = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 10, y: 0, z: 2 } }], edges: [{ ...bundle.edges[0]!, mode: "ramp" as const }] };
    const result = buildGreybox(ramp, () => true, () => false, emptyScene, "high");
    const high = result.wallSegments.find((w) => w.ax >= 8 && w.az > 0)!;
    expect(high.yMin).toBeGreaterThan(1.4);
    const under = resolveWalls((high.ax + high.bx) / 2, high.az - 0.05, 0.3, -1, 1.8, result.wallSegments);
    expect(under.z).toBeCloseTo(high.az - 0.05);
    const atFloor = resolveWalls((high.ax + high.bx) / 2, high.az - 0.05, 0.3, 1.7, 1.8, result.wallSegments);
    expect(atFloor.z).not.toBeCloseTo(high.az - 0.05);
  });

  it("fills the outside corner of a bend inside one edge", () => {
    const bent = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 5, y: 10, z: 0 } }], edges: [{ ...bundle.edges[0]!, geometry: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 10, z: 0 }] }] };
    const result = buildGreybox(bent, () => true, () => false, emptyScene, "high");
    result.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(5.5, 1, 0.5), new THREE.Vector3(0, -1, 0), 0, 2);
    expect(ray.intersectObjects(result.walkable, false).some((hit) => Math.abs(hit.point.y) < 0.001)).toBe(true);
  });

  it("builds a short sceneGap passage even above modelled floor", () => {
    const forced = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 0.4, y: 0, z: 0 } }], edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    const result = buildGreybox(forced, () => true, () => true, emptyScene, "high");
    expect(result.stats.runs).toBe(1);
    expect(result.walkable).toHaveLength(1);
  });

  it("creates a portal and splits the scene wall at its opening", () => {
    const result = buildGreybox(bundle, () => true, (p) => p.x <= 2 || p.x >= 6, {
      colliderNear: () => false,
      wallHit: (a, b) => a.x < 2.5 && b.x >= 2.5 ? { x: 2.25, y: 0, z: 0 } : null,
    }, "high");
    expect(result.stats.portals).toBe(1);
    expect(result.stats.meshes).toBeLessThanOrEqual(3);
    expect(result.root.getObjectByName("greybox-portal")).toBeTruthy();
    expect(result.openings[0]!.width).toBeCloseTo(MODE_WIDTH.walk!);
    const wall = { ax: 2.25, az: -3, bx: 2.25, bz: 3, yMin: 0, yMax: 3 };
    const split = splitWallsAtOpenings([wall], result.openings);
    expect(resolveWalls(2.25, 0, 0.2, 0, 1.8, split).x).toBeCloseTo(2.25);
    expect(Math.abs(resolveWalls(2.25, 2.3, 0.2, 0, 1.8, split).x - 2.25)).toBeGreaterThan(0.1);
  });

  it("preserves the entire floor and walls of a long straight passage", () => {
    const long = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 2000, y: 0, z: 0 } }] };
    const result = buildGreybox(long, () => true, () => false, emptyScene, "low");
    expect(result.stats.triangles).toBeLessThan(1000);
    result.root.updateMatrixWorld(true);
    for (const x of [0.25, 1000.25, 1999.75]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, 0), new THREE.Vector3(0, -1, 0), 0, 2);
      expect(ray.intersectObjects(result.walkable, false).some((hit) => Math.abs(hit.point.y) < 0.001)).toBe(true);
    }
    expect(result.wallSegments.some((wall) => Math.max(wall.ax, wall.bx) >= 1999.5)).toBe(true);
  });

  it("simplifies a sampled straight 100 m run to one segment", () => {
    const points = Array.from({ length: 201 }, (_, i) => ({ x: i / 2, y: 0, z: 0 }));
    expect(simplifyGreyboxRun(points)).toEqual([points[0], points.at(-1)]);
  });

  it("deduplicates identical corridors and clips partially overlapping corridors", () => {
    const duplicate = { ...bundle, edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "duplicate" }] };
    const result = buildGreybox(duplicate, () => true, () => false, emptyScene, "high");
    expect(result.stats.runs).toBe(1);
    expect(result.stats.lengthM).toBeCloseTo(10);
    const partial = { ...duplicate, nodes: [...bundle.nodes, { ...bundle.nodes[1]!, id: "c", position: { x: 15, y: 0, z: 0 } }], edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "partial", from: "b", to: "c", geometry: [{ x: 5, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }] }] };
    // The second edge starts at its from-node, so set that node at 5 m.
    partial.nodes = [bundle.nodes[0]!, bundle.nodes[1]!, { ...bundle.nodes[0]!, id: "d", position: { x: 5, y: 0, z: 0 } }, partial.nodes[2]!];
    partial.edges[1] = { ...partial.edges[1]!, from: "d" };
    expect(buildGreybox(partial, () => true, () => false, emptyScene, "high").stats.lengthM).toBeCloseTo(15);
  });

  it("retains the wider passage when a narrow edge appears first", () => {
    const wide = { ...bundle, edges: [
      { ...bundle.edges[0]!, id: "narrow", attributes: { width: { m: 2 } } },
      { ...bundle.edges[0]!, id: "wide", attributes: { width: { m: 4 } } },
    ] } as unknown as StationBundle;
    const result = buildGreybox(wide, () => true, () => false, emptyScene, "high");
    const shell = result.root.getObjectByName("greybox-shell") as THREE.Mesh;
    shell.geometry.computeBoundingBox();
    expect(shell.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(4);
  });

  it("deduplicates diagonal runs without merging corridors on another level", () => {
    const diagonal = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 10, y: 10, z: 0 } },
      { ...bundle.nodes[0]!, id: "upper-a", position: { x: 0, y: 0, z: 4 } },
      { ...bundle.nodes[1]!, id: "upper-b", position: { x: 10, y: 10, z: 4 } }],
      edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "reverse", from: "b", to: "a" }, { ...bundle.edges[0]!, id: "upper", from: "upper-a", to: "upper-b" }] };
    const result = buildGreybox(diagonal, () => true, () => false, emptyScene, "high");
    expect(result.stats.runs).toBe(2);
    expect(result.stats.lengthM).toBeCloseTo(20 * Math.SQRT2);
  });

  it("builds 16 km of overlapping passages on five floors within budget", () => {
    const floors = Array.from({ length: 5 }, (_, i) => ({ ...bundle.floors[0]!, id: `f${i}`, renderElevationM: i * 4 }));
    const nodes = floors.flatMap((floor, i) => [
      { ...bundle.nodes[0]!, id: `a${i}`, floorId: floor.id, position: { x: 0, y: 0, z: i * 4 } },
      { ...bundle.nodes[1]!, id: `b${i}`, floorId: floor.id, position: { x: 200, y: 0, z: i * 4 } },
    ]);
    const edges = floors.flatMap((_floor, i) => Array.from({ length: 16 }, (_, k) => ({ ...bundle.edges[0]!, id: `e${i}-${k}`, from: `a${i}`, to: `b${i}`, attributes: { sceneGap: true } })));
    const result = buildGreybox({ ...bundle, floors, nodes, edges }, () => true, () => false, emptyScene, "low");
    expect(result.stats.triangles).toBeLessThanOrEqual(60000);
    expect(result.stats.buildMs).toBeLessThanOrEqual(300);
    expect(result.stats.lengthM).toBeCloseTo(1000);
  });

  it("keeps a 400 m two-floor synthetic network within the mesh and triangle budget", () => {
    const network = { ...bundle, floors: [bundle.floors[0]!, { ...bundle.floors[0]!, id: "f2", renderElevationM: 4 }], nodes: [
      { ...bundle.nodes[0]!, position: { x: 0, y: 0, z: 0 } }, { ...bundle.nodes[1]!, position: { x: 200, y: 0, z: 0 } },
      { ...bundle.nodes[0]!, id: "c", floorId: "f2", position: { x: 0, y: 10, z: 4 } }, { ...bundle.nodes[1]!, id: "d", floorId: "f2", position: { x: 200, y: 10, z: 4 } },
    ], edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "e2", from: "c", to: "d" }] };
    const high = buildGreybox(network, () => true, () => false, emptyScene, "high");
    const low = buildGreybox(network, () => true, () => false, emptyScene, "low");
    expect(high.stats.meshes).toBeLessThanOrEqual(6);
    expect(low.stats.meshes).toBeLessThanOrEqual(3);
    expect(high.stats.triangles).toBeLessThanOrEqual(60000);
    expect(low.stats.triangles).toBeLessThanOrEqual(60000);
    expect(high.stats.lengthM).toBeCloseTo(400);
    const bytes = high.root.children.reduce((total, object) => {
      const geometry = (object as THREE.Mesh).geometry;
      return total + Object.values(geometry.attributes).reduce((sum, attr) => sum + (attr as THREE.BufferAttribute).array.byteLength, 0);
    }, 0);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it("keeps a longer network and five floors within the station budgets", () => {
    const floors = Array.from({ length: 5 }, (_, i) => ({ ...bundle.floors[0]!, id: `floor-${i}`, renderElevationM: i * 4 }));
    const nodes = floors.flatMap((floor, i) => [
      { ...bundle.nodes[0]!, id: `a-${i}`, floorId: floor.id, position: { x: 0, y: i * 10, z: i * 4 } },
      { ...bundle.nodes[1]!, id: `b-${i}`, floorId: floor.id, position: { x: 160, y: i * 10, z: i * 4 } },
    ]);
    const edges = floors.map((_floor, i) => ({ ...bundle.edges[0]!, id: `edge-${i}`, from: `a-${i}`, to: `b-${i}` }));
    const result = buildGreybox({ ...bundle, floors, nodes, edges }, () => true, () => false, emptyScene, "high");
    let bytes = 0;
    result.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      bytes += Object.values(mesh.geometry.attributes).reduce((sum, attr) => sum + (attr as THREE.BufferAttribute).array.byteLength, 0);
      bytes += mesh.geometry.index?.array.byteLength ?? 0;
    });
    expect(result.stats.meshes).toBeLessThanOrEqual(12);
    expect(result.stats.triangles).toBeLessThanOrEqual(60000);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });
});


describe("incremental floor-run discovery", () => {
  const scene = { colliderNear: () => false, wallHit: () => null };
  const sample = { ...bundle,
    nodes: [...bundle.nodes, { ...bundle.nodes[0]!, id: "c", position: { x: 100, y: 0, z: 0 } }, { ...bundle.nodes[1]!, id: "d", position: { x: 110, y: 0, z: 0 } }],
    edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "other", from: "c", to: "d" }],
  };
  it("matches the one-shot geometry when all edges have been discovered", () => {
    const builder = createGreyboxBuilder(sample, () => true, () => false, scene, "high");
    while (!builder.done) builder.probeStep(10);
    const incremental = builder.emit(), full = buildGreybox(sample, () => true, () => false, scene, "high");
    expect(incremental.stats.triangles).toBe(full.stats.triangles);
    expect(incremental.openings).toHaveLength(full.openings.length);
    expect(new THREE.Box3().setFromObject(incremental.root)).toEqual(new THREE.Box3().setFromObject(full.root));
  });
  it("keeps floor discovery within a generous per-step bound", () => {
    const many = { ...sample, edges: Array.from({ length: 200 }, (_, i) => ({ ...sample.edges[0]!, id: `copy-${i}` })) };
    const builder = createGreyboxBuilder(many, () => true, () => false, scene, "high");
    while (!builder.done) {
      const start = performance.now();
      builder.probeStep(6);
      expect(performance.now() - start).toBeLessThan(24);
    }
  });
  it("discovers edges intersecting the requested route bounds", () => {
    const builder = createGreyboxBuilder(sample, () => true, () => false, scene, "high");
    expect(builder.ensure(new THREE.Box3(new THREE.Vector3(99, -1, -1), new THREE.Vector3(111, 1, 1)))).toBe(true);
    expect(builder.runs.map((run) => run.edge.id)).toEqual(["other"]);
    expect(builder.ensure(new THREE.Box3(new THREE.Vector3(99, -1, -1), new THREE.Vector3(111, 1, 1)))).toBe(false);
    expect(builder.done).toBe(false);
  });
});
