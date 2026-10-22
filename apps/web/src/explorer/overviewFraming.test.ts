import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Edge, StationBundle } from "@gteki/schema";
import { MIN_SLICE_M, OVERVIEW_FILL, OVERVIEW_OFFSET, boxCorners, extentShare, frameBounds, freeArea, pointsBounds, routableBounds, routablePoints, screenBox, type Aabb } from "./overviewFraming.ts";

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
      it(`${vp.name}, ${name}: the limiting axis is 65% of its side, the other no more; centred, nothing clipped`, () => {
        const pose = frameBounds(raw, { fovDeg: 60, aspect: vp.w / vp.h });
        const cam = camera(vp.w, vp.h, pose);
        const e = screenExtent(fitted(raw), cam, vp.w, vp.h);
        // Per-axis fit: one axis reaches `fill` of its own side, the other stays at or under it.
        const wShare = e.widthPx / vp.w, hShare = e.heightPx / vp.h;
        expect(Math.max(wShare, hShare)).toBeCloseTo(OVERVIEW_FILL, 2);
        expect(Math.min(wShare, hShare)).toBeLessThanOrEqual(OVERVIEW_FILL + 1e-3);
        expect(Math.max(wShare, hShare)).toBeLessThanOrEqual(0.8);
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

  it("honours another fill, per axis", () => {
    const box = BOXES["Ikebukuro, compact"]!;
    const pose = frameBounds(box, { fovDeg: 60, aspect: 1.6 }, 0.5);
    const e = screenExtent(box, camera(1440, 900, pose), 1440, 900);
    expect(Math.max(e.widthPx / 1440, e.heightPx / 900)).toBeCloseTo(0.5, 2);
  });
});

describe("freeArea: what the search panel leaves unobstructed", () => {
  const PHONE = { w: 393, h: 852 };
  const DESKTOP = { w: 1440, h: 900 };

  it("is the whole canvas without a panel (or a panel entirely off it)", () => {
    expect(freeArea(PHONE, null)).toEqual({ x: 0, y: 0, w: 393, h: 852 });
    expect(freeArea(PHONE, { x: 400, y: 0, w: 300, h: 900 })).toEqual({ x: 0, y: 0, w: 393, h: 852 });
  });

  it("is below a phone's full-width top panel", () => {
    // 393x852, panel 16..377 x 58..610 (the opaque sheet Lane F measured, ~65% of the height).
    expect(freeArea(PHONE, { x: 16, y: 58, w: 361, h: 552 })).toEqual({ x: 0, y: 610, w: 393, h: 242 });
  });

  it("is to the right of a desktop's left column, whether expanded or collapsed", () => {
    for (const h of [260, 96]) expect(freeArea(DESKTOP, { x: 16, y: 58, w: 400, h })).toEqual({ x: 416, y: 0, w: 1024, h: 900 });
  });

  it("is above a bottom sheet and left of a right-hand column", () => {
    expect(freeArea(PHONE, { x: 0, y: 600, w: 393, h: 252 })).toEqual({ x: 0, y: 0, w: 393, h: 600 });
    expect(freeArea(DESKTOP, { x: 1100, y: 0, w: 340, h: 900 })).toEqual({ x: 0, y: 0, w: 1100, h: 900 });
  });

  it("clips a panel that hangs off the canvas, and falls back to the canvas when it covers it", () => {
    expect(freeArea(PHONE, { x: 16, y: 58, w: 500, h: 552 })).toEqual({ x: 0, y: 610, w: 393, h: 242 });
    expect(freeArea(PHONE, { x: -10, y: -20, w: 500, h: 900 })).toEqual({ x: 0, y: 0, w: 393, h: 852 });
  });

  it("keeps the credit strip out of the free area: it spans the width at the bottom edge", () => {
    // No panel: the strip alone shortens the usable canvas (38 px phone, 30 px desktop).
    expect(freeArea(PHONE, null, 38)).toEqual({ x: 0, y: 0, w: 393, h: 814 });
    expect(freeArea(DESKTOP, null, 30)).toEqual({ x: 0, y: 0, w: 1440, h: 870 });
    // With a top panel the free band below it ends above the strip.
    expect(freeArea(PHONE, { x: 16, y: 58, w: 361, h: 552 }, 38)).toEqual({ x: 0, y: 610, w: 393, h: 204 });
    // The desktop column's right-hand area is full height minus the strip.
    expect(freeArea(DESKTOP, { x: 16, y: 58, w: 400, h: 260 }, 30)).toEqual({ x: 416, y: 0, w: 1024, h: 870 });
    // A bottom sheet that runs into the strip still leaves only the area above the sheet.
    expect(freeArea(PHONE, { x: 0, y: 600, w: 393, h: 252 }, 38)).toEqual({ x: 0, y: 0, w: 393, h: 600 });
    // A strip taller than the canvas never yields an empty rect (or a negative one).
    const sliver = freeArea(PHONE, null, 9999);
    expect(sliver.w).toBe(393);
    expect(sliver.h).toBe(1);
  });
});

