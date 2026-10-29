import * as THREE from "three";
import { R, type V3 } from "./geometry.ts";
import type { Box, GreyboxScene, UnmodelledEdgeRun } from "./greybox.ts";
import { castCamera } from "./raycast.ts";
import type { Segment2 } from "./walker.ts";
import { MODE_WIDTH } from "./graphView.ts";

/** Probes against station-owned colliders and walls, before adding generated geometry. */
export function greyboxSceneProbes(colliders: readonly THREE.Object3D[], walls: readonly Segment2[]): GreyboxScene {
  const ray = new THREE.Raycaster();
  const sides = new Set(colliders);
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), ...[1, -1].flatMap((x) => [1, -1].map((z) => new THREE.Vector3(x, 0, z).normalize()))];
  return {
    colliderNear(p, radius) {
      const origin = R(p.x, p.y, p.z);
      ray.near = 0; ray.far = radius;
      return dirs.some((dir) => { ray.set(origin, dir); return castCamera(ray, colliders, sides).length > 0; });
    },
    wallHit(a, b) {
      const from = R(a.x, a.y, a.z), to = R(b.x, b.y, b.z);
      const dx = to.x - from.x, dz = to.z - from.z;
      let best = Infinity;
      for (const w of walls) {
        const wx = w.bx - w.ax, wz = w.bz - w.az;
        const cross = dx * wz - dz * wx;
        if (Math.abs(cross) < 1e-9) continue;
        const ox = w.ax - from.x, oz = w.az - from.z;
        const t = (ox * wz - oz * wx) / cross, u = (ox * dz - oz * dx) / cross;
        const height = from.y + (to.y - from.y) * t;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && height + 1.2 >= w.yMin && height + 1.2 <= w.yMax) best = Math.min(best, t);
      }
      const delta = to.clone().sub(from), length = delta.length();
      if (length > 1e-9) {
        ray.set(from.clone().add(new THREE.Vector3(0, 1.2, 0)), delta.divideScalar(length));
        ray.near = 0; ray.far = length;
        const hit = castCamera(ray, colliders, sides)[0];
        if (hit) best = Math.min(best, hit.distance / length);
      }
      if (!Number.isFinite(best)) return null;
      return { x: a.x + (b.x - a.x) * best, y: a.y + (b.y - a.y) * best, z: a.z + (b.z - a.z) * best };
    },
  };
}

export function insideGreyboxOpening(point: THREE.Vector3, box: Box): boolean {
  const dx = point.x - box.center.x, dz = point.z - box.center.z;
  return point.y >= box.center.y && point.y <= box.center.y + box.height &&
    Math.abs(dx * box.across.x + dz * box.across.z) <= box.width / 2 &&
    Math.abs(dx * box.along.x + dz * box.along.z) <= box.depth / 2;
}

export interface GreyboxSegment { line: THREE.Line3; halfWidth: number }

export function greyboxPathSegments(runs: readonly UnmodelledEdgeRun[]): GreyboxSegment[] {
  return runs.flatMap((run) => run.points.slice(1).map((p, i) => {
    const a = run.points[i]!;
    const width = (run.edge.attributes as unknown as { width?: { m?: unknown } } | undefined)?.width?.m;
    const resolved = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : MODE_WIDTH[run.edge.mode] ?? 2;
    return { line: new THREE.Line3(R(a.x, a.y, a.z), R(p.x, p.y, p.z)), halfWidth: resolved / 2 };
  }));
}

export function nearGreybox(point: THREE.Vector3, segments: readonly GreyboxSegment[], distance: number): boolean {
  return segments.some(({ line, halfWidth }) => {
    const dx = line.end.x - line.start.x, dz = line.end.z - line.start.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 ? THREE.MathUtils.clamp(((point.x - line.start.x) * dx + (point.z - line.start.z) * dz) / length2, 0, 1) : 0;
    const x = line.start.x + dx * t, z = line.start.z + dz * t;
    const floor = THREE.MathUtils.lerp(line.start.y, line.end.y, t);
    const horizontal = Math.max(0, Math.hypot(point.x - x, point.z - z) - halfWidth);
    const vertical = Math.max(0, floor - point.y, point.y - floor - 2.6);
    return Math.hypot(horizontal, vertical) <= distance;
  });
}

export function routeUsesGreybox(points: readonly V3[], segments: readonly GreyboxSegment[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const start = R(a.x, a.y, a.z), end = R(b.x, b.y, b.z);
    const count = Math.max(1, Math.ceil(start.distanceTo(end) / 0.5));
    const closest = new THREE.Vector3();
    for (let k = 0; k <= count; k++) {
      const sample = start.clone().lerp(end, k / count);
      if (segments.some(({ line }) => line.closestPointToPoint(sample, true, closest).distanceToSquared(sample) <= 0.26 ** 2)) return true;
    }
  }
  return false;
}
