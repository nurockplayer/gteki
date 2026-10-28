import * as THREE from "three";
import type { Edge, StationBundle } from "@gteki/schema";
import { nodeDisplayZ } from "@gteki/navigation";

export type V3 = { x: number; y: number; z: number };

/** ENU → renderer (x, z, -y). */
export const R = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, -y);

/**
 * Flat ribbon along a renderer-space polyline (constant width in XZ, following Y), with
 * `u` = arc length (metres) for scrolling textures and `v` across the strip.
 */
export function ribbonGeometry(points: readonly THREE.Vector3[], width: number, lift = 0): THREE.BufferGeometry {
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
    uv.push(s, 0, s, 1);
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
export function edgePoints(bundle: StationBundle, edge: Edge, nodes: Map<string, StationBundle["nodes"][number]>, floors: Map<string, StationBundle["floors"][number]>): THREE.Vector3[] {
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
  const g = c.getContext("2d")!;
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
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 80, 8);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 50, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
