// Overhead wayfinding signs built from scene/signage.json (derived from the
// verified graph by pipeline/build_signage.py). GTEki's own sign style:
// charcoal panel, white type, exit numbers on yellow badges (the common
// Japanese exit colour convention). No operator logos or typefaces.
import type * as THREE_NS from "three";

type Arrow = "up" | "left" | "right";

interface SignContent {
  /** Direction to take at the junction for everything in this block (default straight on). */
  arrow?: Arrow;
  /** `distanceM`: walking distance still to go from this sign (graph lengths, rounded; repeater signs only). */
  exits: { id: string; label: string; ja: string | null; en: string | null; distanceM?: number }[];
  gates: { id: string; ja: string | null; en: string | null; distanceM?: number }[];
  /** Named areas ahead (POIs of category "other": the area names as printed on the reference map), place boards only. */
  places?: { id: string; ja: string | null; en: string | null; distanceM?: number }[];
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
  /** "repeat": a repeater along a long passage (not at a junction); draws like any other sign.
   *  "place": a place-name board along a long passage (areas ahead and behind, with distances); drawn on a blue panel. */
  kind?: "repeat" | "place";
  /** Where the content comes from (graph edge, POIs, access fact); data only. */
  basis?: string[];
}

export const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",system-ui,sans-serif';
const PX_PER_M = 300;
const H = 0.42;
const ATLAS_W = 4096; // atlas page side (px), lowered to the GPU's MAX_TEXTURE_SIZE where that is smaller
/** Phone tier ("low") paints faces at this fraction of full size (150 px/m). It was 0.54 until #108's place boards
 *  used the last spare rows of the one 4096 x 2048 page; 0.5 leaves several rows spare (scene/signage.test.ts pins it). */
export const LOW_TEXEL_SCALE = 0.5;
const GUTTER = 8; // px between faces; the gutter is panel colour so mip filtering never bleeds a foreign colour
/** Operator chips before gate names, keyed by POI id prefix: plain lettering on a line-colour square
 *  (GTEki style, no operator logo). Only operators with routable gates need an entry. */
const GATE_CHIPS: { prefix: string; text: string; bg: string }[] = [{ prefix: "jr-", text: "JR", bg: "#2e9e4f" }];

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

/** Panel colours. Direction signs are charcoal; place boards are a deeper blue so that the two kinds
 *  never read alike down a long passage. The atlas page background stays the charcoal gutter colour. */
type Theme = { panel: string; rule: string; divider: string };
const THEME_DIRECTION: Theme = { panel: "#1c222b", rule: "#2b3340", divider: "#4a5361" };
const THEME_PLACE: Theme = { panel: "#124a68", rule: "#2f7fa6", divider: "#5b93b3" };

/** "~140 m": the distance still to go, small type under an exit badge / after a gate's English name. */
const distLabel = (m: number) => `~${m} m`;

