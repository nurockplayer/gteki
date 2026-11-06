// Decorative wall props (#858 item 12) must not reach any routable edge: the walker's body path runs on
// graph polylines, and the pipeline keeps those 0.35 m off colliders. Each prop footprint, expanded by
// WALKER_BODY.radiusM, has to stay clear of every edge polyline in the station graph.
import { WALKER_BODY } from "@gteki/scene-api";
import { describe, expect, it } from "vitest";
import graph from "../gteki/graph.json";
import wallProps from "./wall-props.ts";

type P = { x: number; y: number };
const edges = (graph as { edges: { id: string; geometry: P[] }[] }).edges;

/** The prop's plan rectangle: from 0.02 m inside the wall to the front face, `w` wide. */
function footprint(p: (typeof wallProps)[number]): P[] {
  const [wx, wy] = p.wall, [nx, ny] = p.n, tx = -ny, ty = nx;
  const at = (along: number, out: number): P => ({ x: wx + tx * along + nx * out, y: wy + ty * along + ny * out });
  return [at(-p.w / 2, -0.02), at(p.w / 2, -0.02), at(p.w / 2, p.d - 0.02), at(-p.w / 2, p.d - 0.02)];
}

function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(c.x, c.y, d.x, d.y, a.x, a.y), d2 = cross(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = cross(a.x, a.y, b.x, b.y, c.x, c.y), d4 = cross(a.x, a.y, b.x, b.y, d.x, d.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function insideRect(p: P, rect: P[]): boolean {
  let side = 0;
  for (let i = 0; i < rect.length; i++) {
    const c = cross(rect[i]!.x, rect[i]!.y, rect[(i + 1) % rect.length]!.x, rect[(i + 1) % rect.length]!.y, p.x, p.y);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (side !== 0 && s !== side) return false;
    side = s;
  }
  return true;
}

/** Plan distance between a segment and the rectangle (0 when they meet or the segment is inside). */
function segmentToRect(a: P, b: P, rect: P[]): number {
  if (insideRect(a, rect) || insideRect(b, rect)) return 0;
  let best = Infinity;
  for (let i = 0; i < rect.length; i++) {
    const c = rect[i]!, d = rect[(i + 1) % rect.length]!;
    if (segmentsCross(a, b, c, d)) return 0;
    best = Math.min(best, pointSegment(a.x, a.y, c.x, c.y, d.x, d.y), pointSegment(b.x, b.y, c.x, c.y, d.x, d.y));
  }
  return best;
}

describe("Ikebukuro wall props (#858 item 12)", () => {
  it("has placements", () => {
    expect(wallProps.length).toBeGreaterThan(0);
  });

  it("keeps every footprint, expanded by the walker's radius, clear of every edge polyline", () => {
    const touches: string[] = [];
    for (const prop of wallProps) {
      const rect = footprint(prop);
      for (const edge of edges) {
        for (let i = 1; i < edge.geometry.length; i++) {
          const distance = segmentToRect(edge.geometry[i - 1]!, edge.geometry[i]!, rect);
          if (distance <= WALKER_BODY.radiusM) {
            touches.push(`${prop.id} touches ${edge.id} at ${distance.toFixed(2)} m`);
            break;
          }
        }
      }
    }
    expect(touches).toEqual([]);
  });
});
