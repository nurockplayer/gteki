// A ray's first hit within the scan range, or its first hit when the same ray
// is recast to a 250 m horizon. Only the point's height is needed.
export type RayHit = { readonly point: { readonly y: number } } | null | undefined;
export type RayOutcome = "enclosed" | "escape" | "rangeMiss";

const STREET = 0.00001;
const aboveStreet = (hit: RayHit) => Boolean(hit && hit.point.y > STREET);

/**
 * Classifies one scan ray. `near` is the hit inside the 25 m scan range and
 * `horizon` the hit from recasting the same ray to 250 m.
 */
export function classifyRay(near: RayHit, horizon: RayHit): RayOutcome {
  if (aboveStreet(near) || aboveStreet(horizon)) return "escape";
  if (!near) return horizon ? "rangeMiss" : "escape";
  return "enclosed";
}

export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Plan footprint of an opening the scene cuts in the street slab, either
 * - `band`: the square-ended band from `a` to `b` plus `halfWidth` on each side,
 *   derived from the run and the same 0.25–2.4 m band `cutStairwells` uses; or
 * - `rings`: a whole street-level connector polygon the layout removes as a void
 *   (`buildLayout` drops such a polygon from the slab because a run descends
 *   through it). Outer ring first, holes after.
 */
export type OpeningFootprint =
  | {
      readonly kind: "band";
      /** Opening owner (the run edge), so a flight's own street end can be told from a neighbour's. */
      readonly id: string;
      readonly a: PlanPoint;
      readonly b: PlanPoint;
      readonly halfWidth: number;
    }
  | {
      readonly kind: "rings";
      readonly id: string;
      readonly rings: readonly (readonly PlanPoint[])[];
    };

export type EscapeClass = "streetOpening" | "shellGap";

/** Where an escape reaches the street plane, in plan coordinates; null = it never climbs. */
export type StreetCrossing = PlanPoint | null;

function pointInRing(p: PlanPoint, ring: readonly PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return (p.x - x) ** 2 + (p.y - y) ** 2;
}

/** Inside the ring, or within `margin` metres of its edge. */
function ringContains(p: PlanPoint, ring: readonly PlanPoint[], margin: number): boolean {
  if (pointInRing(p, ring)) return true;
  if (margin <= 0) return false;
  const limit = margin * margin;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (distanceToSegmentSquared(p, ring[j]!, ring[i]!) <= limit) return true;
  }
  return false;
}

/** Whether `p` lies in the opening, widened by `margin` metres on every side. */
export function footprintContains(o: OpeningFootprint, p: PlanPoint, margin = 0): boolean {
  if (o.kind === "rings") {
    // A hole widened by the margin is outside the footprint.
    for (let i = 1; i < o.rings.length; i++) if (ringContains(p, o.rings[i]!, margin)) return false;
    return o.rings[0] ? ringContains(p, o.rings[0], margin) : false;
  }
  const dx = o.b.x - o.a.x;
  const dy = o.b.y - o.a.y;
  const length = Math.hypot(dx, dy);
  const half = o.halfWidth + margin;
  if (length < 1e-9) return Math.hypot(p.x - o.a.x, p.y - o.a.y) <= half;
  const along = ((p.x - o.a.x) * dx + (p.y - o.a.y) * dy) / length;
  if (along < -margin || along > length + margin) return false;
  const across = Math.abs((p.x - o.a.x) * dy - (p.y - o.a.y) * dx) / length;
  return across <= half;
}

/**
 * Splits a real escape by where it leaves the street plane. A ray that reaches the
 * plane inside a cut opening is a street opening; anything else — a crossing outside
 * every opening, or a ray that never climbs — is a shell gap. The default 0.3 m
 * margin covers the cut's own end and edge fuzz (the floor-holes check widens the
 * run footprint by the same amount).
 */
export function classifyEscape(crossing: StreetCrossing, openings: readonly OpeningFootprint[], margin = 0.3): EscapeClass {
  if (!crossing) return "shellGap";
  return openings.some((o) => footprintContains(o, crossing, margin)) ? "streetOpening" : "shellGap";
}
