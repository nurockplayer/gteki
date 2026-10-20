// Overhead wayfinding signs built from scene/signage.json (derived from the
// verified graph by pipeline/build_signage.py). GTEki's own sign style:
// charcoal panel, white type, exit numbers on yellow badges (the common
// Japanese exit colour convention). No operator logos or typefaces.
import type * as THREE_NS from "three";

interface SignContent {
  exits: { id: string; label: string; ja: string | null; en: string | null }[];
  gates: { id: string; ja: string | null; en: string | null }[];
}

export interface SignSpec extends SignContent {
  id: string;
  position: { x: number; y: number; z: number };
  facing: { x: number; y: number };
  /** Read when walking toward the junction: destinations straight ahead through it. */
  back?: SignContent;
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

function drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(cx, cy - s * 0.5);
  g.lineTo(cx + s * 0.42, cy);
  g.lineTo(cx + s * 0.14, cy);
  g.lineTo(cx + s * 0.14, cy + s * 0.5);
  g.lineTo(cx - s * 0.14, cy + s * 0.5);
  g.lineTo(cx - s * 0.14, cy);
  g.lineTo(cx - s * 0.42, cy);
  g.closePath();
  g.fill();
}

/** Draw one sign face; returns canvas and physical width in metres. */
function paint(spec: SignContent): { canvas: HTMLCanvasElement; widthM: number } {
  const h = Math.round(H * PX_PER_M);
  const measure = document.createElement("canvas").getContext("2d")!;
  const pad = 22;
  const badge = h - 2 * pad - 34;
  const parts: { w: number; draw: (g: CanvasRenderingContext2D, x: number) => void }[] = [];
  parts.push({ w: h * 0.62, draw: (g, x) => drawArrow(g, x + h * 0.31, h / 2, h * 0.58) });
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

/** Build all signs as one group, positioned in the renderer frame via toRenderer. */
export function buildSigns(THREE: typeof THREE_NS, specs: SignSpec[], toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3, anisotropy: number) {
  const group = new THREE.Group();
  group.name = "ikebukuro_signs";
  // Unlit: the station has no dynamic lights (baked lighting only).
  const housing = new THREE.MeshBasicMaterial({ color: 0x4f565f });
  const textures: THREE_NS.Texture[] = [];
  const face = (content: SignContent) => {
    const { canvas, widthM } = paint(content);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    // Internally lit sign face (unlit material, mild boost).
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.color.setScalar(1.1);
    return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(widthM, H), mat), widthM };
  };
  for (const s of specs) {
    const front = face(s);
    const hasBack = !!s.back && (s.back.exits.length > 0 || s.back.gates.length > 0);
    const back = hasBack ? face(s.back!) : null;
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
