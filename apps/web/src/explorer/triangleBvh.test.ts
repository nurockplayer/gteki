import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TriangleBvh, segmentHitsBox, type Cull } from "./triangleBvh.ts";

/** Unit floor quad at y = 0, facing up (counter-clockwise seen from above, as PlaneGeometry rotated -90° about X). */
const floor = () => new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);

const mergeFloors = () => {
  const a = floor(), b = floor().translate(0, 10, 0);
  const pos = [...a.getAttribute("position").array, ...b.getAttribute("position").array];
  const idx = [...a.getIndex()!.array, ...[...b.getIndex()!.array].map((i) => i + a.getAttribute("position").count)];
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
};

const bvhOf = (g: THREE.BufferGeometry) => TriangleBvh.build(g.getAttribute("position"), g.getIndex());

describe("triangle BVH", () => {
  it("finds a floor between the segment ends and nothing short of it", () => {
    const bvh = bvhOf(floor());
    expect(bvh.triangleCount).toBe(2);
    expect(bvh.anyHit(1, 5, 1, 0, -10, 0)).toBe(true);
    expect(bvh.anyHit(1, 5, 1, 0, -4, 0)).toBe(false); // stops 1 m above
    expect(bvh.anyHit(20, 5, 1, 0, -10, 0)).toBe(false); // beside it
  });

  it("respects the face side like three's material.side", () => {
    const bvh = bvhOf(floor());
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "front-only")).toBe(true); // from above: front face
    expect(bvh.anyHit(0, -5, 0, 0, 10, 0, "front-only")).toBe(false); // from below: back face
    expect(bvh.anyHit(0, -5, 0, 0, 10, 0, "back-only")).toBe(true);
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "back-only")).toBe(false);
  });

  it("handles axis-aligned segments that lie on node boundaries, with +0 or -0 components", () => {
    const bvh = bvhOf(new THREE.BoxGeometry(2, 2, 2));
    expect(bvh.anyHit(-1, 0, -5, 0, 0, 10)).toBe(true); // grazes the x = -1 face plane
    expect(bvh.anyHit(-1, 0, -5, -0, -0, 10)).toBe(true);
    expect(bvh.anyHit(-1.5, 0, -5, 0, 0, 10)).toBe(false);
    expect(bvh.anyHit(-1.5, 0, -5, -0, 0, 10)).toBe(false);
  });

  it("counts only the whole triangles inside an index or vertex range (geometry groups, draw range)", () => {
    // Two floors: y = 0 (index 0..5) and y = 10 (index 6..11).
    const g = mergeFloors();
    const bvh = bvhOf(g);
    expect(bvh.triangleCount).toBe(4);
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "both", 0, 6)).toBe(true);
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "both", 6, 6)).toBe(false); // only the upper floor
    expect(bvh.anyHit(0, 15, 0, 0, -10, 0, "both", 6, Infinity)).toBe(true);
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "both", 0, 0)).toBe(false); // empty draw range
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "both", 0, 2)).toBe(false); // a cut triangle is not drawn
    expect(bvh.anyHit(0, 5, 0, 0, -10, 0, "both", 1, 4)).toBe(false); // nor are triangles straddling either end
    const flat = g.toNonIndexed();
    expect(bvhOf(flat).anyHit(0, 5, 0, 0, -10, 0, "both", 6, Infinity)).toBe(false);
  });

  it("matches a brute-force three.js raycast on a random triangle soup", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 40 - 20;
    const pos: number[] = [];
    for (let i = 0; i < 600; i++) {
      const cx = rnd(), cy = rnd(), cz = rnd();
      for (let k = 0; k < 3; k++) pos.push(cx + rnd() / 8, cy + rnd() / 8, cz + rnd() / 8);
    }
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const bvh = bvhOf(g);
    const ray = new THREE.Ray();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
    const brute = (cull: Cull, o: THREE.Vector3, d: THREE.Vector3) => {
      ray.set(o, d.clone().normalize());
      for (let t = 0; t < 600; t++) {
        a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6);
        const p = cull === "back-only" ? ray.intersectTriangle(c, b, a, true, hit) : ray.intersectTriangle(a, b, c, cull === "front-only", hit);
        if (p && p.distanceTo(o) <= d.length()) return true;
      }
      return false;
    };
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const o = new THREE.Vector3(rnd(), rnd(), rnd());
      const d = new THREE.Vector3(rnd(), rnd(), rnd());
      for (const cull of ["both", "front-only", "back-only"] as const) {
        const expected = brute(cull, o, d);
        if (expected) hits++;
        expect(bvh.anyHit(o.x, o.y, o.z, d.x, d.y, d.z, cull)).toBe(expected);
      }
    }
    expect(hits).toBeGreaterThan(20); // the soup is dense enough to exercise hits, not only misses
  });

  it("never lets a segment slip through the edge two triangles share", () => {
    // PlaneGeometry splits its quad along the diagonal y = x; every point on it belongs to both triangles.
    const bvh = bvhOf(new THREE.PlaneGeometry(10, 10));
    let misses = 0;
    for (let i = -40; i <= 40; i++) {
      const k = i / 9.3;
      for (const [sx, sy] of [[0, 0], [0.37, -0.21], [-1.3, 2.9], [7.1, 0.03]] as const) {
        // From (k + sx, k + sy, 3) through (k, k, 0) and on to z = -3.
        if (!bvh.anyHit(k + sx, k + sy, 3, -2 * sx, -2 * sy, -6)) misses++;
      }
    }
    expect(misses).toBe(0);
  });

  it("builds an empty tree for an empty geometry", () => {
    const bvh = bvhOf(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3)));
    expect(bvh.triangleCount).toBe(0);
    expect(bvh.anyHit(0, 0, 0, 1, 1, 1)).toBe(false);
  });

  it("tests a segment against a stored box, clipped to its ends", () => {
    const box = [9, 9, 9, -1, -1, -1, 1, 1, 1]; // box at offset 3
    expect(segmentHitsBox(-5, 0, 0, 10, 0, 0, box, 3)).toBe(true);
    expect(segmentHitsBox(-5, 0, 0, 3, 0, 0, box, 3)).toBe(false); // stops short
    expect(segmentHitsBox(-5, 2, 0, 10, 0, 0, box, 3)).toBe(false); // passes above
    expect(segmentHitsBox(-5, 1, 0, 10, -0, 0, box, 3)).toBe(true); // on the face plane, -0
    expect(segmentHitsBox(0, 0, 0, 0, 0, 0, box, 3)).toBe(true); // a point inside
  });
});
