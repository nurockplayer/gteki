import type { Edge, StationBundle } from "@gteki/schema";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { edgePoints, R, type V3 } from "./geometry.ts";
import { MODE_WIDTH } from "./graphView.ts";
import type { Segment2 } from "./walker.ts";

/** An edge's floorless samples, extended into the adjacent modelled floor. */
export interface UnmodelledEdgeRun {
  edge: Edge;
  points: V3[];
}

/** Find passage candidates without changing the station or retaining its geometry on disk. */
export function unmodelledRunsByEdge(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean): UnmodelledEdgeRun[] {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const out: UnmodelledEdgeRun[] = [];
  for (const edge of bundle.edges) {
    if (!traversable(edge) || !["walk", "gate", "moving_walkway", "ramp"].includes(edge.mode)) continue;
    const points = edgePoints(bundle, edge, nodes, floors).map((p) => ({ x: p.x, y: -p.z, z: p.y }));
    if (points.length < 2) continue;
    const samples: V3[] = [points[0]!];
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const count = Math.max(1, Math.ceil(length / 0.5));
      const start = distances.at(-1)!;
      for (let k = 1; k <= count; k++) {
        samples.push({ x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count, z: a.z + (b.z - a.z) * k / count });
        distances.push(start + length * k / count);
      }
    }
    const pointAt = (distance: number): V3 => {
      let k = 1;
      while (k < distances.length - 1 && distances[k]! < distance) k++;
      const a = samples[k - 1]!, b = samples[k]!;
      const span = distances[k]! - distances[k - 1]!;
      const t = span ? (distance - distances[k - 1]!) / span : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    const bare = samples.map((p) => edge.attributes?.sceneGap === true || !hasFloor(p));
    for (let i = 0; i < samples.length; i++) {
      if (!bare[i]) continue;
      let end = i;
      while (end + 1 < samples.length && bare[end + 1]) end++;
      const length = distances[end]! - distances[i]!;
      if (length >= 1 || edge.attributes?.sceneGap === true) {
        const start = Math.max(0, distances[i]! - 0.5);
        const finish = Math.min(distances.at(-1)!, distances[end]! + 0.5);
        const inside = samples.filter((_p, k) => distances[k]! > start && distances[k]! < finish);
        out.push({ edge, points: [pointAt(start), ...inside, pointAt(finish)] });
      }
      i = end;
    }
  }
  return out;
}

/** An oriented opening in renderer coordinates; center is at floor level, and axes are horizontal unit vectors. */
export interface Box {
  center: THREE.Vector3;
  along: THREE.Vector3;
  across: THREE.Vector3;
  width: number;
  depth: number;
  height: number;
}

export interface GreyboxStats { runs: number; lengthM: number; portals: number; meshes: number; triangles: number; buildMs: number }
export interface GreyboxScene {
  colliderNear(p: V3, r: number): boolean;
  wallHit(a: V3, b: V3): V3 | null;
}

