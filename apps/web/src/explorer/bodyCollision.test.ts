import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WALKER_BODY } from "@gteki/scene-api";
import { BODY_HEIGHTS, BODY_RAYS, bodyBlock, hitNormal, slideAlong, type CastFn } from "./bodyCollision.ts";
import { castAll, explorerTargets } from "./raycast.ts";

const R = WALKER_BODY.radiusM;
const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** Triangle winding of a test wall: as built, every triangle reversed, or every other triangle reversed. */
type Winding = "ccw" | "cw" | "mixed";

/** An axis-aligned wall block spanning [x0, x1] x [y0, y1] x [z0, z1]; reversed windings render double-sided so rays still hit them. */
function block(x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = 2, winding: Winding = "ccw"): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const index = geometry.index!;
  for (let t = 0; t < index.count / 3; t++) {
    if (winding === "cw" || (winding === "mixed" && t % 2 === 0)) {
      const b = index.getX(t * 3 + 1);
      index.setX(t * 3 + 1, index.getX(t * 3 + 2));
      index.setX(t * 3 + 2, b);
    }
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: winding === "ccw" ? THREE.FrontSide : THREE.DoubleSide }));
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** The explorer's cast: nearest collider hit along a ray, through castAll over the collider targets. */
function caster(...colliders: THREE.Mesh[]): CastFn {
  const targets = explorerTargets([], colliders).collider;
  const ray = new THREE.Raycaster();
  return (origin, dir, far) => {
    ray.set(origin, dir);
    ray.far = far;
    const hit = castAll(ray, targets)[0];
    return hit ? { distance: hit.distance, normal: hitNormal(hit, dir) } : null;
  };
}

const blocked = (from: THREE.Vector3, to: THREE.Vector3, cast: CastFn) => bodyBlock(from, to, cast, R) !== null;

/** One explorer step: the move, else the move projected onto the surface that stopped it, else none. */
function step(from: THREE.Vector3, to: THREE.Vector3, cast: CastFn): THREE.Vector3 | null {
  const hit = bodyBlock(from, to, cast, R);
  if (!hit) return to;
  const slid = slideAlong(from, to, hit.normal);
  return slid && bodyBlock(from, slid, cast, R) === null ? slid : null;
}

/** What the explorer did before: one centreline ray per height, `radius` past the target. */
function centrelineBlocked(from: THREE.Vector3, to: THREE.Vector3, cast: CastFn): boolean {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return false;
  dir.divideScalar(len);
  return BODY_HEIGHTS.some((h) => cast(from.clone().add(new THREE.Vector3(0, h, 0)), dir, len + R) !== null);
}

/** How far a body of radius R at (x, z) reaches into the block (0 when clear), measured on the block itself (rotation allowed). */
function overlap(mesh: THREE.Mesh, x: number, z: number): number {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  const p = mesh.worldToLocal(new THREE.Vector3(x, (box.min.y + box.max.y) / 2, z));
  const d = Math.hypot(p.x - Math.min(Math.max(p.x, box.min.x), box.max.x), p.z - Math.min(Math.max(p.z, box.min.z), box.max.z));
  return Math.max(0, R - d);
}

/** Walk `steps` moves of (dx, dz), keeping each one the check allows; returns the final position. */
function walk(start: THREE.Vector3, dx: number, dz: number, steps: number, blocked: (from: THREE.Vector3, to: THREE.Vector3) => boolean): THREE.Vector3 {
  const pos = start.clone();
  for (let i = 0; i < steps; i++) {
    const to = pos.clone().add(new THREE.Vector3(dx, 0, dz));
    if (!blocked(pos, to)) pos.copy(to);
  }
  return pos;
}

// Ray-sampling slack: a convex corner can sit between two radial rays (see BODY_RAYS), a flat wall up to R(1 - cos(pi / rays)).
const SAMPLING = 0.065;

