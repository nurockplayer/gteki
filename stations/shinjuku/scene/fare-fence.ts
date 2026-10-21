/** Fare/access containment from source polygons; never supplies or alters routing edges. */
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import {
  pointInRings,
  centroid,
  railingWalls,
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
  signSpan?: { a: XY; b: XY };
  restrictedSpaceId?: string;
  restrictedNodeId?: string;
  closedSide?: XY;
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
/** Convert and bound each polygon once, rather than allocating rings for every 8 cm probe. */
export function containsPolygons(ps: XY[][][]) {
  const prepareRing = (ring: XY[]) => {
    const rows = new Map<number, { a: XY; b: XY }[]>();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + ring.length - 1) % ring.length]!;
      if (a.y === b.y) continue;
      for (let y = Math.floor(Math.min(a.y, b.y) / 4); y <= Math.floor(Math.max(a.y, b.y) / 4); y++) {
        const list = rows.get(y) ?? []; list.push({ a, b }); rows.set(y, list);
      }
    }
    // The same ray-crossing formula as layout.pointInRing; only impossible edges are skipped.
    return (p: XY) => {
      let inside = false;
      for (const { a, b } of rows.get(Math.floor(p.y / 4)) ?? [])
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      return inside;
    };
  };
  const bounded = ps.map(rings => {
    const r = rings[0]!, [outer, ...holes] = rings.map(prepareRing);
    const contains = (p: XY) => !!outer?.(p) && !holes.some(test => test(p));
    return { contains, x0: Math.min(...r.map(p => p.x)), x1: Math.max(...r.map(p => p.x)),
      y0: Math.min(...r.map(p => p.y)), y1: Math.max(...r.map(p => p.y)) };
  });
  const cells = new Map<string, typeof bounded>();
  for (const b of bounded) for (let x = Math.floor(b.x0 / 8); x <= Math.floor(b.x1 / 8); x++)
    for (let y = Math.floor(b.y0 / 8); y <= Math.floor(b.y1 / 8); y++) {
      const key = `${x},${y}`, list = cells.get(key) ?? [];
      list.push(b); cells.set(key, list);
    }
  let last = "", candidates: typeof bounded = [];
  return (p: XY) => {
    const key = `${Math.floor(p.x / 8)},${Math.floor(p.y / 8)}`;
    if (key !== last) { last = key; candidates = cells.get(key) ?? []; }
    return candidates.some(b => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && b.contains(p));
  };
}
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
        x0: Math.min(pts[i]!.x, b.x) - .44, x1: Math.max(pts[i]!.x, b.x) + .44,
        y0: Math.min(pts[i]!.y, b.y) - .44, y1: Math.max(pts[i]!.y, b.y) + .44,
        za: za + ((zb - za) * lengths[i]!) / (lengths.at(-1) || 1),
        zb: za + ((zb - za) * lengths[i + 1]!) / (lengths.at(-1) || 1),
      }));
    });
  const routeClear = (p: XY, z: number, radius = .44) =>
    paths.some((e) => {
      if (p.x < e.x0 || p.x > e.x1 || p.y < e.y0 || p.y > e.y1 ||
          z < Math.min(e.za, e.zb) - 0.95 || z > Math.max(e.za, e.zb) + 1.75)
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
        distance(p, e.a, e.b) < radius
      );
    });
  for (const lv of layout.levels) {
    const source = plan.levels.find((s) => s.floorId === lv.floorId);
    const envelopes = layout.pads.filter(
      p => p.spaceId.startsWith("elevator-envelope:") && Math.abs(p.z - lv.z) < .02,
    );
    // Access containment only needs the footprint near procedural elevator fill.
    // Unioning the whole station (including floors with no envelope) dominated start-up.
    const overlapsEnvelope = (rs: XY[][]) => {
      const r = rs[0]!, x0 = Math.min(...r.map(p => p.x)), x1 = Math.max(...r.map(p => p.x));
      const y0 = Math.min(...r.map(p => p.y)), y1 = Math.max(...r.map(p => p.y));
      return envelopes.some(e => {
        const a = e.rings[0]!;
        return Math.max(...a.map(p => p.x)) >= x0 && Math.min(...a.map(p => p.x)) <= x1 &&
          Math.max(...a.map(p => p.y)) >= y0 && Math.min(...a.map(p => p.y)) <= y1;
      });
    };
    const candidates = [
      ...(source?.spaces.filter(s => !s.restricted).map(s => s.rings) ?? []),
      ...[...layout.linkStrips, ...layout.pads.filter(p => p.spaceId.startsWith("pad:")), ...layout.streetPads]
        .filter(p => Math.abs(p.z - lv.z) < .02).map(p => p.rings),
    ].filter(overlapsEnvelope);
    const footprint = union(candidates.map(poly));
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
    const onFloor = containsPolygons(floor.map(s => s.rings));
    // Point membership needs no union. A paid perimeter matters only on mixed-fare floors.
    const free = source?.spaces.filter(s => !s.restricted && s.toll === "free").map(s => s.rings) ?? [];
    const paid = free.length ? union(source?.spaces.filter(s => !s.restricted && s.toll === "paid").map(s => poly(s.rings)) ?? []) : [];
    const inFree = containsPolygons(free);
    const inRemoved = containsPolygons(removed.map(rings));
    const walls = lv.walls.filter(w => lv.z + 1.7 >= w.zMin && lv.z + .3 <= w.zMax &&
      (w.bodyMin === undefined || lv.z >= w.bodyMin) && (w.bodyMax === undefined || lv.z <= w.bodyMax))
      .map(w => ({ w, x0: Math.min(w.a.x, w.b.x) - .07, x1: Math.max(w.a.x, w.b.x) + .07,
        y0: Math.min(w.a.y, w.b.y) - .07, y1: Math.max(w.a.y, w.b.y) + .07 }));
    const wallRows = new Map<number, typeof walls>();
    for (const b of walls) for (let y = Math.floor(b.y0 / 4); y <= Math.floor(b.y1 / 4); y++) {
      const row = wallRows.get(y) ?? []; row.push(b); wallRows.set(y, row);
    }
    const existingWall = (p: XY) => (wallRows.get(Math.floor(p.y / 4)) ?? []).some(b =>
      p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && distance(p, b.w.a, b.w.b) < .07);
    const addBoundary = (
      ps: MultiPolygon,
      reason: Fence["reason"],
      keep: (p: XY, n: XY) => boolean,
    ) => {
      const margin = reason === "fare" ? .5 : .05;
      const relevant = (reason === "fare" ? free : removed.map(rings)).map(rs => {
        const r = rs[0]!;
        return { x0: Math.min(...r.map(p => p.x)) - margin, x1: Math.max(...r.map(p => p.x)) + margin,
          y0: Math.min(...r.map(p => p.y)) - margin, y1: Math.max(...r.map(p => p.y)) + margin };
      });
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
              if (start && Math.hypot(end.x - start.x, end.y - start.y) > 0.02) {
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
              }
              start = null;
            };
            // Preserve the original 8 cm probe positions, but visit only edge
            // intervals that could touch an opposite fare polygon / removed fill.
            const windows = relevant.flatMap(box => {
              let lo = 0, hi = 1;
              for (const [v, d, min, max] of [[a.x, dx, box.x0, box.x1], [a.y, dy, box.y0, box.y1]]) {
                if (Math.abs(d!) < 1e-12) { if (v! < min! || v! > max!) return []; }
                else { const u = (min! - v!) / d!, w = (max! - v!) / d!; lo = Math.max(lo, Math.min(u, w)); hi = Math.min(hi, Math.max(u, w)); }
              }
              return lo <= hi ? [[Math.max(0, Math.floor(lo * steps) - 1), Math.min(steps, Math.ceil(hi * steps) + 1)]] : [];
            }).sort((a, b) => a[0]! - b[0]!);
            const merged: number[][] = [];
            for (const w of windows) {
              const last = merged.at(-1);
              if (last && last[1]! >= w[0]!) last[1] = Math.max(last[1]!, w[1]!);
              else merged.push(w);
            }
            for (const [lo, hi] of merged) {
              for (let i = lo!; i < hi!; i++) {
                const p = at((i + 0.5) / steps);
                const yes = keep(p, normal) && !existingWall(p) && !routeClear(p, lv.z);
                if (yes && !start) start = at(i / steps);
                if (!yes && start) flush(at(i / steps));
              }
              flush(at(hi! / steps));
            }
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
            inFree({ x: p.x + n.x * k, y: p.y + n.y * k }) ||
            inFree({ x: p.x - n.x * k, y: p.y - n.y * k }),
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
        (inRemoved({ x: p.x + n.x, y: p.y + n.y }) ||
          inRemoved({ x: p.x - n.x, y: p.y - n.y })) &&
        (onFloor({ x: p.x + n.x, y: p.y + n.y }) ||
          onFloor({ x: p.x - n.x, y: p.y - n.y })),
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
  // A boundary-alignment return is safe only when the whole published route stays clear.
  const guards = restrictedEntranceGuards(layout, plan, bundle);
  for (let i = 0; i < guards.length; i += 3) {
    const group = guards.slice(i, i + 3);
    const clear = group.every(f => {
      const count = Math.max(1, Math.ceil(Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) / .002));
      for (let j = 0; j <= count; j++) if (routeClear({ x: f.a.x + (f.b.x - f.a.x) * j / count, y: f.a.y + (f.b.y - f.a.y) * j / count }, f.zMin + .05, .3001)) return false;
      return true;
    });
    if (clear) fences.push(...group);
  }
  closeBarrierEnds(layout, fences, gates, (a, b, z) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / .03));
    for (let i = 0; i <= steps; i++) if (routeClear({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, z, .34)) return false;
    return true;
  });
  return { fences, gates, removedAccess };
}

