import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PolylinePoint } from "@gteki/navigation";
import { auditPolyline, cutSceneProbe, resampleAudit, sceneProbe, segmentsCross, violations, wallsNear } from "./route-clip-audit.ts";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";

// Renderer frame: y up, ENU (x, y, z) → (x, z, -y). A 20 m floor at z 0 and a wall across x = 5.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 20).translate(5, 1.5, 0), new THREE.MeshBasicMaterial());
const mezzanine = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2).translate(-6, 2.5, 0), new THREE.MeshBasicMaterial());
const root = new THREE.Group().add(floor, wall, mezzanine);
root.updateMatrixWorld(true);
const probe = sceneProbe({ root, walkable: [floor, mezzanine], colliders: [wall], walls: [{ a: { x: -9, y: 3 }, b: { x: -1, y: 3 }, zMin: 0, zMax: 2 }] } as never);
const line = (...pts: [number, number, number][]): PolylinePoint[] =>
  pts.map(([x, y, z], i) => ({ x, y, z, zKnown: true, stepIndex: i - 1, floorId: "f" }));

describe("route clip audit", () => {
  it("attributes a hit to the earliest obstacle across both body heights",()=>{
    const near=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.3,2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));near.position.set(0.3,1.5,0);
    const far=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.3,2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));far.position.set(0.7,0.5,0);
    near.updateMatrixWorld(true);far.updateMatrixWorld(true);
    const details:import("./route-clip-audit.ts").SampleDetail[]=[];
    auditPolyline({ground:[],collider:[near,far],walls:[]},line([0,0,0],[1,0,0]),{alreadySampled:true,detail:details});
    expect(details[1]!.wallCollider).toBe(0);
    near.geometry.dispose();far.geometry.dispose();
  });
  it("preserves audit results for explicit samples and a reused cache", () => {
    const points = line([0.2, 0, 0], [8.2, 0, 0]);
    const expected = auditPolyline(probe, points);
    const cache = { floor: new Map<string, number | null>(), wall: new Map() };
    const details: import("./route-clip-audit.ts").SampleDetail[] = [];
    expect(auditPolyline(probe, resampleAudit(points), { alreadySampled: true, cache, detail: details })).toEqual(expected);
    const repeated: import("./route-clip-audit.ts").SampleDetail[] = [];
    expect(auditPolyline(probe, resampleAudit(points), { alreadySampled: true, cache, detail: repeated })).toEqual(expected);
    expect(repeated).toEqual(details);
  });
  it("passes a route on the floor that stays on one side of the wall", () => {
    expect(violations(auditPolyline(probe, line([-8, 0, 0.1], [4, 0, 0.1])))).toBe(0);
  });
  it("checks against the walkable nearest the drawn height, under a mezzanine too", () => {
    expect(violations(auditPolyline(probe, line([-7, 0, 0], [-5, 0, 0])))).toBe(0);
  });
  it("counts samples above the floor tolerance", () => {
    const a = auditPolyline(probe, line([-8, 0, 1], [-2, 0, 1]));
    expect(a.offFloor).toBe(a.samples);
    expect(a.maxAbsDzM).toBeCloseTo(1);
  });
  it("counts a wall crossing and samples with no floor below", () => {
    expect(auditPolyline(probe, line([0.2, 0, 0], [8.2, 0, 0])).wallHits).toBe(1);
    expect(auditPolyline(probe, line([30, 0, 0], [31, 0, 0])).noFloor).toBe(3);
    expect(auditPolyline(probe, line([-8, 3, 0], [-4, 3, 0])).wallHits).toBeGreaterThan(0);
  });
  it("passes a lift ride over a low scene wall", () => {
    expect(auditPolyline(probe, line([-5, 2.8, 0], [-5, 3.2, 10]), { skipInteriorFloor: true }).wallHits).toBe(0);
  });
  it("returns optional sample detail without changing elevator audit counts", () => {
    const points = line([0.2, 0, 0], [12.2, 0, 0]);
    const detail: import("./route-clip-audit.ts").SampleDetail[] = [];
    const withDetail = auditPolyline(probe, points, { skipInteriorFloor: true, detail });
    expect(withDetail).toEqual(auditPolyline(probe, points, { skipInteriorFloor: true }));
    expect(detail).toHaveLength(withDetail.samples);
    expect(detail.some(d => d.wallBefore && d.floor === "ok")).toBe(true);
    expect(detail.some(d => d.floor === "none")).toBe(true);
  });
  it("cuts a collider proxy outside the scene root with the slabs, as the browser does", () => {
    const bundle = createSyntheticBundle([syntheticEdge("start-upper", "start", "upper", { mode: "stairs", lengthM: 10.77 })]);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 6), new THREE.MeshBasicMaterial());
    proxy.position.set(5, 3.8, 0); proxy.updateMatrixWorld(true);
    const original = proxy.geometry;
    cutSceneProbe({ root: new THREE.Group(), walkable: [], colliders: [proxy], cameraBlockers: [], walls: [] } as never, bundle, "high");
    expect(proxy.geometry).not.toBe(original);
  });
});

