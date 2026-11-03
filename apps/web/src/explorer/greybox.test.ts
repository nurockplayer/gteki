import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { WALKER_BODY } from "@gteki/scene-api";
import { buildGreybox, createGreyboxBuilder, emitGreybox, greyboxTriangleLimit, portalDepthAxis, portalWidthAxis, simplifyGreyboxRun, splitWallsAtOpenings, unmodelledRunsByEdge } from "./greybox.ts";
import { MODE_WIDTH } from "./graphView.ts";
import { resolveWalls } from "./walker.ts";

const bundle = {
  floors: [{ id: "f", renderElevationM: 0 }],
  nodes: [{ id: "a", floorId: "f", position: { x: 0, y: 0, z: 0 } }, { id: "b", floorId: "f", position: { x: 10, y: 0, z: 0 } }],
  edges: [{ id: "e", from: "a", to: "b", mode: "walk" }],
} as unknown as StationBundle;

/** A floor probe that finds floor only within 0.5 m of the given nodes (ENU), so landing pads are laid everywhere else. */
function floorOnlyAt(nodes: readonly { id: string; position: { x: number; y: number; z: number | null } }[], ids: readonly string[]) {
  const at = nodes.filter((n) => ids.includes(n.id));
  return (p: { x: number; y: number; z: number }) => at.some((n) => Math.hypot(p.x - n.position.x, p.y - n.position.y) < 0.5 && Math.abs(p.z - (n.position.z ?? 0)) < 0.5);
}

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

  it("yields the whole run of a skipped stairs edge, whatever its mode", () => {
    const stairs = { ...bundle, edges: [{ id: "s", from: "a", to: "b", mode: "stairs" }] } as unknown as StationBundle;
    const runs = unmodelledRunsByEdge(stairs, () => true, () => true, new Set(["s"]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.edge.id).toBe("s");
    expect(runs[0]!.points.at(-1)!.x).toBe(10);
    expect(unmodelledRunsByEdge(stairs, () => false, () => true, new Set(["s"]))).toEqual([]);
  });

  it("marks a skipped connector's run exactly as a sceneGap edge's", () => {
    const sceneGap = { ...bundle, edges: [{ ...bundle.edges[0]!, attributes: { sceneGap: true } }] };
    const skipped = unmodelledRunsByEdge(bundle, () => true, () => true, new Set(["e"]));
    expect(skipped).toHaveLength(1);
    expect(skipped.map((run) => run.points)).toEqual(unmodelledRunsByEdge(sceneGap, () => true, () => true).map((run) => run.points));
    expect(unmodelledRunsByEdge(bundle, () => true, () => true, new Set(["other"]))).toEqual([]);
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
  it("emits no wall piece without plan length where two stair cuts' bounds differ only by rounding", () => {
    // A flight whose both ends are on passages is cut from each end, in opposite directions: on a wall it crosses the
    // two cut grids can differ by rounding only, and the slivers between them made zero-length walls (found by a
    // random search over diagonal layouts; this is one of them).
    const station = {
      floors: [{ id: "f", renderElevationM: 0 }, { id: "g", renderElevationM: 4 }],
      nodes: [{ id: "a", floorId: "f", position: { x: -2.515371093766471, y: 4.158027066922758, z: 0 } }, { id: "b", floorId: "f", position: { x: -7.491887125499859, y: 11.096805121450734, z: 0 } },
        { id: "m", floorId: "f", position: { x: -5.369720649737605, y: 8.137859128676528, z: 0 } }, { id: "c", floorId: "g", position: { x: -11.767454803262858, y: 3.7334887520153144, z: 4 } },
        { id: "d", floorId: "g", position: { x: -11.767454803262858 + 6 * Math.cos(3.7445089313623328), y: 3.7334887520153144 + 6 * Math.sin(3.7445089313623328), z: 4 } }],
      edges: [{ id: "e1", from: "a", to: "m", mode: "walk" }, { id: "e2", from: "m", to: "b", mode: "walk" }, { id: "s", from: "m", to: "c", mode: "stairs" },
        { id: "up", from: "c", to: "d", mode: "walk" }, { id: "x", from: "a", to: "c", mode: "walk" }],
    } as unknown as StationBundle;
    for (const tier of ["high", "low"] as const) {
      const result = buildGreybox(station, () => true, () => false, emptyScene, tier);
      expect(result.wallSegments.length).toBeGreaterThan(0);
      expect(result.wallSegments.filter((w) => Math.hypot(w.bx - w.ax, w.bz - w.az) < 1e-3)).toEqual([]);
    }
  });
  it("builds a missing upper stair landing and captures its walkable floor", () => {
    const station = {
      ...bundle,
      floors:[{id:"lower",renderElevationM:0},{id:"upper",renderElevationM:4}],
      nodes:[{id:"low",floorId:"lower",position:{x:0,y:0,z:0}},{id:"high",floorId:"upper",position:{x:0,y:0,z:4}},{id:"walk",floorId:"upper",position:{x:2,y:0,z:4}}],
      edges:[{id:"stair",from:"low",to:"high",mode:"stairs"},{id:"path",from:"high",to:"walk",mode:"walk"}],
    } as unknown as StationBundle;
    const grey=buildGreybox(station,()=>true,p=>p.z<2 || (p.z>3 && p.x>=1.5),emptyScene,"low",true);
    expect(grey.stats.landingPads).toBe(1);
    // The explorer builds without nav capture: it must lay the same pad, or the baked navmesh walks a floor the scene lacks (#669 r1).
    const live=buildGreybox(station,()=>true,p=>p.z<2 || (p.z>3 && p.x>=1.5),emptyScene,"low");
    expect(live.stats.landingPads).toBe(1);
    expect(live.wallSegments).toEqual(grey.wallSegments);
    expect(grey.walkable.length).toBeGreaterThan(0);
    expect(grey.walkable[0]!.userData.greybox).toBe(true);
    const vertices=grey.navFloors!;
    expect(vertices.some((_v,i)=>i%3===1 && Math.abs(vertices[i]!-4)<1e-6)).toBe(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(0,5,0),new THREE.Vector3(0,-1,0));
    expect(ray.intersectObjects(grey.walkable).some(hit=>Math.abs(hit.point.y-4)<1e-6)).toBe(true);
    ray.ray.origin.x=1.25;
    expect(ray.intersectObjects(grey.walkable).some(hit=>Math.abs(hit.point.y-4)<1e-6)).toBe(true);
  });
  it("lays a landing pad beside the flight, never over it", () => {
    const station = {
      ...bundle,
      floors:[{id:"lower",renderElevationM:0},{id:"upper",renderElevationM:4}],
      nodes:[{id:"low",floorId:"lower",position:{x:0,y:0,z:0}},{id:"high",floorId:"upper",position:{x:4,y:0,z:4}},{id:"walk",floorId:"upper",position:{x:8,y:0,z:4}}],
      edges:[{id:"stair",from:"low",to:"high",mode:"stairs"},{id:"path",from:"high",to:"walk",mode:"walk"}],
    } as unknown as StationBundle;
    const grey=buildGreybox(station,()=>true,p=>p.z<2 || (p.z>3 && p.x>=7),emptyScene,"low",true);
    expect(grey.stats.landingPads).toBe(1);
    const ray=new THREE.Raycaster(new THREE.Vector3(2.5,10,0),new THREE.Vector3(0,-1,0));
    expect(ray.intersectObjects(grey.colliders).filter(hit=>hit.point.y>2)).toEqual([]);
    ray.ray.origin.x=4.5;
    expect(ray.intersectObjects(grey.walkable).some(hit=>Math.abs(hit.point.y-4)<1e-6)).toBe(true);
  });
  it("uses the triangle limit for each tier", () => {
    expect(greyboxTriangleLimit("high")).toBe(150000);
    expect(greyboxTriangleLimit("low")).toBe(100000);
  });
  it.each([false,true])("preserves the wider floor for overlapping passages (wide first: %s)", (wideFirst) => {
    const narrow={...bundle.edges[0]!,id:"narrow",mode:"gate" as const}, wide={...bundle.edges[0]!,id:"wide",mode:"walk" as const};
    const station={...bundle,edges:wideFirst ? [wide,narrow] : [narrow,wide]};
    const grey=buildGreybox(station,()=>true,()=>false,emptyScene,"low",true);
    const ray=new THREE.Raycaster(new THREE.Vector3(5,1,1.15),new THREE.Vector3(0,-1,0));
    expect(ray.intersectObjects(grey.walkable).some(hit=>Math.abs(hit.point.y)<1e-6)).toBe(true);
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

  it("opens only the wall a stair crosses at a run end", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 6, z: 4 } }];
    const stairs = { id: "s", from: "b", to: "c", mode: "stairs", attributes: { width: { m: 4 } } };
    // Floor at the stair's own ends, so no landing pad is laid there: this checks the passage wall opening only.
    const result = buildGreybox({ ...bundle, floors, nodes, edges: [bundle.edges[0]!, stairs] } as unknown as StationBundle, () => true, floorOnlyAt(nodes, ["b", "c"]), emptyScene, "high");
    const half = MODE_WIDTH.walk! / 2;
    const side = (z: number) => result.wallSegments.filter((w) => Math.abs(w.az - z) < 1e-6 && Math.abs(w.bz - z) < 1e-6);
    // North in the graph is -z in the renderer: the stair crosses the -z wall over its 4 m width.
    // Its floor is already beyond a step there, so a low guard remains below the flight body.
    expect(side(-half).length).toBeGreaterThan(0);
    expect(side(-half).filter((w) => w.yMax > 1.11).every((w) => Math.max(w.ax, w.bx) <= 8 + 1e-5)).toBe(true);
    // The other side wall still runs right up to the node, so nobody walks off the passage there.
    expect(Math.max(...side(half).map((w) => Math.max(w.ax, w.bx)))).toBeGreaterThan(10 - 1e-5);
  });

  it("opens the wall a stair crosses at a shallow angle from mid-passage", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [...bundle.nodes, { id: "d", floorId: "f", position: { x: 20, y: 0, z: 0 } }, { id: "c", floorId: "g", position: { x: 10 + 15 * Math.cos(Math.PI / 12), y: 15 * Math.sin(Math.PI / 12), z: 4 } }];
    const edges = [bundle.edges[0]!, { id: "e2", from: "b", to: "d", mode: "walk" }, { id: "s", from: "b", to: "c", mode: "stairs" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const half = MODE_WIDTH.walk! / 2;
    const near = result.wallSegments.filter((w) => Math.abs(w.az + half) < 1e-6 && Math.abs(w.bz + half) < 1e-6);
    expect(near.length).toBeGreaterThan(0);
    // The step-compatible start opens; further along a low guard stays below the flight body.
    expect(near.some((w) => Math.min(w.ax, w.bx) < 11 && Math.max(w.ax, w.bx) > 11)).toBe(false);
    expect(near.some((w) => Math.min(w.ax, w.bx) < 12.5 && Math.max(w.ax, w.bx) > 12.5 && w.yMax <= 1.11)).toBe(true);
    expect(near.some((w) => Math.max(w.ax, w.bx) > 15)).toBe(true);
  });

  it("guards a boundary the flight meets far from the mouth, and keeps other levels enclosed", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 8 }, { id: "h", renderElevationM: -6 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 16, z: 8 } },
      { id: "p", floorId: "f", position: { x: 0, y: 6, z: 1 } }, { id: "q", floorId: "f", position: { x: 20, y: 6, z: 1 } },
      { id: "r", floorId: "h", position: { x: 0, y: 3, z: -6 } }, { id: "t", floorId: "h", position: { x: 20, y: 3, z: -6 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }, { id: "rt", from: "r", to: "t", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const covers = (z: number, y: number) => result.wallSegments.some((w) => Math.abs(w.az - z) < 1e-6 && Math.min(w.ax, w.bx) < 10.3 && Math.max(w.ax, w.bx) > 10.3 && Math.abs(w.yMin - y) < 1.5);
    // The higher flight leaves a corridor guard below its body. The corridor 6 m below stays enclosed.
    expect(covers(-6 + MODE_WIDTH.walk! / 2, 1)).toBe(true);
    expect(covers(-3 + MODE_WIDTH.walk! / 2, -6)).toBe(true);
  });

  it("guards the corridor ledge inside a diagonal rising flight footprint", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 6 }];
    const nodes = [...bundle.nodes, { id: "d", floorId: "f", position: { x: 30, y: 0, z: 0 } }, { id: "c", floorId: "g", position: { x: 20, y: 1, z: 6 } }];
    const edges = [bundle.edges[0]!, { id: "e2", from: "b", to: "d", mode: "walk" }, { id: "s", from: "b", to: "c", mode: "stairs" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const north = result.wallSegments.filter((w) => Math.abs(w.az + MODE_WIDTH.walk! / 2) < 1e-6);
    const at = (x: number) => north.filter((w) => Math.min(w.ax, w.bx) <= x + 1e-6 && Math.max(w.ax, w.bx) >= x - 1e-6);
    // This is the inherited #694 fixture: the flight overlaps the corridor side at x = 13.6, over a step above it.
    for (const x of [13.6, 18]) {
      expect(at(x).some((w) => w.yMin <= 0 && w.yMax >= 1.09)).toBe(true);
      expect(at(x).every((w) => w.yMax <= 1.11)).toBe(true);
    }
    expect(resolveWalls(13.6, -MODE_WIDTH.walk! / 2, 0.3, 0, 1.7, north).z).not.toBeCloseTo(-MODE_WIDTH.walk! / 2);
  });

  it("guards a corridor beside a rising flight beyond a step and leaves the step-height attachment open", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 6 }];
    const nodes = [...bundle.nodes, { id: "d", floorId: "f", position: { x: 30, y: 0, z: 0 } }, { id: "c", floorId: "g", position: { x: 20, y: 0, z: 6 } }];
    const edges = [bundle.edges[0]!, { id: "e2", from: "b", to: "d", mode: "walk" }, { id: "s", from: "b", to: "c", mode: "stairs", attributes: { width: { m: MODE_WIDTH.walk! } } }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const north = result.wallSegments.filter((w) => Math.abs(w.az + MODE_WIDTH.walk! / 2) < 1e-6);
    const at = (x: number) => north.filter((w) => Math.min(w.ax, w.bx) <= x + 1e-6 && Math.max(w.ax, w.bx) >= x - 1e-6);
    // The flight's north side coincides with the corridor boundary at x = 10. Its rise is 0.6 m per metre.
    const stepEnd = 10 + WALKER_BODY.stepUpM / 0.6;
    expect(at(stepEnd - 0.01)).toHaveLength(0);
    for (const x of [stepEnd + 0.01, 11.5, 13.6]) {
      expect(at(x).some((w) => w.yMin <= 0 && w.yMax > WALKER_BODY.bodyBottomM)).toBe(true);
      expect(at(x).every((w) => w.yMax <= 1.11)).toBe(true);
    }
    expect(resolveWalls(11.5, -MODE_WIDTH.walk! / 2, 0.3, 0, 1.7, north).z).not.toBeCloseTo(-MODE_WIDTH.walk! / 2);
  });

  it("guards a corridor rising steeply beside a parallel flight without inverted collision bands", () => {
    const station = {
      floors: [{ id: "f", renderElevationM: 0 }, { id: "g", renderElevationM: 4 }],
      nodes: [{ id: "a", floorId: "f", position: { x: 0, y: 0, z: 0 } }, { id: "b", floorId: "f", position: { x: 10, y: 0, z: 12 } },
        { id: "c", floorId: "g", position: { x: 0, y: 1, z: 4 } }, { id: "d", floorId: "g", position: { x: 10, y: 1, z: 16 } }],
      edges: [{ id: "walk", from: "a", to: "b", mode: "walk", attributes: { width: { m: 2 } } },
        { id: "stairs", from: "c", to: "d", mode: "stairs", attributes: { width: { m: 2 } } }],
    } as unknown as StationBundle;
    const result = buildGreybox(station, () => true, () => false, emptyScene, "high");
    const side = result.wallSegments.filter((w) => Math.abs(w.az + 1) < 1e-6 && Math.abs(w.bz + 1) < 1e-6);
    expect(side.length).toBeGreaterThan(0);
    expect(side.every((w) => w.yMin <= w.yMax)).toBe(true);
    for (const x of [0.5, 1.5, 3.25, 5, 7.75, 9.5]) {
      expect(resolveWalls(x, -1, 0.3, 1.2 * x, WALKER_BODY.bodyTopM, side).z).not.toBeCloseTo(-1);
    }
  });

  it("keeps a corridor guard above the body of a flight descending beside it", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: -6 }];
    const nodes = [...bundle.nodes, { id: "d", floorId: "f", position: { x: 30, y: 0, z: 0 } }, { id: "c", floorId: "g", position: { x: 20, y: 0, z: -6 } }];
    const edges = [bundle.edges[0]!, { id: "e2", from: "b", to: "d", mode: "walk" }, { id: "s", from: "b", to: "c", mode: "stairs", attributes: { width: { m: MODE_WIDTH.walk! } } }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const x = 11; // The flight is 0.6 m below the corridor: its body reaches 1.1 m above the corridor.
    const north = result.wallSegments.filter((w) => Math.abs(w.az + MODE_WIDTH.walk! / 2) < 1e-6);
    const at = north.filter((w) => Math.min(w.ax, w.bx) <= x && Math.max(w.ax, w.bx) >= x);
    expect(at.some((w) => w.yMin < WALKER_BODY.bodyTopM && w.yMax > WALKER_BODY.bodyTopM)).toBe(true);
    expect(resolveWalls(x, -MODE_WIDTH.walk! / 2, 0.3, 0, WALKER_BODY.bodyTopM, north).z).not.toBeCloseTo(-MODE_WIDTH.walk! / 2);
    expect(resolveWalls(x, -MODE_WIDTH.walk! / 2, 0.3, -0.6, WALKER_BODY.bodyTopM, north).z).toBeCloseTo(-MODE_WIDTH.walk! / 2);
  });

  it("keeps the wall of a corridor a flight passes over, below the flight", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 8 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 8, z: 8 } },
      { id: "p", floorId: "f", position: { x: 0, y: 3.7, z: 0 } }, { id: "q", floorId: "f", position: { x: 20, y: 3.7, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    // The flight is 2.4 m up where it crosses the corridor's near wall, 2.4 m north: a walker in the corridor
    // still meets a guard, and nothing stands where a walker on the flight is.
    const at = result.wallSegments.filter((w) => Math.abs(w.az + 3.7 - MODE_WIDTH.walk! / 2) < 1e-6 && Math.min(w.ax, w.bx) < 10.3 && Math.max(w.ax, w.bx) > 10.3);
    expect(at.some((w) => w.yMin <= 0 && w.yMax >= 1.09)).toBe(true);
    expect(at.every((w) => w.yMax < 2.5 || w.yMin > 4.4)).toBe(true);
  });

  it("keeps the corridor wall under a flight whose both ends are junctions", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 8 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 8, z: 8 } }, { id: "d", floorId: "g", position: { x: 20, y: 8, z: 8 } }, { id: "e", floorId: "g", position: { x: 0, y: 8, z: 8 } },
      { id: "p", floorId: "f", position: { x: 0, y: 3.7, z: 0 } }, { id: "q", floorId: "f", position: { x: 20, y: 3.7, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }, { id: "cd", from: "c", to: "d", mode: "walk" }, { id: "ec", from: "e", to: "c", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const at = result.wallSegments.filter((w) => Math.abs(w.az + 3.7 - MODE_WIDTH.walk! / 2) < 1e-6 && Math.min(w.ax, w.bx) < 10.3 && Math.max(w.ax, w.bx) > 10.3);
    expect(at.some((w) => w.yMin <= 0 && w.yMax >= 1.09)).toBe(true);
    expect(at.every((w) => w.yMax < 2.5 || w.yMin > 4.4)).toBe(true);
  });

  it("leaves out an intermediate level's floor where it hangs 1.6 m over a corridor, and keeps the corridor", () => {
    const floors = [...bundle.floors, { id: "m", renderElevationM: 1.6, intermediate: true }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "m", position: { x: 5, y: -5, z: 1.6 } }, { id: "d", floorId: "m", position: { x: 5, y: 5, z: 1.6 } }];
    const edges = [bundle.edges[0]!, { id: "cd", from: "c", to: "d", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high", true);
    const half = MODE_WIDTH.walk! / 2, nav = result.navFloors!;
    const covered = (x: number, y: number, z: number) => {
      for (let i = 0; i < nav.length; i += 9) {
        if (![1, 4, 7].every((k) => Math.abs(nav[i + k]! - y) < 1e-6)) continue;
        const [ax, az, bx, bz, cx, cz] = [nav[i]!, nav[i + 2]!, nav[i + 3]!, nav[i + 5]!, nav[i + 6]!, nav[i + 8]!];
        const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax), d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx), d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true;
      }
      return false;
    };
    expect(covered(5, 0, 0)).toBe(true);
    expect(covered(5, 1.6, 0)).toBe(false);
    expect(covered(5, 1.6, -4)).toBe(true);
    expect(covered(5, 1.6, half + 0.1)).toBe(true);
    // Nothing of the upper level stands over the corridor below its 2.3 m headroom.
    const low = result.wallSegments.filter((w) => w.yMin < 2.3 && w.yMax > 1.5);
    expect(low.every((w) => Math.abs((w.az + w.bz) / 2) >= half - 1e-6 || (w.ax + w.bx) / 2 < 4 || (w.ax + w.bx) / 2 > 6)).toBe(true);
  });

  it("keeps a corridor wall that only runs along a stair's side line", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const half = MODE_WIDTH.walk! / 2, stairHalf = MODE_WIDTH.stairs! / 2;
    // A corridor whose north wall lies exactly on the stair's west side line, running north beside it.
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 6, z: 4 } },
      { id: "p", floorId: "f", position: { x: 10 - stairHalf - half, y: 1, z: 0 } }, { id: "q", floorId: "f", position: { x: 10 - stairHalf - half, y: 6, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const east = result.wallSegments.filter((w) => Math.abs(w.ax - (10 - stairHalf)) < 1e-6 && Math.abs(w.bx - (10 - stairHalf)) < 1e-6);
    const length = east.reduce((sum, w) => sum + Math.abs(w.bz - w.az), 0);
    // The stair footprint does not cut it down to about 2 m: only the part on the stair's own side line goes to the connector.
    expect(length).toBeGreaterThanOrEqual(4.5 - 1e-6);
  });

  it("keeps the wall a flight rising along it has not reached yet", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 6 }];
    const nodes = [...bundle.nodes, { id: "d", floorId: "f", position: { x: 30, y: 0, z: 0 } }, { id: "c", floorId: "g", position: { x: 20, y: 1, z: 6 } }];
    const edges = [bundle.edges[0]!, { id: "e2", from: "b", to: "d", mode: "walk" }, { id: "s", from: "b", to: "c", mode: "stairs" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const north = result.wallSegments.filter((w) => Math.abs(w.az + MODE_WIDTH.walk! / 2) < 1e-6);
    // Past x = 15 the flight is over 2 m up: the corridor below keeps its guard.
    expect(north.some((w) => Math.min(w.ax, w.bx) <= 16 && Math.max(w.ax, w.bx) >= 16 && w.yMin <= 0 && w.yMax >= 1.09)).toBe(true);
  });

  it("opens a near-parallel wall that crosses into the stair footprint", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const stairHalf = MODE_WIDTH.stairs! / 2, half = MODE_WIDTH.walk! / 2;
    // A corridor whose east wall starts on the stair's west side line and drifts 0.3 m into the footprint.
    const x0 = 10 - stairHalf - half;
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 6, z: 4 } },
      { id: "p", floorId: "f", position: { x: x0, y: 1, z: 0 } }, { id: "q", floorId: "f", position: { x: x0 + 0.3, y: 6, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, floorOnlyAt(nodes, ["b", "c"]), emptyScene, "high");
    // Near q the wall is inside the footprint at about 2.6 m up the flight: no full-height wall may stand there.
    const near = result.wallSegments.filter((w) => Math.max(w.az, w.bz) < -5 && Math.min(w.ax, w.bx) > 10 - stairHalf - 0.01 && Math.min(w.ax, w.bx) < 10 - stairHalf + 0.4);
    expect(near.every((w) => w.yMax < 2.9 + 0.5)).toBe(true);
  });

  it("keeps the wall between a flight passing below it and one passing above", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 8 }, { id: "h", renderElevationM: -4.4 }, { id: "k", renderElevationM: 3.6 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 8, z: 8 } },
      { id: "u0", floorId: "h", position: { x: 0, y: 0, z: -4.4 } }, { id: "u", floorId: "h", position: { x: 10, y: 0, z: -4.4 } }, { id: "w", floorId: "k", position: { x: 10, y: 8, z: 3.6 } },
      { id: "p", floorId: "f", position: { x: 0, y: 3.7, z: 0 } }, { id: "q", floorId: "f", position: { x: 20, y: 3.7, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "uu", from: "u0", to: "u", mode: "walk" }, { id: "t", from: "u", to: "w", mode: "stairs" },
      { id: "pq", from: "p", to: "q", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    // At the corridor's near wall (2.4 m north) one flight is 2.4 m above its base and the other 2 m below it: the
    // corridor guard between their body clearances stays.
    const at = result.wallSegments.filter((w) => Math.abs(w.az + 3.7 - MODE_WIDTH.walk! / 2) < 1e-6 && Math.min(w.ax, w.bx) < 10.3 && Math.max(w.ax, w.bx) > 10.3);
    expect(at.some((w) => w.yMin <= 0 && w.yMax >= 1.09)).toBe(true);
    expect(at.every((w) => w.yMax < 2.6)).toBe(true);
  });

  it("opens a stair mouth at the end of a long ramp", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 7 }];
    const ramp = [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 30, y: 0, z: 3 } }];
    const nodes = [...ramp, { id: "c", floorId: "g", position: { x: 30, y: 6, z: 7 } }];
    const edges = [{ ...bundle.edges[0]!, mode: "ramp" }, { id: "s", from: "b", to: "c", mode: "stairs" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const half = MODE_WIDTH.ramp! / 2, stairHalf = MODE_WIDTH.stairs! / 2;
    const near = result.wallSegments.filter((w) => Math.abs((w.az + w.bz) / 2 + half) < 1e-6);
    expect(near.length).toBeGreaterThan(0);
    expect(near.filter((w) => w.yMax > 4.2).every((w) => Math.max(w.ax, w.bx) <= 30 - stairHalf + 1e-5)).toBe(true);
    const stairY = 3 + 4 * half / 6;
    expect(resolveWalls(30, -half, 0.3, stairY, WALKER_BODY.bodyTopM, near).z).toBeCloseTo(-half);
  });

  it("opens a passing corridor's wall only inside the stair footprint", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 10, y: 6, z: 4 } }, { id: "p", floorId: "f", position: { x: 0, y: 2.7, z: 0 } }, { id: "q", floorId: "f", position: { x: 20, y: 2.7, z: 0 } }];
    const edges = [bundle.edges[0]!, { id: "s", from: "b", to: "c", mode: "stairs" }, { id: "pq", from: "p", to: "q", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const wallLengthNear = (z: number) => result.wallSegments.filter((w) => Math.abs((w.az + w.bz) / 2 - z) < 0.01 && w.yMax > 1.11).reduce((sum, w) => sum + Math.hypot(w.bx - w.ax, w.bz - w.az), 0);
    // The renderer frame mirrors north into -z; take whichever side the corridor's near wall lands on.
    // The full-height wall gives way to a low guard over the flight's 2 m width; the rest stays full-height.
    expect(Math.max(wallLengthNear(1.4), wallLengthNear(-1.4))).toBeGreaterThan(20 - MODE_WIDTH.stairs! - 1e-3);
    expect(Math.max(wallLengthNear(1.4), wallLengthNear(-1.4))).toBeLessThan(20 - MODE_WIDTH.stairs! + 1e-3);
  });

  it("makes a junction patch and keeps wall segments out of its disc", () => {
    const junction = { ...bundle, nodes: [...bundle.nodes, { ...bundle.nodes[1]!, id: "c", position: { x: 10, y: 10, z: 0 } }], edges: [bundle.edges[0]!, { ...bundle.edges[0]!, id: "e2", from: "b", to: "c" }] };
    const result = buildGreybox(junction, () => true, () => false, emptyScene, "high");
    expect(result.stats.runs).toBe(2);
    for (const wall of result.wallSegments) {
      const mid = new THREE.Vector2((wall.ax + wall.bx) / 2 - 10, (wall.az + wall.bz) / 2);
      // The disc is a 24-gon: a wall on its rim stands at least its apothem from the centre.
      expect(mid.length()).toBeGreaterThanOrEqual(MODE_WIDTH.walk! / 2 * Math.cos(Math.PI / 24) - 1e-5);
    }
    const shell = result.root.getObjectByName("greybox-shell") as THREE.Mesh;
    result.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(10.5, 1, 0.5), new THREE.Vector3(0, -1, 0), 0, 2);
    expect(ray.intersectObject(shell).some((hit) => Math.abs(hit.point.y) < 0.001)).toBe(true);
  });

  it("drops end walls where the scene's floor already reaches past them, and ignores colliders", () => {
    const ordinary = buildGreybox(bundle, () => true, () => false, emptyScene, "high");
    // A collider near a wall no longer removes it: only the walkable union decides where a wall stands.
    const blocked = buildGreybox(bundle, () => true, () => false, { ...emptyScene, colliderNear: () => true }, "high");
    expect(ordinary.wallSegments.some((wall) => Math.abs(wall.ax - wall.bx) < 1e-9)).toBe(true);
    expect(blocked.wallSegments).toHaveLength(ordinary.wallSegments.length);
    // Floor reaching past both ends makes both end walls attachments; the side walls stay.
    const attached = buildGreybox(bundle, () => true, (p) => p.x < -0.25 || p.x > 10.25, emptyScene, "high");
    expect(attached.wallSegments.length).toBeGreaterThan(0);
    expect(attached.wallSegments.every((wall) => Math.abs(wall.az - wall.bz) < 1e-9)).toBe(true);
  });

  it("unions a ramp with the floor it climbs to, so no end wall stands between them", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [bundle.nodes[0]!, { id: "r", floorId: "g", position: { x: 10, y: 0, z: 4 } }, { id: "s", floorId: "g", position: { x: 20, y: 0, z: 4 } }];
    const edges = [{ id: "ramp", from: "a", to: "r", mode: "ramp" }, { id: "walk", from: "r", to: "s", mode: "walk" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    // No wall across the passage where the ramp meets the upper corridor (x = 10).
    expect(result.wallSegments.some((w) => Math.abs(w.ax - 10) < 1e-6 && Math.abs(w.bx - 10) < 1e-6)).toBe(false);
  });

  it("keeps both outlines of two corridors stacked in plan, even when a ramp joins their floors", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [...bundle.nodes, { id: "c", floorId: "g", position: { x: 0, y: 0, z: 4 } }, { id: "d", floorId: "g", position: { x: 10, y: 0, z: 4 } },
      { id: "r0", floorId: "f", position: { x: 30, y: 0, z: 0 } }, { id: "r1", floorId: "g", position: { x: 40, y: 0, z: 4 } }];
    const edges = [bundle.edges[0]!, { id: "upper", from: "c", to: "d", mode: "walk" }, { id: "ramp", from: "r0", to: "r1", mode: "ramp" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    const side = (y: number) => result.wallSegments.some((w) => Math.abs(w.az - w.bz) < 1e-9 && w.az > 0 && Math.min(w.ax, w.bx) < 5 && Math.max(w.ax, w.bx) > 5 && Math.abs(w.yMin + 0.12 - y) < 0.01);
    expect(side(0)).toBe(true);
    expect(side(4)).toBe(true);
  });

  it("keeps a level passage's wall on its floor where the run turns into a ramp", () => {
    const bent = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 20, y: 0, z: 2 } }] };
    // One run, flat for 10 m, then rising 2 m over the next 10 m (ENU z up).
    const run = { edge: bent.edges[0]!, points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 2)] };
    const grey = emitGreybox(bent as unknown as StationBundle, [run] as never, () => false, emptyScene, "high");
    const at = (x: number) => grey.wallSegments.filter((w) => Math.abs(w.az - w.bz) < 1e-9 && Math.min(w.ax, w.bx) <= x && Math.max(w.ax, w.bx) >= x);
    expect(at(5).length).toBeGreaterThan(0);
    expect(at(5).every((w) => w.yMin < 0)).toBe(true);
    expect(at(9.9).length).toBeGreaterThan(0);
    expect(at(9.9).every((w) => w.yMin < 0)).toBe(true);
  });

  it("keeps a corridor's walls where a ramp to another floor passes over it", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 4 }];
    const nodes = [...bundle.nodes, { id: "r0", floorId: "f", position: { x: 5, y: -10, z: 0 } }, { id: "r1", floorId: "g", position: { x: 5, y: 10, z: 4 } }];
    const edges = [bundle.edges[0]!, { id: "ramp", from: "r0", to: "r1", mode: "ramp" }];
    const result = buildGreybox({ ...bundle, floors, nodes, edges } as unknown as StationBundle, () => true, () => false, emptyScene, "high");
    // The corridor's south wall (renderer z = +half) is crossed in plan by the ramp, 2 m up: it stays at x = 5.
    const half = MODE_WIDTH.walk! / 2;
    expect(result.wallSegments.some((w) => Math.abs(w.az - half) < 1e-6 && Math.abs(w.bz - half) < 1e-6 && Math.min(w.ax, w.bx) <= 5 && Math.max(w.ax, w.bx) >= 5 && w.yMin < 0)).toBe(true);
  });

  it("stops the wall across a corridor a ramp joins and climbs over below the ramp, so a walker on it passes", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 2.3 }];
    // The ramp runs beside the corridor, 1.6 m off its centreline: it overlaps the corridor's edge (ENU y 0.5..1.3), which
    // the corridor index leaves to both, rising out of the corridor's floor and over that edge.
    const nodes = [
      { id: "w0", floorId: "f", position: { x: -10, y: 0, z: 0 } }, { id: "w1", floorId: "f", position: { x: 40, y: 0, z: 0 } },
      { id: "r0", floorId: "f", position: { x: 0, y: 1.6, z: 0.3 } }, { id: "r1", floorId: "g", position: { x: 30, y: 1.6, z: 2.3 } },
    ];
    const edges = [{ id: "corridor", from: "w0", to: "w1", mode: "walk" }, { id: "ramp", from: "r0", to: "r1", mode: "ramp" }];
    const joined = { ...bundle, floors, nodes, edges } as unknown as StationBundle;
    const runs = [
      { edge: edges[0]!, points: [new THREE.Vector3(-10, 0, 0), new THREE.Vector3(40, 0, 0)] },
      { edge: edges[1]!, points: [new THREE.Vector3(0, 1.6, 0.3), new THREE.Vector3(30, 1.6, 2.3)] },
    ];
    const grey = emitGreybox(joined, runs as never, () => false, emptyScene, "high");
    // The corridor's edge gives way where the ramp is 1.7 m up (x = 21): the wall across it there (renderer z -1.3..-0.5)
    // stops 0.4 m under the ramp.
    const across = grey.wallSegments.filter((w) => Math.abs(w.ax - w.bx) < 1e-6 && Math.abs(w.ax - 21) < 0.05 && Math.min(w.az, w.bz) > -1.31 && Math.max(w.az, w.bz) < -0.49);
    expect(across.length).toBeGreaterThan(0);
    for (const w of across) expect(w.yMax).toBeLessThanOrEqual(1.3 + 1e-6);
    // A walker on the ramp over that edge, 0.15 m past the wall (and clear of the ramp's and corridor's side guards), is
    // not pushed back by it.
    const at = resolveWalls(21.15, -0.9, 0.3, 1.72, 1.7, grey.wallSegments as never);
    expect(at.x).toBeCloseTo(21.15);
    expect(at.z).toBeCloseTo(-0.9);
  });

  it("unions the bend of a ramp between floors with the ramp, leaving no wall inside the turn", () => {
    const floors = [...bundle.floors, { id: "g", renderElevationM: 8 }];
    const nodes = [bundle.nodes[0]!, { id: "top", floorId: "g", position: { x: 4, y: 4, z: 8 } }];
    const edges = [{ id: "ramp", from: "a", to: "top", mode: "ramp" }];
    const turned = { ...bundle, floors, nodes, edges } as unknown as StationBundle;
    // Steep (1 m up per metre), up 4 m along x, then 4 m more along y: a bend at (4, 0, 4), whose patch meets each
    // leg more than a step apart in height near the inside corner.
    const run = { edge: edges[0]!, points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 4), new THREE.Vector3(4, 4, 8)] };
    const grey = emitGreybox(turned, [run] as never, () => false, emptyScene, "high");
    const half = MODE_WIDTH.ramp! / 2;
    // Nothing stands inside either leg's passage (renderer z = -ENU y): the bend patch's arc there is not an outline.
    const within = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) => x > x0 + 0.2 && x < x1 - 0.2 && z > z0 + 0.2 && z < z1 - 0.2;
    const inside = grey.wallSegments.filter((w) => {
      const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
      return within(mx, mz, 0, 4, -half, half) || within(mx, mz, 4 - half, 4 + half, -4, 0);
    });
    expect(inside).toEqual([]);
  });

  it("decides attachments along a long side in pieces, where scene floor reaches only part of it", () => {
    const long = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 40, y: 0, z: 0 } }] };
    // Scene floor south of the passage (ENU y < 0), beside x 0..10 only.
    const result = buildGreybox(long, () => true, (p) => p.y < -MODE_WIDTH.walk! / 2 && p.x >= 0 && p.x <= 10, emptyScene, "high");
    const south = result.wallSegments.filter((w) => Math.abs(w.az - w.bz) < 1e-9 && w.az > 0);
    const covered = (lo: number, hi: number) => south.some((w) => Math.min(w.ax, w.bx) < hi && Math.max(w.ax, w.bx) > lo);
    expect(covered(1, 9)).toBe(false);
    expect(covered(12, 38)).toBe(true);
  });

  it("keeps a long passage's side walls whole past a collider", () => {
    const long = { ...bundle, nodes: [bundle.nodes[0]!, { ...bundle.nodes[1]!, position: { x: 40, y: 0, z: 0 } }] };
    const result = buildGreybox(long, () => true, () => false, { ...emptyScene, colliderNear: (p) => Math.abs(p.x - 19) < 0.01 }, "high");
    for (const sign of [-1, 1]) {
      const walls = result.wallSegments.filter((wall) => Math.abs(wall.az - wall.bz) < 1e-9 && Math.sign(wall.az) === sign);
      expect(walls.reduce((length, wall) => length + Math.hypot(wall.bx - wall.ax, wall.bz - wall.az), 0)).toBeCloseTo(40);
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
    expect(result.openings[0]!.depth).toBe(0.6);
    expect(result.openings[0]!.center.x).toBeCloseTo(2.25);
    expect(result.stats.meshes).toBeLessThanOrEqual(3);
    expect(result.root.getObjectByName("greybox-portal")).toBeTruthy();
    expect(result.openings[0]!.width).toBeCloseTo(MODE_WIDTH.walk!);
    const wall = { ax: 2.25, az: -3, bx: 2.25, bz: 3, yMin: 0, yMax: 3 };
    const split = splitWallsAtOpenings([wall], result.openings);
    expect(resolveWalls(2.25, 0, 0.2, 0, 1.8, split).x).toBeCloseTo(2.25);
    expect(Math.abs(resolveWalls(2.25, 2.3, 0.2, 0, 1.8, split).x - 2.25)).toBeGreaterThan(0.1);
  });

  it("limits the wall-tangent opening at a 70 degree crossing while fitting the walker", () => {
    const angle = THREE.MathUtils.degToRad(70);
    const normal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const result = buildGreybox(bundle, () => true, p => p.x <= 2 || p.x >= 6, {
      colliderNear: () => false,
      wallHit: (a, b) => a.x < 2.5 && b.x >= 2.5 ? { x: 2.25, y: 0, z: 0, wallNormal: normal } : null,
    }, "high");
    const box = result.openings[0]!, passageWidth = MODE_WIDTH.walk!;
    expect(box.width).toBeCloseTo(2 * passageWidth);
    expect(portalWidthAxis(box).dot(portalDepthAxis(box))).toBeCloseTo(0);
    expect(portalDepthAxis(box).dot(normal)).toBeCloseTo(1);
    expect(box.width * Math.cos(angle)).toBeGreaterThanOrEqual(0.6);
  });

  it("opens a station wall a floorless run crosses mid-segment, though its floor never changes", () => {
    const result = buildGreybox(bundle, () => true, () => false, {
      colliderNear: () => false,
      wallHit: (a, b, wallsOnly) => wallsOnly && a.x < 4.75 && b.x >= 4.75 ? { x: 4.75, y: 0, z: 0, wallNormal: new THREE.Vector3(1, 0, 0) } : null,
    }, "high");
    expect(result.openings).toHaveLength(1);
    expect(result.stats.portals).toBe(1);
    expect(result.openings[0]!.center.x).toBeCloseTo(4.75);
  });

  it("opens every station wall a floorless run crosses, including one just past its start and more than eight", () => {
    const walls = [0.03, ...Array.from({ length: 9 }, (_, i) => 1 + i)];
    const result = buildGreybox(bundle, () => true, () => false, {
      colliderNear: () => false,
      wallHit: (a, b, wallsOnly) => {
        const x = wallsOnly ? walls.find((w) => a.x < w && b.x >= w) : undefined;
        return x === undefined ? null : { x, y: 0, z: 0, wallNormal: new THREE.Vector3(1, 0, 0) };
      },
    }, "high");
    expect(result.openings.map((box) => box.center.x).sort((p, q) => p - q)).toEqual(walls.map((w) => expect.closeTo(w)));
  });

  it("opens a wall through a run's end only when the route carries on beyond it", () => {
    const wallAt = (x: number) => ({ colliderNear: () => false, wallHit: (a: { x: number }, b: { x: number }, wallsOnly?: boolean) => wallsOnly && Math.min(a.x, b.x) <= x && Math.max(a.x, b.x) >= x ? { x, y: 0, z: 0, wallNormal: new THREE.Vector3(1, 0, 0) } : null });
    // Ends on a wall with nothing beyond it: no opening.
    expect(buildGreybox(bundle, () => true, () => false, wallAt(10), "high").openings).toHaveLength(0);
    // Crosses a wall 0.02 m before its end: opened, as anywhere else on the segment.
    expect(buildGreybox(bundle, () => true, () => false, wallAt(9.98), "high").openings).toHaveLength(1);
    // Starts on a wall that another edge at that node comes through: opened.
    const through = { ...bundle, nodes: [...bundle.nodes, { id: "c", floorId: "f", position: { x: -5, y: 0, z: 0 } }], edges: [...bundle.edges, { ...bundle.edges[0]!, id: "e2", from: "c", to: "a" }] } as unknown as StationBundle;
    const openings = buildGreybox(through, () => true, () => false, wallAt(0), "high").openings;
    expect(openings.some((box) => Math.abs(box.center.x) < 1e-6)).toBe(true);
    // The same edge closed: nothing carries on beyond the wall, so it stays shut.
    expect(buildGreybox(through, (e) => e.id !== "e2", () => false, wallAt(0), "high").openings).toHaveLength(0);
  });

  it("opens both of two differently oriented walls crossed 0.08 m apart", () => {
    const result = buildGreybox(bundle, () => true, () => false, {
      colliderNear: () => false,
      wallHit: (a, b, wallsOnly) => !wallsOnly ? null
        : a.x < 5 && b.x >= 5 ? { x: 5, y: 0, z: 0, wallNormal: new THREE.Vector3(1, 0, 0) }
        : a.x < 5.08 && b.x >= 5.08 ? { x: 5.08, y: 0, z: 0, wallNormal: new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2) } : null,
    }, "high");
    expect(result.openings).toHaveLength(2);
  });

  it("opens no wall that a floorless run only touches at an inner bend", () => {
    const bent = { ...bundle, nodes: [bundle.nodes[0]!, { id: "b", floorId: "f", position: { x: 0, y: 5, z: 0 } }], edges: [{ id: "e", from: "a", to: "b", mode: "walk", geometry: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] }] } as unknown as StationBundle;
    const result = buildGreybox(bent, () => true, () => false, {
      colliderNear: () => false,
      wallHit: (a, b, wallsOnly) => wallsOnly && a.x < 5 && b.x >= 5 ? { x: 5, y: 0, z: 0, wallNormal: new THREE.Vector3(1, 0, 0) } : null,
    }, "high");
    expect(result.openings).toHaveLength(0);
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
