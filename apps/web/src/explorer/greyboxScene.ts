import * as THREE from "three";
import { R, type V3 } from "./geometry.ts";
import { portalDepthAxis, portalWidthAxis, type Box, type GreyboxScene, type UnmodelledEdgeRun } from "./greybox.ts";
import { castCamera } from "./raycast.ts";
import type { Segment2 } from "./walker.ts";
import { MODE_WIDTH } from "./graphView.ts";
import { currentBvh } from "./meshBvh.ts";

/** Probes against station-owned colliders and walls, before adding generated geometry. */
export function greyboxSceneProbes(colliders: readonly THREE.Object3D[], walls: readonly Segment2[]): GreyboxScene {
  const ray = new THREE.Raycaster();
  const dynamic: THREE.Object3D[] = [];
  const staticMeshes: { mesh: THREE.Mesh; bounds: THREE.Box3; inverse: THREE.Matrix4; radiusScale: number }[] = [];
  for (const object of colliders) {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || mesh.raycast !== THREE.Mesh.prototype.raycast || mesh.getVertexPosition !== THREE.Mesh.prototype.getVertexPosition || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || !currentBvh(mesh.geometry)) { dynamic.push(object); continue; }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    const inverse = mesh.matrixWorld.clone().invert(), e = inverse.elements;
    const radiusScale = Math.sqrt(e[0]! ** 2 + e[1]! ** 2 + e[2]! ** 2 + e[4]! ** 2 + e[5]! ** 2 + e[6]! ** 2 + e[8]! ** 2 + e[9]! ** 2 + e[10]! ** 2);
    staticMeshes.push({ mesh, bounds, inverse, radiusScale });
  }
  const sides = new Set(colliders), dynamicSides = new Set(dynamic);
  const wallCells = new Map<string, Segment2[]>(), largeWalls: Segment2[] = [];
  const wallCellSize = 5;
  for (const wall of walls) {
    const x0 = Math.floor(Math.min(wall.ax, wall.bx) / wallCellSize), x1 = Math.floor(Math.max(wall.ax, wall.bx) / wallCellSize);
    const z0 = Math.floor(Math.min(wall.az, wall.bz) / wallCellSize), z1 = Math.floor(Math.max(wall.az, wall.bz) / wallCellSize);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) { largeWalls.push(wall); continue; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`; let cell = wallCells.get(key); if (!cell) { cell = []; wallCells.set(key, cell); } cell.push(wall);
    }
  }
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), local = new THREE.Vector3();
  const candidates: number[] = [];
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), ...[1, -1].flatMap((x) => [1, -1].map((z) => new THREE.Vector3(x, 0, z).normalize()))];
  return {
    colliderNear(p, radius) {
      const origin = R(p.x, p.y, p.z);
      for (const entry of staticMeshes) {
        if (entry.bounds.distanceToPoint(origin) > radius) continue;
        const mesh = entry.mesh, geometry = mesh.geometry, tree = currentBvh(geometry);
        if (!tree) { dynamic.push(mesh); dynamicSides.add(mesh); continue; }
        candidates.length = 0;
        local.copy(origin).applyMatrix4(entry.inverse);
        tree.pointCandidates(local.x, local.y, local.z, radius * entry.radiusScale + 1e-6, candidates);
        const pos = geometry.getAttribute("position"), index = geometry.index, range = geometry.drawRange;
        for (const id of candidates) {
          const at = id * 3;
          if (at < range.start || at + 3 > range.start + range.count) continue;
          if (Array.isArray(mesh.material) && !geometry.groups.some((g) => at >= g.start && at + 3 <= g.start + g.count)) continue;
          const vertex = (offset: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(at + offset) : at + offset).applyMatrix4(mesh.matrixWorld);
          vertex(0, triangle.a); vertex(1, triangle.b); vertex(2, triangle.c);
          if (triangle.closestPointToPoint(origin, closest).distanceToSquared(origin) <= radius * radius) return true;
        }
      }
      ray.near = 0; ray.far = radius;
      return dirs.some((dir) => { ray.set(origin, dir); return castCamera(ray, dynamic, dynamicSides).length > 0; });
    },
    wallHit(a, b, opts) {
      const from = R(a.x, a.y, a.z), to = R(b.x, b.y, b.z);
      const dx = to.x - from.x, dz = to.z - from.z;
      let best = Infinity;
      let wallNormal: THREE.Vector3 | undefined;
      let backFace: boolean | undefined;
      const candidates = new Set(largeWalls);
      const x0 = Math.floor(Math.min(from.x, to.x) / wallCellSize), x1 = Math.floor(Math.max(from.x, to.x) / wallCellSize);
      const z0 = Math.floor(Math.min(from.z, to.z) / wallCellSize), z1 = Math.floor(Math.max(from.z, to.z) / wallCellSize);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) for (const wall of walls) candidates.add(wall);
      else for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (const wall of wallCells.get(`${x},${z}`) ?? []) candidates.add(wall);
      for (const w of opts?.faceOnly ? [] : candidates) {
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
        if (hit && hit.distance <= best * length + 0.3) {
          best = hit.distance / length;
          if (hit.face) {
            const matrix = hit.object.matrixWorld.clone();
            if (hit.instanceId !== undefined && (hit.object as THREE.InstancedMesh).isInstancedMesh) {
              const inst = new THREE.Matrix4(); (hit.object as THREE.InstancedMesh).getMatrixAt(hit.instanceId, inst); matrix.multiply(inst);
            }
            const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix));
            backFace = normal.dot(ray.ray.direction) > 0;
            normal.y = 0;
            if (normal.lengthSq() > 1e-12) wallNormal = normal.normalize();
          }
        }
      }
      if (!Number.isFinite(best)) return null;
      return { x: a.x + (b.x - a.x) * best, y: a.y + (b.y - a.y) * best, z: a.z + (b.z - a.z) * best, ...(wallNormal ? { wallNormal } : {}), ...(backFace !== undefined ? { backFace } : {}) };
    },
  };
}

export function insideGreyboxOpening(point: THREE.Vector3, box: Box): boolean {
  const dx = point.x - box.center.x, dz = point.z - box.center.z;
  const across = portalWidthAxis(box), depth = portalDepthAxis(box);
  return point.y >= box.center.y && point.y <= box.center.y + box.height &&
    Math.abs(dx * across.x + dz * across.z) <= box.width / 2 &&
    Math.abs(dx * depth.x + dz * depth.z) <= box.depth / 2;
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
