/** "直進 / Go straight" is a claim about the path: it must not be spoken across a real bend. */
import { describe, expect, it } from "vitest";
import { createRouter, type RouteResult } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { narrate, staysStraight } from "../app/src/narrate.ts";

const { bundle } = loadShinjukuBundle();
const router = createRouter(bundle);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const poi = (id: string) => bundle.pois.find((p) => p.id === id)!;
const heading = (from: string, to: string) => {
  const a = nodes.get(from)!.position, b = nodes.get(to)!.position;
  return Math.atan2(b.x - a.x, b.y - a.y);
};
const route = (from: string, to: string, stepFree = false) =>
  router.route(poi(from).connectorNodeIds, poi(to).connectorNodeIds, { fare: "ticketed", stepFree, today: "2026-10-21" });

/** Plan headings of the walk steps each maneuver speaks for (up to the next maneuver). */
function spans(r: RouteResult) {
  const ms = narrate(bundle, r);
  return ms.map((m, k) => {
    const end = k + 1 < ms.length ? ms[k + 1]!.startIndex : r.steps.length;
    const walk = r.steps.slice(k === 0 ? 0 : m.startIndex, end).filter((s) => s.mode === "walk");
    return { m, headings: walk.map((s) => heading(s.fromNodeId, s.toNodeId)), nodes: walk.map((s) => s.fromNodeId) };
  });
}

describe("walk narration names real bends", () => {
  it("does not call the 91° B2 bend on exit 1 → exit 3 straight", () => {
    const r = route("poi:exit:1", "poi:exit:3");
    if (!r.ok) throw new Error(r.message);
    const bend = "n:cc72a4c123d240ab8abe66d677e29f39";
    const k = r.steps.findIndex((s) => s.fromNodeId === bend);
    expect(k).toBeGreaterThan(0);
    const before = heading(r.steps[k - 1]!.fromNodeId, bend), after = heading(bend, r.steps[k]!.toNodeId);
    expect(Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)))).toBeGreaterThan(1.5);
    const across = spans(r).filter(({ m, nodes: ns }) => /直進|Go straight/.test(m.ja + m.en) && ns.includes(bend) && ns[0] !== bend);
    expect(across.map(({ m }) => m.ja)).toEqual([]);
    expect(narrate(bundle, r).some((m) => m.kind === "turn" && m.startIndex === k)).toBe(true);
  });

  it("never speaks 直進 / Go straight over a heading range wider than 60° on any routable POI pair", () => {
    const bad: string[] = [];
    let walks = 0;
    for (const a of bundle.pois)
      for (const b of bundle.pois)
        for (const stepFree of [false, true]) {
          if (a === b || !a.connectorNodeIds.length || !b.connectorNodeIds.length) continue;
          const r = route(a.id, b.id, stepFree);
          if (!r.ok) continue;
          for (const { m, headings } of spans(r)) {
            if (!/^直進/.test(m.ja)) continue;
            walks++;
            expect(m.en).toMatch(/^Go straight/);
            if (!staysStraight(headings)) bad.push(`${a.id}→${b.id}${stepFree ? " (step-free)" : ""}: ${m.ja}`);
          }
        }
    expect(walks).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  }, 120_000);

  it("staysStraight rejects a drift past 60° and a swing wider than 60°", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(staysStraight([0, deg(20), deg(40), deg(55)])).toBe(true);
    expect(staysStraight([0, deg(35), deg(70)])).toBe(false);
    expect(staysStraight([0, deg(40), deg(-35)])).toBe(false);
    expect(staysStraight([deg(179), deg(-179)])).toBe(true);
  });
});
