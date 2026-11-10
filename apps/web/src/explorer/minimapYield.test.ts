import { describe, expect, it } from "vitest";
import { anySampleClear, faceEligible, overlapSamples, rayOnQuad, insideCameraCut, minimapYield, type YieldRect } from "./minimapYield.ts";

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

describe("insideCameraCut", () => {
  it("recognizes the fully discarded core while retaining the dithered rim and disabled cut", () => {
    const end = { x: 0, y: 0, z: -2 };
    const radii = { x: 1, y: 1.2, z: 0.5, w: 0.7 };
    expect(insideCameraCut({ x: 0.7, y: 0, z: -1 }, end, radii)).toBe(true);
    expect(insideCameraCut({ x: 0.8, y: 0, z: -1 }, end, radii)).toBe(false);
    radii.y = 0;
    expect(insideCameraCut({ x: 0, y: 0, z: -1 }, end, radii)).toBe(false);
  });
});

describe("sign samples", () => {
  it("samples the part of the sign's screen box over the minimap", () => {
    const out = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
    // A 400 px sign covering a 100 x 60 px minimap entirely: every sample lands on the minimap.
    overlapSamples({ left: 0, right: 400, top: 0, bottom: 400 }, { left: 250, right: 350, top: 170, bottom: 230 }, out);
    expect(out).toEqual([{ x: 300, y: 200 }, { x: 260, y: 176 }, { x: 340, y: 176 }, { x: 340, y: 224 }, { x: 260, y: 224 }]);
  });

  it("maps a ray onto the sign face and rejects rays beside or behind it", () => {
    const a = { x: -1, y: 1, z: -5 }, b = { x: 1, y: 1, z: -5 }, c = { x: -1, y: -1, z: -5 }, o = { x: 0, y: 0, z: 0 }, p = { x: 0, y: 0, z: 0 };
    expect(rayOnQuad(o, { x: 0.1, y: 0.1, z: -1 }, a, b, c, p)).toBe(true);
    expect(p.x).toBeCloseTo(0.5); expect(p.y).toBeCloseTo(0.5); expect(p.z).toBeCloseTo(-5);
    expect(rayOnQuad(o, { x: 0.5, y: 0, z: -1 }, a, b, c, p)).toBe(false);
    expect(rayOnQuad(o, { x: 0, y: 0, z: 1 }, a, b, c, p)).toBe(false);
  });

  it("yields when any sample is clear", () => {
    expect(anySampleClear(5, (i) => i !== 3)).toBe(true);
    expect(anySampleClear(5, () => true)).toBe(false);
    expect(anySampleClear(0, () => false)).toBe(false);
  });
});