describe("zero-length walls", () => {
  it("never cross a path, while a real wall on the same line still does", () => {
    const at = (walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]) => {
      const details: { wallBefore: boolean }[] = [];
      auditPolyline({ ground: [], collider: [], walls: walls.map((w) => ({ ...w, zMin: 0, zMax: 2 })) } as never, line([-1, 0, 0], [1, 0, 0]), { alreadySampled: true, detail: details as never });
      return details.some((d) => d.wallBefore);
    };
    // A point wall 180 m north on the path's crossing line x = 0 (the collinear branch used to match the whole line).
    expect(at([{ a: { x: 0, y: 180 }, b: { x: 0, y: 180 } }])).toBe(false);
    expect(at([{ a: { x: 0, y: -1 }, b: { x: 0, y: 1 } }])).toBe(true);
  });
});

describe("wall index", () => {
  it("reports the same wall hits as a scan of every wall", () => {
    // Fixture: random walls (long, short, zero-length, collinear runs, on cell lines) against random 0.5 m steps.
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const walls: import("@gteki/scene-api").WallSegment[] = [];
    for (let i = 0; i < 400; i++) {
      const x = rand() * 80 - 40, y = rand() * 80 - 40, len = [0, 0.3, 3, 40][i % 4]!, angle = i % 5 === 0 ? 0 : rand() * Math.PI;
      walls.push({ a: { x, y }, b: { x: x + len * Math.cos(angle), y: y + len * Math.sin(angle) }, zMin: 0, zMax: 2 });
    }
    for (let k = -3; k <= 3; k++) walls.push({ a: { x: 4 * k, y: -40 }, b: { x: 4 * k, y: 40 }, zMin: 0, zMax: 2 }, { a: { x: -40, y: 8 }, b: { x: 40, y: 8 }, zMin: 0, zMax: 2 });
    const steps: PolylinePoint[] = [];
    for (let i = 0; i < 1500; i++) {
      const x = i % 7 === 0 ? 4 * Math.round(rand() * 20 - 10) : rand() * 90 - 45, y = i % 11 === 0 ? 8 : rand() * 90 - 45, angle = rand() * 2 * Math.PI;
      steps.push(...line([x, y, 0], [x + 0.5 * Math.cos(angle), y + 0.5 * Math.sin(angle), 0]));
    }
    // Brute force: every wall segmentsCross reports for each step. The index must keep every one of them as a candidate,
    // and auditPolyline (indexed) must report the earliest of them, the wall the full scan would have reported.
    const pad = 0.01;
    let crossings = 0;
    for (let i = 0; i < steps.length; i += 2) {
      const p = steps[i]!, q = steps[i + 1]!;
      const brute = walls.flatMap((w, wi) => segmentsCross(p, q, w) === null ? [] : [wi]);
      const near = new Set(wallsNear(walls, Math.min(p.x, q.x) - pad, Math.min(p.y, q.y) - pad, Math.max(p.x, q.x) + pad, Math.max(p.y, q.y) + pad));
      expect(brute.filter((wi) => !near.has(wi))).toEqual([]);
      const detail: import("./route-clip-audit.ts").SampleDetail[] = [];
      auditPolyline({ ground: [], collider: [], walls }, [p, q], { alreadySampled: true, detail });
      const first = brute.map((wi) => ({ wi, t: segmentsCross(p, q, walls[wi]!)! })).reduce<{ wi: number; t: number } | undefined>((a, b) => !a || b.t < a.t ? b : a, undefined);
      expect([detail[1]!.wallBefore, detail[1]!.wallSegment]).toEqual([!!first, first?.wi]);
      crossings += brute.length;
    }
    expect(crossings).toBeGreaterThan(100);
  });
  it("returns every wall for a query box too large to grid", () => {
    const walls = [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, zMin: 0, zMax: 2 }, { a: { x: 1e6, y: 0 }, b: { x: 1e6 + 1, y: 0 }, zMin: 0, zMax: 2 }];
    expect(wallsNear(walls, -1e7, -1e7, 1e7, 1e7)).toEqual([0, 1]);
    expect(wallsNear(walls, -1, -1, 2, 1)).toEqual([0]);
  });
});