describe("frameBounds inside the free area", () => {
  const PHONE_PANEL = { x: 16, y: 58, w: 361, h: 552 };
  const DESKTOP_PANEL = { x: 16, y: 58, w: 400, h: 260 };
  const layouts = [
    { name: "phone 393x852 with a top panel", w: 393, h: 852, panel: PHONE_PANEL, strip: 0 },
    { name: "phone 393x852 with a top panel and a 38 px credit strip", w: 393, h: 852, panel: PHONE_PANEL, strip: 38 },
    { name: "desktop 1440x900 with a left column", w: 1440, h: 900, panel: DESKTOP_PANEL, strip: 0 },
    { name: "desktop 1440x900 with a left column and a 30 px credit strip", w: 1440, h: 900, panel: DESKTOP_PANEL, strip: 30 },
  ];

  for (const lay of layouts) {
    for (const name of ["Ikebukuro, compact", "Shinjuku, flat and long"]) {
      it(`${lay.name}, ${name}: per-axis fit, 50-80% of the free short side, centred, clear of panel and strip`, () => {
        const free = freeArea({ w: lay.w, h: lay.h }, lay.panel, lay.strip);
        const raw = BOXES[name]!;
        const pose = frameBounds(raw, { fovDeg: 60, aspect: lay.w / lay.h, viewport: { w: lay.w, h: lay.h }, free });
        const cam = camera(lay.w, lay.h, pose);
        const e = screenExtent(fitted(raw), cam, lay.w, lay.h); // NDC
        // To px against the free area's own origin.
        const box = { x0: (e.x0 * 0.5 + 0.5) * lay.w, x1: (e.x1 * 0.5 + 0.5) * lay.w, y0: (-e.y1 * 0.5 + 0.5) * lay.h, y1: (-e.y0 * 0.5 + 0.5) * lay.h };
        // The limiting axis reaches `fill` of its own free side; the other stays at or under it.
        const wShare = (box.x1 - box.x0) / free.w, hShare = (box.y1 - box.y0) / free.h;
        expect(Math.max(wShare, hShare)).toBeCloseTo(OVERVIEW_FILL, 2);
        expect(Math.min(wShare, hShare)).toBeLessThanOrEqual(OVERVIEW_FILL + 1e-3);
        // What the QA hook reports (larger side / the free short side) stays in the accepted band.
        const share = Math.max(box.x1 - box.x0, box.y1 - box.y0) / Math.min(free.w, free.h);
        expect(share).toBeGreaterThanOrEqual(0.5);
        expect(share).toBeLessThanOrEqual(0.8);
        // Centred in the free area, inside it: never under the panel nor in the credit strip.
        expect((box.x0 + box.x1) / 2).toBeCloseTo(free.x + free.w / 2, 0);
        expect((box.y0 + box.y1) / 2).toBeCloseTo(free.y + free.h / 2, 0);
        expect(box.x0).toBeGreaterThanOrEqual(free.x);
        expect(box.x1).toBeLessThanOrEqual(free.x + free.w);
        expect(box.y0).toBeGreaterThanOrEqual(free.y);
        expect(box.y1).toBeLessThanOrEqual(free.y + free.h);
        expect(box.y1).toBeLessThanOrEqual(lay.h - lay.strip);
      });
    }
  }

  it("keeps the viewing direction when it is pushed off centre", () => {
    const free = freeArea({ w: 393, h: 852 }, PHONE_PANEL, 38);
    const pose = frameBounds(BOXES["Ikebukuro, compact"]!, { fovDeg: 60, aspect: 393 / 852, viewport: { w: 393, h: 852 }, free });
    expect(pose.position.clone().sub(pose.target).normalize().distanceTo(OVERVIEW_OFFSET)).toBeLessThan(1e-9);
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
    it(`${vp.name}: the fitted slice box takes 65% of one axis, and its inner network points no more`, () => {
      const raw = BOXES["Ikebukuro, compact"]!;
      const pose = frameBounds(raw, { fovDeg: 60, aspect: vp.w / vp.h });
      const cam = camera(vp.w, vp.h, pose);
      const boxBox = screenBox(boxCorners(raw), cam, vp.w, vp.h)!;
      const largest = Math.max(boxBox.x1 - boxBox.x0, boxBox.y1 - boxBox.y0);
      expect(Math.max((boxBox.x1 - boxBox.x0) / vp.w, (boxBox.y1 - boxBox.y0) / vp.h)).toBeCloseTo(OVERVIEW_FILL, 2);
      // A network that spans only part of the box (the corners are extremes) is no bigger on screen.
      const inner = [raw.min.clone().lerp(raw.max, 0.1), raw.min.clone().lerp(raw.max, 0.9), raw.min.clone().lerp(raw.max, 0.5)];
      const box = screenBox(inner, cam, vp.w, vp.h)!;
      expect(Math.max(box.x1 - box.x0, box.y1 - box.y0)).toBeLessThanOrEqual(largest + 1e-9);
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