/** Draw one sign face (one or more arrow blocks); returns canvas and physical width in metres. */
function paint(blocks: SignContent[], theme: Theme): { canvas: HTMLCanvasElement; widthM: number } {
  const h = Math.round(H * PX_PER_M);
  const pad = 22;
  const parts: Part[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) {
      parts.push({ w: 34, draw: (g, x) => { g.fillStyle = theme.divider; g.fillRect(x + 15, 18, 4, h - 36); } });
    }
    parts.push(...blockParts(b, h, pad));
  });
  const width = Math.ceil(parts.reduce((s, p) => s + p.w, 0) + pad * 2);
  const c = document.createElement("canvas");
  c.width = Math.min(ATLAS_W - 2 * GUTTER, width);
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = theme.panel;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = theme.rule;
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
function paintFitted(blocks: SignContent[], maxW: number, theme: Theme = THEME_DIRECTION) {
  let b = blocks.map((x) => ({ ...x, exits: [...x.exits], gates: [...x.gates], places: [...(x.places ?? [])] }));
  const n = (x: SignContent) => x.exits.length + x.gates.length + (x.places?.length ?? 0);
  for (;;) {
    const r = paint(b, theme);
    const fullest = [...b].sort((p, q) => n(q) - n(p))[0]!;
    if (r.widthM <= maxW || n(fullest) <= 1) return r;
    if (fullest.places!.length > 1) fullest.places!.pop();
    else if (fullest.gates.length > 1 || !fullest.exits.length) fullest.gates.pop();
    else if (fullest.exits.length > 1 || !fullest.gates.length) fullest.exits.pop();
    else fullest.gates.pop();
    b = b.filter((x) => n(x) > 0);
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
      const dText = e.distanceM != null ? distLabel(e.distanceM) : null;
      let pw = bw;
      if (dText) {
        measure.font = `600 ${Math.round(h * 0.16)}px ${FONT}`;
        pw = Math.max(bw, measure.measureText(dText).width + 8);
      }
      parts.push({
        w: pw + 12,
        draw: (g, x) => {
          const bx = x + (pw - bw) / 2;
          g.fillStyle = "#ffd200";
          roundRect(g, bx, (h - badge) / 2, bw, badge, 10);
          g.fill();
          g.fillStyle = "#151515";
          g.font = `700 ${Math.round(badge * 0.62)}px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(e.label, bx + bw / 2, h / 2 + 3);
          if (dText) {
            g.fillStyle = "#d6dde6";
            g.font = `600 ${Math.round(h * 0.16)}px ${FONT}`;
            g.fillText(dText, x + pw / 2, h - 18);
          }
          g.textAlign = "left";
        },
      });
    }
  }
  for (const place of spec.places ?? []) {
    const ja = place.ja ?? "";
    const en = place.en ?? "";
    const dText = place.distanceM != null ? distLabel(place.distanceM) : null;
    measure.font = `700 ${Math.round(h * 0.3)}px ${FONT}`;
    const jaW = measure.measureText(ja).width;
    measure.font = `500 ${Math.round(h * 0.16)}px ${FONT}`;
    const enW = measure.measureText(en).width;
    const dW = dText ? measure.measureText(dText).width : 0;
    const tw = Math.max(jaW, enW + (dText ? 16 + dW : 0)) + 36;
    parts.push({
      w: tw,
      draw: (g, x) => {
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillStyle = "#ffffff";
        g.font = `700 ${Math.round(h * 0.3)}px ${FONT}`;
        g.fillText(ja, x + 14, h * 0.36);
        g.fillStyle = "#d6e8f2";
        g.font = `500 ${Math.round(h * 0.16)}px ${FONT}`;
        g.fillText(en, x + 16, h * 0.73);
        if (dText) {
          g.fillStyle = "#ffd200";
          g.font = `600 ${Math.round(h * 0.16)}px ${FONT}`;
          g.fillText(dText, x + 16 + enW + 16, h * 0.73);
        }
      },
    });
  }
  for (const gate of spec.gates) {
    const chip = GATE_CHIPS.find((c) => gate.id.startsWith(c.prefix));
    // The chip carries the operator, so the name drops a leading "JR " that would repeat it.
    const strip = (t: string) => (chip && t.startsWith(chip.text + " ") ? t.slice(chip.text.length + 1) : t);
    measure.font = `600 ${Math.round(h * 0.24)}px ${FONT}`;
    const ja = strip(gate.ja ?? "");
    const en = strip(gate.en ?? "");
    const cw = chip ? badge * 1.15 : 0;
    const off = chip ? cw + 12 : 0;
    const dText = gate.distanceM != null ? distLabel(gate.distanceM) : null;
    const enW = (measure.measureText(en).width * 0.15) / 0.24;
    const dW = dText ? (measure.measureText(dText).width * 0.15) / 0.24 : 0;
    const tw = Math.max(measure.measureText(ja).width, enW + (dText ? 14 + dW : 0)) + 30 + off;
    parts.push({
      w: tw,
      draw: (g, x) => {
        if (chip) {
          g.fillStyle = chip.bg;
          roundRect(g, x + 14, (h - badge) / 2, cw, badge, 10);
          g.fill();
          g.fillStyle = "#ffffff";
          g.font = `800 ${Math.round(badge * 0.5)}px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(chip.text, x + 14 + cw / 2, h / 2 + 2);
          g.textAlign = "left";
        }
        g.fillStyle = "#ffffff";
        g.textBaseline = "middle";
        g.font = `600 ${Math.round(h * 0.24)}px ${FONT}`;
        g.fillText(ja, x + 14 + off, h * 0.38);
        g.font = `500 ${Math.round(h * 0.15)}px ${FONT}`;
        g.fillStyle = "#d6dde6";
        g.fillText(en, x + 16 + off, h * 0.72);
        if (dText) {
          g.fillStyle = "#ffd200";
          g.font = `600 ${Math.round(h * 0.15)}px ${FONT}`;
          g.fillText(dText, x + 16 + off + enW + 14, h * 0.72);
        }
      },
    });
  }
  return parts;
}

/** Shelf-pack face canvases (all the same height) into as few atlas pages of side `side` px as fit, drawn
 *  at `scale` (< 1 on low quality: same layout, fewer texels). A face wider than a page is drawn narrower
 *  (fewer texels across, same size in the scene). Slots carry the drawn size for the UVs. */
