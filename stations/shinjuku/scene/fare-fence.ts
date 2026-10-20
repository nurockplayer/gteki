/** Fare/access containment from source polygons; never supplies or alters routing edges. */
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import {
  pointInRings,
  type GateLine,
  type Layout,
  type Plan,
  type WallSeg,
  type XY,
} from "./layout.ts";

export interface Fence extends WallSeg {
  id: string;
  reason: "fare" | "access";
  level: string;
}
export interface FareProtection {
  fences: Fence[];
  gates: GateLine[];
  removedAccess: { level: string; z: number; rings: XY[][] }[];
}
const poly = (rings: XY[][]): Polygon =>
  rings.map((r) => r.map((p) => [p.x, p.y]));
const rings = (p: Polygon): XY[][] =>
  p.map((r) => r.map(([x, y]) => ({ x, y })));
const union = (ps: Polygon[]): MultiPolygon =>
  ps.length ? polygonClipping.union(ps[0]!, ...ps.slice(1)) : [];
const inside = (p: XY, ps: MultiPolygon) =>
  ps.some((r) => pointInRings(p, rings(r)));
function distance(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Trim ONLY procedural elevator-envelope fill to the independently mapped footprint.
 * The surrounding render-only enclosure may remain; its floor must not imply public access.
 * Both WalkWorld and explorer proxies are built later from these same clipped pads.
 */
export function protectFareAndAccess(
  layout: Layout,
  plan: Plan,
  bundle: StationBundle,
): FareProtection {
  const fences: Fence[] = [],
    removedAccess: FareProtection["removedAccess"] = [];
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const paths = bundle.edges
    .filter((e) => e.verification === "verified")
    .flatMap((e) => {
      const pts = e.geometry?.length
        ? e.geometry
        : [nodes.get(e.from)!.position, nodes.get(e.to)!.position];
      const za = layout.nodeZ.get(e.from)!,
        zb = layout.nodeZ.get(e.to)!,
        lengths = [0];
      for (let i = 1; i < pts.length; i++)
        lengths.push(
          lengths[i - 1]! +
            Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y),
        );
      return pts.slice(1).map((b, i) => ({
        mode: e.mode,
        a: pts[i]!,
        b,
        za: za + ((zb - za) * lengths[i]!) / (lengths.at(-1) || 1),
        zb: za + ((zb - za) * lengths[i + 1]!) / (lengths.at(-1) || 1),
      }));
    });
  const routeClear = (p: XY, z: number) =>
    paths.some((e) => {
      if (z < Math.min(e.za, e.zb) - 0.95 || z > Math.max(e.za, e.zb) + 1.75)
        return false;
      const dx = e.b.x - e.a.x,
        dy = e.b.y - e.a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
      const feet = e.za + (e.zb - e.za) * t;
      return (
        (e.mode === "elevator" || (feet >= z - 1.75 && feet <= z + 0.95)) &&
        distance(p, e.a, e.b) < 0.44
      );
    });
  for (const lv of layout.levels) {
    const source = plan.levels.find((s) => s.floorId === lv.floorId);
    const footprint = union([
      ...(source?.spaces
        .filter((s) => !s.restricted)
        .map((s) => poly(s.rings)) ?? []),
      ...[
        ...layout.linkStrips,
        ...layout.pads.filter((p) => p.spaceId.startsWith("pad:")),
        ...layout.streetPads,
      ]
        .filter((p) => Math.abs(p.z - lv.z) < 0.02)
        .map((p) => poly(p.rings)),
    ]);
    const envelopes = layout.pads.filter(
      (p) =>
        p.spaceId.startsWith("elevator-envelope:") &&
        Math.abs(p.z - lv.z) < 0.02,
    );
    const removed = union(
      envelopes.flatMap((p) =>
        polygonClipping.difference(poly(p.rings), footprint),
      ),
    );
    for (const r of removed)
      removedAccess.push({ level: lv.label, z: lv.z, rings: rings(r) });
    layout.pads = layout.pads.flatMap((p) =>
      envelopes.includes(p)
        ? polygonClipping
            .intersection(poly(p.rings), footprint)
            .map((r, i) => ({
              ...p,
              spaceId: `${p.spaceId}:mapped${i}`,
              rings: rings(r),
            }))
        : [p],
    );

    const floor = [
      ...lv.slabs,
      ...layout.pads.filter((p) => Math.abs(p.z - lv.z) < 0.02),
      ...layout.linkStrips.filter((p) => Math.abs(p.z - lv.z) < 0.02),
    ];
    const onFloor = (p: XY) => floor.some((s) => pointInRings(p, s.rings));
    const paid = union(
      source?.spaces
        .filter((s) => !s.restricted && s.toll === "paid")
        .map((s) => poly(s.rings)) ?? [],
    );
    const free = union(
      source?.spaces
        .filter((s) => !s.restricted && s.toll === "free")
        .map((s) => poly(s.rings)) ?? [],
    );
    const existingWall = (p: XY) =>
      lv.walls.some(
        (w) =>
          lv.z + 1.7 >= w.zMin &&
          lv.z + 0.3 <= w.zMax &&
          (w.bodyMin === undefined || lv.z >= w.bodyMin) &&
          (w.bodyMax === undefined || lv.z <= w.bodyMax) &&
          distance(p, w.a, w.b) < 0.07,
      );
    const addBoundary = (
      ps: MultiPolygon,
      reason: Fence["reason"],
      keep: (p: XY, n: XY) => boolean,
    ) => {
      for (const polygon of ps)
        for (const ring of polygon)
          for (let j = 1; j < ring.length; j++) {
            const a = { x: ring[j - 1]![0], y: ring[j - 1]![1] },
              b = { x: ring[j]![0], y: ring[j]![1] },
              dx = b.x - a.x,
              dy = b.y - a.y,
              len = Math.hypot(dx, dy);
            if (len < 1e-5) continue;
            const normal = { x: (-dy / len) * 0.04, y: (dx / len) * 0.04 },
              steps = Math.max(1, Math.ceil(len / 0.08));
            let start: XY | null = null;
            const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
            const flush = (end: XY) => {
              if (start && Math.hypot(end.x - start.x, end.y - start.y) > 0.02)
                fences.push({
                  id: `${reason}:${lv.label}:${fences.length}`,
                  reason,
                  level: lv.label,
                  a: start,
                  b: end,
                  zMin: lv.z - 0.05,
                  zMax: lv.z + 1.15,
                  kind: "wall",
                  side: 1,
                });
              start = null;
            };
            for (let i = 0; i < steps; i++) {
              const p = at((i + 0.5) / steps);
              const yes =
                keep(p, normal) && !existingWall(p) && !routeClear(p, lv.z);
              if (yes && !start) start = at(i / steps);
              if (!yes && start) flush(at(i / steps));
            }
            flush(b);
          }
    };
    // CAD fare polygons can leave sub-step gaps (including gate-machine teeth).
    // Close those too: the walker can step between target samples across a narrow floor gap.
    addBoundary(
      paid,
      "fare",
      (p, n) =>
        [1, 4, 8, 12].some(
          (k) =>
            inside({ x: p.x + n.x * k, y: p.y + n.y * k }, free) ||
            inside({ x: p.x - n.x * k, y: p.y - n.y * k }, free),
        ) &&
        [1, 4, 8, 12].some((k) =>
          onFloor({ x: p.x + n.x * k, y: p.y + n.y * k }),
        ) &&
        [1, 4, 8, 12].some((k) =>
          onFloor({ x: p.x - n.x * k, y: p.y - n.y * k }),
        ),
    );
    // Only the shared border of mapped space and removed fill receives an access fence.
    addBoundary(
      footprint,
      "access",
      (p, n) =>
        (onFloor({ x: p.x + n.x, y: p.y + n.y }) ||
          onFloor({ x: p.x - n.x, y: p.y - n.y })) &&
        (inside({ x: p.x + n.x, y: p.y + n.y }, removed) ||
          inside({ x: p.x - n.x, y: p.y - n.y }, removed)),
    );
  }
  // Two source links can describe the same physical gate. Draw one aisle per distinct line.
  const gates = layout.gates.filter(
    (g, i, all) =>
      all.findIndex(
        (h) =>
          Math.hypot(g.center.x - h.center.x, g.center.y - h.center.y) < 0.02 &&
          Math.abs(g.center.z - h.center.z) < 0.02,
      ) === i,
  );
  return { fences, gates, removedAccess };
}

/** End machines straddle the verified aisle. Other source-to-source boundaries are fenced. */
export function gateMachines(g: GateLine): XY[] {
  const n = { x: -g.dir.y, y: g.dir.x };
  return [-0.62, 0.62].map((d) => ({
    x: g.center.x + n.x * d,
    y: g.center.y + n.y * d,
  }));
}
