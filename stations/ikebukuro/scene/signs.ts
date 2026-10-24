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

export interface IdentityBoard {
  id: string;
  anchor: { nodeId?: string; edgeId?: string };
  kind: "station-name" | "meeting-point";
  text: { ja: string; kana?: string; en: string; transfer?: string; location?: string; locationEn?: string; status?: string };
  sourceIds: string[];
  textVerification: "VERIFIED" | "APPROXIMATE";
  placement: "GTEki-authored, not a surveyed sign location";
  position: { x: number; y: number; z: number };
  facing: { x: number; y: number };
  widthM: number;
  heightM: number;
  ceilingZ: number;
  mount?: "ceiling" | "wall";
}

// replace with IdentityBoardTag from @gteki/scene-api once #347 lands
type IdentityBoardTag = {
  front?: [number, number, number];
  regions?: { kind: "name" | "arrow"; min: [number, number, number]; max: [number, number, number] }[];
};

/** Conservative cap-height proxy (0.7 em), not measured glyph ink or a recognition study. */
export const IDENTITY_TYPE = { jaEm: 0.56, enEm: 0.40, cap: 0.7 } as const;
const IDENTITY_ART = { widthM: 3.4, heightM: 0.54 } as const;

export function identityTypography(board: IdentityBoard, nameScale = board.widthM > 2 ? 0.8 : 1.12) {
  const artScale = Math.min(board.widthM / IDENTITY_ART.widthM, board.heightM / IDENTITY_ART.heightM);
  const jaM = IDENTITY_ART.heightM * IDENTITY_TYPE.jaEm * artScale * nameScale;
  const enM = IDENTITY_ART.heightM * IDENTITY_TYPE.enEm * artScale * nameScale;
  const kanaM = IDENTITY_ART.heightM * 0.15 * artScale * nameScale;
  const jpWidth = 2*jaM, enWidth = 9*0.56*enM, gap = 0.08*artScale*nameScale;
  const jaX = 0.5-(jpWidth+enWidth+gap)/2/board.widthM;
  const enX = jaX+(jpWidth+gap)/board.widthM;
  const y = (fraction: number) => 0.5+((fraction-0.5)*nameScale-(nameScale > 1 ? 0.03 : 0))*IDENTITY_ART.heightM*artScale/board.heightM;
  return { jaM, enM, kanaM, artScale, jaX, enX, jaY: y(0.43), enY: y(0.50), kanaY: y(0.18) };
}