function packAtlas(faces: HTMLCanvasElement[], backgrounds: string[], scale: number, side: number) {
  const dims = faces.map((c) => ({ w: Math.min(side - 2 * GUTTER, Math.ceil(c.width * scale)), h: Math.round(c.height * scale) }));
  const rowH = dims[0] ? dims[0].h + GUTTER : 0;
  const rowsPerPage = Math.max(1, Math.floor(side / Math.max(1, rowH)));
  const slots: { page: number; x: number; y: number; w: number; h: number }[] = new Array(dims.length);
  let page = 0, row = 0, x = GUTTER;
  const pageRows: number[] = [0];
  // Widest first: a shelf then ends close to the page edge, so fewer rows are wasted on ragged tails.
  const order = dims.map((_, i) => i).sort((p, q) => dims[q]!.w - dims[p]!.w || p - q);
  for (const i of order) {
    const d = dims[i]!;
    if (x + d.w + GUTTER > side) {
      row++;
      x = GUTTER;
      if (row >= rowsPerPage) {
        page++;
        row = 0;
        pageRows.push(0);
      }
    }
    slots[i] = { page, x, y: GUTTER + row * rowH, ...d };
    pageRows[page] = row + 1;
    x += d.w + GUTTER;
  }
  const pages = pageRows.map((rows, pi) => {
    const c = document.createElement("canvas");
    // Power-of-two sides keep mipmapping cheap on every GPU; a short last page also narrows.
    c.height = Math.min(side, 2 ** Math.ceil(Math.log2(GUTTER + rows * rowH)));
    c.width = rows > 1 ? side : 2 ** Math.ceil(Math.log2(Math.max(64, ...slots.filter((s) => s.page === pi).map((s) => s.x + s.w + GUTTER))));
    const g = c.getContext("2d")!;
    g.fillStyle = "#1c222b";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = "high";
    return c;
  });
  faces.forEach((c, i) => {
    const s = slots[i]!;
    const g = pages[s.page]!.getContext("2d")!;
    // Half the gutter around a face takes its own panel colour, so mip filtering never pulls a neighbour's in.
    g.fillStyle = backgrounds[i]!;
    g.fillRect(s.x - GUTTER / 2, s.y - GUTTER / 2, s.w + GUTTER, s.h + GUTTER);
    g.drawImage(c, s.x, s.y, s.w, s.h);
  });
  return { pages, slots, rowsPerPage, rowsUsed: pageRows, rowH };
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
export function buildSigns(
  THREE: typeof THREE_NS,
  specs: SignSpec[],
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
  anisotropy: number,
  texelScale = 1,
  maxTextureSize = ATLAS_W,
) {
  const group = new THREE.Group();
  group.name = "ikebukuro_signs";
  type Face = { canvas: HTMLCanvasElement; widthM: number; h: number; bg: string; local: THREE_NS.Matrix4; sign: THREE_NS.Matrix4 };
  const faces: Face[] = [];
  const boxes: { geo: THREE_NS.BufferGeometry; matrix: THREE_NS.Matrix4 }[] = [];
  const face = (content: SignContent[], maxW: number, theme: Theme) => {
    const fit = paintFitted(content, maxW, theme);
    const widthM = Math.min(fit.widthM, maxW);
    return { canvas: fit.canvas, widthM, h: H * (widthM / fit.widthM), bg: theme.panel }; // last resort: scale a single item down
  };
  for (const s of specs) {
    const scale = s.scale ?? 1;
    const maxW = (s.maxWidthM ?? Infinity) / scale;
    const theme = s.kind === "place" ? THEME_PLACE : THEME_DIRECTION;
    const front = face([s], maxW, theme);
    const backBlocks = (s.back ?? []).filter((b) => b.exits.length > 0 || b.gates.length > 0 || (b.places?.length ?? 0) > 0);
    const back = backBlocks.length ? face(backBlocks, maxW, theme) : null;
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

  const { pages, slots, rowsPerPage, rowsUsed, rowH } = packAtlas(faces.map((x) => x.canvas), faces.map((x) => x.bg), texelScale, Math.min(ATLAS_W, maxTextureSize));
  const textures: THREE_NS.Texture[] = [];
  pages.forEach((page, pi) => {
    const tex = new THREE.CanvasTexture(page);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    const parts = faces.flatMap((fc, i) => {
      if (slots[i]!.page !== pi) return [];
      const geo = new THREE.PlaneGeometry(fc.widthM, fc.h);
      // Remap the plane's 0..1 UVs onto this face's atlas rectangle (CanvasTexture flips Y).
      const u0 = slots[i]!.x / page.width, u1 = (slots[i]!.x + slots[i]!.w) / page.width;
      const vTop = 1 - slots[i]!.y / page.height, vBot = 1 - (slots[i]!.y + slots[i]!.h) / page.height;
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
    /** Atlas page sizes (px), for tests and the harness: the low tier should stay one 4096 x 2048 page. */
    pages: pages.map((p) => ({ w: p.width, h: p.height })),
    /** Shelf rows used per page, rows a full page holds, and the row pitch / gutter (px): how much budget is left. */
    rows: { used: rowsUsed, perPage: rowsPerPage, rowH, gutter: GUTTER },
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