/** Source-restricted entrances whose verified endpoint lies on a CAD boundary.
 * A return 0.315 m inside the boundary leaves the 0.3 m body at most a 1.5 cm
 * alignment sliver inside it, while retaining the published endpoint's clearance.
 */
export function restrictedEntranceGuards(layout: Layout, plan: Plan, bundle: StationBundle): Fence[] {
  const out: Fence[] = [];
  for (const lv of plan.levels) for (const space of lv.spaces.filter(s => s.restricted)) {
    const points = space.rings[0]!, x0 = Math.min(...points.map(p => p.x)), x1 = Math.max(...points.map(p => p.x));
    const y0 = Math.min(...points.map(p => p.y)), y1 = Math.max(...points.map(p => p.y));
    const nodes = bundle.nodes.filter(n => n.floorId === lv.floorId && Math.abs((layout.nodeZ.get(n.id) ?? Infinity) - lv.renderElevationM) < .02 &&
      n.position.x >= x0 && n.position.x <= x1 && n.position.y >= y0 && n.position.y <= y1 && pointInRings(n.position, space.rings));
    for (const node of nodes) {
      const near = space.rings.flatMap(r => r.slice(1).map((b, i) => {
        const a = r[i]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        const t = Math.max(0, Math.min(length, ((node.position.x - a.x) * dx + (node.position.y - a.y) * dy) / length));
        const q = { x: a.x + dx * t / length, y: a.y + dy * t / length };
        return { a, b, q, length, t, distance: Math.hypot(q.x - node.position.x, q.y - node.position.y) };
      })).filter(e => e.length > 1e-8).sort((a, b) => a.distance - b.distance)[0];
      if (!near || near.distance > .02 || near.distance < 1e-8) continue;
      const n = { x: (node.position.x - near.q.x) / near.distance, y: (node.position.y - near.q.y) / near.distance };
      const u = { x: (near.b.x - near.a.x) / near.length, y: (near.b.y - near.a.y) / near.length };
      const at = (t: number, depth: number): XY => ({ x: near.a.x + u.x * t + n.x * depth, y: near.a.y + u.y * t + n.y * depth });
      const a = at(Math.max(0, near.t - .85), 0), b = at(Math.min(near.length, near.t + .85), 0);
      const c = { x: a.x + n.x * .315, y: a.y + n.y * .315 }, d = { x: b.x + n.x * .315, y: b.y + n.y * .315 };
      for (const [i, [from, to]] of [[a, c], [c, d], [d, b]].entries()) out.push({
        id: `restricted:${space.id}:${node.id}:${i}`, restrictedSpaceId: space.id, restrictedNodeId: node.id,
        closedSide: i === 1 ? { x: (c.x + d.x) / 2 + n.x * .1, y: (c.y + d.y) / 2 + n.y * .1 } : undefined, reason: "access", level: lv.label,
        a: from!, b: to!, zMin: lv.renderElevationM - .05, zMax: lv.renderElevationM + 1.15, side: 1, kind: "wall",
      });
    }
  }
  return out;
}

