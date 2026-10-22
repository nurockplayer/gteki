import { describe, expect, it } from "vitest";
import { hudRectsOverlap, placeProjectedLabel, type HudRect } from "../app/src/hud-layout.ts";

const banner = { x: 12, y: 80, width: 366, height: 74 };
const chips = { x: 12, y: 166, width: 310, height: 44 };
const minimap = { x: 278, y: 220, width: 100, height: 100 };
const toast = { x: 12, y: 220, width: 220, height: 36 };
const view = { x: 12, y: 218, width: 366, height: 302 };

describe("world labels around the HUD", () => {
  it.each([180, 205, 245, 400, 600])("keeps a phone destination projected at y=%s clear of the banner, chips, toast and minimap", (y) => {
    const size = { width: 260, height: 52 }, obstacles = [banner, chips, minimap, toast];
    const placed = placeProjectedLabel({ x: 195, y }, size, view, obstacles);
    expect(placed).not.toBeNull();
    const rect = { ...placed!, ...size };
    expect(rect.y).toBeGreaterThanOrEqual(chips.y + chips.height + 8);
    expect(obstacles.some((r) => hudRectsOverlap(rect, r, 7.9))).toBe(false);
    expect(rect.y + rect.height).toBeLessThanOrEqual(520);
  });
  it("hides the projected label when an expanded disclosure consumes the available view", () => {
    const disclosure = { x: 0, y: 210, width: 390, height: 330 };
    expect(placeProjectedLabel({ x: 195, y: 300 }, { width: 260, height: 52 }, view, [disclosure])).toBeNull();
  });
  it("keeps desktop projection near its world point when clear", () => {
    const placed = placeProjectedLabel({ x: 900, y: 470 }, { width: 240, height: 48 }, { x: 12, y: 80, width: 1256, height: 530 }, [banner]);
    expect(placed).toEqual({ x: 780, y: 422 });
  });
  it("avoids an already placed maneuver cue", () => {
    const cue: HudRect = { x: 120, y: 360, width: 90, height: 40 };
    const size = { width: 260, height: 52 };
    const placed = placeProjectedLabel({ x: 195, y: 400 }, size, view, [banner, chips, minimap, toast, cue]);
    expect(placed).not.toBeNull();
    expect(hudRectsOverlap({ ...placed!, ...size }, cue, 7.9)).toBe(false);
  });
  it("omits an oversized label instead of overflowing a narrow viewport", () => {
    expect(placeProjectedLabel({ x: 100, y: 250 }, { width: 260, height: 52 }, { x: 12, y: 218, width: 180, height: 200 }, [])).toBeNull();
  });
});
