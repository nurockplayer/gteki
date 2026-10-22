import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { followShadow, type FollowShadowInfo } from "./followShadow.ts";

const H = 14, N = 2048, Y_RANGE = [0, 12] as const;
const TEXEL = (2 * H) / N;

/** Directional light `elevation`/`azimuth` degrees above the horizon, its target at the origin (as defaultEnvironment). */
const sunAt = (elevation: number, azimuth = 33) => {
  const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  const sun = new THREE.DirectionalLight();
  sun.position.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(130);
  sun.target.position.set(0, 0, 0);
  return sun;
};
const fit = (sun: THREE.DirectionalLight, walker: THREE.Vector3, h = H, size = N, out?: FollowShadowInfo) => followShadow(sun, walker, h, size, Y_RANGE, out);
/** The shadow matrix as the renderer builds it: world → (u, v, depth), each 0…1 inside the frustum. */
const shadowUvw = (sun: THREE.DirectionalLight, p: THREE.Vector3) => {
  sun.shadow.updateMatrices(sun);
  return p.clone().applyMatrix4(sun.shadow.matrix);
};
/** mulberry32 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const frac = (x: number) => x - Math.floor(x);
const fracGap = (a: number, b: number) => { const d = Math.abs(frac(a) - frac(b)); return Math.min(d, 1 - d); };

/** The walker positions of the stability tests: far apart, then sub-texel steps, then a long walk. */
const walkerPositions = (rand: () => number) => {
  const ps: THREE.Vector3[] = [];
  for (let i = 0; i < 150; i++) ps.push(new THREE.Vector3((rand() - 0.5) * 400, rand() * 8, (rand() - 0.5) * 400));
  const p = new THREE.Vector3(17.3, 1.5, -42.9);
  for (let i = 0; i < 150; i++) { p.x += (rand() - 0.5) * TEXEL * 0.7; p.z += (rand() - 0.5) * TEXEL * 0.7; ps.push(p.clone()); }
  for (let i = 0; i < 150; i++) { p.x += 0.05 + rand() * 0.04; p.z -= 0.03 * rand(); ps.push(p.clone()); }
  return ps;
};

/**
 * Points of the frustum ∩ slab, sampled by three's own camera basis: a, b across the light axis (|a|, |b| ≤ limit),
 * the world height `y` anywhere in yRange, and t along the axis solved from y.
 */
function frustumSlabPoints(sun: THREE.DirectionalLight, centre: THREE.Vector3, limit: number, count: number, rand: () => number): THREE.Vector3[] {
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  sun.shadow.camera.matrixWorld.extractBasis(x, y, z);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const a = (rand() * 2 - 1) * limit, b = (rand() * 2 - 1) * limit;
    const worldY = i % 3 === 0 ? Y_RANGE[0] : i % 3 === 1 ? Y_RANGE[1] : Y_RANGE[0] + rand() * (Y_RANGE[1] - Y_RANGE[0]);
    const t = (worldY - centre.y - b * y.y) / z.y;
    pts.push(centre.clone().addScaledVector(x, a).addScaledVector(y, b).addScaledVector(z, t));
  }
  return pts;
}

