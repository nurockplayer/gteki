import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

/**
 * Shot sequence of one walk out of Ikebukuro B1: the passage before the stairs, the stairs, the street after
 * the exit. Evidence for #858 item 4, not a gate, so it runs only with GTEKI_EXIT_TRANSITION=1.
 *   GTEKI_EXIT_TRANSITION=1 GTEKI_EXIT_OUT=<dir> pnpm exec playwright test specs/28-exit-transition.spec.ts
 */
const enabled = process.env.GTEKI_EXIT_TRANSITION === "1";
const out = process.env.GTEKI_EXIT_OUT ?? "test-results/exit-transition";
const STEP_M = Number(process.env.GTEKI_EXIT_STEP_M ?? 2.5);

type Point = { x: number; y: number; z: number };

function samples(points: Point[]): Point[] {
  const result: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const count = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / STEP_M));
    for (let k = 1; k <= count; k++) result.push({ x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count, z: a.z + (b.z - a.z) * k / count });
  }
  return result;
}

test.describe("exit transition", () => {
  test.skip(!enabled, "set GTEKI_EXIT_TRANSITION=1");
  test.setTimeout(600_000);
  test("x10 walk out from B1 @phone", async ({ page }, info) => {
    await openStation(page, "ikebukuro", "");
    await hooks.walkFromNode(page, "w_nw");
    const graph = JSON.parse(fs.readFileSync(path.join(process.env.GTEKI_ROOT!, "stations/ikebukuro/gteki/graph.json"), "utf8")) as { edges: { id: string; geometry: Point[] }[] };
    const stairs = graph.edges.find((edge) => edge.id === "w_nw__x10")!.geometry;
    // 10 m of street past the exit, along the stairs' last heading.
    const a = stairs.at(-2)!, b = stairs.at(-1)!, length = Math.hypot(b.x - a.x, b.y - a.y);
    const street = { x: b.x + (b.x - a.x) / length * 10, y: b.y + (b.y - a.y) / length * 10, z: b.z };
    const points = samples([...stairs, street]);
    for (const [index, point] of points.entries()) {
      const walked = await page.evaluate((target) => (window as any).__gteki.walkPath([target], { maxSeconds: 20 }), { x: point.x, y: point.z, z: -point.y });
      await hooks.simulate(page, 0.5);
      const state = await page.evaluate(() => { const q = (window as any).__qa, a = q.cur; (window as any).__gteki.simulate(0); const c = (window as any).__gteki.camera(); return { draws: q.cur - a, avatar: (window as any).__gteki.avatar(), camera: { boom: c.boomActual, wanted: c.boomWanted, raise: c.raise, position: c.position } }; });
      console.log(`RESULT ${info.project.name} step=${index} done=${walked.done} draws=${state.draws} avatar=${JSON.stringify(state.avatar)} camera=${JSON.stringify(state.camera)}`);
      await page.screenshot({ path: `${out}/${info.project.name}/${String(index).padStart(2, "0")}.png` });
    }
    // The view from the stair head, all round: what the player gets at the end of the walk.
    for (const heading of [0, 90, 180, 270]) {
      await page.evaluate((yaw) => (window as any).__gteki.setCamera({ yaw }), -heading * Math.PI / 180);
      await hooks.simulate(page, 1);
      await page.screenshot({ path: `${out}/${info.project.name}/top-h${heading}.png` });
    }
  });
});
