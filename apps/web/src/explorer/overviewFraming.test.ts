import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Edge, StationBundle } from "@gteki/schema";
import { MIN_SLICE_M, OVERVIEW_FILL, OVERVIEW_OFFSET, boxCorners, extentShare, frameBounds, pointsBounds, routableBounds, routablePoints, screenBox, type Aabb } from "./overviewFraming.ts";

const VIEWPORTS = [
  { name: "desktop 1440x900", w: 1440, h: 900 },
  { name: "phone 393x659", w: 393, h: 659 },
  { name: "phone 412x839", w: 412, h: 839 },
];

/** Renderer-frame boxes (x east, y up, z south): sizes from the real stations' routable graphs. */
const BOXES: Record<string, Aabb> = {
  "Ikebukuro, compact": { min: new THREE.Vector3(-155, 25, -179), max: new THREE.Vector3(172, 36, 179) },
  "Shinjuku, flat and long": { min: new THREE.Vector3(-96, -30, -224), max: new THREE.Vector3(21, -26, 18) },
  "long east-west strip": { min: new THREE.Vector3(-300, 0, -20), max: new THREE.Vector3(300, 4, 20) },
  "tall shaft": { min: new THREE.Vector3(-15, -40, -15), max: new THREE.Vector3(15, 20, 15) },
  "one point": { min: new THREE.Vector3(7, 2, 9), max: new THREE.Vector3(7, 2, 9) },
};

/** The camera as the explorer sets it up (fov 60, near 0.1, far 2000, looking at the orbit target). */
function camera(w: number, h: number, pose: { target: THREE.Vector3; position: THREE.Vector3 }): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

/** Projects the 8 corners to pixels. */
function screenExtent(box: Aabb, cam: THREE.PerspectiveCamera, w: number, h: number) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMax = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(cam);
    zMax = Math.max(zMax, p.z);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0, x1, y0, y1, zMax, widthPx: ((x1 - x0) / 2) * w, heightPx: ((y1 - y0) / 2) * h };
}

/** The box the fit actually used: a slice smaller than MIN_SLICE_M on a ground axis is grown around its centre. */
function fitted(raw: Aabb): Aabb {
  const c = raw.min.clone().add(raw.max).multiplyScalar(0.5);
  const grow = (lo: number, hi: number, mid: number): [number, number] => hi - lo >= MIN_SLICE_M ? [lo, hi] : [mid - MIN_SLICE_M / 2, mid + MIN_SLICE_M / 2];
  const [x0, x1] = grow(raw.min.x, raw.max.x, c.x);
  const [z0, z1] = grow(raw.min.z, raw.max.z, c.z);
  return { min: new THREE.Vector3(x0, raw.min.y, z0), max: new THREE.Vector3(x1, raw.max.y, z1) };
}

describe("frameBounds", () => {
  for (const vp of VIEWPORTS) {
    for (const [name, raw] of Object.entries(BOXES)) {
      it(`${vp.name}, ${name}: larger extent is 50-80% of the shorter side, centred, nothing clipped`, () => {
        const pose = frameBounds(raw, { fovDeg: 60, aspect: vp.w / vp.h });
        const cam = camera(vp.w, vp.h, pose);
        const e = screenExtent(fitted(raw), cam, vp.w, vp.h);
        const fill = Math.max(e.widthPx, e.heightPx) / Math.min(vp.w, vp.h);
        expect(fill).toBeGreaterThanOrEqual(0.5);
        expect(fill).toBeLessThanOrEqual(0.8);
        expect(fill).toBeCloseTo(OVERVIEW_FILL, 2);
        // Inside the viewport on every side (NDC +-1) with room to spare, and centred.
        for (const v of [e.x0, e.x1, e.y0, e.y1]) expect(Math.abs(v)).toBeLessThan(1);
        expect((e.x0 + e.x1) / 2).toBeCloseTo(0, 2);
        expect((e.y0 + e.y1) / 2).toBeCloseTo(0, 2);
        // Between the near and far planes.
        expect(e.zMax).toBeLessThan(1);
        expect(pose.distance).toBeGreaterThan(cam.near);
        expect(pose.distance).toBeLessThan(cam.far);
      });
    }
  }

  it("keeps the overview's viewing direction and looks at the target", () => {
    const pose = frameBounds(BOXES["Ikebukuro, compact"]!, { fovDeg: 60, aspect: 1.6 });
    expect(pose.position.clone().sub(pose.target).normalize().distanceTo(OVERVIEW_OFFSET)).toBeLessThan(1e-9);
    expect(pose.position.distanceTo(pose.target)).toBeCloseTo(pose.distance, 9);
  });

  it("uses the horizontal fov in portrait: the same box needs a larger distance on a narrow screen", () => {
    const box = BOXES["Ikebukuro, compact"]!;
    const wide = frameBounds(box, { fovDeg: 60, aspect: 1440 / 900 });
    const narrow = frameBounds(box, { fovDeg: 60, aspect: 393 / 659 });
    expect(narrow.distance).toBeGreaterThan(wide.distance * 1.4);
  });

  it("is deterministic and does not mutate the box", () => {
    const box = BOXES["Shinjuku, flat and long"]!;
    const before = [box.min.clone(), box.max.clone()];
    const a = frameBounds(box, { fovDeg: 60, aspect: 1.6 });
    const b = frameBounds(box, { fovDeg: 60, aspect: 1.6 });
    expect(a.position.equals(b.position)).toBe(true);
    expect(box.min.equals(before[0]!) && box.max.equals(before[1]!)).toBe(true);
  });

  it("honours another fill", () => {
    const box = BOXES["Ikebukuro, compact"]!;
    const pose = frameBounds(box, { fovDeg: 60, aspect: 1.6 }, 0.5);
    const e = screenExtent(box, camera(1440, 900, pose), 1440, 900);
    expect(Math.max(e.widthPx, e.heightPx) / 900).toBeCloseTo(0.5, 2);
  });
});

