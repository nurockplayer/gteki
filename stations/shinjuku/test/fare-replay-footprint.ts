/** Float32 proxy rounding is a representation fringe, never a general access buffer. */
import { containsPolygons } from "../scene/fare-fence.ts";
import type { XY } from "../scene/layout.ts";

export interface FringeCertificate { point: XY; distanceM: number; roundingBoundM: number }
export function renderedFootprint(polygons: XY[][][]) {
  const entries = polygons.map(rings => {
    const rounded = rings.map(r => r.map(p => ({ x: Math.fround(p.x), y: Math.fround(p.y) })));
    const error = Math.max(0, ...rings.flatMap((r, j) => r.map((p, i) => Math.hypot(p.x - rounded[j]![i]!.x, p.y - rounded[j]![i]!.y))));
    if (error + 1e-7 >= .02) throw new Error("Proxy quantisation cannot certify a sub-2 cm fringe");
    const outer = rounded[0]!;
    return { rings, error, has: containsPolygons([rounded]), x0: Math.min(...outer.map(p => p.x)), x1: Math.max(...outer.map(p => p.x)),
      y0: Math.min(...outer.map(p => p.y)), y1: Math.max(...outer.map(p => p.y)) };
  });
  const exact = containsPolygons(polygons);
  return (p: XY, publicAt: (p: XY) => boolean): FringeCertificate | undefined => {
    if (exact(p)) return;
    for (const e of entries) {
      if (p.x < e.x0 || p.x > e.x1 || p.y < e.y0 || p.y > e.y1 || !e.has(p)) continue;
      const edges = e.rings.flatMap(r => r.map((a, i) => {
        const b = r[(i + 1) % r.length]!, dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        return { q, d: Math.hypot(q.x - p.x, q.y - p.y) };
      })).sort((a, b) => a.d - b.d);
      for (const { q, d } of edges) {
        if (d > e.error + 1e-7) break;
        // Exhibit a genuinely public point inside the body disk. Do not infer
        // safety just from a small distance or from the proxy's backing floor.
        for (const dx of [-1e-8, 0, 1e-8]) for (const dy of [-1e-8, 0, 1e-8]) {
          const point = { x: q.x + dx, y: q.y + dy }, distanceM = Math.hypot(point.x - p.x, point.y - p.y);
          if (distanceM <= e.error + 1e-7 && exact(point) && publicAt(point))
            return { point, distanceM, roundingBoundM: e.error + 1e-7 };
        }
      }
    }
  };
}
