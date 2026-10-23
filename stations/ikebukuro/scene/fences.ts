// "Access unverified" fences from scene/access_fences.json (pipeline/build_access.py). They run along
// the outline of the routable areas, so free walking stays on floor whose access is verified. Invisible
// collision all round, plus a labelled panel where floor carries on outside. No route data.
import type * as THREE_NS from "three";
import { FONT } from "./signs.ts";
import { RAIL_FACE_OFFSET, RAIL_LABEL_H } from "./kit.ts";

export interface AccessFences {
  label: { ja: string; en: string };
  /** Collision panels: ends in ENU x, y (m), bottom and top in ENU z (m). */
  fences: { a: number[]; b: number[]; z0: number; z1: number }[];
  /** Labelled stretches where floor carries on outside: ends in ENU x, y, floor height z (m). */
  marks: { a: number[]; b: number[]; z: number }[];
}

const TILE_W = 2.4; // m of fence per label repeat
const PANEL_H = 1.2; // visible panel height (m); the collider is full height

function paintLabel(label: { ja: string; en: string }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(24, 22, 18, 0.82)";
  g.fillRect(0, 0, c.width, c.height);
  // Hazard bands top and bottom: reads as a temporary barrier, not as a wall.
  for (const y of [0, c.height - 34]) {
    g.save();
    g.beginPath();
    g.rect(0, y, c.width, 34);
    g.clip();
    for (let x = -64; x < c.width + 64; x += 64) {
      g.fillStyle = "#e8b400";
      g.beginPath();
      g.moveTo(x, y + 34);
      g.lineTo(x + 32, y);
      g.lineTo(x + 64, y);
      g.lineTo(x + 32, y + 34);
      g.fill();
    }
    g.restore();
  }
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `700 58px ${FONT}`;
  g.fillText(label.ja, c.width / 2, 106);
  g.font = `500 38px ${FONT}`;
  g.fillText(label.en, c.width / 2, 166);
  return c;
}

type ToRenderer = (x: number, y: number, z: number) => THREE_NS.Vector3;

/** A quad over the ends a to b, from height z0 to z1. `off` (m) pushes it along its front-face normal, so a label
 * can sit just off the face of a kit rail. The front side is the one the triangles (0 1 2) wind towards. */
function pushQuad(out: number[], toRenderer: ToRenderer, a: number[], b: number[], z0: number, z1: number, off = 0) {
  const v = [toRenderer(a[0]!, a[1]!, z0), toRenderer(b[0]!, b[1]!, z0), toRenderer(b[0]!, b[1]!, z1), toRenderer(a[0]!, a[1]!, z1)];
  if (off) {
    const dx = v[1]!.x - v[0]!.x, dz = v[1]!.z - v[0]!.z;
    const len = Math.hypot(dx, dz) || 1;
    for (const p of v) {
      p.x += (-dz / len) * off;
      p.z += (dx / len) * off;
    }
  }
  for (const k of [0, 1, 2, 0, 2, 3]) out.push(v[k]!.x, v[k]!.y, v[k]!.z);
}

/** The invisible full-height collision mesh of the fence panels (no canvas): what the walker is blocked by. */
export function buildFenceCollider(THREE: typeof THREE_NS, fences: AccessFences["fences"], toRenderer: ToRenderer) {
  const col: number[] = [];
  for (const f of fences) pushQuad(col, toRenderer, f.a, f.b, f.z0, f.z1);
  const colGeo = new THREE.BufferGeometry();
  colGeo.setAttribute("position", new THREE.Float32BufferAttribute(col, 3));
  const collider = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  collider.name = "access_fences_collider";
  collider.userData.gteki_role = "access_fences_collider";
  collider.visible = false;
  collider.updateMatrixWorld(true);
  collider.matrixAutoUpdate = false;
  return collider;
}

/**
 * `railed`: indices of `data.marks` that a kit rail (scene/kit.ts) now stands on. Their label faces sit just off the
 * rail's two faces and stop at its cap; every other stretch keeps the free-standing board. The collider is unchanged.
 */
export function buildAccessFences(
  THREE: typeof THREE_NS,
  data: AccessFences,
  toRenderer: ToRenderer,
  railed: ReadonlySet<number> = new Set(),
) {
  const vis: number[] = [], uv: number[] = [];
  const quad = (out: number[], a: number[], b: number[], z0: number, z1: number, off = 0) => pushQuad(out, toRenderer, a, b, z0, z1, off);
  data.marks.forEach((m, i) => {
    const u = Math.hypot(m.b[0]! - m.a[0]!, m.b[1]! - m.a[1]!) / TILE_W;
    const onRail = railed.has(i);
    // One single-sided face per side, each with its own UVs, so the label never reads mirrored.
    for (const [a, b] of [[m.a, m.b], [m.b, m.a]] as const) {
      quad(vis, a, b, m.z + 0.05, m.z + 0.05 + (onRail ? RAIL_LABEL_H : PANEL_H), onRail ? RAIL_FACE_OFFSET : 0);
      uv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1);
    }
  });
  const tex = new THREE.CanvasTexture(paintLabel(data.label));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const visGeo = new THREE.BufferGeometry();
  visGeo.setAttribute("position", new THREE.Float32BufferAttribute(vis, 3));
  visGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const visMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide, depthWrite: false, toneMapped: false });
  const visual = new THREE.Mesh(visGeo, visMat);
  visual.name = "access_fences";
  visual.userData.gteki_role = "access_fences";
  const collider = buildFenceCollider(THREE, data.fences, toRenderer);
  visual.updateMatrixWorld(true);
  visual.matrixAutoUpdate = false;
  return {
    visual,
    collider,
    dispose() {
      visGeo.dispose();
      visMat.dispose();
      tex.dispose();
      collider.geometry.dispose();
      collider.material.dispose();
    },
  };
}
