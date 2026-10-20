// Overhead wayfinding signs built from scene/signage.json (derived from the
// verified graph by pipeline/build_signage.py). GTEki's own sign style:
// charcoal panel, white type, exit numbers on yellow badges (the common
// Japanese exit colour convention). No operator logos or typefaces.
import type * as THREE_NS from "three";

type Arrow = "up" | "left" | "right";

interface SignContent {
  /** Direction to take at the junction for everything in this block (default straight on). */
  arrow?: Arrow;
  exits: { id: string; label: string; ja: string | null; en: string | null }[];
  gates: { id: string; ja: string | null; en: string | null }[];
}

export interface SignSpec extends SignContent {
  id: string;
  position: { x: number; y: number; z: number };
  facing: { x: number; y: number };
  /** Read when walking toward the junction: one block per turn taken there (left, straight on, right). */
  back?: SignContent[];
  /** Clear passage width at the sign (m); content is trimmed to fit. */
  maxWidthM?: number;
  /** Panel scale (< 1 only where a low ceiling leaves less than the full panel height). */
  scale?: number;
}

const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",system-ui,sans-serif';
const PX_PER_M = 300;
const H = 0.42;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, arrow: Arrow) {
  g.save();
  g.translate(cx, cy);
  g.rotate(arrow === "left" ? -Math.PI / 2 : arrow === "right" ? Math.PI / 2 : 0);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(0, -s * 0.5);
  g.lineTo(s * 0.42, 0);
  g.lineTo(s * 0.14, 0);
  g.lineTo(s * 0.14, s * 0.5);
  g.lineTo(-s * 0.14, s * 0.5);
  g.lineTo(-s * 0.14, 0);
  g.lineTo(-s * 0.42, 0);
  g.closePath();
  g.fill();
  g.restore();
}

type Part = { w: number; draw: (g: CanvasRenderingContext2D, x: number) => void };

/** Draw one sign face (one or more arrow blocks); returns canvas and physical width in metres. */
function paint(blocks: SignContent[]): { canvas: HTMLCanvasElement; widthM: number } {
  const h = Math.round(H * PX_PER_M);
  const pad = 22;
  const parts: Part[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) {
      parts.push({ w: 34, draw: (g, x) => { g.fillStyle = "#4a5361"; g.fillRect(x + 15, 18, 4, h - 36); } });
    }
    parts.push(...blockParts(b, h, pad));
  });
  const width = Math.ceil(parts.reduce((s, p) => s + p.w, 0) + pad * 2);
  const c = document.createElement("canvas");
  c.width = Math.min(4096, width);
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c222b";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#2b3340";
  g.fillRect(0, 0, c.width, 6);
  let x = pad;
  for (const p of parts) {
    p.draw(g, x);
    x += p.w;
  }
  return { canvas: c, widthM: c.width / PX_PER_M };
}

/** Paint, trimming the fullest block until the face fits maxW: a second gate goes first
 *  (gates usually share the same way), then the farthest exits. */
function paintFitted(blocks: SignContent[], maxW: number) {
  let b = blocks.map((x) => ({ ...x, exits: [...x.exits], gates: [...x.gates] }));
  for (;;) {
    const r = paint(b);
    const fullest = [...b].sort((p, q) => q.exits.length + q.gates.length - (p.exits.length + p.gates.length))[0];
    if (r.widthM <= maxW || fullest.exits.length + fullest.gates.length <= 1) return r;
    if (fullest.gates.length > 1 || !fullest.exits.length) fullest.gates.pop();
    else if (fullest.exits.length > 1 || !fullest.gates.length) fullest.exits.pop();
    else fullest.gates.pop();
    b = b.filter((x) => x.exits.length || x.gates.length);
  }
}