describe("bodyBlock", () => {
  it("never lets the body overlap a wall it slides along from close by", () => {
    // Wall face at x = 1; the walker is 0.5 from it (0.2 clear of its body) and drifts into it while it walks along.
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    const body = (from: THREE.Vector3, to: THREE.Vector3) => blocked(from, to, cast);
    const end = walk(v(0.5, 0), 0.004, -0.05, 100, body);
    expect(end.z).toBeLessThan(-2); // it did keep walking along the wall before the drift closed the gap
    expect(overlap(wall, end.x, end.z)).toBeLessThan(R * (1 - Math.cos(Math.PI / BODY_RAYS)) + 1e-3);
    // The centreline-only check slides the body well into the wall.
    const old = walk(v(0.5, 0), 0.004, -0.05, 100, (from, to) => centrelineBlocked(from, to, cast));
    expect(overlap(wall, old.x, old.z)).toBeGreaterThan(0.1);
  });

  it("blocks rounding a box corner diagonally where the centreline check lets the body clip it", () => {
    // A block with its corner at (0.5, -1); the walker passes it going south, 0.2 clear of its body.
    const box = block(0.5, 3, -4, -1);
    const cast = caster(box);
    const from = v(0.3, -0.82);
    const to = v(0.3, -0.88);
    expect(centrelineBlocked(from, to, cast)).toBe(false);
    expect(blocked(from, to, cast)).toBe(true);
    // Walking south with a slight drift toward the block, far from every ray the old check casts.
    const body = (a: THREE.Vector3, b: THREE.Vector3) => blocked(a, b, cast);
    const end = walk(v(0.2, 0), 0.01, -0.05, 60, body);
    expect(overlap(box, end.x, end.z)).toBeLessThan(SAMPLING);
    const old = walk(v(0.2, 0), 0.01, -0.05, 60, (a, b) => centrelineBlocked(a, b, cast));
    expect(overlap(box, old.x, old.z)).toBeGreaterThan(SAMPLING);
  });

  it("blocks a sweep that crosses a wall even when the target disc is clear of it", () => {
    const wall = block(-5, 5, -0.1, 0.1);
    const cast = caster(wall);
    expect(blocked(v(0, 1), v(0, -1), cast)).toBe(true);
    expect(blocked(v(2, 1), v(2.5, -1), cast)).toBe(true);
  });

  it("lets a walker that overlaps a wall step away from it and along it, but not deeper", () => {
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    const at = v(0.85, 0); // 0.15 from the face: inside the 0.3 body
    const move = (dx: number, dz: number) => blocked(at, at.clone().add(v(dx, dz)), cast);
    expect(move(-0.05, 0)).toBe(false); // away
    expect(move(0, -0.05)).toBe(false); // along
    expect(move(0, 0.05)).toBe(false);
    expect(move(-0.03, -0.05)).toBe(false); // away and along
    expect(move(0.03, 0)).toBe(true); // deeper
    expect(move(0.03, -0.05)).toBe(true); // deeper and along
  });

  it("passes in open space and keeps every ray within the body's reach", () => {
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    // A wall just past the body (0.31 away) never stops a walker moving along it or toward it by a hair.
    expect(blocked(v(0.69, 0), v(0.69, -0.05), cast)).toBe(false);
    expect(blocked(v(0, 0), v(0.1, 0.05), cast)).toBe(false);
    expect(blocked(v(-3, 4), v(-3.04, 4.03), cast)).toBe(false);
    // Empty collider list: nothing is hit.
    expect(blocked(v(0, 0), v(0.1, 0), () => null)).toBe(false);
  });

  it("does nothing for a zero-length move", () => {
    let calls = 0;
    const cast: CastFn = () => (calls++, null);
    expect(blocked(v(1, 1), v(1, 1), cast)).toBe(false);
    expect(calls).toBe(0);
  });

  it("walks through a doorway wider than the body", () => {
    // Two walls with a 1.0 m gap (the body needs 0.6).
    const cast = caster(block(-5, -0.5, -0.1, 0.1), block(0.5, 5, -0.1, 0.1));
    const end = walk(v(0, 2), 0, -0.05, 80, (a, b) => blocked(a, b, cast));
    expect(end.z).toBeCloseTo(-2, 5);
    // Aimed at the jamb it stops short of it.
    const jamb = walk(v(0.9, 2), -0.01, -0.05, 80, (a, b) => blocked(a, b, cast));
    expect(jamb.z).toBeGreaterThan(0.1);
  });

  it("passes a corridor exactly as wide as the body", () => {
    const cast = caster(block(-5, -R, -10, 10), block(R, 5, -10, 10));
    const end = walk(v(0, 5), 0, -0.05, 100, (a, b) => blocked(a, b, cast));
    expect(end.z).toBeCloseTo(0, 5);
    // One 2 cm too narrow stops the walker before it enters.
    const narrow = caster(block(-5, -R + 0.01, -10, 10), block(R - 0.01, 5, -10, 10));
    const stuck = walk(v(0, 11), 0, -0.05, 100, (a, b) => blocked(a, b, narrow));
    expect(stuck.z).toBeGreaterThan(9);
  });

  it("checks both heights", () => {
    const heights = [
      [0.3, 0.7, true], // knee-height only
      [1.0, 1.5, true], // chest-height only
      [0.75, 0.95, false], // between the two rays
    ] as const;
    for (const [y0, y1, expected] of heights) {
      // A wall beside the path (sweep rays do not reach it) and one across it.
      const beside = caster(block(0.3, 1, -20, 20, y0, y1));
      expect(blocked(v(0, 0), v(0.1, -0.02), beside)).toBe(expected);
      const across = caster(block(-5, 5, -1, -0.8, y0, y1));
      expect(blocked(v(0, 0), v(0, -0.7), across)).toBe(expected);
    }
  });

  it("casts 3 + 2 + 12 rays per height, and the start's 12 more only when the target disc touches something", () => {
    let calls = 0;
    const open: CastFn = () => (calls++, null);
    expect(blocked(v(0, 0), v(0.05, 0), open)).toBe(false);
    expect(calls).toBe(BODY_HEIGHTS.length * (3 + 2 + BODY_RAYS));
    // A surface at the target only: the disc slipped into touching, so the start is looked at as well.
    calls = 0;
    const slip: CastFn = (origin) => (calls++, origin.x > 0.04 && origin.x < 0.06 ? { distance: 0.2, normal: new THREE.Vector3(0, 0, 1) } : null);
    expect(blocked(v(0, 0), v(0.05, 0), slip)).toBe(true);
    expect(calls).toBe(3 + 2 + 2 * BODY_RAYS);
    // A surface the motion goes into is refused without the start being cast.
    calls = 0;
    const into: CastFn = (origin) => (calls++, origin.x > 0.04 && origin.x < 0.06 ? { distance: 0.2, normal: new THREE.Vector3(-1, 0, 0) } : null);
    expect(blocked(v(0, 0), v(0.05, 0), into)).toBe(true);
    expect(calls).toBe(3 + 2 + BODY_RAYS);
  });

  describe("convex corners", () => {
    // A box spanning x, z in [0, 3]: the walker overlaps its corner at the origin.
    const corner = () => caster(block(0, 3, 0, 3));

    it("lets a walker overlapping a corner step away although the sampled clearance shrinks (Codex P2 on #81)", () => {
      // The true distance to the corner grows 0.1803 -> 0.1879, but the radial-ray minimum falls 0.2000 -> 0.1963.
      expect(blocked(v(-0.15, -0.1), v(-0.17, -0.08), corner())).toBe(false);
    });

    it("lets it escape diagonally away from the corner, and along either face", () => {
      const cast = corner();
      const at = v(-0.15, -0.1);
      const escapes: [number, number][] = [[-0.04, -0.04], [-0.04, -0.01], [-0.01, -0.04], [-0.04, 0.03], [0, -0.05], [-0.05, 0]];
      for (const [dx, dz] of escapes) {
        expect([dx, dz, blocked(at, at.clone().add(v(dx, dz)), cast)]).toEqual([dx, dz, false]);
      }
      // Toward the corner it is refused; moving toward a face's plane past its end is refused too, but slides on.
      expect(blocked(at, at.clone().add(v(0.03, 0.03)), cast)).toBe(true);
      const slid = step(at, at.clone().add(v(0.03, -0.04)), cast);
      expect(slid).not.toBeNull();
      expect(slid!.x).toBeCloseTo(at.x);
      expect(slid!.z).toBeCloseTo(at.z - 0.04);
    });
  });

  describe("sliding", () => {
    it("slides along a wall it drifts into, never deeper and making progress along it", () => {
      const wall = block(1, 1.4, -20, 20);
      const cast = caster(wall);
      let pos = v(0.5, 0);
      let deepest = 0;
      for (let i = 0; i < 100; i++) {
        pos = step(pos, pos.clone().add(v(0.004, -0.05)), cast) ?? pos;
        deepest = Math.max(deepest, overlap(wall, pos.x, pos.z));
      }
      expect(deepest).toBeLessThan(R * (1 - Math.cos(Math.PI / BODY_RAYS)) + 1e-3);
      expect(pos.z).toBeLessThan(-4.9); // plain refusal stops at about z = -2.5; the slide keeps going
      expect(pos.x).toBeGreaterThan(0.6);
    });

    it("projects a stopped move onto the surface, and nothing is left of a head-on one", () => {
      const n = new THREE.Vector3(-1, 0, 0);
      const slid = slideAlong(v(0, 0), v(0.04, -0.05), n)!;
      expect(slid.x).toBeCloseTo(0);
      expect(slid.z).toBeCloseTo(-0.05);
      expect(slideAlong(v(0, 0), v(0.05, 0), n)).toBeNull();
      expect(slideAlong(v(0, 0), v(0.05, 0), new THREE.Vector3(0, 1, 0))).toBeNull(); // a floor or ceiling
    });

    it("slides along an oblique wall by its own normal, not the world axes", () => {
      const wall = block(1, 1.4, -20, 20);
      wall.rotation.y = Math.PI / 6;
      wall.updateMatrixWorld(true);
      const cast = caster(wall);
      let pos = v(-0.5, 0);
      for (let i = 0; i < 60; i++) pos = step(pos, pos.clone().add(v(0.05, 0)), cast) ?? pos;
      expect(overlap(wall, pos.x, pos.z)).toBeLessThan(0.02);
      expect(Math.abs(pos.z)).toBeGreaterThan(0.5); // carried along the wall, not stuck at the first touch
    });
  });

  describe.each(["ccw", "cw", "mixed"] as const)("walls with %s triangle winding", (winding) => {
    it("faces every hit normal toward the ray's origin", () => {
      const wall = block(1, 1.4, -20, 20, 0, 2, winding);
      wall.rotation.y = 0.4;
      wall.scale.set(1, 1, 2);
      wall.updateMatrixWorld(true);
      const targets = explorerTargets([], [wall]).collider;
      const ray = new THREE.Raycaster();
      let hits = 0;
      for (const [ox, oz] of [[0, 0], [0.3, 1], [-1, -2]]) {
        const dir = new THREE.Vector3(1, 0, 0.1).normalize();
        ray.set(new THREE.Vector3(ox, 1, oz), dir);
        for (const hit of castAll(ray, targets)) {
          const n = hitNormal(hit, dir);
          expect(n.length()).toBeCloseTo(1);
          expect(n.dot(dir)).toBeLessThan(0);
          hits++;
        }
      }
      expect(hits).toBeGreaterThan(0);
    });

    it("lets an overlapped walker back away diagonally (Codex P2 on #81), but not dig in diagonally", () => {
      const wall = block(1, 1.4, -20, 20, 0, 2, winding);
      const cast = caster(wall);
      // Codex's case: the +side sweep ray would start at x = 1.022, behind the wall.
      expect(blocked(v(0.85, 0), v(0.8, -0.035), cast)).toBe(false);
      for (const deg of [10, 30, 45, 60, 80]) {
        for (const sign of [1, -1]) {
          const a = (deg * Math.PI) / 180;
          const from = v(0.85, 0);
          const to = from.clone().add(v(-Math.cos(a) * 0.05, sign * Math.sin(a) * 0.05));
          expect([deg, sign, blocked(from, to, cast)]).toEqual([deg, sign, false]);
          expect(overlap(wall, to.x, to.z)).toBeLessThan(overlap(wall, from.x, from.z));
          // The same angle going in instead of out.
          const into = from.clone().add(v(Math.cos(a) * 0.03, sign * Math.sin(a) * 0.03));
          expect([deg, sign, blocked(from, into, cast)]).toEqual([deg, sign, true]);
        }
      }
    });

    it("behaves the same: leave, slide, never deeper, corner escape", () => {
      const wall = block(1, 1.4, -20, 20, 0, 2, winding);
      const cast = caster(wall);
      const at = v(0.85, 0);
      const move = (dx: number, dz: number) => blocked(at, at.clone().add(v(dx, dz)), cast);
      expect(move(-0.05, 0)).toBe(false);
      expect(move(0, -0.05)).toBe(false);
      expect(move(0.03, 0)).toBe(true);
      expect(move(0.03, -0.05)).toBe(true);
      expect(blocked(v(0, 0), v(0, 2), caster(block(-5, 5, 1, 1.2, 0, 2, winding)))).toBe(true);
      let pos = v(0.5, 0);
      for (let i = 0; i < 100; i++) pos = step(pos, pos.clone().add(v(0.004, -0.05)), cast) ?? pos;
      expect(pos.z).toBeLessThan(-4.9);
      expect(overlap(wall, pos.x, pos.z)).toBeLessThan(R * (1 - Math.cos(Math.PI / BODY_RAYS)) + 1e-3);
      const corner = caster(block(0, 3, 0, 3, 0, 2, winding));
      expect(blocked(v(-0.15, -0.1), v(-0.17, -0.08), corner)).toBe(false);
      expect(blocked(v(-0.15, -0.1), v(-0.12, -0.07), corner)).toBe(true);
    });
  });
});
