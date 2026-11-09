export type YieldRect = { left: number; right: number; top: number; bottom: number; behind: boolean; distance: number };
export type YieldState = { lastOverlap: number };

export function minimapYield(rects: readonly YieldRect[], minimap: Pick<YieldRect, "left" | "right" | "top" | "bottom">, now: number, state: YieldState): boolean {
  for (const rect of rects) {
    if (!rect.behind && rect.distance <= 15 && rect.left < minimap.right && rect.right > minimap.left && rect.top < minimap.bottom && rect.bottom > minimap.top) {
      state.lastOverlap = now;
      return true;
    }
  }
  return now - state.lastOverlap < 0.6;
}
