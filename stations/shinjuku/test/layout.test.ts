import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { buildLayout, WalkWorld, type Plan } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;

describe("E27 scene layout", () => {
  const layout = buildLayout(bundle, plan);
  const world = new WalkWorld(layout);

  it("builds every level with floor slabs and walls", () => {
    expect(layout.levels.length).toBe(6);
    for (const lv of layout.levels) {
      expect(lv.slabs.length).toBeGreaterThan(0);
      expect(lv.walls.length).toBeGreaterThan(0);
      expect(lv.ceilingZ).toBeGreaterThan(lv.z + 2.2);
    }
  });

  it("puts walkable ground under every non-elevator graph node at its render height", () => {
    const misses: string[] = [];
    for (const n of bundle.nodes) {
      if (n.kind === "elevator") continue;
      const z = layout.nodeZ.get(n.id)!;
      if (world.groundAt(n.position, z, 0.3, 0.3) === null) misses.push(`${n.id} ${n.floorId} ${n.kind}`);
    }
    // report, then require near-total coverage
    if (misses.length) console.warn("nodes without ground:", misses.length, misses.slice(0, 12));
    expect(misses).toEqual([]);
  });

  it("lets a walker follow every walk/stairs/escalator/gate edge without leaving the ground", () => {
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const bad: string[] = [];
    for (const e of bundle.edges) {
      if (e.mode === "elevator") continue;
      const A = nodeById.get(e.from)!;
      const B = nodeById.get(e.to)!;
      let z = layout.nodeZ.get(e.from)!;
      const steps = Math.max(2, Math.ceil((e.lengthM ?? 1) / 0.25));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: A.position.x + (B.position.x - A.position.x) * t, y: A.position.y + (B.position.y - A.position.y) * t };
        const g = world.groundAt(p, z);
        if (g === null) {
          bad.push(`${e.id} ${e.mode} at t=${t.toFixed(2)}`);
          break;
        }
        z = g;
      }
      // must also end at the destination's height (no staying on an overlapping surface)
      if (!bad.at(-1)?.startsWith(e.id) && Math.abs(z - layout.nodeZ.get(e.to)!) > 0.35) bad.push(`${e.id} ${e.mode} ends at ${z.toFixed(2)} ≠ ${layout.nodeZ.get(e.to)!.toFixed(2)}`);
    }
    if (bad.length) console.warn("edges not walkable:", bad.length, bad.slice(0, 15));
    expect(bad).toEqual([]);
  });
});
