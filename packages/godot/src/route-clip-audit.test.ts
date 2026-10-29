import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PolylinePoint } from "@gteki/navigation";
import { auditPolyline, resampleAudit, sceneProbe, violations } from "./route-clip-audit.ts";

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
});
