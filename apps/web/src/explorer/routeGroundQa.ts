import * as THREE from "three";
import type { RouteStep } from "@gteki/navigation";
import { nodeDisplayZ } from "@gteki/navigation";
import { roleOf } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { R, edgePoints, type V3 } from "./geometry.ts";
import { cumulativeLengths, samplePolyline } from "./walker.ts";

/** Prioritize all guide stops; spread the remaining samples over the complete route. */
export function darkSampleDistances(total: number, stops: readonly number[]): number[] {
  const required = [...new Set(stops.map((s) => THREE.MathUtils.clamp(s, 0, total)))].sort((a, b) => a - b);
  if (required.length > 40) throw new RangeError("More than 40 guide stops cannot fit in the luminance sample cap");
  const regular: number[] = [];
  for (let s = 0; s < total; s += 10) if (!required.includes(s)) regular.push(s);
  if (!required.includes(total)) regular.push(total);
  const slots = 40 - required.length;
  const selected = regular.length <= slots ? regular : Array.from({ length: slots }, (_, i) => regular[Math.round(i * (regular.length - 1) / Math.max(1, slots - 1))]!);
  return [...required, ...selected].sort((a, b) => a - b);
}

/** A deterministic half-metre sampling of the drawn route, including both ends. */
export function routeGroundCounts(points: readonly V3[], ground: (p: THREE.Vector3) => number | null, verticalSteps: readonly RouteStep[], bundle: StationBundle | null, nearMesh: (p: THREE.Vector3, radius: number, edgeId: string) => boolean) {
  const pts = points.map((p) => R(p.x, p.y, p.z));
  let samples = 0, noFloor = 0;
  if (pts.length === 1) {
    const height = ground(pts[0]!);
    samples = 1;
    if (height === null || Math.abs(height - pts[0]!.y) > 0.3) noFloor = 1;
  }
  if (pts.length > 1) {
    const cum = cumulativeLengths(pts), total = cum.at(-1)!;
    const at = (s: number) => {
      const p = samplePolyline(pts, cum, s);
      const y = ground(new THREE.Vector3(p.x, p.y, p.z));
      samples++;
      if (y === null || Math.abs(y - p.y) > 0.3) noFloor++;
    };
    for (let s = 0; s < total; s += 0.5) at(s);
    at(total);
  }
  let verticalWithoutConnector = 0;
  if (bundle) {
    const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
    const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
    for (const step of verticalSteps) {
      if (!["stairs", "escalator", "elevator"].includes(step.mode)) continue;
      const a = nodes.get(step.fromNodeId), b = nodes.get(step.toNodeId);
      if (!a || !b) { verticalWithoutConnector++; continue; }
      const edge = bundle.edges.find((e) => e.id === step.edgeId);
      const path = edge ? edgePoints(bundle, edge, nodes, floors) : [R(a.position.x, a.position.y, nodeDisplayZ(a, floors.get(a.floorId)).z), R(b.position.x, b.position.y, nodeDisplayZ(b, floors.get(b.floorId)).z)];
      const cumulative = cumulativeLengths(path), midpoint = samplePolyline(path, cumulative, (cumulative.at(-1) ?? 0) / 2);
      if (!nearMesh(new THREE.Vector3(midpoint.x, midpoint.y, midpoint.z), 1.5, step.edgeId)) verticalWithoutConnector++;
    }
  }
  return { samples, noFloor, verticalWithoutConnector };
}

/** Only explicit vertical transport is evidence of a connector; ambiguous roles are unknown.
 * Shinjuku's animated escalator steps are named in stations/shinjuku/scene/build.ts.
 */
function isConnector(mesh: THREE.Mesh): boolean {
  if (mesh.userData.greybox) return mesh.userData.connector === true;
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent) {
    if (object.name.startsWith("escalator-steps:")) return true;
    const role = roleOf(object);
    if (role) return ["stairs", "escalator", "elevator"].includes(role);
  }
  return false;
}

/** Distance to connector mesh triangles in world space, not merely a mesh's bounding box. */
export function sceneMeshNear(roots: readonly THREE.Object3D[], point: THREE.Vector3, radius: number, edgeId?: string): boolean {
  const meshes: THREE.Mesh[] = [];
  for (const root of roots) { root.updateWorldMatrix(true, true); root.traverse((o) => { if ((o as THREE.Mesh).isMesh && isConnector(o as THREE.Mesh)) meshes.push(o as THREE.Mesh); }); }
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (const mesh of meshes) {
    const geometry = mesh.geometry, position = geometry?.getAttribute("position"), index = geometry?.getIndex();
    if (!position) continue;
    geometry.computeBoundingSphere();
    const instance = mesh as THREE.InstancedMesh;
    const count = instance.isInstancedMesh ? instance.count : 1;
    for (let n = 0; n < count; n++) {
      if (instance.isInstancedMesh) { instance.getMatrixAt(n, matrix); matrix.premultiply(mesh.matrixWorld); } else matrix.copy(mesh.matrixWorld);
      const bound = geometry.boundingSphere?.clone().applyMatrix4(matrix);
      if (bound && bound.distanceToPoint(point) > radius) continue;
      const size = index?.count ?? position.count;
      for (let i = 0; i + 2 < size; i += 3) {
        if (mesh.userData.greybox && edgeId !== undefined) {
          const ranges = mesh.userData.edgeRanges as { start: number; end: number; edgeId?: string }[] | undefined;
          if (ranges ? !ranges.some((r) => i >= r.start && i + 3 <= r.end && r.edgeId === edgeId) : mesh.userData.edgeId !== edgeId) continue;
        }
        const read = (v: THREE.Vector3, k: number) => v.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(matrix);
        read(triangle.a, i); read(triangle.b, i + 1); read(triangle.c, i + 2);
        if (triangle.closestPointToPoint(point, closest).distanceToSquared(point) <= radius * radius) return true;
      }
    }
  }
  return false;
}