export interface SignSpec extends SignContent {
  identity?: IdentityBoard;
  id: string;
  position: { x: number; y: number; z: number };
  facing: { x: number; y: number };
  /** Surveyed ceiling above the sign (ENU m), for presentation-only suspension. */
  ceilingZ?: number;
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

/** Fitted face dimensions in world metres, shared with the kit without measuring text again. */
export interface SignLayout {
  id: string;
  position: SignSpec["position"];
  facing: SignSpec["facing"];
  ceilingZ?: number;
  scale: number;
  widthM: number;
  heightM: number;
}

export const FONT = '"GTEki Sign JP","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic",system-ui,sans-serif';
const PX_PER_M = 300;
const H = 0.42;
const ATLAS_W = 4096; // atlas page side (px), lowered to the GPU's MAX_TEXTURE_SIZE where that is smaller
/** Phone tier ("low") paints faces at this fraction of full size (PX_PER_M x this, px/m). At 0.5 the English
 *  line and the "~N m" distance stopped reading at mid range, so it is back above 0.54 (0.56 read as well as 0.6 on an
 *  iPhone 15-size low-tier shoot at 6-10 m, GPU slot 2026-10-23: the render resolution, not the atlas, limits it); the faces then spill past
 *  one 4096 x 2048 page into a small overflow page (LOW_PAGE_HEIGHTS; scene/signage.test.ts pins both). */
export const LOW_TEXEL_SCALE = 0.56;
/** Phone tier page heights (px, pages 4096 wide): the first page, then an overflow page made only when the faces
 *  do not fit the first, as short as the rest allows. The phone tier never gets a 4096 x 4096 page. */
const LOW_PAGE_HEIGHTS = [2048, 1024];
/** Em (fraction of the face height) of the small lines: an exit's distance, a gate's or hall's English name and
 *  its distance. The Japanese name stays larger (gates 0.24, halls 0.3). */
export const SMALL_EM = 0.21;
/** Em of the 出口 / Exit caption before an exit's badges (were 0.2 / 0.15): 出口 stays larger than Exit. Centred at
 *  0.36 and 0.68 of the face height, 出口 spans about 0.23-0.49 and Exit 0.58-0.78, so they never touch. */
export const EXIT_JA_EM = 0.26;
export const EXIT_EN_EM = 0.2;
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

/** Original GTEki layout: two name columns above plain JR and Metro transfer rows.
 *  No operator colour, ring, badge, pictogram or copied sign composition. */
function paintIdentity(board: IdentityBoard, pxPerM: number, nameScale: number, transfers: boolean) {
  const c = document.createElement("canvas");
  c.width = Math.round(board.widthM * pxPerM);
  const fullHeight = Math.round(board.heightM * pxPerM);
  c.height = fullHeight;
  const g = c.getContext("2d")!;
  // Paint in physical units, so pixel rounding never changes glyph aspect or metadata bounds.
  const w = board.widthM, h = board.heightM;
  g.setTransform(c.width/w, 0, 0, fullHeight/h, 0, 0);
  const type = identityTypography(board, nameScale);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  g.fillStyle = board.kind === "meeting-point" ? THEME_PLACE.panel : "#263d48";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  g.textAlign = "left";
  g.textBaseline = "middle";
  const line = (text: string, x: number, y: number, em: number, weight = 500, name = false) => {
    let fontPx = h * em;
    g.font = `${weight} ${fontPx}px ${FONT}`;
    // Fit transfer/location rows by reducing both axes equally, never fillText's horizontal squeeze.
    if (!name) {
      fontPx *= Math.min(1, (1-x-0.04)*w / Math.max(1e-6, g.measureText(text).width));
      g.font = `${weight} ${fontPx}px ${FONT}`;
    }
    g.fillText(text, x * w, y * h);
    if (name) {
      const m = g.measureText(text);
      bounds.minX = Math.min(bounds.minX, x*w - (m.actualBoundingBoxLeft ?? 0));
      bounds.maxX = Math.max(bounds.maxX, x*w + (m.actualBoundingBoxRight ?? m.width));
      bounds.minY = Math.min(bounds.minY, y*h - (m.actualBoundingBoxAscent ?? fontPx/2));
      bounds.maxY = Math.max(bounds.maxY, y*h + (m.actualBoundingBoxDescent ?? fontPx/2));
    }
    return fontPx/h*board.heightM*IDENTITY_TYPE.cap;
  };
  const transferCapM: number[] = [];
  if (board.kind === "station-name") {
    line(board.text.ja, type.jaX, type.jaY, type.jaM/board.heightM, 700, true);
    line(board.text.kana!, type.enX, type.kanaY, type.kanaM/board.heightM, 500, true);
    line(board.text.en, type.enX, type.enY, type.enM/board.heightM, 600, true);
    if (transfers) {
      const rows = board.text.transfer!.split(" · ");
      // The name em box ends at 0.71 h. Two rows use all remaining height with a small interline gap.
      transferCapM.push(line(rows.slice(0, 3).join(" · "), 0.04, 0.78, 0.13));
      transferCapM.push(line(rows.slice(3).join(" · "), 0.04, 0.93, 0.13));
    }
  } else {
    line(board.text.ja, 0.04, 0.22, 0.25, 700, true);
    line(board.text.en, 0.38, 0.23, 0.16, 500, true);
    line(board.text.location!, 0.04, 0.49, 0.13);
    line(board.text.locationEn!, 0.04, 0.68, 0.105);
    line(board.text.status!, 0.04, 0.89, 0.10);
  }
  let canvas = c;
  if (!transfers && board.kind === "station-name") {
    canvas = document.createElement("canvas");
    canvas.width = c.width;
    // Retain every measured name glyph plus one texel; crop only the unused transfer band.
    canvas.height = Math.min(fullHeight, Math.max(Math.ceil(fullHeight*0.72), Math.ceil(bounds.maxY/h*fullHeight)+1));
    canvas.getContext("2d")!.drawImage(c, 0, 0);
  }
  const croppedH = h*canvas.height/fullHeight;
  return { canvas, widthM: board.widthM, h: croppedH, centerY: (h-croppedH)/2, transferCapM, bg: board.kind === "meeting-point" ? THEME_PLACE.panel : "#263d48",
    nameRegion: { min: [(bounds.minX/w-0.5)*board.widthM, (0.5-bounds.maxY/h)*board.heightM],
      max: [(bounds.maxX/w-0.5)*board.widthM, (0.5-bounds.minY/h)*board.heightM] } };
}

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
    measure.font = `600 ${Math.round(h * EXIT_JA_EM)}px ${FONT}`;
    const jaW = measure.measureText("出口").width;
    measure.font = `500 ${Math.round(h * EXIT_EN_EM)}px ${FONT}`;
    const lw = Math.max(jaW, measure.measureText("Exit").width + 4) + 18;
    parts.push({
      w: lw,
      draw: (g, x) => {
        g.fillStyle = "#ffffff";
        g.font = `600 ${Math.round(h * EXIT_JA_EM)}px ${FONT}`;
        g.textBaseline = "middle";
        g.fillText("出口", x, h * 0.36);
        g.font = `500 ${Math.round(h * EXIT_EN_EM)}px ${FONT}`;
        g.fillText("Exit", x + 4, h * 0.68);
      },
    });
    for (const e of spec.exits) {
      const bw = Math.max(badge, 30 + e.label.length * badge * 0.42);
      const dText = e.distanceM != null ? distLabel(e.distanceM) : null;
      let pw = bw;
      if (dText) {
        measure.font = `600 ${Math.round(h * SMALL_EM)}px ${FONT}`;
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
            g.font = `600 ${Math.round(h * SMALL_EM)}px ${FONT}`;
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
    measure.font = `500 ${Math.round(h * SMALL_EM)}px ${FONT}`;
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
        g.font = `500 ${Math.round(h * SMALL_EM)}px ${FONT}`;
        g.fillText(en, x + 16, h * 0.73);
        if (dText) {
          g.fillStyle = "#ffd200";
          g.font = `600 ${Math.round(h * SMALL_EM)}px ${FONT}`;
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
    const enW = (measure.measureText(en).width * SMALL_EM) / 0.24;
    const dW = dText ? (measure.measureText(dText).width * SMALL_EM) / 0.24 : 0;
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
        g.font = `500 ${Math.round(h * SMALL_EM)}px ${FONT}`;
        g.fillStyle = "#d6dde6";
        g.fillText(en, x + 16 + off, h * 0.72);
        if (dText) {
          g.fillStyle = "#ffd200";
          g.font = `600 ${Math.round(h * SMALL_EM)}px ${FONT}`;
          g.fillText(dText, x + 16 + off + enW + 14, h * 0.72);
        }
      },
    });
  }
  return parts;
}