describe("followShadow", () => {
  it("sizes the frustum as ±halfExtent over the map", () => {
    const sun = sunAt(55);
    const info = fit(sun, new THREE.Vector3(10, 1.5, 20));
    const cam = sun.shadow.camera;
    expect(info.texelM).toBe(TEXEL);
    expect(TEXEL).toBeCloseTo(0.01367, 5);
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-H, H, H, -H]);
    expect(sun.shadow.mapSize.toArray()).toEqual([N, N]);
    expect(info.near).toBe(cam.near);
    expect(info.far).toBe(cam.far);
    // Light space spans 2H over N texels: two world points one texel apart across the axis are 1/N apart in u.
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    sun.shadow.updateMatrices(sun);
    cam.matrixWorld.extractBasis(x, y, z);
    const a = shadowUvw(sun, info.centre), b = shadowUvw(sun, info.centre.clone().addScaledVector(x, TEXEL));
    expect(b.x - a.x).toBeCloseTo(1 / N, 12);
    expect(a.x).toBeCloseTo(0.5, 12);
    expect(a.y).toBeCloseTo(0.5, 12);
  });

  it("keeps world-fixed geometry on the same texel fractions while the walker moves", () => {
    const P = new THREE.Vector3(13.37, 2.5, -7.77);
    for (const [el, az] of [[55, 33], [20, 200], [78, -120], [35, 90], [60, 0], [45, 180], [90, 0]] as const) {
      const sun = sunAt(el, az);
      const rand = seeded(el * 1000 + az + 7);
      let base: THREE.Vector3 | null = null;
      for (const walker of walkerPositions(rand)) {
        fit(sun, walker);
        const uvw = shadowUvw(sun, P);
        base ??= uvw;
        expect(fracGap(uvw.x * N, base.x * N), `u at ${el}°/${az}°`).toBeLessThan(1e-4);
        expect(fracGap(uvw.y * N, base.y * N), `v at ${el}°/${az}°`).toBeLessThan(1e-4);
      }
    }
  });

  it("would shimmer without the snap (centring on the walker shifts the fractions)", () => {
    const P = new THREE.Vector3(13.37, 2.5, -7.77);
    const sun = sunAt(55, 33);
    const dir = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    let base: THREE.Vector3 | null = null, worst = 0;
    for (const walker of walkerPositions(seeded(99))) {
      // A naive follow: centre exactly on the walker, same frustum.
      sun.target.position.copy(walker);
      sun.position.copy(walker).addScaledVector(dir, 100);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
      const uvw = shadowUvw(sun, P);
      base ??= uvw;
      worst = Math.max(worst, fracGap(uvw.x * N, base.x * N), fracGap(uvw.y * N, base.y * N));
    }
    expect(worst).toBeGreaterThan(0.3);
  });

  it("snaps the centre onto the texel grid, within half a texel of the walker across the axis", () => {
    const sun = sunAt(40, 120);
    const info = fit(sun, new THREE.Vector3(3.3, 1.5, 4.4));
    sun.shadow.updateMatrices(sun);
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    sun.shadow.camera.matrixWorld.extractBasis(x, y, z);
    // Three's camera axes: the centre is a whole number of texels along both, and moved by < texel/√2·… from the walker.
    expect(Math.abs(info.centre.dot(x) / TEXEL - Math.round(info.centre.dot(x) / TEXEL))).toBeLessThan(1e-7);
    expect(Math.abs(info.centre.dot(y) / TEXEL - Math.round(info.centre.dot(y) / TEXEL))).toBeLessThan(1e-7);
    const moved = info.centre.clone().sub(new THREE.Vector3(3.3, 1.5, 4.4));
    expect(Math.abs(moved.dot(x))).toBeLessThanOrEqual(TEXEL / 2 + 1e-9);
    expect(Math.abs(moved.dot(y))).toBeLessThanOrEqual(TEXEL / 2 + 1e-9);
    expect(moved.dot(z)).toBeCloseTo(0, 12);
    expect(sun.target.position.distanceTo(info.centre)).toBe(0);
  });

  it("covers the walker's surroundings at both ends of yRange", () => {
    for (const el of [20, 45, 70]) {
      const sun = sunAt(el, 71);
      const rand = seeded(el);
      for (let k = 0; k < 40; k++) {
        const walker = new THREE.Vector3((rand() - 0.5) * 300, 3, (rand() - 0.5) * 300); // mid-height of the station
        const info = fit(sun, walker);
        // On the floor and at the roof, within half the extent of the walker (|b| ≤ e·R + |Δy| < H − texel).
        for (const y of Y_RANGE) {
          for (let i = 0; i < 24; i++) {
            const ang = (i / 24) * Math.PI * 2, R = H / 2;
            const p = new THREE.Vector3(info.centre.x + R * Math.cos(ang), y, info.centre.z + R * Math.sin(ang));
            const uvw = shadowUvw(sun, p);
            expect([el, y, uvw.x, uvw.y, uvw.z].every(Number.isFinite)).toBe(true);
            expect(uvw.x, `u ${el}° y=${y}`).toBeGreaterThan(0);
            expect(uvw.x).toBeLessThan(1);
            expect(uvw.y).toBeGreaterThan(0);
            expect(uvw.y).toBeLessThan(1);
            expect(uvw.z).toBeGreaterThan(0);
            expect(uvw.z).toBeLessThan(1);
          }
        }
      }
    }
  });

  it("fits depth around everything the frustum sees between the two heights, even for a low or near-vertical sun", () => {
    for (const el of [20, 8, 45, 70, 89.99, 90]) {
      const sun = sunAt(el, -40);
      const rand = seeded(el * 13);
      for (let k = 0; k < 10; k++) {
        const walker = new THREE.Vector3((rand() - 0.5) * 200, rand() * 12, (rand() - 0.5) * 200);
        const info = fit(sun, walker);
        sun.shadow.updateMatrices(sun);
        expect(info.near).toBeGreaterThan(0);
        for (const p of frustumSlabPoints(sun, info.centre, H - TEXEL, 300, rand)) {
          const uvw = p.clone().applyMatrix4(sun.shadow.matrix);
          expect(uvw.x).toBeGreaterThanOrEqual(0);
          expect(uvw.x).toBeLessThanOrEqual(1);
          expect(uvw.y).toBeGreaterThanOrEqual(0);
          expect(uvw.y).toBeLessThanOrEqual(1);
          expect(uvw.z, `depth at ${el}°`).toBeGreaterThan(0);
          expect(uvw.z, `depth at ${el}°`).toBeLessThan(1);
        }
      }
    }
  });

  it("keeps the depth range tight and the same across a level walk", () => {
    const sun = sunAt(55);
    const first = fit(sun, new THREE.Vector3(0, 1.5, 0));
    expect(first.near).toBeCloseTo(1, 9);
    // 55° sun, 12 m of height, H = 14: box depth ≈ 2r(|dx|+|dz|) + 12·sin(55°) stays under ~150 m.
    expect(first.far).toBeLessThan(150);
    for (let i = 0; i < 50; i++) {
      const info = fit(sun, new THREE.Vector3(i * 7.7, 1.5, -i * 3.1));
      expect(info.near).toBeCloseTo(first.near, 6);
      expect(info.far).toBeCloseTo(first.far, 6);
    }
  });

  it("leaves the sun direction alone over many calls", () => {
    const sun = sunAt(37, 250);
    const before = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    const rand = seeded(5);
    for (let i = 0; i < 2000; i++) fit(sun, new THREE.Vector3((rand() - 0.5) * 500, rand() * 10, (rand() - 0.5) * 500));
    const after = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    expect(after.distanceTo(before)).toBeLessThan(1e-12);
  });

  it("matches three's shadow camera: it sits on the axis, looks along it, and uses the same right/up as the snap", () => {
    const sun = sunAt(48, 15);
    const info = fit(sun, new THREE.Vector3(5, 2, 9));
    sun.shadow.updateMatrices(sun);
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    sun.shadow.camera.matrixWorld.extractBasis(x, y, z);
    const dir = new THREE.Vector3().subVectors(sun.position, info.centre).normalize();
    expect(z.distanceTo(dir)).toBeLessThan(1e-12);
    expect(x.y).toBeCloseTo(0, 12); // up × z is horizontal
    expect(y.y).toBeGreaterThan(0);
    // The shadow camera's eye is the sun and its target the centre, so the centre is the middle of the map.
    expect(sun.shadow.camera.position.distanceTo(sun.position)).toBe(0);
    const mid = shadowUvw(sun, info.centre);
    expect(mid.x).toBeCloseTo(0.5, 12);
    expect(mid.y).toBeCloseTo(0.5, 12);
  });

  it("works for a vertical sun, which three tilts by 1e-4 (the basis then follows suit)", () => {
    for (const sign of [1, -1]) {
      const sun = new THREE.DirectionalLight();
      sun.position.set(0, 80 * sign, 0);
      sun.target.position.set(0, 0, 0);
      const info = fit(sun, new THREE.Vector3(12.3, 1, 45.6));
      const dir = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
      expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1e-4, 9);
      expect(Math.sign(dir.y)).toBe(sign);
      expect(Number.isFinite(info.far) && info.near > 0 && info.far > info.near).toBe(true);
      const a = shadowUvw(sun, new THREE.Vector3(12, 5, 45));
      expect(a.x).toBeGreaterThan(0);
      expect(a.x).toBeLessThan(1);
      // Stable from here on: no further drift of the direction, and the snap stays aligned.
      const P = new THREE.Vector3(10, 3, 40);
      const base = shadowUvw(sun, P);
      const rand = seeded(sign + 3);
      for (let i = 0; i < 100; i++) {
        fit(sun, new THREE.Vector3(12 + (rand() - 0.5) * 50, 1, 45 + (rand() - 0.5) * 50));
        const uvw = shadowUvw(sun, P);
        expect(fracGap(uvw.x * N, base.x * N)).toBeLessThan(1e-4);
        expect(fracGap(uvw.y * N, base.y * N)).toBeLessThan(1e-4);
      }
      expect(new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize().distanceTo(dir)).toBeLessThan(1e-12);
    }
  });

  it("reallocates the shadow map only when mapSize changes", () => {
    const sun = sunAt(50);
    sun.shadow.mapSize.set(N, N);
    const depthTexture = { dispose: vi.fn() };
    const map = { dispose: vi.fn(), depthTexture };
    sun.shadow.map = map as unknown as THREE.WebGLRenderTarget;
    fit(sun, new THREE.Vector3(), H, N);
    expect(sun.shadow.map).toBe(map);
    expect(map.dispose).not.toHaveBeenCalled();
    fit(sun, new THREE.Vector3(), H, 4096);
    expect(sun.shadow.map).toBeNull();
    expect(map.dispose).toHaveBeenCalledTimes(1);
    expect(depthTexture.dispose).toHaveBeenCalledTimes(1);
    expect(sun.shadow.mapSize.toArray()).toEqual([4096, 4096]);
    expect(fit(sun, new THREE.Vector3(), H, 4096).texelM).toBeCloseTo((2 * H) / 4096, 15);
  });

  it("re-projects the shadow camera only when its numbers change", () => {
    const sun = sunAt(50);
    const spy = vi.spyOn(sun.shadow.camera, "updateProjectionMatrix");
    const out: FollowShadowInfo = { texelM: 0, near: 0, far: 0, centre: new THREE.Vector3() };
    const walker = new THREE.Vector3(4, 1.5, 4);
    expect(fit(sun, walker, H, N, out)).toBe(out);
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) fit(sun, walker, H, N, out);
    expect(spy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) fit(sun, walker.set(4 + i * 3.3, 1.5, 4 - i * 2.1), H, N, out);
    expect(spy).toHaveBeenCalledTimes(1);
    fit(sun, walker, 12, N, out);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("works with a target that is not in the scene and with a sun parented to the scene", () => {
    const scene = new THREE.Scene();
    const sun = sunAt(60);
    scene.add(sun);
    const info = fit(sun, new THREE.Vector3(9, 1, 9));
    expect(sun.target.parent).toBeNull();
    expect(sun.matrixWorld.elements.slice(12, 15)).toEqual(sun.position.toArray());
    expect(sun.target.matrixWorld.elements.slice(12, 15)).toEqual(info.centre.toArray());
  });

  it("rejects what cannot be fitted without touching the sun", () => {
    const walker = new THREE.Vector3(1, 1, 1);
    const run = (sun: THREE.DirectionalLight, h: number, size: number, y: readonly [number, number], t = walker) => () => followShadow(sun, t, h, size, y);
    const sun = sunAt(50);
    const snapshot = () => [sun.position.toArray(), sun.target.position.toArray(), sun.shadow.camera.far, sun.shadow.mapSize.x];
    const before = snapshot();
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(run(sun, bad, N, Y_RANGE)).toThrow(RangeError);
      expect(run(sun, H, bad, Y_RANGE)).toThrow(RangeError);
    }
    expect(run(sun, H, N, [5, 1])).toThrow(RangeError);
    expect(run(sun, H, N, [0, NaN])).toThrow(RangeError);
    expect(run(sun, H, N, Y_RANGE, new THREE.Vector3(NaN, 0, 0))).toThrow(RangeError);
    expect(snapshot()).toEqual(before);

    const flat = new THREE.DirectionalLight();
    flat.position.set(3, 4, 5);
    flat.target.position.set(3, 4, 5); // zero-length direction
    expect(run(flat, H, N, Y_RANGE)).toThrow(/coincide/);
    expect(flat.position.toArray()).toEqual([3, 4, 5]);
    expect(flat.shadow.camera.far).toBe(500);
  });
});
