/**
 * Shinjuku's explorer commuters (#938): the station graph's verified walk, stairs, ramp and gate edges,
 * reshaped for Ikebukuro's `buildCrowd` (the instanced crowd, not the lane app's per-agent `createCrowd`).
 * Pure: no three.js import (crowd.ts is imported for types only) and no renderer frame here.
 */
import type { StationBundle } from "@gteki/schema";
import type { buildCrowd, Lane } from "../../ikebukuro/scene/crowd.ts";

/** The crowd builder's own edge shape, which crowd.ts keeps private. */
type CrowdEdge = Parameters<typeof buildCrowd>[1][number];

/** Walking modes only. `buildCrowd` walks every kept edge in both directions, so escalators and lifts are out. */
const WALK_MODES: readonly string[] = ["walk", "stairs", "ramp", "gate"];
/** Half-width of the constant lane per mode (m). The crowd keeps 0.2 m of it as shoulder room: 0.6 / 0.25. */
const HALF_WIDTH_M: Record<string, number> = { walk: 0.8, stairs: 0.45, ramp: 0.8, gate: 0.8 };

/**
 * The walkable part of `bundle` as `buildCrowd` input: mode/verification/closure/presence filtered edges and
 * one constant lane each. Shinjuku's edge polylines carry no heights (`z: null`), which `buildCrowd` would
 * skip whole, so the two end points take their z from the node they join via `nodeZ`.
 */
export function crowdEdges(
  bundle: Pick<StationBundle, "nodes" | "edges">,
  nodeZ: (id: string) => number,
): { edges: CrowdEdge[]; lanes: Record<string, Lane> } {
  const present = new Set(bundle.nodes.map((n) => n.id));
  const edges: CrowdEdge[] = [];
  const lanes: Record<string, Lane> = {};
  for (const e of bundle.edges) {
    const g = e.geometry;
    if (!WALK_MODES.includes(e.mode) || e.verification !== "verified" || e.closed) continue;
    if (!g?.length || !present.has(e.from) || !present.has(e.to)) continue;
    const last = g.length - 1;
    edges.push({
      id: e.id, from: e.from, to: e.to, verification: e.verification,
      geometry: g.map((p, i) => ({ x: p.x, y: p.y, z: i === 0 ? nodeZ(e.from) : i === last ? nodeZ(e.to) : p.z })),
    });
    // No surveyed PLATEAU lane exists for Shinjuku; one constant interval covers every distance.
    const w = HALF_WIDTH_M[e.mode]!;
    lanes[e.id] = { stepM: 1000, left: [w], right: [w] };
  }
  return { edges, lanes };
}