/** Clip a wall against oriented openings, preserving the wall above and below an opening. */
export function splitWallsAtOpenings(walls: readonly Segment2[], openings: readonly Box[]): Segment2[] {
  let result = [...walls];
  for (const box of openings) {
    const next: Segment2[] = [];
    for (const w of result) {
      const bottom = box.center.y, top = bottom + box.height;
      if (w.yMax <= bottom || w.yMin >= top) { next.push(w); continue; }
      let lo = 0, hi = 1;
      const x = w.ax - box.center.x, z = w.az - box.center.z;
      const dx = w.bx - w.ax, dz = w.bz - w.az;
      for (const [axis, extent] of [[box.across, box.width / 2], [box.along, box.depth / 2]] as const) {
        const origin = x * axis.x + z * axis.z, delta = dx * axis.x + dz * axis.z;
        if (Math.abs(delta) < 1e-9) { if (Math.abs(origin) > extent) { lo = 1; hi = 0; break; } continue; }
        const a = (-extent - origin) / delta, b = (extent - origin) / delta;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
      if (lo >= hi) { next.push(w); continue; }
      const piece = (a: number, b: number, yMin: number, yMax: number) => {
        if (b - a > 1e-9 && yMax > yMin) next.push({ ax: w.ax + dx * a, az: w.az + dz * a, bx: w.ax + dx * b, bz: w.az + dz * b, yMin, yMax });
      };
      piece(0, lo, w.yMin, w.yMax); piece(hi, 1, w.yMin, w.yMax);
      piece(lo, hi, w.yMin, Math.min(w.yMax, bottom));
      piece(lo, hi, Math.max(w.yMin, top), w.yMax);
    }
    result = next;
  }
  return result;
}

type Batch = { shell: number[]; colors: number[]; lights: number[]; kerb: number[]; portal: number[]; portalColors: number[] };
const batch = (): Batch => ({ shell: [], colors: [], lights: [], kerb: [], portal: [], portalColors: [] });
const enu = (v: THREE.Vector3): V3 => ({ x: v.x, y: -v.z, z: v.y });

/** Append a two-sided quad; vertex shade is baked into the shell's vertex colours. */
function quad(out: number[], colors: number[] | null, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, shades: readonly [number, number, number, number] = [1, 1, 1, 1]): void {
  const points = [a, b, c, a, c, d];
  const indices = [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!; out.push(p.x, p.y, p.z);
    if (colors) { const shade = shades[indices[i]!]!; colors.push(shade, shade, shade); }
  }
}

function widthOf(edge: Edge): number {
  // The public schema currently permits only scalar attributes; accept a structured runtime width when supplied.
  const width = (edge.attributes as unknown as { width?: { m?: unknown } } | undefined)?.width?.m;
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : MODE_WIDTH[edge.mode] ?? 2;
}

/** Procedural passages, built entirely in memory from the already-loaded graph and scene probes. */
export function buildGreybox(bundle: StationBundle, traversable: (edge: Edge) => boolean, hasFloor: (p: V3) => boolean, scene: GreyboxScene, tier: "high" | "low") {
  const started = performance.now();
  const runs = unmodelledRunsByEdge(bundle, traversable, hasFloor);
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const junctions = new Map<string, { at: THREE.Vector3; width: number; count: number; floor: string }>();
  for (const run of runs) {
    const edgePointsR = edgePoints(bundle, run.edge, nodes, floors);
    for (const [id, point, endpoint] of [[run.edge.from, run.points[0], edgePointsR[0]], [run.edge.to, run.points.at(-1), edgePointsR.at(-1)]] as const) {
      if (!point || !endpoint || R(point.x, point.y, point.z).distanceTo(endpoint) > 1e-5) continue;
      const current = junctions.get(id);
      if (current) { current.count++; current.width = Math.max(current.width, widthOf(run.edge)); }
      else junctions.set(id, { at: endpoint, width: widthOf(run.edge), count: 1, floor: nodes.get(id)?.floorId ?? "" });
    }
  }
  const batches = new Map<string, Batch>();
  const getBatch = (floor: string) => {
    const key = tier === "low" ? "all" : floor;
    let b = batches.get(key); if (!b) { b = batch(); batches.set(key, b); } return b;
  };
  const openings: Box[] = [];
  const wallSegments: Segment2[] = [];
  let lengthM = 0;
  const shellMat = new THREE.MeshLambertMaterial({ color: 0x9a9690, emissive: 0x9a9690, emissiveIntensity: 0.35, vertexColors: true, side: THREE.DoubleSide });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });
  const kerbMat = new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false, side: THREE.DoubleSide });
  for (const run of runs) {
    const width = widthOf(run.edge), half = width / 2;
    const b = getBatch(nodes.get(run.edge.from)?.floorId ?? "");
    const pts = run.points.map((p) => R(p.x, p.y, p.z));
    let travelled = 0, nextLight = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, z = pts[i]!;
      const diff = z.clone().sub(a), length = diff.length(), flat = Math.hypot(diff.x, diff.z);
      if (length < 1e-8 || flat < 1e-8) continue;
      const along = new THREE.Vector3(diff.x / flat, 0, diff.z / flat);
      const across = new THREE.Vector3(-along.z, 0, along.x);
      const offset = (p: THREE.Vector3, side: number, height: number) => p.clone().addScaledVector(across, side).add(new THREE.Vector3(0, height, 0));
      const al = offset(a, -half, 0), ar = offset(a, half, 0), zl = offset(z, -half, 0), zr = offset(z, half, 0);
      quad(b.shell, b.colors, al, zl, z, a, [0.62, 0.62, 1, 1]);
      quad(b.shell, b.colors, a, z, zr, ar, [1, 1, 0.62, 0.62]);
      quad(b.shell, b.colors, offset(a, -half, -0.12), offset(a, half, -0.12), offset(z, half, -0.12), offset(z, -half, -0.12));
      for (const side of [-1, 1]) {
        quad(b.shell, b.colors, offset(a, side * half, -0.12), offset(z, side * half, -0.12), offset(z, side * half, 0), offset(a, side * half, 0));
        quad(b.kerb, null, offset(a, side * (half - 0.05), 0.005), offset(z, side * (half - 0.05), 0.005), offset(z, side * half, 0.005), offset(a, side * half, 0.005));
        const wa = offset(a, side * half, 0), wz = offset(z, side * half, 0);
        // Clip the wall centreline against junction discs; the floor and ceiling remain continuous.
        let intervals: [number, number][] = [[0, 1]];
        for (const j of junctions.values()) {
          if (j.count < 2 || Math.abs(j.at.y - (a.y + z.y) / 2) > 1) continue;
          const vx = wz.x - wa.x, vz = wz.z - wa.z, ox = wa.x - j.at.x, oz = wa.z - j.at.z;
          const A = vx * vx + vz * vz, B = 2 * (ox * vx + oz * vz), C = ox * ox + oz * oz - (j.width / 2) ** 2;
          const disc = B * B - 4 * A * C;
          if (A < 1e-12 || disc <= 0) continue;
          const lo = (-B - Math.sqrt(disc)) / (2 * A), hi = (-B + Math.sqrt(disc)) / (2 * A);
          intervals = intervals.flatMap(([s, e]) => [[s, Math.min(e, lo)], [Math.max(s, hi), e]].filter(([x, y]) => x! < y!) as [number, number][]);
        }
        for (const [s, e] of intervals) {
          const p = wa.clone().lerp(wz, s), q = wa.clone().lerp(wz, e), mid = p.clone().lerp(q, 0.5);
          mid.y += 1.3;
          if (scene.colliderNear(enu(mid), 0.3)) continue;
          const pm = p.clone().add(new THREE.Vector3(0, 1.3, 0)), qm = q.clone().add(new THREE.Vector3(0, 1.3, 0));
          quad(b.shell, b.colors, p, q, qm, pm, [0.62, 0.62, 1, 1]);
          quad(b.shell, b.colors, pm, qm, q.clone().add(new THREE.Vector3(0, 2.6, 0)), p.clone().add(new THREE.Vector3(0, 2.6, 0)), [1, 1, 0.62, 0.62]);
          wallSegments.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, yMin: Math.min(p.y, q.y), yMax: Math.max(p.y, q.y) + 2.6 });
        }
      }
      quad(b.shell, b.colors, offset(a, -half, 2.6), offset(a, 0, 2.6), offset(z, 0, 2.6), offset(z, -half, 2.6), [0.62, 1, 1, 0.62]);
      quad(b.shell, b.colors, offset(a, 0, 2.6), offset(a, half, 2.6), offset(z, half, 2.6), offset(z, 0, 2.6), [1, 0.62, 0.62, 1]);
      while (nextLight <= travelled + length) {
        const t = (nextLight - travelled) / length;
        if (t >= 0) {
          const center = a.clone().lerp(z, t).add(new THREE.Vector3(0, 2.59, 0));
          const p = center.clone().addScaledVector(along, -0.6), q = center.clone().addScaledVector(along, 0.6);
          quad(b.lights, null, p.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, -0.075), q.clone().addScaledVector(across, 0.075), p.clone().addScaledVector(across, 0.075));
        }
        nextLight += 6;
      }
      const pa = run.points[i - 1]!, pz = run.points[i]!;
      const transition = run.edge.attributes?.sceneGap === true
        ? (i === 1 && hasFloor(pa)) || (i === pts.length - 1 && hasFloor(pz))
        : hasFloor(pa) !== hasFloor(pz);
      if (transition) {
        const hit = scene.wallHit(pa, pz);
        if (hit) {
          const center = R(hit.x, hit.y, hit.z);
          openings.push({ center, along: along.clone(), across: across.clone(), width, depth: 0.6, height: 2.3 });
          // Thin planar jambs and lintel; amber strips make the reveal visible.
          for (const side of [-1, 1]) {
            const outer = side * (half + 0.08), inner = side * half;
            quad(b.portal, b.portalColors, offset(center, inner, 0), offset(center, outer, 0), offset(center, outer, 2.4), offset(center, inner, 2.4));
            quad(b.kerb, null, offset(center, inner, 0), offset(center, inner + side * 0.03, 0), offset(center, inner + side * 0.03, 2.3), offset(center, inner, 2.3));
          }
          quad(b.portal, b.portalColors, offset(center, -half - 0.08, 2.3), offset(center, half + 0.08, 2.3), offset(center, half + 0.08, 2.4), offset(center, -half - 0.08, 2.4));
          quad(b.kerb, null, offset(center, -half, 2.3), offset(center, half, 2.3), offset(center, half, 2.33), offset(center, -half, 2.33));
        }
      }
      travelled += length; lengthM += length;
    }
  }
  for (const j of junctions.values()) {
    if (j.count < 2) continue;
    const b = getBatch(j.floor), radius = j.width / 2;
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24, z = (i + 1) * Math.PI * 2 / 24;
      for (const height of [0, 2.6]) {
        const center = j.at.clone().add(new THREE.Vector3(0, height, 0));
        const p = center.clone().add(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
        const q = center.clone().add(new THREE.Vector3(Math.cos(z) * radius, 0, Math.sin(z) * radius));
        quad(b.shell, b.colors, center, p, q, center, [0.72, 0.72, 0.72, 0.72]);
      }
    }
  }
  const root = new THREE.Group(), walkable: THREE.Object3D[] = [], colliders: THREE.Object3D[] = [];
  let triangles = 0;
  for (const b of batches.values()) {
    const shellName = b.portal.length ? "greybox-portal" : "greybox-shell";
    b.shell = b.shell.concat(b.portal);
    b.colors = b.colors.concat(b.portalColors);
    for (const [name, data, colors, material] of [[shellName, b.shell, b.colors, shellMat], ["greybox-lights", b.lights, null, lightMat], ["greybox-kerb", b.kerb, null, kerbMat]] as const) {
      if (!data.length) continue;
      const part = new THREE.BufferGeometry();
      part.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      if (colors) part.setAttribute("color", new THREE.Uint8BufferAttribute(colors.map((c) => Math.round(c * 255)), 3, true));
      part.computeVertexNormals();
      const normal = part.getAttribute("normal");
      const packed = new Int8Array(normal.count * 3);
      for (let i = 0; i < normal.count; i++) {
        packed[i * 3] = Math.round(normal.getX(i) * 127);
        packed[i * 3 + 1] = Math.round(normal.getY(i) * 127);
        packed[i * 3 + 2] = Math.round(normal.getZ(i) * 127);
      }
      part.setAttribute("normal", new THREE.Int8BufferAttribute(packed, 3, true));
      const geometry = mergeGeometries([part])!; part.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
      mesh.userData = { greybox: true, approximate: true };
      if (name === "greybox-portal") {
        const shell = new THREE.Group(); shell.name = "greybox-shell"; shell.add(mesh); root.add(shell);
      } else root.add(mesh);
      triangles += data.length / 9;
      if (material === shellMat) { walkable.push(mesh); colliders.push(mesh); }
    }
  }
  return { root, walkable, colliders, wallSegments, openings, stats: { runs: runs.length, lengthM, portals: openings.length, meshes: root.children.length, triangles, buildMs: performance.now() - started } satisfies GreyboxStats };
}
