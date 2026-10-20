import { describe, expect, it } from "vitest";
import { EnuFrame, enuToThree, threeToEnu } from "./index.ts";

describe("EnuFrame", () => {
  const frame = new EnuFrame({ lat: 35.6870, lon: 139.6994, h: 0 });

  it("maps the origin to zero", () => {
    const e = frame.toEnu({ lat: 35.687, lon: 139.6994, h: 0 });
    expect(Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.z)).toBeLessThan(1e-6);
  });

  it("gives east/north metric offsets consistent with GRS80 at Tokyo", () => {
    // 0.001° lon at 35.687°N ≈ 90.4 m; 0.001° lat ≈ 110.9 m
    const east = frame.toEnu({ lat: 35.687, lon: 139.7004, h: 0 });
    const north = frame.toEnu({ lat: 35.688, lon: 139.6994, h: 0 });
    expect(east.x).toBeCloseTo(90.4, 0);
    expect(Math.abs(east.y)).toBeLessThan(0.01);
    expect(north.y).toBeCloseTo(110.9, 0);
  });

  it("roundtrips geodetic → ENU → geodetic below 1 mm", () => {
    const g = { lat: 35.68912, lon: 139.70213, h: -24.5 };
    const back = frame.toGeodetic(frame.toEnu(g));
    const e1 = frame.toEnu(g);
    const e2 = frame.toEnu(back);
    expect(Math.hypot(e1.x - e2.x, e1.y - e2.y, e1.z - e2.z)).toBeLessThan(1e-3);
    expect(back.h).toBeCloseTo(-24.5, 3);
  });

  it("maps ENU to Three Y-up with -Z north and back", () => {
    expect(enuToThree({ x: 1, y: 2, z: 3 })).toEqual([1, 3, -2]);
    expect(threeToEnu([1, 3, -2])).toEqual({ x: 1, y: 2, z: 3 });
  });
});
