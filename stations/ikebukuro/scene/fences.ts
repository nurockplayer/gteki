// "Access unverified" fences from scene/access_fences.json (pipeline/build_access.py). They close
// the ends of surveyed passages that would link routable areas by a way the graph never verified,
// so free walking can't present them as public shortcuts. Collision plus a label; no route data.
import type * as THREE_NS from "three";
import { FONT } from "./signs.ts";

export interface FenceSpec {
  /** Ends in ENU x, y (m). */
  a: number[];
  b: number[];
  /** Bottom and top of the collision panel (ENU z, m). */
  z0: number;
  z1: number;
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

export function buildAccessFences(
  THREE: typeof THREE_NS,
  fences: FenceSpec[],
  label: { ja: string; en: string },
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
) {
  const vis: number[] = [], uv: number[] = [], col: number[] = [];
  for (const f of fences) {
    const [ax, ay] = f.a as [number, number], [bx, by] = f.b as [number, number];
    const u = Math.hypot(bx - ax, by - ay) / TILE_W;
    const top = f.z0 + 0.05 + PANEL_H;
    const quad = (out: number[], z0: number, z1: number, flip = false) => {
      const [p, q] = flip ? [[bx, by], [ax, ay]] : [[ax, ay], [bx, by]];
      const v = [toRenderer(p[0]!, p[1]!, z0), toRenderer(q[0]!, q[1]!, z0), toRenderer(q[0]!, q[1]!, z1), toRenderer(p[0]!, p[1]!, z1)];
      for (const k of [0, 1, 2, 0, 2, 3]) out.push(v[k]!.x, v[k]!.y, v[k]!.z);
    };
    // One single-sided face per side, each with its own UVs, so the label never reads mirrored.
    for (const flip of [false, true]) {
      quad(vis, f.z0 + 0.05, top, flip);
      uv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1);
    }
    quad(col, f.z0, f.z1);
  }
  const tex = new THREE.CanvasTexture(paintLabel(label));
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
  const colGeo = new THREE.BufferGeometry();
  colGeo.setAttribute("position", new THREE.Float32BufferAttribute(col, 3));
  const collider = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  collider.name = "access_fences_collider";
  collider.userData.gteki_role = "access_fences_collider";
  collider.visible = false;
  for (const m of [visual, collider]) {
    m.updateMatrixWorld(true);
    m.matrixAutoUpdate = false;
  }
  return {
    visual,
    collider,
    dispose() {
      visGeo.dispose();
      visMat.dispose();
      tex.dispose();
      colGeo.dispose();
      collider.material.dispose();
    },
  };
}