/** Close actual centre lines, rather than relying on overlapping radius capsules.
 * Keep every verified edge clear; these are procedural joins, not additional passages.
 */
function closeBarrierEnds(layout: Layout, fences: Fence[], gates: GateLine[], clear: (a: XY, b: XY, z: number) => boolean) {
  for (const f of fences) if (f.reason === "access") f.signSpan = { a: { ...f.a }, b: { ...f.b } };
  const machines = gates.flatMap(g => gateMachines(g).map(c => ({
    a: { x: c.x - g.dir.x * .75, y: c.y - g.dir.y * .75 },
    b: { x: c.x + g.dir.x * .75, y: c.y + g.dir.y * .75 },
    zMin: g.center.z - .1, zMax: g.center.z + 1, bodyMin: g.center.z - .5,
    kind: "wall" as const, side: 1 as const,
  })));
  const walls = [...layout.levels.flatMap(l => l.walls), ...layout.runWalls, ...railingWalls(layout), ...machines];
  const nearest = (p: XY, w: WallSeg) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / (dx * dx + dy * dy || 1)));
    return { x: w.a.x + dx * t, y: w.a.y + dy * t };
  };
  const blocking = (w: WallSeg, z: number) => z + 1.7 >= w.zMin && z + .3 <= w.zMax &&
    (w.bodyMin === undefined || z >= w.bodyMin) && (w.bodyMax === undefined || z <= w.bodyMax);
  const join = (p: XY, z: number, level: string, reason: Fence["reason"], self?: Fence, end?: "a" | "b", exclude?: WallSeg) => {
    const other = self && end ? self[end === "a" ? "b" : "a"] : undefined;
    const outward = (q: XY) => !other || distance(q, p, other) > 1e-5 ||
      (q.x - p.x) * (p.x - other.x) + (q.y - p.y) * (p.y - other.y) >= -1e-8;
    const optionsAt = (radius: number) => [...walls, ...fences].filter(w => w !== self && w !== exclude && blocking(w, z) &&
      p.x >= Math.min(w.a.x, w.b.x) - radius && p.x <= Math.max(w.a.x, w.b.x) + radius &&
      p.y >= Math.min(w.a.y, w.b.y) - radius && p.y <= Math.max(w.a.y, w.b.y) + radius)
      .flatMap(w => [nearest(p, w), w.a, w.b].filter(outward).map(q => ({ w, q, d: Math.hypot(p.x - q.x, p.y - q.y) })))
      .filter(v => v.d <= radius).sort((a, b) => a.d - b.d);
    const options = optionsAt(2);
    if ((options[0]?.d ?? Infinity) <= .02) return;
    const option = options.find(v => clear(p, v.q, z));
    if (!option) return; // The independent endpoint test reports any unresolved join.
    const { q } = option;
    if (self && end) {
      const other = self[end === "a" ? "b" : "a"], dx = p.x - other.x, dy = p.y - other.y, len = Math.hypot(dx, dy);
      const extension = ((q.x - p.x) * dx + (q.y - p.y) * dy) / len;
      const along = { x: p.x + dx / len * (extension + .015), y: p.y + dy / len * (extension + .015) };
      if (extension >= 0 && distance(along, option.w.a, option.w.b) <= .015 && clear(p, along, z)) {
        self[end] = along; return;
      }
    }
    fences.push({ id: `join:${level}:${fences.length}`, reason, level, a: { ...p }, b: { ...q },
      zMin: z - .05, zMax: z + 1.15, side: 1, kind: "wall" });
  };
  for (const f of [...fences]) for (const end of ["a", "b"] as const)
    join(f[end], f.zMin + .05, f.level, f.reason, f, end);
  let i = 0;
  for (const g of gates) for (const c of gateMachines(g)) {
    const level = layout.levels.find(l => Math.abs(l.z - g.center.z) < .02)!.label;
    join(c, g.center.z, level, "fare", undefined, undefined, machines[i++]!);
  }
}

