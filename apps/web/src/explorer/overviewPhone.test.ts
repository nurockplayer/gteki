import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parseStationFiles } from "@gteki/schema";
import { DEFAULT_PROFILE, createRouter } from "@gteki/navigation";
import { Explorer } from "./explorer.ts";
import { OVERVIEW_MIN_VIEWPORT_SHARE, OVERVIEW_OFFSET, frameBounds, overviewFar, pointsBounds, routablePoints, screenBox, type Aabb, type ViewRect } from "./overviewFraming.ts";
import { STREET_SURFACE_FLAG } from "./streetBackdrop.ts";

/**
 * #109: a phone whose search panel or open route card covers the view must still open on a map half
 * the viewport's shorter side, and the routeless fallback must not frame the street context.
 */

function network(station: string): { box: Aabb; points: THREE.Vector3[] } {
  const dir = fileURLToPath(new URL(`../../../../stations/${station}/gteki/`, import.meta.url));
  const read = (f: string): unknown => JSON.parse(readFileSync(dir + f, "utf8")) as unknown;
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const router = createRouter(parsed.bundle);
  const points = routablePoints(parsed.bundle, (e) => router.isTraversable(e, DEFAULT_PROFILE));
  return { box: pointsBounds(points)!, points };
}

const NETWORKS = [["Ikebukuro", network("ikebukuro")], ["Shinjuku", network("shinjuku")]] as const;

/** The network's larger projected side as a share of the viewport's shorter side, after a fit. */
function viewportShare(net: { box: Aabb; points: THREE.Vector3[] }, w: number, h: number, free: ViewRect, minViewportShare?: number): { share: number; distance: number; box: { x0: number; y0: number; x1: number; y1: number } } {
  const pose = frameBounds(net.box, { fovDeg: 60, aspect: w / h, near: 0.05, viewport: { w, h }, free, points: net.points, ...(minViewportShare ? { minViewportShare } : {}) });
  const cam = new THREE.PerspectiveCamera(60, w / h, 0.05, overviewFar(pose.distance, net.box.min.distanceTo(net.box.max) / 2));
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const e = screenBox(net.points, cam, w, h)!;
  return { share: Math.max(e.x1 - e.x0, e.y1 - e.y0) / Math.min(w, h), distance: pose.distance, box: e };
}

