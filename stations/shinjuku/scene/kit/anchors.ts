/**
 * Shinjuku anchors a kit piece may attach to. Every anchor comes from data the scene already draws or
 * from the GSI facility list in plan.json: verified gate rows, the lift portals mounted on existing
 * walls, stair and escalator runs, the three toilet facility points (F001 to F003), and the street-level
 * top of each exit run. Nothing is invented: no anchor exists for shops, kiosks, benches or vending
 * because the dataset has none.
 */
import type { StationBundle } from "@gteki/schema";
import type { FareProtection } from "../fare-fence.ts";
import type { Layout, LevelLayout, Plan, WallSeg, XY, XYZ } from "../layout.ts";
import { surfaceEntrances } from "../surface-layout.ts";
import type { ExitTopAnchor, GateRowAnchor, KitAnchors, LiftAnchor, RunAnchor, ToiletAnchor } from "./types.ts";

/** GSI indoor spatial data spec (H30.3): toilet facility codes. The only facility codes the swap adds anchors for. */
export const TOILET_FACILITY_CODES = ["F001", "F002", "F003"] as const;

const unit = (a: XY, b: XY): XY | null => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l < 1e-9 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

function levelAt(layout: Layout, z: number): LevelLayout | undefined {
  let best: LevelLayout | undefined;
  for (const lv of layout.levels) if (!best || Math.abs(lv.z - z) < Math.abs(best.z - z)) best = lv;
  return best;
}

export function gateRowAnchors(layout: Layout, protection: FareProtection): GateRowAnchor[] {
  return protection.gates.map((g) => ({
    role: "gate" as const,
    key: g.edgeId,
    center: g.center,
    dir: g.dir,
    width: g.width,
    floorId: levelAt(layout, g.center.z)?.floorId ?? "",
  }));
}

export function runAnchors(layout: Layout): RunAnchor[] {
  return layout.runs.flatMap((r) => {
    const lo = r.a.z <= r.b.z ? r.a : r.b;
    const hi = r.a.z <= r.b.z ? r.b : r.a;
    const dir = unit(lo, hi);
    if (!dir || hi.z - lo.z < 0.05) return []; // flat landing links are floor strips, not runs
    return [{ role: r.mode, key: r.edgeId, lo, hi, width: r.width, dir, floorId: levelAt(layout, lo.z)?.floorId ?? "" }];
  });
}

/** The toilet facility points, each with the nearest toilet-room wall on its level (the room's door side is not in the data). */
export function toiletAnchors(layout: Layout, plan: Plan): ToiletAnchor[] {
  const out: ToiletAnchor[] = [];
  for (const level of plan.levels) {
    const lv = layout.levels.find((l) => l.floorId === level.floorId);
    if (!lv) continue;
    for (const f of level.facilities) {
      if (!(TOILET_FACILITY_CODES as readonly string[]).includes(f.category)) continue;
      const point: XYZ = { x: f.x, y: f.y, z: lv.z };
      out.push({ role: "toilet", key: f.id, code: f.category, point, wall: toiletWall(lv.walls, point), floorId: lv.floorId });
    }
  }
  return out;
}

const CHAIN_JOIN_M = 0.05;
const CHAIN_BEND_COS = Math.cos((12 * Math.PI) / 180);
const TOILET_WALL_REACH_M = 12;

/**
 * The straight run of toilet-room wall nearest the facility point. CAD room outlines are jagged, so a single
 * segment is often under a metre: neighbours that join end to end and bend by at most 12 degrees are chained.
 * The facility point is a room representative, not a door position, so this is a placement heuristic, not a claim.
 */
function toiletWall(walls: WallSeg[], point: XY): ToiletAnchor["wall"] {
  const segs = walls.filter((w) => w.kind === "toilet" && Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 1e-6);
  const dist = (w: WallSeg) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, t = Math.max(0, Math.min(1, ((point.x - w.a.x) * dx + (point.y - w.a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (w.a.x + dx * t), point.y - (w.a.y + dy * t));
  };
  let seed: WallSeg | null = null;
  for (const w of segs) if (!seed || dist(w) < dist(seed)) seed = w;
  if (!seed || dist(seed) > TOILET_WALL_REACH_M) return null;
  const dirOf = (w: WallSeg) => unit(w.a, w.b)!;
  const chain: WallSeg[] = [seed];
  const used = new Set<WallSeg>(chain);
  for (let grew = true; grew;) {
    grew = false;
    const head = chain[0]!, tail = chain[chain.length - 1]!;
    for (const w of segs) {
      if (used.has(w) || w.side !== seed.side) continue;
      if (Math.hypot(w.a.x - tail.b.x, w.a.y - tail.b.y) < CHAIN_JOIN_M && dirOf(w).x * dirOf(tail).x + dirOf(w).y * dirOf(tail).y >= CHAIN_BEND_COS) { chain.push(w); used.add(w); grew = true; break; }
      if (Math.hypot(w.b.x - head.a.x, w.b.y - head.a.y) < CHAIN_JOIN_M && dirOf(w).x * dirOf(head).x + dirOf(w).y * dirOf(head).y >= CHAIN_BEND_COS) { chain.unshift(w); used.add(w); grew = true; break; }
    }
  }
  const a = chain[0]!.a, b = chain[chain.length - 1]!.b;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const u = unit(a, b)!;
  const s = Math.max(0, Math.min(length, (point.x - a.x) * u.x + (point.y - a.y) * u.y));
  const left = { x: -u.y, y: u.x };
  return { point: { x: a.x + u.x * s, y: a.y + u.y * s }, u, normal: seed.side >= 0 ? left : { x: -left.x, y: -left.y }, length, s };
}

export function exitTopAnchors(layout: Layout, bundle: StationBundle): ExitTopAnchor[] {
  return surfaceEntrances(layout, bundle).map((e) => ({
    role: "exit" as const,
    key: e.id,
    top: e.top,
    center: e.center,
    u: e.u,
    halfWidth: e.halfWidth,
    halfLength: e.halfLength,
    z: 0,
    floorId: levelAt(layout, 0)?.floorId ?? "",
  }));
}

export function collectKitAnchors(args: { layout: Layout; protection: FareProtection; plan: Plan; bundle: StationBundle; lifts: LiftAnchor[] }): KitAnchors {
  return {
    gates: gateRowAnchors(args.layout, args.protection),
    lifts: args.lifts,
    runs: runAnchors(args.layout),
    toilets: toiletAnchors(args.layout, args.plan),
    exits: exitTopAnchors(args.layout, args.bundle),
  };
}