/** End machines straddle the verified aisle. Other source-to-source boundaries are fenced. */
export function gateMachines(g: GateLine): XY[] {
  const n = { x: -g.dir.y, y: g.dir.x };
  return [-0.62, 0.62].map((d) => ({
    x: g.center.x + n.x * d,
    y: g.center.y + n.y * d,
  }));
}

/** Wording describes the closed side of this particular sign, not an inferred station rule. */
export const ACCESS_WORDING = {
  restricted: { ja: "立入制限区域", en: "Restricted area" },
  closed: { ja: "立入不可", en: "No entry" },
} as const;
export function accessSigns(protection: FareProtection, plan: Plan) {
  const used = new Set<string>();
  const signFences = protection.fences.filter(f => !f.id.startsWith("join:")).map(f => ({ ...f, ...(f.signSpan ?? {}) }));
  const signs = protection.removedAccess.flatMap(area => {
    const center = centroid(area.rings[0]!), pts = area.rings[0]!;
    const x0 = Math.min(...pts.map(p => p.x)) - .15, x1 = Math.max(...pts.map(p => p.x)) + .15;
    const y0 = Math.min(...pts.map(p => p.y)) - .15, y1 = Math.max(...pts.map(p => p.y)) + .15;
    const fence = signFences.filter(f => {
      const x = (f.a.x + f.b.x) / 2, y = (f.a.y + f.b.y) / 2;
      return f.reason === "access" && !f.restrictedSpaceId && f.level === area.level && Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) >= .7 && x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }).sort((a, b) => {
      const distance = (f: Fence) => Math.hypot((f.a.x + f.b.x) / 2 - center.x, (f.a.y + f.b.y) / 2 - center.y);
      return distance(a) - distance(b);
    })[0];
    if (!fence || used.has(fence.id)) return [];
    used.add(fence.id);
    const mid = { x: (fence.a.x + fence.b.x) / 2, y: (fence.a.y + fence.b.y) / 2 };
    const length = Math.hypot(fence.b.x - fence.a.x, fence.b.y - fence.a.y);
    const removedSide = [-1, 1].map(sign => ({
      x: mid.x - sign * (fence.b.y - fence.a.y) / length * .1,
      y: mid.y + sign * (fence.b.x - fence.a.x) / length * .1,
    })).find(p => pointInRings(p, area.rings));
    if (!removedSide) throw new Error(`Access sign ${fence.id} has no closed side`);
    const source = plan.levels.find(l => Math.abs(l.renderElevationM - area.z) < .02)?.spaces
      .find(s => s.restricted && pointInRings(removedSide, s.rings));
    const classification = source ? "restricted" : "closed";
    return [{ fence, z: area.z, removedSide, classification, sourceSpaceId: source?.id ?? null,
      ...ACCESS_WORDING[classification] }];
  });
  const named = new Set<string>();
  for (const fence of signFences.filter(f => f.closedSide).sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))) if (fence.closedSide && fence.restrictedSpaceId && !named.has(fence.restrictedSpaceId)) {
    named.add(fence.restrictedSpaceId);
    signs.push({
    fence, z: fence.zMin + .05, removedSide: fence.closedSide, classification: "restricted",
    sourceSpaceId: fence.restrictedSpaceId, ...ACCESS_WORDING.restricted,
    });
  }
  return signs;
}
