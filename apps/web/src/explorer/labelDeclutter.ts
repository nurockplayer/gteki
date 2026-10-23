/**
 * Screen-space declutter for POI labels in the overview, kept free of three.js and the DOM so it can be
 * unit-tested. Labels are placed greedily by priority; one whose rectangle meets an already placed
 * label is dropped. The caller hides the dropped ones (so they leave the layout, as the e2e overlap
 * probes measure the label DOM rects), on top of the occlusion and floor states, never instead of them.
 */

/** Priority classes, best first. */
export const LABEL_CLASS = { endpoint: 0, exit: 1, gate: 2, other: 3 } as const;
export type LabelClass = (typeof LABEL_CLASS)[keyof typeof LABEL_CLASS];

/** Origin and destination first, then exits, ticket gates, everything else. */
export function labelClass(selected: boolean, category: string): LabelClass {
  if (selected) return LABEL_CLASS.endpoint;
  if (category === "exit") return LABEL_CLASS.exit;
  if (category === "ticket_gate") return LABEL_CLASS.gate;
  return LABEL_CLASS.other;
}

export interface DeclutterItem {
  id: string;
  /** Rectangle centre on screen (px) and size (px). CSS2D labels are centred on their anchor. */
  x: number;
  y: number;
  w: number;
  h: number;
  klass: LabelClass;
  /** Backed by a verified graph node (not search-only). Preferred within a class. */
  routable: boolean;
  /** Already drawn faded (occluded or off its floor). Preferred last within a class, so a clear label wins. */
  faded?: boolean;
  /** Shown by the previous pass: it keeps its place when merely touching (hysteresis against flicker). */
  wasVisible?: boolean;
  /** `false` when w/h are an estimate (not yet measured from the DOM). */
  measured?: boolean;
}

export interface DeclutterOptions {
  /** Clearance (px) kept around every placed label. */
  pad?: number;
  /** Extra clearance (px) a label that was hidden needs before it comes back. */
  hold?: number;
}

export const DECLUTTER_PAD_PX = 3;
export const DECLUTTER_HOLD_PX = 4;

/**
 * Ids of the labels to keep. Properties:
 * - no two kept labels' padded rectangles intersect, except endpoint labels (class `endpoint`), which are
 *   always kept (a start and a destination that sit close together both stay findable);
 * - labels are considered in order of class, then clear before faded, then routable before search-only,
 *   then id, so a lower-priority label never takes the place of a higher one;
 * - the result depends only on the input (order of `items` does not matter).
 */
export function declutter(items: readonly DeclutterItem[], options: DeclutterOptions = {}): Set<string> {
  const pad = options.pad ?? DECLUTTER_PAD_PX;
  const hold = options.hold ?? DECLUTTER_HOLD_PX;
  const order = items.slice().sort(compare);
  const keep = new Set<string>();
  // Placed rectangles (left, top, right, bottom) in parallel arrays: no allocation per label.
  const n = order.length;
  const L = new Float64Array(n), T = new Float64Array(n), Rr = new Float64Array(n), B = new Float64Array(n);
  let placed = 0;
  for (const it of order) {
    const hw = it.w / 2, hh = it.h / 2;
    const l = it.x - hw, t = it.y - hh, r = it.x + hw, b = it.y + hh;
    // `gap` is the clearance kept to every placed label; one that was hidden needs the extra `hold` to come back.
    const gap = it.klass === LABEL_CLASS.endpoint ? 0 : it.wasVisible ? pad : pad + hold;
    let clear = true;
    if (it.klass !== LABEL_CLASS.endpoint) {
      for (let i = 0; i < placed; i++) {
        if (l < Rr[i]! + gap && r > L[i]! - gap && t < B[i]! + gap && b > T[i]! - gap) { clear = false; break; }
      }
    }
    if (!clear) continue;
    keep.add(it.id);
    L[placed] = l; T[placed] = t; Rr[placed] = r; B[placed] = b;
    placed++;
  }
  return keep;
}

function compare(a: DeclutterItem, b: DeclutterItem): number {
  return a.klass - b.klass
    || Number(Boolean(a.faded)) - Number(Boolean(b.faded))
    || Number(!a.routable) - Number(!b.routable)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Label font size (px) and the box around the text, as styled by `.poi-label` (dot, padding, border). */
export const LABEL_FONT_PX = 12;
const LABEL_BOX = { chrome: 31, h: 26 };

/** Whether a character is drawn about one em wide (CJK, kana, Hangul, full-width forms); else it is ASCII-like. */
function fullWidth(code: number): boolean {
  return (code >= 0x1100 && code <= 0x11ff) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6);
}

/**
 * A label's box (px) before it has been measured. Full-width characters count a full em and others 0.55 em,
 * rounded up, so the first pass errs toward a larger box (hiding) rather than letting a wide label overlap.
 */
export function estimateLabelBox(text: string, fontPx = LABEL_FONT_PX): { w: number; h: number } {
  let em = 0;
  for (const ch of text) em += fullWidth(ch.codePointAt(0)!) ? 1 : 0.55;
  return { w: Math.ceil(LABEL_BOX.chrome + em * fontPx), h: LABEL_BOX.h };
}

/**
 * Ids kept by a pass whose box was only estimated. Their real size is known only once the browser has laid
 * them out (after they are shown), so the caller schedules another pass for them; once measured they are
 * no longer reported, so this settles.
 */
export function revealedUnmeasured(items: readonly DeclutterItem[], keep: ReadonlySet<string>): string[] {
  return items.filter((i) => i.measured === false && keep.has(i.id)).map((i) => i.id);
}