describe("routableBounds", () => {
  const node = (id: string, x: number, y: number, z: number | null) => ({ id, floorId: "f", kind: "junction", position: { x, y, z } });
  const edge = (id: string, from: string, to: string) => ({ id, from, to, mode: "walk" }) as unknown as Edge;
  const bundle = {
    nodes: [node("a", 0, 0, 0), node("b", 10, 20, 0), node("far", 500, 500, 0), node("c", -4, 3, null)],
    floors: [{ id: "f", renderElevationM: 5 }],
    edges: [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("closed", "a", "far")],
  } as unknown as StationBundle;

  it("spans the traversable edges only (renderer frame: x, z up, -y) and reaches label height", () => {
    const box = routableBounds(bundle, (e) => e.id !== "closed")!;
    expect(box.min.x).toBe(-4);
    expect(box.min.z).toBe(-20);
    expect(box.max.x).toBe(10);
    expect(box.max.z).toBeCloseTo(0, 9);
    expect(box.min.y).toBe(0);
    expect(box.max.y).toBeCloseTo(5 + 2.4, 9); // node c has no z: it is at its floor's height
  });

  it("is null when nothing is routable", () => {
    expect(routableBounds(bundle, () => false)).toBeNull();
  });

  it("routablePoints are the points the bounds come from", () => {
    const pts = routablePoints(bundle, (e) => e.id !== "closed");
    expect(pts.length).toBe(4); // two edges, two points each
    const box = pointsBounds(pts)!;
    const direct = routableBounds(bundle, (e) => e.id !== "closed")!;
    expect(box.min.equals(direct.min) && box.max.equals(direct.max)).toBe(true);
    expect(pointsBounds([])).toBeNull();
  });
});

describe("screen extent of the network (overviewFrame hook math)", () => {
  for (const vp of VIEWPORTS) {
    it(`${vp.name}: the fitted slice box shares 65%, and its inner network points no more than that`, () => {
      const raw = BOXES["Ikebukuro, compact"]!;
      const pose = frameBounds(raw, { fovDeg: 60, aspect: vp.w / vp.h });
      const cam = camera(vp.w, vp.h, pose);
      const boxShare = extentShare(screenBox(boxCorners(raw), cam, vp.w, vp.h)!, vp.w, vp.h);
      expect(boxShare).toBeCloseTo(OVERVIEW_FILL, 2);
      // A network that spans only part of the box (the corners are extremes) is no bigger on screen.
      const inner = [raw.min.clone().lerp(raw.max, 0.1), raw.min.clone().lerp(raw.max, 0.9), raw.min.clone().lerp(raw.max, 0.5)];
      const box = screenBox(inner, cam, vp.w, vp.h)!;
      expect(extentShare(box, vp.w, vp.h)).toBeLessThanOrEqual(boxShare + 1e-9);
      expect(box.x0).toBeGreaterThanOrEqual(0);
      expect(box.y1).toBeLessThanOrEqual(vp.h);
    });
  }

  it("computes the bbox in pixels and the share against the shorter side", () => {
    const cam = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    // At z=0 and distance 10 the half-height is 10*tan(30deg) = 5.7735 m, the half-width twice that.
    const half = 10 * Math.tan(Math.PI / 6);
    const b = screenBox([new THREE.Vector3(-half, -half / 2, 0), new THREE.Vector3(half, half / 2, 0)], cam, 800, 400)!;
    expect(b.x0).toBeCloseTo(200, 3); // 800 * (1 - 0.5) / 2
    expect(b.x1).toBeCloseTo(600, 3);
    expect(b.y0).toBeCloseTo(100, 3);
    expect(b.y1).toBeCloseTo(300, 3);
    expect(extentShare(b, 800, 400)).toBeCloseTo(1, 6); // 400 px wide... larger side 400 / shorter side 400
  });

  it("ignores points behind the camera and is null when nothing is in range", () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    expect(screenBox([new THREE.Vector3(0, 0, 20)], cam, 100, 100)).toBeNull();
    expect(screenBox([], cam, 100, 100)).toBeNull();
    expect(screenBox([new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, 0)], cam, 100, 100)).not.toBeNull();
  });
});
