import { describe, expect, it } from "vitest";
import { faceEligible, minimapYield, type YieldRect } from "./minimapYield.ts";

describe("minimapYield", () => {
  it("holds an overlap for 0.6 seconds and ignores signs behind or beyond 15 m", () => {
    const map = { left: 0, right: 100, top: 0, bottom: 100 };
    const sign: YieldRect = { left: 50, right: 150, top: 50, bottom: 150, behind: false, distance: 15 };
    const state = { lastOverlap: -Infinity };
    expect(minimapYield([sign], map, 1, state)).toBe(true);
    expect(minimapYield([], map, 1.59, state)).toBe(true);
    expect(minimapYield([], map, 1.6, state)).toBe(false);
    sign.behind = true;
    expect(minimapYield([sign], map, 2, state)).toBe(false);
    sign.behind = false;
    sign.distance = 15.01;
    expect(minimapYield([sign], map, 2, state)).toBe(false);
  });
});

describe("faceEligible", () => {
  it("rejects faces facing away, crossing the near plane, or beyond range", () => {
    const face = { centre: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, cameraPos: { x: 0, y: 0, z: 15 }, viewZ: [-1, -1, -1, -1], near: 0.1, maxDistance: 15 };
    expect(faceEligible(face)).toBe(true);
    face.normal.z = -1;
    expect(faceEligible(face)).toBe(false);
    face.normal.z = 1;
    face.viewZ[0] = -0.05;
    expect(faceEligible(face)).toBe(false);
    face.viewZ[0] = -1;
    face.cameraPos.z = 15.01;
    expect(faceEligible(face)).toBe(false);
  });
});
