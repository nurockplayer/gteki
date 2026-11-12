import * as THREE from "three";
import { segmentExclusionCuts, subtractPlan, type PlanExclusion, type PlanPoint } from "./walkableModel.ts";
import type { Edge, StationBundle } from "@gteki/schema";
import { nodeDisplayZ } from "@gteki/navigation";

export type V3 = { x: number; y: number; z: number };

/** ENU → renderer (x, z, -y). */
export const R = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, -y);

/** Route ribbon width in metres: 0.40 m at the walking camera so it reads as a guide line, 1.1 m in overview. */
export const ROUTE_RIBBON_WIDTH_WALK = 0.4;
export const ROUTE_RIBBON_WIDTH_OVERVIEW = 1.1;

/** Chevron pitch along the ribbon: ~0.9 m while walking (unstretched), 1.8 m in overview (today's look). */
export const ROUTE_CHEVRON_PITCH_WALK = 0.9;
export const ROUTE_CHEVRON_PITCH_OVERVIEW = 1.8;

/** Near-camera fade of the walking ribbon: invisible under 2.5 m from the camera, fully drawn by 5 m. */
export const ROUTE_FADE_NEAR_M = 2.5;
export const ROUTE_FADE_FAR_M = 5;

/**
 * Fades a route ribbon's fragments out near the camera, so the band never fills the low walking frame.
 * The vertex pass carries the fragment's world position (varyings interpolate perspective-correct) and the
 * fragment pass multiplies the material alpha by a smoothstep on the true distance to the camera; a vertex-only
 * distance would stay large across a long segment that passes under the camera and never fade there.
 */
export function routeNearFade(material: THREE.Material, near = ROUTE_FADE_NEAR_M, far = ROUTE_FADE_FAR_M): void {
  material.customProgramCacheKey = () => `route-near-fade-${near}-${far}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vRouteWorld;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tvRouteWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec3 vRouteWorld;\nvoid main() {")
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n\tgl_FragColor.a *= smoothstep( ${near.toFixed(3)}, ${far.toFixed(3)}, distance( vRouteWorld, cameraPosition ) );`);
  };
}

/**
 * Flat ribbon along a renderer-space polyline (constant width in XZ, following Y), with
 * `u` = arc length (metres) × `uScale` for scrolling textures and `v` across the strip.
 */
export function steppedProfile(samples: readonly THREE.Vector3[]): THREE.Vector3[] {
  if (samples.length < 2 || !samples.some((p, i) => i > 0 && Math.abs(p.y - samples[i - 1]!.y) > 0.05)) return [...samples];
  const out = [samples[0]!.clone()];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!, p = samples[i]!;
    if (Math.abs(p.y - prev.y) > 0.05) {
      const edge = p.y > prev.y ? prev : p;
      out.push(new THREE.Vector3(edge.x, prev.y, edge.z), new THREE.Vector3(edge.x, p.y, edge.z));
    }
  }
  out.push(samples[samples.length - 1]!.clone());
  return out.filter((p, i) => i === 0 || !p.equals(out[i - 1]!));
}

/** Sample steep segments against nearby ground; vertical segments retain their endpoints. */
export function routeSegmentProfile(a: THREE.Vector3, b: THREE.Vector3, groundHeight: (p: THREE.Vector3) => number | undefined): THREE.Vector3[] {
  const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
  if (horizontal === 0 || Math.abs(b.y - a.y) <= horizontal * Math.tan(Math.PI / 12)) return [a, b];
  const count = Math.ceil(horizontal / 0.05);
  const samples = Array.from({ length: count + 1 }, (_, j) => {
    const p = a.clone().lerp(b, j / count);
    const height = groundHeight(p);
    if (height !== undefined && Math.abs(height - p.y) <= 0.6) p.y = height;
    return p;
  });
  return steppedProfile(samples);
}

