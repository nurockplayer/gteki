import { describe, expect, it } from "vitest";
import { ENU_TO_RENDERER_MATRIX, EnuFrame, StationFrame, enuToRenderer, enuToThree, rendererToEnu, threeToEnu } from "./index.ts";

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

describe("StationFrame (height-preserving station frame)", () => {
  const frame = new StationFrame({ lat: 35.7295, lon: 139.7109, h: 0 });

  it("keeps source heights as z (TP stays TP) and matches ENU horizontally", () => {
    const g = { lat: 35.7312, lon: 139.7131, h: 27.4 };
    const local = frame.toLocal(g);
    expect(local.z).toBeCloseTo(27.4, 9);
    const enu = new EnuFrame({ lat: 35.7295, lon: 139.7109, h: 0 }).toEnu({ ...g, h: 0 });
    expect(local.x).toBeCloseTo(enu.x, 9);
    expect(local.y).toBeCloseTo(enu.y, 9);
  });

  it.each([
    { lat: 35.7295, lon: 139.7109, h: 0 },
    { lat: 35.7312, lon: 139.7131, h: 27.4 },
    { lat: 35.7251, lon: 139.7052, h: -18.25 },
    { lat: 35.7395, lon: 139.7209, h: 40 },
  ])("roundtrips %j below 1 mm horizontally and exactly in height", (g) => {
    const back = frame.toGeodetic(frame.toLocal(g));
    const a = frame.toLocal(g);
    const b = frame.toLocal(back);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-3);
    expect(back.h).toBeCloseTo(g.h, 9);
    expect(back.lat).toBeCloseTo(g.lat, 9);
    expect(back.lon).toBeCloseTo(g.lon, 9);
  });

  it("local → geodetic → local roundtrips arbitrary station points", () => {
    for (const p of [{ x: 0, y: 0, z: 0 }, { x: 812.5, y: -403.2, z: 26.1 }, { x: -1500, y: 1500, z: -30 }]) {
      const q = frame.toLocal(frame.toGeodetic(p));
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-3);
    }
  });

  it("exposes one renderer mapping and its matrix, consistent with each other", () => {
    const p = { x: 3, y: 5, z: 7 };
    const [rx, ry, rz] = enuToRenderer(p);
    const m = ENU_TO_RENDERER_MATRIX;
    // column-major: r = M · p
    expect([m[0]! * 3 + m[4]! * 5 + m[8]! * 7, m[1]! * 3 + m[5]! * 5 + m[9]! * 7, m[2]! * 3 + m[6]! * 5 + m[10]! * 7]).toEqual([rx, ry, rz]);
    expect(rendererToEnu([rx, ry, rz])).toEqual(p);
  });
});
