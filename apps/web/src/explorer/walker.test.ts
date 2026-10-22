import { describe, expect, it } from "vitest";
import { acceptGround, angleDelta, cumulativeLengths, resolveWalls, samplePolyline, wallToRenderer } from "./walker.ts";
import { WALKER_BODY, WALKER_SPEED } from "@gteki/scene-api";

describe("walker", () => {
  const wall = wallToRenderer({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, zMin: 0, zMax: 3 });

  it("maps ENU walls to the renderer XZ plane (z = -north)", () => {
    expect(wallToRenderer({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, zMin: -6, zMax: -3 })).toEqual({ ax: 1, az: -2, bx: 3, bz: -4, yMin: -6, yMax: -3 });
  });

  it("pushes the body out of a wall it overlaps and leaves distant bodies alone", () => {
    const p = resolveWalls(5, 0.1, 0.3, 0, 1.7, [wall]);
    expect(p.z).toBeCloseTo(0.3);
    expect(resolveWalls(5, 2, 0.3, 0, 1.7, [wall])).toEqual({ x: 5, z: 2 });
  });

  it("ignores walls on other floors", () => {
    expect(resolveWalls(5, 0.1, 0.3, -6, 1.7, [wall])).toEqual({ x: 5, z: 0.1 });
  });

  it("only accepts known ground within step limits", () => {
    expect(acceptGround(0, null)).toBe(false);
    expect(acceptGround(0, 0.3)).toBe(true);
    expect(acceptGround(0, 1.0)).toBe(false);
    expect(acceptGround(0, -0.5)).toBe(true);
    expect(acceptGround(0, -3)).toBe(false);
  });

  it("samples a polyline by arc length with unit tangents", () => {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }];
    const cum = cumulativeLengths(pts);
    expect(cum).toEqual([0, 10, 20]);
    expect(samplePolyline(pts, cum, 5)).toMatchObject({ x: 5, z: 0, tx: 1, tz: 0, segment: 0 });
    expect(samplePolyline(pts, cum, 15)).toMatchObject({ x: 10, z: 5, tx: 0, tz: 1, segment: 1 });
    expect(samplePolyline(pts, cum, 99)).toMatchObject({ x: 10, z: 10 });
  });

  it("computes the shortest signed angle", () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});

describe("walker body is part of the scene contract", () => {
  it("pins the published constants station scenes author against", () => {
    expect(WALKER_BODY).toEqual({ radiusM: 0.3, bodyBottomM: 0.2, bodyTopM: 1.7, eyeM: 1.62, stepUpM: 0.45, stepDownM: 0.9 });
  });

  it("pins the walker ground speeds replay tools import", () => {
    expect(WALKER_SPEED).toEqual({ walkMps: 1.45, runMps: 3.4 });
  });

  it("blocks only walls whose band overlaps feet+0.2 … feet+1.7 (a railing above a stair run does not)", () => {
    const wall = (zMin: number, zMax: number) => wallToRenderer({ a: { x: -5, y: 0 }, b: { x: 5, y: 0 }, zMin, zMax });
    const at = (zMin: number, zMax: number) => resolveWalls(0, 0.1, 0.3, 0, WALKER_BODY.bodyTopM, [wall(zMin, zMax)]);
    expect(at(1.75, 2.8)).toEqual({ x: 0, z: 0.1 }); // above the head band
    expect(at(-1, 0.15)).toEqual({ x: 0, z: 0.1 }); // below the shin band
    expect(at(1.6, 2.8).z).not.toBeCloseTo(0.1); // overlaps at the top edge
    expect(at(-1, 0.25).z).not.toBeCloseTo(0.1); // overlaps at the bottom edge
  });
});