export function ribbonGeometry(points: readonly THREE.Vector3[], width: number, lift = 0, uScale = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const h = Math.hypot(tx, tz) || 1;
    tx /= h;
    tz /= h;
    // Miter at joints, clamped so sharp corners don't spike.
    let scale = 1;
    if (i > 0 && i < points.length - 1) {
      const ax = p.x - prev.x, az = p.z - prev.z, bx = next.x - p.x, bz = next.z - p.z;
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      const cos = (ax * bx + az * bz) / (la * lb);
      scale = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + cos) / 2)));
    }
    const nx = -tz * (width / 2) * scale;
    const nz = tx * (width / 2) * scale;
    if (i > 0) s += p.distanceTo(prev);
    pos.push(p.x + nx, p.y + lift, p.z + nz, p.x - nx, p.y + lift, p.z - nz);
    uv.push(s * uScale, 0, s * uScale, 1);
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Renderer-space polyline for an edge, with display heights for unknown z (never routed on). */
export function edgePoints(bundle: Pick<StationBundle, "nodes" | "floors">, edge: Edge, nodes: Map<string, StationBundle["nodes"][number]>, floors: Map<string, StationBundle["floors"][number]>): THREE.Vector3[] {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return [];
  const za = nodeDisplayZ(from, floors.get(from.floorId)).z;
  const zb = nodeDisplayZ(to, floors.get(to.floorId)).z;
  const raw = edge.geometry && edge.geometry.length >= 2 ? edge.geometry : [from.position, to.position];
  const lens = [0];
  for (let i = 1; i < raw.length; i++) lens.push(lens[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
  const total = lens[lens.length - 1]! || 1;
  return raw.map((p, i) => {
    const z = i === 0 ? za : i === raw.length - 1 ? zb : p.z ?? za + (zb - za) * (lens[i]! / total);
    return R(i === 0 ? from.position.x : i === raw.length - 1 ? to.position.x : p.x, i === 0 ? from.position.y : i === raw.length - 1 ? to.position.y : p.y, z);
  });
}

/** Canvas texture of chevrons for the animated route ribbon. */
export function chevronTexture(color = "#5ef0ff"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = "rgba(94,240,255,0.22)";
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(44, 12);
  g.lineTo(76, 32);
  g.lineTo(44, 52);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White dashes (1 m on, 0.6 m off at repeat 1/1.6) for the "no model" route overlay; tinted by the material. */
export function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 80;
  c.height = 8;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.clearRect(0, 0, 80, 8);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 50, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Remove explicit holes from graph triangles on their floor, preserving the authored surface height. */
export function clipFlatGeometry(geometry: THREE.BufferGeometry, holes: readonly PlanExclusion[], levels: readonly string[], heights: readonly number[], offset = new THREE.Vector3()): THREE.BufferGeometry {
  if (!holes.length) return geometry;
  const position = geometry.getAttribute("position"), count = geometry.index?.count ?? position.count, out: number[] = [];
  let hasCuts = false;
  for (let i = 0; i < count; i += 3) {
    const corners = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(position, geometry.index?.getX(i + j) ?? i + j).add(offset));
    const low = Math.min(...corners.map((p) => p.y)), high = Math.max(...corners.map((p) => p.y));
    const cuts = holes.flatMap((plane) => segmentExclusionCuts(plane, levels, { y: low }, { y: high }, heights));
    if (!cuts.length) { for (const p of corners) out.push(p.x - offset.x, p.y - offset.y, p.z - offset.z); continue; }
    hasCuts = true;
    const a = corners[0]!, normal = corners[1]!.clone().sub(a).cross(corners[2]!.clone().sub(a));
    const height = (p: PlanPoint) => a.y - (normal.x * (p.x - a.x) + normal.z * (p.z - a.z)) / normal.y;
    if (Math.abs(normal.y) < 1e-12) { for (const p of corners) out.push(p.x - offset.x, p.y - offset.y, p.z - offset.z); continue; }
    for (const polygon of subtractPlan(corners, cuts)) {
      const rings = polygon.map((ring) => ring.map((p) => new THREE.Vector2(p.x, p.z)));
      const faces = THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)), points = rings.flat();
      for (const face of faces) {
        const triangle = face.map((index) => points[index]!);
        const [a, b, c] = triangle as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
        if (((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) !== (normal.y > 0)) triangle.reverse();
        for (const p of triangle) out.push(p.x - offset.x, height({ x: p.x, z: p.y }) - offset.y, p.y - offset.z);
      }
    }
  }
  if (!hasCuts) return geometry;
  const clipped = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  clipped.computeVertexNormals();
  return clipped;
}
