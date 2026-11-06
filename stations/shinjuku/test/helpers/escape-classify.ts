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
