import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";

/** A laid-out full-width band (the credit line, the phone's bottom sheet) starting at `top`. */
const band = (top: number, width = 390) => ({
  getClientRects: () => [{}],
  getBoundingClientRect: () => ({ left: 0, top, width, height: 845 - top }),
});

/** A display:none element: no box at all. */
const none = () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) });

const canvas = (w: number, h: number) => ({ getBoundingClientRect: () => ({ left: 0, top: 0, bottom: h, width: w, height: h }) });

/** Exercise the private occluder measurement on a CPU-only stand-in, never construct a renderer. */
function runtime(w = 390, h = 845) {
  // Private runtime fields/methods are intentionally accessed only by this stand-in.
  const e = Object.create(Explorer.prototype) as any;
  Object.assign(e, {
    viewSize: { w, h }, mode: "overview", panelEl: null, minimapEl: null, creditEl: null, sheetEl: null,
    host: canvas(w, h), fitOverview: vi.fn(),
  });
  return e;
}

describe("the route sheet as an overview occluder (#385)", () => {
  it("ends the phone's free area above an open, full-width sheet", () => {
    const e = runtime();
    e.creditEl = band(807); // the 38 px credit strip along the canvas bottom
    const before = e.freeRect();
    expect(before.y + before.h).toBe(807);
    e.sheetEl = band(507); // a 300 px sheet standing on that strip
    const after = e.freeRect();
    expect(after.y).toBe(0);
    expect(after.y + after.h).toBe(507);
  });

  it("keeps the larger of the sheet and the credit line", () => {
    for (const [creditTop, sheetTop, end] of [[700, 740, 700], [807, 507, 507]] as const) {
      const e = runtime();
      e.creditEl = band(creditTop);
      e.sheetEl = band(sheetTop);
      const free = e.freeRect();
      expect(free.y + free.h).toBe(end);
    }
  });

  it("ignores a closed sheet and the transparent sheet in walk or guide", () => {
    const expected = runtime().freeRect();
    const closed = runtime();
    closed.sheetEl = none();
    expect(closed.freeRect()).toEqual(expected);
    for (const mode of ["walk", "guide"]) {
      const e = runtime();
      e.mode = mode;
      e.sheetEl = band(507);
      expect(e.freeRect()).toEqual(expected);
    }
  });

  it("leaves desktop framing unchanged: its sheet is a narrow left column", () => {
    const e = runtime(1280, 720);
    const before = e.freeRect();
    e.sheetEl = band(300, 400);
    expect(e.freeRect()).toEqual(before);
    // The same width, but spanning the canvas: a phone lay-out counts.
    e.sheetEl = band(300, 1280);
    expect(e.freeRect().y + e.freeRect().h).toBe(300);
  });

  it("refits an automatic overview when the sheet is named, never a user-moved camera", () => {
    const e = runtime();
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    e.framed = box.clone();
    e.setSheet(band(507));
    expect(e.fitOverview).toHaveBeenCalledTimes(1);
    // A reset (the route cleared) only changes the band size; the open/closed refit still follows it.
    e.setSheet(band(600));
    expect(e.fitOverview).toHaveBeenCalledTimes(2);
    // The user moved the camera: `framed` is cleared, so no automatic refit may run.
    e.framed = null;
    e.setSheet(band(500));
    expect(e.fitOverview).toHaveBeenCalledTimes(2);
    // Outside the overview the sheet is transparent and blocks nothing, so nothing refits.
    e.mode = "walk";
    e.framed = box.clone();
    e.setSheet(band(500));
    expect(e.fitOverview).toHaveBeenCalledTimes(2);
  });
});