describe("phone overview keeps half the viewport when the panel and route card cover it (#109)", () => {
  // The cases Lane F measured in the browser; the free rects are the bands the UI leaves.
  it("412x839 with the panel and the route card open: 0.26 comes back up to half", () => {
    const free = { x: 0, y: 356, w: 412, h: 164 };
    for (const [name, net] of NETWORKS) {
      const plain = viewportShare(net, 412, 839, free);
      expect(plain.share, name).toBeCloseTo(0.26, 2);
      const floored = viewportShare(net, 412, 839, free, OVERVIEW_MIN_VIEWPORT_SHARE);
      expect(floored.share, name).toBeCloseTo(0.5, 3);
      // It grows past the short band rather than into it, but never past the viewport's sides.
      expect(floored.box.x0, name).toBeGreaterThanOrEqual(0);
      expect(floored.box.x1, name).toBeLessThanOrEqual(412);
    }
  });

  it("393x659 with the panel collapsed already shows half-plus, and the floor changes nothing", () => {
    const free = { x: 0, y: 0, w: 393, h: 659 };
    for (const [name, net] of NETWORKS) {
      const plain = viewportShare(net, 393, 659, free);
      // The browser read 0.72 for Ikebukuro on the same layout; the floor is below what the fill reaches.
      expect(plain.share, name).toBeGreaterThan(0.65);
      expect(viewportShare(net, 393, 659, free, OVERVIEW_MIN_VIEWPORT_SHARE).distance, name).toBe(plain.distance);
    }
  });

  it("393x659 with the panel expanded: the fill already lands at half, and the floor holds it there", () => {
    // The free band under the expanded phone panel (the browser measured 0.50 on this layout).
    const free = { x: 0, y: 359, w: 393, h: 300 };
    for (const [name, net] of NETWORKS) {
      expect(viewportShare(net, 393, 659, free).share, name).toBeCloseTo(0.5, 1);
      expect(viewportShare(net, 393, 659, free, OVERVIEW_MIN_VIEWPORT_SHARE).share, name).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });
});

/** The fields `fitOverview` and `frameAll` read, with the free rect supplied instead of measured from the DOM. */
type Stand = {
  viewSize: { w: number; h: number };
  camera: THREE.PerspectiveCamera;
  orbit: { target: THREE.Vector3; update(): void };
  framed: THREE.Box3 | null;
  framedPts: THREE.Vector3[] | null;
  world: THREE.Object3D;
  routableBox: THREE.Box3 | null;
  setMode: () => void;
  freeRect: () => ViewRect;
};

function stand(w: number, h: number, free: ViewRect, box: THREE.Box3 | null = null, points: THREE.Vector3[] | null = null): Stand {
  return Object.assign(Object.create(Explorer.prototype) as Stand, {
    viewSize: { w, h },
    camera: new THREE.PerspectiveCamera(60, w / h, 0.1, 20000),
    orbit: { target: new THREE.Vector3(), update: (): void => {} },
    framed: box,
    framedPts: points,
    world: new THREE.Group(),
    routableBox: null,
    setMode: (): void => {},
    freeRect: () => free,
  });
}

/** Distance the explorer's own fit chose (private methods; the stand is the only caller). */
function fitted(e: Stand): number {
  (Explorer.prototype as unknown as { fitOverview(this: Stand): void }).fitOverview.call(e);
  return e.camera.position.distanceTo(e.orbit.target);
}

function expectedFit(e: Stand, net: { box: Aabb; points: THREE.Vector3[] }, minViewportShare?: number): number {
  const { w, h } = e.viewSize;
  return frameBounds(net.box, { fovDeg: e.camera.fov, aspect: e.camera.aspect, near: e.camera.near, viewport: { w, h }, free: e.freeRect(), points: net.points, ...(minViewportShare ? { minViewportShare } : {}) }, undefined, OVERVIEW_OFFSET).distance;
}

describe("the explorer asks for the floor only on an occluded phone (#109)", () => {
  const net = NETWORKS[0]![1];
  const box = new THREE.Box3(net.box.min.clone(), net.box.max.clone());

  it("412x839 with the panel and the route card open: the fit keeps half the short side", () => {
    const e = stand(412, 839, { x: 0, y: 356, w: 412, h: 164 }, box, net.points);
    expect(fitted(e)).toBeCloseTo(expectedFit(e, net, 0.5), 6);
    expect(fitted(e)).toBeLessThan(expectedFit(e, net) * 0.8);
  });

  it("a desktop column and an unobstructed phone view keep the plain fill", () => {
    for (const [w, h, free] of [[1440, 900, { x: 416, y: 0, w: 1024, h: 900 }], [412, 839, { x: 0, y: 0, w: 412, h: 839 }]] as const) {
      const e = stand(w, h, free, box, net.points);
      expect(fitted(e), `${w}x${h}`).toBeCloseTo(expectedFit(e, net), 6);
    }
  });
});

describe("the routeless fallback does not frame the street context (#109)", () => {
  function world(): THREE.Object3D {
    const root = new THREE.Group();
    const station = new THREE.Mesh(new THREE.BoxGeometry(40, 10, 40));
    station.position.set(0, 5, 0);
    const street = new THREE.Group();
    street.userData[STREET_SURFACE_FLAG] = true;
    // A road surface reaching 900 m out, as the real street context does: framing it zooms the fit out.
    street.add(new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800).rotateX(-Math.PI / 2)));
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    tube.position.set(-5, 12, 6);
    root.add(station, street, tube);
    root.updateMatrixWorld(true);
    return root;
  }

  it("skips a flagged subtree but keeps every other object", () => {
    const e = stand(412, 839, { x: 0, y: 0, w: 412, h: 839 });
    e.world = world();
    const box = (Explorer.prototype as unknown as { contextBox(this: Stand): THREE.Box3 }).contextBox.call(e);
    expect(box.min.x).toBeCloseTo(-20, 6);
    expect(box.max.x).toBeCloseTo(20, 6);
    expect(box.min.z).toBeCloseTo(-20, 6);
    expect(box.max.y).toBeCloseTo(13, 6); // the 2 m tube on the station's roof at 12
    expect(box.getSize(new THREE.Vector3()).x).toBeLessThan(1800);
  });

  it("frameAll's fallback frames the station-sized box, not the 1800 m road", () => {
    const e = stand(412, 839, { x: 0, y: 0, w: 412, h: 839 });
    e.world = world();
    (Explorer.prototype as unknown as { frameAll(this: Stand, box?: THREE.Box3): void }).frameAll.call(e);
    expect(e.framed!.getSize(new THREE.Vector3()).x).toBeLessThan(100);
  });
});