function blockParts(spec: SignContent, h: number, pad: number): Part[] {
  const measure = document.createElement("canvas").getContext("2d")!;
  const badge = h - 2 * pad - 34;
  const parts: Part[] = [];
  const arrow = spec.arrow ?? "up";
  parts.push({ w: h * 0.62, draw: (g, x) => drawArrow(g, x + h * 0.31, h / 2, h * 0.58, arrow) });
  if (spec.exits.length) {
    measure.font = `600 ${Math.round(h * 0.2)}px ${FONT}`;
    const lw = Math.max(measure.measureText("出口").width, measure.measureText("Exit").width) + 18;
    parts.push({
      w: lw,
      draw: (g, x) => {
        g.fillStyle = "#ffffff";
        g.font = `600 ${Math.round(h * 0.2)}px ${FONT}`;
        g.textBaseline = "middle";
        g.fillText("出口", x, h * 0.36);
        g.font = `500 ${Math.round(h * 0.15)}px ${FONT}`;
        g.fillText("Exit", x + 4, h * 0.68);
      },
    });
    for (const e of spec.exits) {
      const bw = Math.max(badge, 30 + e.label.length * badge * 0.42);
      parts.push({
        w: bw + 12,
        draw: (g, x) => {
          g.fillStyle = "#ffd200";
          roundRect(g, x, (h - badge) / 2, bw, badge, 10);
          g.fill();
          g.fillStyle = "#151515";
          g.font = `700 ${Math.round(badge * 0.62)}px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(e.label, x + bw / 2, h / 2 + 3);
          g.textAlign = "left";
        },
      });
    }
  }
  for (const gate of spec.gates) {
    measure.font = `600 ${Math.round(h * 0.24)}px ${FONT}`;
    const ja = gate.ja ?? "";
    const en = gate.en ?? "";
    const tw = Math.max(measure.measureText(ja).width, (measure.measureText(en).width * 0.15) / 0.24) + 30;
    parts.push({
      w: tw,
      draw: (g, x) => {
        g.fillStyle = "#ffffff";
        g.textBaseline = "middle";
        g.font = `600 ${Math.round(h * 0.24)}px ${FONT}`;
        g.fillText(ja, x + 14, h * 0.38);
        g.font = `500 ${Math.round(h * 0.15)}px ${FONT}`;
        g.fillStyle = "#d6dde6";
        g.fillText(en, x + 16, h * 0.72);
      },
    });
  }
  return parts;
}

/** Build all signs as one group, positioned in the renderer frame via toRenderer. */
export function buildSigns(THREE: typeof THREE_NS, specs: SignSpec[], toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3, anisotropy: number) {
  const group = new THREE.Group();
  group.name = "ikebukuro_signs";
  // Unlit: the station has no dynamic lights (baked lighting only).
  const housing = new THREE.MeshBasicMaterial({ color: 0x4f565f });
  const textures: THREE_NS.Texture[] = [];
  const face = (content: SignContent[], maxW: number) => {
    const fit = paintFitted(content, maxW);
    const { canvas } = fit;
    const widthM = Math.min(fit.widthM, maxW);
    const h = H * (widthM / fit.widthM); // last resort: scale a single item down
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    // Internally lit sign face (unlit material, mild boost).
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.color.setScalar(1.1);
    return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(widthM, h), mat), widthM };
  };
  for (const s of specs) {
    const scale = s.scale ?? 1;
    const maxW = (s.maxWidthM ?? Infinity) / scale;
    const front = face([s], maxW);
    const backBlocks = (s.back ?? []).filter((b) => b.exits.length > 0 || b.gates.length > 0);
    const back = backBlocks.length ? face(backBlocks, maxW) : null;
    const width = Math.max(front.widthM, back?.widthM ?? 0);
    const box = new THREE.Mesh(new THREE.BoxGeometry(width + 0.06, H + 0.06, 0.08), housing);
    front.mesh.position.z = 0.041;
    const sign = new THREE.Group();
    sign.add(box, front.mesh);
    if (back) {
      back.mesh.position.z = -0.041;
      back.mesh.rotation.y = Math.PI;
      sign.add(back.mesh);
    }
    const p = toRenderer(s.position.x, s.position.y, s.position.z);
    sign.position.copy(p);
    sign.scale.setScalar(scale);
    // Plane faces +Z in local space; rotate so it faces the ENU 'facing' vector.
    const f = toRenderer(s.facing.x, s.facing.y, 0).sub(toRenderer(0, 0, 0));
    sign.rotation.y = Math.atan2(f.x, f.z);
    sign.userData = { gteki_role: "sign", signId: s.id };
    group.add(sign);
  }
  return {
    group,
    dispose() {
      textures.forEach((t) => t.dispose());
      group.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE_NS.Material).dispose();
        }
      });
    },
  };
}
