import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parseStationFiles } from "@gteki/schema";
import { DEFAULT_PROFILE, createRouter } from "@gteki/navigation";
import { Explorer } from "./explorer.ts";
import { OVERVIEW_MIN_VIEWPORT_SHARE, frameBounds, overviewFar, pointsBounds, routablePoints, screenBox, type Aabb, type ViewRect } from "./overviewFraming.ts";
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
  it("412x839 with the panel and the route card open: the floor lifts the map to half the short side", () => {
    const free = { x: 0, y: 356, w: 412, h: 164 };
    for (const [name, net] of NETWORKS) {
      const plain = viewportShare(net, 412, 839, free);
      const floored = viewportShare(net, 412, 839, free, OVERVIEW_MIN_VIEWPORT_SHARE);
      expect(floored.share, name).toBeCloseTo(0.5, 3);
      // The short band alone would leave a speck; the floor is what lifts it.
      expect(floored.share, name).toBeGreaterThan(plain.share + 0.1);
      // It grows past the short band rather than into it, but never past the viewport's sides.
      expect(floored.box.x0, name).toBeGreaterThanOrEqual(0);
      expect(floored.box.x1, name).toBeLessThanOrEqual(412);
    }
  });

  it("393x659 with the panel collapsed or expanded: the fill already reaches half, and the floor holds it there", () => {
    // The wide band (collapsed panel, 0.72 in the browser) clears the floor on its own; the band under the
    // expanded panel lands at half, so there the floor is a guardrail rather than a zoom-out.
    for (const free of [{ x: 0, y: 0, w: 393, h: 659 }, { x: 0, y: 359, w: 393, h: 300 }]) {
      for (const [name, net] of NETWORKS) {
        const cases = `${name} ${free.h}`;
        const plain = viewportShare(net, 393, 659, free);
        const floored = viewportShare(net, 393, 659, free, OVERVIEW_MIN_VIEWPORT_SHARE);
        expect(plain.share, cases).toBeGreaterThan(0.45);
        expect(floored.share, cases).toBeGreaterThanOrEqual(0.5 - 1e-6);
        // Within 2 % of the plain fit: the floor never pulls the camera back on these layouts.
        expect(Math.abs(floored.distance / plain.distance - 1), cases).toBeLessThan(0.02);
      }
    }
  });
});

/** `contextBox` reads only `world`: give it that field rather than a whole Explorer. */
function contextBoxOf(world: THREE.Object3D): THREE.Box3 {
  const e = Object.assign(Object.create(Explorer.prototype) as { world: THREE.Object3D }, { world });
  return (Explorer.prototype as unknown as { contextBox(this: { world: THREE.Object3D }): THREE.Box3 }).contextBox.call(e);
}

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
    // A 1 m geometry whose second instance sits 40 m out: the bounds must cover the instances, as
    // Box3.setFromObject does, not just the geometry's own box.
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1, 0));
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(40, 1, 0));
    root.add(station, street, tube, instanced);
    root.updateMatrixWorld(true);
    return root;
  }

  it("skips a flagged subtree but keeps every other object, instances included", () => {
    const box = contextBoxOf(world());
    expect(box.min.x).toBeCloseTo(-20, 6);
    expect(box.max.x).toBeCloseTo(40.5, 6); // the far instance, not the 1 m geometry
    expect(box.min.z).toBeCloseTo(-20, 6);
    expect(box.max.y).toBeCloseTo(13, 6); // the 2 m tube on the station's roof at 12
    expect(box.getSize(new THREE.Vector3()).x).toBeLessThan(1800); // the 1800 m road is skipped
  });
});
