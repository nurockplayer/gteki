/**
 * Headless play test: the third-person controller guide-walks real routes between POIs over the
 * analytic WalkWorld and must arrive. Catches collision walls across stair/escalator mouths,
 * missing ground, and unreachable connectors. (Prop walls from the Three.js builder — gate
 * machines, platform doors — need a canvas and are exercised in the browser instead.)
 */
import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import { buildLayout, WalkWorld, type Plan } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { Player, type GuidePoint } from "../app/src/player.ts";
import planJson from "../data/plan.json" with { type: "json" };

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const world = new WalkWorld(layout);
const router = createRouter(bundle);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const nodeZ = (id: string) => layout.nodeZ.get(id) ?? 0;

function walk(fromPoi: string, toPoi: string, stepFree = false, speed = 1) {
  const a = bundle.pois.find((p) => p.id === fromPoi)!;
  const b = bundle.pois.find((p) => p.id === toPoi)!;
  const r = router.route(a.connectorNodeIds[0]!, b.connectorNodeIds, { fare: "ticketed", stepFree });
  if (!r.ok) return { ok: false as const, reason: r.reason };
  const pts: GuidePoint[] = r.nodeIds.map((id, i) => ({
    ...nodes.get(id)!.position,
    z: nodeZ(id),
    nodeId: id,
    elevator: i > 0 && r.steps[i - 1]!.mode === "elevator",
    escalator: i > 0 && r.steps[i - 1]!.mode === "escalator",
  }));
  const player = new Player(world, pts[0]!);
  let arrived = false;
  player.onGuideEvent = (e) => {
    if (e.type === "arrived") arrived = true;
  };
  player.startGuide(pts);
  player.setGuideSpeed(speed);
  const limit = r.totalLengthM / 0.5 + 60; // allow the slowest guided connector, the escalator ride
  let t = 0;
  for (; t < limit && !arrived; t += 1 / 30) player.update(1 / 30, { forward: 0, strafe: 0, run: false }, player.heading);
  const end = pts[pts.length - 1]!;
  // arrival must be at the destination's height too (not on an overlapping floor)
  if (arrived && Math.abs(player.z - end.z) > 0.35) arrived = false;
  return { ok: true as const, arrived, seconds: Math.round(t), stuckAt: arrived ? null : { x: +player.x.toFixed(1), y: +player.y.toFixed(1), z: +player.z.toFixed(1), next: pts[player.guideIndex]?.nodeId }, distToEnd: Math.hypot(player.x - end.x, player.y - end.y) };
}

describe("guided walk over the E27 walk world", () => {
  const platform = "poi:platform:oedo";
  const targets = bundle.pois.filter((p) => p.category === "exit" || p.category === "ticket_gate").map((p) => p.id);

  it.each(targets)("platform → %s arrives", (to) => {
    const res = walk(platform, to);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res, JSON.stringify(res)).toMatchObject({ arrived: true });
  });

  it.each(targets)("%s → platform arrives", (from) => {
    const res = walk(from, platform);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res, JSON.stringify(res)).toMatchObject({ arrived: true });
  });

  it.each([2, 4])("accelerated guide at ×%s still completes ascending and descending routes", (speed) => {
    for (const [from, to] of [[platform, "poi:exit:1"], ["poi:gate:1", "poi:toilet:1"]] as const) {
      const normal = walk(from, to);
      const fast = walk(from, to, false, speed);
      expect(fast.ok).toBe(true);
      if (fast.ok && normal.ok) {
        expect(fast, JSON.stringify(fast)).toMatchObject({ arrived: true });
        expect(fast.seconds).toBeLessThan(normal.seconds / (speed * 0.85));
      }
    }
  });

  it("every routable POI pair arrives (ticketed and step-free profiles)", () => {
    const stuck: string[] = [];
    let walked = 0;
    for (const a of bundle.pois)
      for (const b of bundle.pois) {
        if (a === b || !a.connectorNodeIds.length || !b.connectorNodeIds.length) continue;
        for (const stepFree of [false, true]) {
          const res = walk(a.id, b.id, stepFree);
          if (!res.ok) continue; // e.g. no step-free path: the router fails closed, nothing to walk
          walked++;
          if (!res.arrived) stuck.push(`${a.id}→${b.id}${stepFree ? " (step-free)" : ""} ${JSON.stringify(res.stuckAt)}`);
        }
      }
    expect(walked).toBeGreaterThan(100);
    expect(stuck).toEqual([]);
  }, 60_000);
});
