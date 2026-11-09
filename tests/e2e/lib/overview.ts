import type { Page } from "@playwright/test";

/** One POI label as the user sees it (a CSS2D element under `.gteki-labels`), measured from the DOM. */
export interface LabelBox {
  text: string;
  category: string | null;
  /** In the DOM but `display: none` (hidden by floor rules, occlusion bookkeeping or the overview declutter). */
  hiddenByStyle: boolean;
  /** Class `occluded`: drawn faded (occlusion or an endpoint on another floor). */
  faded: boolean;
  searchOnly: boolean;
  selected: boolean;
  /** Painted and intersecting the viewport. */
  visible: boolean;
  x: number; y: number; w: number; h: number;
}

export interface ViewInfo { w: number; h: number; dpr: number }

/** Every label in the DOM with its rect. Reads only; nothing is clicked or scrolled. */
export async function labelBoxes(page: Page): Promise<{ view: ViewInfo; boxes: LabelBox[] }> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".gteki-labels > *")];
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect();
      const style = getComputedStyle(e);
      const hiddenByStyle = style.display === "none" || style.visibility !== "visible" || Number(style.opacity) < 0.3;
      const onScreen = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      return {
        text: (e.textContent ?? "").trim(),
        category: [...e.classList].find((c) => c.startsWith("cat-"))?.slice(4) ?? null,
        hiddenByStyle,
        faded: e.classList.contains("occluded"),
        searchOnly: e.classList.contains("search-only"),
        selected: e.classList.contains("selected"),
        visible: !hiddenByStyle && onScreen,
        x: r.left, y: r.top, w: r.width, h: r.height,
      };
    });
    return { view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, boxes };
  });
}

/** Label pairs whose rects overlap by more than `minPx` on both axes (same threshold as `labelUiOverlaps`). */
export function overlapPairs(boxes: LabelBox[], minPx = 0.5): { a: string; b: string; dx: number; dy: number }[] {
  const out: { a: string; b: string; dx: number; dy: number }[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (dx > minPx && dy > minPx) out.push({ a: a.text, b: b.text, dx: Math.round(dx), dy: Math.round(dy) });
  }
  return out;
}

/**
 * Extent of the label anchors (rect centres, the CSS2D anchor) as a share of the viewport's shorter side:
 * the larger of the horizontal and vertical extents. A proxy for how much of the screen the POIs span;
 * it cannot exceed the real extent of the slice, so an over-large value is a stronger signal than a small one.
 */
export function anchorSpread(boxes: LabelBox[], view: ViewInfo): { count: number; spread: number | null; bbox: { x0: number; y0: number; x1: number; y1: number } | null } {
  if (boxes.length < 2) return { count: boxes.length, spread: null, bbox: null };
  const xs = boxes.map((b) => b.x + b.w / 2), ys = boxes.map((b) => b.y + b.h / 2);
  const bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const spread = Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) / Math.min(view.w, view.h);
  const r = (v: number) => Math.round(v * 10) / 10;
  return { count: boxes.length, spread: Math.round(spread * 100) / 100, bbox: { x0: r(bbox.x0), y0: r(bbox.y0), x1: r(bbox.x1), y1: r(bbox.y1) } };
}

/** Wait for identical visible geometry in consecutive samples. */
export async function settleLabels(page: Page, stableMs = 250, maxMs = 6000): Promise<number> {
  const t0 = Date.now();
  let last = "", count = 0;
  while (Date.now() - t0 < maxMs) {
    const visible = (await labelBoxes(page)).boxes.filter((b) => b.visible);
    count = visible.length;
    const geometry = JSON.stringify(visible);
    if (geometry === last) return count;
    last = geometry;
    await page.waitForTimeout(stableMs);
  }
  throw new Error(`Label geometry did not settle within ${maxMs} ms`);
}