/** Shelf-pack face canvases (all the same height) into as few atlas pages of side `side` px as fit, drawn
 *  at `scale` (< 1 on low quality: same layout, fewer texels). A face wider than a page is drawn narrower
 *  (fewer texels across, same size in the scene). Slots carry the drawn size for the UVs. `heights` caps each
 *  page's height in turn (the last cap repeats); without it every page may be `side` tall. */
function packAtlas(faces: HTMLCanvasElement[], backgrounds: string[], scale: number, side: number, heights?: number[]) {
  const dims = faces.map((c) => ({ w: Math.min(side - 2 * GUTTER, Math.ceil(c.width * scale)), h: Math.round(c.height * scale) }));
  const rowH = dims[0] ? dims[0].h + GUTTER : 0;
  const cap = (pi: number) => (heights ? Math.min(side, heights[Math.min(pi, heights.length - 1)]!) : side);
  // Rows a page holds; a capped page keeps its last row's bottom gutter inside the page.
  const rowsOn = (pi: number) => Math.max(1, Math.floor((heights ? cap(pi) - GUTTER : side) / Math.max(1, rowH)));
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
      if (row >= rowsOn(page)) {
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
    c.height = Math.min(cap(pi), 2 ** Math.ceil(Math.log2(GUTTER + rows * rowH)));
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
  return { pages, slots, rowsPerPage: pageRows.map((_, pi) => rowsOn(pi)), rowsUsed: pageRows, rowH };
}

/** Separate, tightly cropped shelves. WebGL2 supports mipmaps on these non-power-of-two canvases. */
function packIdentity(art: ReturnType<typeof paintIdentity>[]) {
  if (!art.length) return { pages: [], slots: [] };
  const slots: { page: number; x: number; y: number; w: number; h: number }[] = [];
  let y = GUTTER;
  for (const a of art) {
    slots.push({ page: 0, x: GUTTER, y, w: a.canvas.width, h: a.canvas.height });
    y += a.canvas.height + GUTTER;
  }
  const page = document.createElement("canvas");
  page.width = Math.max(...art.map((a) => a.canvas.width)) + 2*GUTTER;
  page.height = y;
  const g = page.getContext("2d")!;
  art.forEach((a, i) => {
    const s = slots[i]!;
    g.fillStyle = a.bg;
    g.fillRect(0, s.y-GUTTER/2, page.width, s.h+GUTTER);
    g.drawImage(a.canvas, s.x, s.y);
  });
  return { pages: [page], slots };
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
 * Direction faces share the original atlas; identity art has one small texture and one merged face batch.
 */
export function buildSigns(
  THREE: typeof THREE_NS,
  specs: SignSpec[],
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
  anisotropy: number,
  texelScale = 1,
  maxTextureSize = ATLAS_W,
  frame?: { facePlaneM: number },
  identityBoards: IdentityBoard[] = [],
) {
  const group = new THREE.Group();
  group.name = "ikebukuro_signs";
  type Face = { id: string; side: "front" | "back"; scale: number; canvas: HTMLCanvasElement; widthM: number; h: number; bg: string; local: THREE_NS.Matrix4; sign: THREE_NS.Matrix4; solid?: boolean };
  const faces: Face[] = [];
  const identityFaces: Face[] = [];
  // Repeated text is painted once. Artwork is scaled uniformly inside each board's own aspect;
  // the remaining face area uses a solid-colour quad in the same batch, so no glyph is stretched.
  const artKey = (b: IdentityBoard) => b.kind === "meeting-point" ? "meeting-point" : b.widthM > 2 ? "wide" : "compact";
  const identityArt = new Map<string, ReturnType<typeof paintIdentity>>();
  for (const b of identityBoards) {
    const key = artKey(b);
    if (identityArt.has(key)) continue;
    // Compact boards magnify the same artwork less on screen; reserve density for the nearby wide panel.
    const lowDensity = key === "wide" ? 280 : key === "compact" ? 160 : 140;
    const density = Math.min(lowDensity*(texelScale < 1 ? 1 : 2), (maxTextureSize-2*GUTTER)/IDENTITY_ART.widthM);
    identityArt.set(key, paintIdentity({ ...b, widthM: IDENTITY_ART.widthM, heightM: IDENTITY_ART.heightM }, density, key === "compact" ? 1.12 : key === "wide" ? 0.8 : 1, texelScale >= 1));
  }
  const layouts: SignLayout[] = [];
  const boxes: { geo: THREE_NS.BufferGeometry; matrix: THREE_NS.Matrix4 }[] = [];
  const face = (content: SignContent[], maxW: number, theme: Theme) => {
    const fit = paintFitted(content, maxW, theme);
    const widthM = Math.min(fit.widthM, maxW);
    return { canvas: fit.canvas, widthM, h: H * (widthM / fit.widthM), bg: theme.panel }; // last resort: scale a single item down
  };
  const allSpecs: SignSpec[] = [...specs, ...identityBoards.map((b) => ({
    id: b.id, position: b.position, facing: b.facing, ceilingZ: b.ceilingZ, exits: [], gates: [], identity: b,
  }))];
  for (const s of allSpecs) {
    const scale = s.scale ?? 1;
    const maxW = (s.maxWidthM ?? Infinity) / scale;
    const theme = s.kind === "place" ? THEME_PLACE : THEME_DIRECTION;
    const art = s.identity ? identityArt.get(artKey(s.identity))! : null;
    const artScale = s.identity ? Math.min(s.identity.widthM / IDENTITY_ART.widthM, s.identity.heightM / IDENTITY_ART.heightM) : 1;
    const identityFront = s.identity && art ? { ...art, widthM: s.identity.widthM, h: s.identity.heightM,
      nameRegion: { min: art.nameRegion.min.map((v) => v*artScale), max: art.nameRegion.max.map((v) => v*artScale) } } : null;
    const front = identityFront ?? face([s], maxW, theme);
    const backBlocks = (s.back ?? []).filter((b) => b.exits.length > 0 || b.gates.length > 0 || (b.places?.length ?? 0) > 0);
    const back = backBlocks.length ? face(backBlocks, maxW, theme) : null;
    const width = Math.max(front.widthM, back?.widthM ?? 0);
    if (!s.identity) layouts.push({ id: s.id, position: s.position, facing: s.facing, ceilingZ: s.ceilingZ, scale,
      widthM: width * scale, heightM: Math.max(front.h, back?.h ?? 0) * scale });
    // Plane faces +Z in local space; rotate so it faces the ENU 'facing' vector.
    const f = toRenderer(s.facing.x, s.facing.y, 0).sub(toRenderer(0, 0, 0));
    const signM = new THREE.Matrix4().compose(
      toRenderer(s.position.x, s.position.y, s.position.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.x, f.z)),
      new THREE.Vector3(scale, scale, scale),
    );
    // A loaded kit supplies the trim. Its face plane is recessed at +-0.028 m (outer depth 0.08 m):
    // move faces 1 mm inside it and the backing another 1 mm behind, rather than covering the rim at +-0.041.
    // Offsets are world metres even for a scaled low-ceiling sign. Without a kit, keep the original box and face offsets.
    const useFrame = s.identity ? undefined : frame;
    const faceZ = useFrame ? (useFrame.facePlaneM - 0.001) / scale : 0.041;
    if (s.identity && identityFront) {
      const proxy = new THREE.Object3D();
      proxy.name = s.id;
      proxy.applyMatrix4(signM);
      // Metadata only: no Mesh/geometry, draw call, collider or walking surface.
      const tag: IdentityBoardTag = {
        front: [0, 0, 1],
        regions: [{ kind: "name",
          min: [identityFront.nameRegion.min[0]!, identityFront.nameRegion.min[1]!, faceZ - 0.002],
          max: [identityFront.nameRegion.max[0]!, identityFront.nameRegion.max[1]!, faceZ + 0.002] }],
      };
      proxy.userData = { gteki_role: "sign", gteki_identity: tag };
      group.add(proxy);
    }
    const housingH = s.identity ? front.h * (0.60 / 0.54) : useFrame ? H : H + 0.06;
    boxes.push({ geo: new THREE.BoxGeometry(useFrame ? width : width + 0.06, housingH,
      useFrame ? 2 * (faceZ - 0.001 / scale) : 0.08), matrix: signM });
    if (s.identity?.mount !== "wall" && s.identity) {
      const gap = Math.max(0, s.identity.ceilingZ - s.position.z - housingH/2);
      for (const side of [-1, 1]) boxes.push({ geo: new THREE.BoxGeometry(0.015, gap, 0.015),
        matrix: signM.clone().multiply(new THREE.Matrix4().makeTranslation(side*(width/2-0.12), housingH/2+gap/2, 0)) });
    }
    const frontFace: Face = { ...front, id: s.id, side: "front", scale, local: new THREE.Matrix4().makeTranslation(0, 0, faceZ), sign: signM };
    if (art) {
      identityFaces.push({ ...frontFace, solid: true });
      identityFaces.push({ ...frontFace, widthM: art.widthM*artScale, h: art.h*artScale, local: new THREE.Matrix4().makeTranslation(0, art.centerY*artScale, faceZ+0.001) });
    } else faces.push(frontFace);
    if (back) faces.push({ ...back, id: s.id, side: "back", scale, local: new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, 0, -faceZ), sign: signM });
  }

  // Unlit: the station has no dynamic lights (baked lighting only).
  const housing = new THREE.MeshBasicMaterial({ color: 0x4f565f });
  group.add(new THREE.Mesh(merge(THREE, boxes, false), housing));

  // Below full resolution (the phone tier) pages are capped at LOW_PAGE_HEIGHTS; full resolution is unchanged.
  const { pages, slots, rowsPerPage, rowsUsed, rowH } = packAtlas(faces.map((x) => x.canvas), faces.map((x) => x.bg), texelScale,
    Math.min(ATLAS_W, maxTextureSize), texelScale < 1 ? LOW_PAGE_HEIGHTS : undefined);
  const packedIdentity = packIdentity([...identityArt.values()]);
  const textures: THREE_NS.Texture[] = [];
  const addPage = (page: HTMLCanvasElement, pageFaces: Face[], pageSlots: typeof slots, pi: number, name: string) => {
    const tex = new THREE.CanvasTexture(page);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    textures.push(tex);
    const parts = pageFaces.flatMap((fc, i) => {
      const slot = pageSlots[i]!;
      if (slot.page !== pi) return [];
      const geo = new THREE.PlaneGeometry(fc.widthM, fc.h);
      // Remap the plane's 0..1 UVs onto this face's atlas rectangle (CanvasTexture flips Y).
      const u0 = (slot.x + (fc.solid ? 1 : 0)) / page.width, u1 = fc.solid ? u0 : (slot.x + slot.w) / page.width;
      const vTop = 1 - (slot.y + (fc.solid ? 1 : 0)) / page.height, vBot = fc.solid ? vTop : 1 - (slot.y + slot.h) / page.height;
      const uv = geo.getAttribute("uv") as THREE_NS.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), vBot + uv.getY(k) * (vTop - vBot));
      return [{ geo, matrix: fc.sign.clone().multiply(fc.local) }];
    });
    // Internally lit sign face (unlit material, mild boost).
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.color.setScalar(1.1);
    const mesh = new THREE.Mesh(merge(THREE, parts, true), mat);
    mesh.name = name;
    group.add(mesh);
  };
  pages.forEach((page, pi) => addPage(page, faces, slots, pi, `sign-faces-${pi}`));
  const artList = [...identityArt.values()];
  const identitySlots = identityFaces.map((f) => packedIdentity.slots[artList.findIndex((a) => a.canvas === f.canvas)]!);
  packedIdentity.pages.forEach((page, pi) => addPage(page, identityFaces, identitySlots, pi, "identity-faces"));
  // Face sizes (m, before the sign's own scale) for the QA probe's on-screen measurements; not read by the app.
  group.userData = { gteki_role: "sign", faces: [...faces, ...identityFaces.filter((f) => !f.solid)].map((f) => ({ id: f.id, side: f.side, scale: f.scale, widthM: f.widthM, heightM: f.h, canvasPx: { w: f.canvas.width, h: f.canvas.height } })) };

  return {
    group,
    layouts,
    /** Atlas page sizes (px), for tests and the harness: on the low tier one 4096 x 2048 page, plus a 4096 x <= 1024
     *  overflow page only when the faces need it. */
    pages: pages.map((p) => ({ w: p.width, h: p.height })),
    identityPages: packedIdentity.pages.map((p) => ({ w: p.width, h: p.height })),
    identityArt: artList.map((a) => ({ widthM: a.widthM, heightM: a.h, centerY: a.centerY, canvasPx: { w: a.canvas.width, h: a.canvas.height }, transferCapM: a.transferCapM })),
    /** Shelf rows used per page, rows each page holds at its cap, and the row pitch / gutter (px): how much budget is left. */
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
