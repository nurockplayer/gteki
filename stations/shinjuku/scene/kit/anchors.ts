/**
 * Shinjuku anchors a kit piece may attach to. Every anchor comes from data the scene already draws or
 * from the GSI facility list in plan.json: verified gate rows, the lift portals mounted on existing
 * walls, stair and escalator runs, the three toilet facility points (F001 to F003), and the street-level
 * top of each exit run. Nothing is invented: no anchor exists for shops, kiosks, benches or vending
 * because the dataset has none.
 */
import type { StationBundle } from "@gteki/schema";
import type { FareProtection } from "../fare-fence.ts";
import type { Layout, LevelLayout, Plan, XY } from "../layout.ts";
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

/**
 * The toilet facility points (F001 to F003). Each is a room representative from the GSI list, not a door: the dataset
 * has no door source, so the anchors exist to be counted and reported as a gap, never to place a piece.
 */
export function toiletAnchors(layout: Layout, plan: Plan): ToiletAnchor[] {
  const out: ToiletAnchor[] = [];
  for (const level of plan.levels) {
    const lv = layout.levels.find((l) => l.floorId === level.floorId);
    if (!lv) continue;
    for (const f of level.facilities) {
      if (!(TOILET_FACILITY_CODES as readonly string[]).includes(f.category)) continue;
      out.push({ role: "toilet", key: f.id, code: f.category, point: { x: f.x, y: f.y, z: lv.z }, floorId: lv.floorId });
    }
  }
  return out;
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
