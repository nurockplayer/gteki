import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { WALKER_BODY } from "@gteki/scene-api";
import { BODY_HEIGHTS, BODY_RAYS, bodyBlocked, type CastFn } from "./bodyCollision.ts";
import { castAll, explorerTargets } from "./raycast.ts";

const R = WALKER_BODY.radiusM;
const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** An axis-aligned wall block spanning [x0, x1] x [y0, y1] x [z0, z1]. */
function block(x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = 2): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshBasicMaterial());
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
    return castAll(ray, targets)[0]?.distance ?? null;
  };
}

/** What the explorer did before: one centreline ray per height, `radius` past the target. */
function centrelineBlocked(from: THREE.Vector3, to: THREE.Vector3, cast: CastFn): boolean {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return false;
  dir.divideScalar(len);
  return BODY_HEIGHTS.some((h) => cast(from.clone().add(new THREE.Vector3(0, h, 0)), dir, len + R) !== null);
}

/** How far a body of radius R at (x, z) reaches into the block (0 when clear), measured on the block itself. */
function overlap(mesh: THREE.Mesh, x: number, z: number): number {
  const box = new THREE.Box3().setFromObject(mesh);
  const d = Math.hypot(x - Math.min(Math.max(x, box.min.x), box.max.x), z - Math.min(Math.max(z, box.min.z), box.max.z));
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

describe("bodyBlocked", () => {
  it("never lets the body overlap a wall it slides along from close by", () => {
    // Wall face at x = 1; the walker is 0.5 from it (0.2 clear of its body) and drifts into it while it walks along.
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    const body = (from: THREE.Vector3, to: THREE.Vector3) => bodyBlocked(from, to, cast, R);
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
    const from = v(0.3, -0.85);
    const to = v(0.3, -0.9);
    expect(centrelineBlocked(from, to, cast)).toBe(false);
    expect(bodyBlocked(from, to, cast, R)).toBe(true);
    // Walking south with a slight drift toward the block, far from every ray the old check casts.
    const body = (a: THREE.Vector3, b: THREE.Vector3) => bodyBlocked(a, b, cast, R);
    const end = walk(v(0.2, 0), 0.01, -0.05, 60, body);
    expect(overlap(box, end.x, end.z)).toBeLessThan(SAMPLING);
    const old = walk(v(0.2, 0), 0.01, -0.05, 60, (a, b) => centrelineBlocked(a, b, cast));
    expect(overlap(box, old.x, old.z)).toBeGreaterThan(SAMPLING);
  });

  it("blocks a sweep that crosses a wall even when the target disc is clear of it", () => {
    const wall = block(-5, 5, -0.1, 0.1);
    const cast = caster(wall);
    expect(bodyBlocked(v(0, 1), v(0, -1), cast, R)).toBe(true);
    expect(bodyBlocked(v(2, 1), v(2.5, -1), cast, R)).toBe(true);
  });

  it("lets a walker that overlaps a wall step away from it and along it, but not deeper", () => {
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    const at = v(0.85, 0); // 0.15 from the face: inside the 0.3 body
    const blocked = (dx: number, dz: number) => bodyBlocked(at, at.clone().add(v(dx, dz)), cast, R);
    expect(blocked(-0.05, 0)).toBe(false); // away
    expect(blocked(0, -0.05)).toBe(false); // along
    expect(blocked(0, 0.05)).toBe(false);
    expect(blocked(-0.03, -0.05)).toBe(false); // away and along
    expect(blocked(0.03, 0)).toBe(true); // deeper
    expect(blocked(0.03, -0.05)).toBe(true); // deeper and along
  });

  it("passes in open space and keeps every ray within the body's reach", () => {
    const wall = block(1, 1.4, -20, 20);
    const cast = caster(wall);
    // A wall just past the body (0.31 away) never stops a walker moving along it or toward it by a hair.
    expect(bodyBlocked(v(0.69, 0), v(0.69, -0.05), cast, R)).toBe(false);
    expect(bodyBlocked(v(0, 0), v(0.1, 0.05), cast, R)).toBe(false);
    expect(bodyBlocked(v(-3, 4), v(-3.04, 4.03), cast, R)).toBe(false);
    // Empty collider list: nothing is hit.
    expect(bodyBlocked(v(0, 0), v(0.1, 0), () => null, R)).toBe(false);
  });

  it("does nothing for a zero-length move", () => {
    let calls = 0;
    const cast: CastFn = () => (calls++, 0);
    expect(bodyBlocked(v(1, 1), v(1, 1), cast, R)).toBe(false);
    expect(calls).toBe(0);
  });

  it("walks through a doorway wider than the body", () => {
    // Two walls with a 1.0 m gap (the body needs 0.6).
    const cast = caster(block(-5, -0.5, -0.1, 0.1), block(0.5, 5, -0.1, 0.1));
    const end = walk(v(0, 2), 0, -0.05, 80, (a, b) => bodyBlocked(a, b, cast, R));
    expect(end.z).toBeCloseTo(-2, 5);
    // Aimed at the jamb it stops short of it.
    const jamb = walk(v(0.9, 2), -0.01, -0.05, 80, (a, b) => bodyBlocked(a, b, cast, R));
    expect(jamb.z).toBeGreaterThan(0.1);
  });

  it("passes a corridor exactly as wide as the body", () => {
    const cast = caster(block(-5, -R, -10, 10), block(R, 5, -10, 10));
    const end = walk(v(0, 5), 0, -0.05, 100, (a, b) => bodyBlocked(a, b, cast, R));
    expect(end.z).toBeCloseTo(0, 5);
    // One 2 cm too narrow stops the walker before it enters.
    const narrow = caster(block(-5, -R + 0.01, -10, 10), block(R - 0.01, 5, -10, 10));
    const stuck = walk(v(0, 11), 0, -0.05, 100, (a, b) => bodyBlocked(a, b, narrow, R));
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
      expect(bodyBlocked(v(0, 0), v(0.1, -0.02), beside, R)).toBe(expected);
      const across = caster(block(-5, 5, -1, -0.8, y0, y1));
      expect(bodyBlocked(v(0, 0), v(0, -0.7), across, R)).toBe(expected);
    }
  });

  it("casts 3 + 12 rays per height in the open and the start's 12 more beside a wall", () => {
    let calls = 0;
    const open: CastFn = () => (calls++, null);
    bodyBlocked(v(0, 0), v(0.05, 0), open, R);
    expect(calls).toBe(BODY_HEIGHTS.length * (3 + BODY_RAYS));
    // The start clearance is only measured when the target disc touches something (and a refusal skips the other height).
    calls = 0;
    const near: CastFn = (origin) => (calls++, origin.x > 0.04 && origin.x < 0.06 ? 0.2 : null);
    expect(bodyBlocked(v(0, 0), v(0.05, 0), near, R)).toBe(true);
    expect(calls).toBe(3 + 2 * BODY_RAYS);
  });
});
