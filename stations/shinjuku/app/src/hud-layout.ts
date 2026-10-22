export interface HudRect { x: number; y: number; width: number; height: number }
export const hudRectsOverlap = (a: HudRect, b: HudRect, gap = 0) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

/** Place a projected label inside the remaining view, or omit it when HUD leaves no room.
 * Coordinates are the label's top-left; the preferred point is its projected bottom-centre. */
export function placeProjectedLabel(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  bounds: HudRect,
  obstacles: readonly HudRect[],
  gap = 8,
): { x: number; y: number } | null {
  const minX = bounds.x, maxX = bounds.x + bounds.width - size.width;
  const minY = bounds.y, maxY = bounds.y + bounds.height - size.height;
  if (size.width <= 0 || size.height <= 0 || maxX < minX || maxY < minY) return null;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const desired = { x: preferred.x - size.width / 2, y: preferred.y - size.height };
  const xs = [clamp(desired.x, minX, maxX), minX, maxX, ...obstacles.flatMap((r) => [r.x - size.width - gap, r.x + r.width + gap])];
  const ys = [clamp(desired.y, minY, maxY), minY, maxY, ...obstacles.flatMap((r) => [r.y - size.height - gap, r.y + r.height + gap])];
  let best: { x: number; y: number } | null = null, score = Infinity;
  for (const x of xs) for (const y of ys) {
    if (x < minX || x > maxX || y < minY || y > maxY || obstacles.some((r) => hudRectsOverlap({ x, y, ...size }, r, gap - 0.01))) continue;
    const distance = Math.abs(x - desired.x) + Math.abs(y - desired.y);
    if (distance < score) { best = { x, y }; score = distance; }
  }
  return best;
}
