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
const ATLAS_W = 4096;
const GUTTER = 8; // px between faces; the gutter is panel colour so mip filtering never bleeds a foreign colour

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
  c.width = Math.min(ATLAS_W - 2 * GUTTER, width);
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

/** Shelf-pack face canvases (all the same height) into as few atlas pages as fit. */
function packAtlas(faces: HTMLCanvasElement[]) {
  const rowH = faces[0] ? faces[0].height + GUTTER : 0;
  const rowsPerPage = Math.max(1, Math.floor(ATLAS_W / Math.max(1, rowH)));
  const slots: { page: number; x: number; y: number }[] = [];
  let page = 0, row = 0, x = GUTTER;
  const pageRows: number[] = [0];
  for (const c of faces) {
    if (x + c.width + GUTTER > ATLAS_W) {
      row++;
      x = GUTTER;
      if (row >= rowsPerPage) {
        page++;
        row = 0;
        pageRows.push(0);
      }
    }
    slots.push({ page, x, y: GUTTER + row * rowH });
    pageRows[page] = row + 1;
    x += c.width + GUTTER;
  }
  const pages = pageRows.map((rows) => {
    const c = document.createElement("canvas");
    c.width = ATLAS_W;
    // Power-of-two height keeps mipmapping cheap on every GPU.
    c.height = Math.min(ATLAS_W, 2 ** Math.ceil(Math.log2(GUTTER + rows * rowH)));
    const g = c.getContext("2d")!;
    g.fillStyle = "#1c222b";
    g.fillRect(0, 0, c.width, c.height);
    return c;
  });
  faces.forEach((c, i) => pages[slots[i].page].getContext("2d")!.drawImage(c, slots[i].x, slots[i].y));
  return { pages, slots };
}

/** Concatenate indexed geometries (position, normal, optional uv) into one, after each one's matrix.
 *  Normals matter even with unlit materials: the GTAO post pass reads them. */
function merge(THREE: typeof THREE_NS, parts: { geo: THREE_NS.BufferGeometry; matrix: THREE_NS.Matrix4 }[], withUv: boolean) {
  const pos: number[] = [], normal: number[] = [], uv: number[] = [], index: number[] = [];
  for (const { geo, matrix } of parts) {
    geo.applyMatrix4(matrix);
    const base = pos.length / 3;
    pos.push(...(geo.getAttribute("position").array as Float32Array));
    normal.push(...(geo.getAttribute("normal").array as Float32Array));
    if (withUv) uv.push(...(geo.getAttribute("uv").array as Float32Array));
    const idx = geo.getIndex()!;
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  if (withUv) out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(index);
  out.computeBoundingSphere();
  return out;
}

/**
 * Build all signs as one group, positioned in the renderer frame via toRenderer.
 * Faces share atlas textures and all geometry is merged, so ~100 signs cost about three draw calls.
 */
export function buildSigns(THREE: typeof THREE_NS, specs: SignSpec[], toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3, anisotropy: number) {
  const group = new THREE.Group();
  group.name = "ikebukuro_signs";
  type Face = { canvas: HTMLCanvasElement; widthM: number; h: number; local: THREE_NS.Matrix4; sign: THREE_NS.Matrix4 };
  const faces: Face[] = [];
  const boxes: { geo: THREE_NS.BufferGeometry; matrix: THREE_NS.Matrix4 }[] = [];
  const face = (content: SignContent[], maxW: number) => {
    const fit = paintFitted(content, maxW);
    const widthM = Math.min(fit.widthM, maxW);
    return { canvas: fit.canvas, widthM, h: H * (widthM / fit.widthM) }; // last resort: scale a single item down
  };
  for (const s of specs) {
    const scale = s.scale ?? 1;
    const maxW = (s.maxWidthM ?? Infinity) / scale;
    const front = face([s], maxW);
    const backBlocks = (s.back ?? []).filter((b) => b.exits.length > 0 || b.gates.length > 0);
    const back = backBlocks.length ? face(backBlocks, maxW) : null;
    const width = Math.max(front.widthM, back?.widthM ?? 0);
    // Plane faces +Z in local space; rotate so it faces the ENU 'facing' vector.
    const f = toRenderer(s.facing.x, s.facing.y, 0).sub(toRenderer(0, 0, 0));
    const signM = new THREE.Matrix4().compose(
      toRenderer(s.position.x, s.position.y, s.position.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.x, f.z)),
      new THREE.Vector3(scale, scale, scale),
    );
    boxes.push({ geo: new THREE.BoxGeometry(width + 0.06, H + 0.06, 0.08), matrix: signM });
    faces.push({ ...front, local: new THREE.Matrix4().makeTranslation(0, 0, 0.041), sign: signM });
    if (back) faces.push({ ...back, local: new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, -0.041), sign: signM });
  }

  // Unlit: the station has no dynamic lights (baked lighting only).
  const housing = new THREE.MeshBasicMaterial({ color: 0x4f565f });
  group.add(new THREE.Mesh(merge(THREE, boxes, false), housing));

  const { pages, slots } = packAtlas(faces.map((x) => x.canvas));
  const textures: THREE_NS.Texture[] = [];
  pages.forEach((page, pi) => {
    const tex = new THREE.CanvasTexture(page);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    const parts = faces.flatMap((fc, i) => {
      if (slots[i].page !== pi) return [];
      const geo = new THREE.PlaneGeometry(fc.widthM, fc.h);
      // Remap the plane's 0..1 UVs onto this face's atlas rectangle (CanvasTexture flips Y).
      const u0 = slots[i].x / page.width, u1 = (slots[i].x + fc.canvas.width) / page.width;
      const vTop = 1 - slots[i].y / page.height, vBot = 1 - (slots[i].y + fc.canvas.height) / page.height;
      const uv = geo.getAttribute("uv") as THREE_NS.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), vBot + uv.getY(k) * (vTop - vBot));
      return [{ geo, matrix: fc.sign.clone().multiply(fc.local) }];
    });
    // Internally lit sign face (unlit material, mild boost).
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.color.setScalar(1.1);
    group.add(new THREE.Mesh(merge(THREE, parts, true), mat));
  });
  group.userData = { gteki_role: "sign" };

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
