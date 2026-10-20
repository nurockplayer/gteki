import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, routeWaypoints, save, shotPath, type StationKey } from "../lib/gteki.ts";

/**
 * Confirm-by-eye tool for a free-walk "blocked" result. Re-walks each routed step on its own,
 * starting at the step's from-node, aiming at every vertex of the exact edge geometry with one real
 * drag and holding W. No nudges, no recovery. A step that stops here, away from its geometry, points
 * at the scene; a step that completes here but blocked in 04-free-walk points at the autopilot.
 *
 *   GTEKI_PROBE=shinjuku:poi:platform:oedo>poi:exit:2 pnpm exec playwright test specs/08-step-probe.spec.ts
 */
const spec = process.env.GTEKI_PROBE;
const LOOK_RAD_PER_PX = 0.0042;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

async function drag(page: Page, dx: number) {
  const c = (await page.locator("canvas.gteki-canvas").boundingBox())!;
  const x = c.x + c.width * 0.5, y = c.y + c.height * 0.45;
  for (let sent = 0; Math.abs(dx - sent) >= 1; ) {
    const chunk = Math.max(-500, Math.min(500, Math.round(dx - sent)));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + chunk, y, { steps: 2 });
    await page.mouse.up();
    sent += chunk;
  }
}

test.skip(!spec, "set GTEKI_PROBE=<station>:<from>><to>");
test.use({ trace: "off" });

test(`step probe ${spec}`, async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const [key, rest] = [spec!.slice(0, spec!.indexOf(":")) as StationKey, spec!.slice(spec!.indexOf(":") + 1)];
  const [from, to] = rest.split(">") as [string, string];
  await openStation(page, key);
  await hooks.setProfile(page, { stepFree: false, unpaidOnly: false, strictHours: false });
  await hooks.setOrigin(page, from);
  await hooks.setDestination(page, to);
  const route = await hooks.route(page);
  expect(route?.ok).toBe(true);
  const steps = route.steps as { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }[];
  const wps = routeWaypoints(key, steps);
  const results: Record<string, unknown>[] = [];
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s]!;
    if (step.mode === "elevator") { results.push({ s, edgeId: step.edgeId, mode: step.mode, skipped: "lift" }); continue; }
    const pts = wps.filter((w) => w.stepIndex === s).map((w) => w.p);
    expect(await hooks.walkFromNode(page, step.fromNodeId)).toBe(true);
    let pos = await hooks.avatar(page);
    let yaw = 0;
    let worst = 0;
    for (const p of pts) {
      const want = Math.atan2(-(p.x - pos.x), p.y - pos.y);
      const dx = Math.round(-wrap(want - yaw) / LOOK_RAD_PER_PX);
      if (Math.abs(dx) >= 2) { await drag(page, dx); yaw = wrap(yaw - dx * LOOK_RAD_PER_PX); }
      const d0 = Math.hypot(p.x - pos.x, p.y - pos.y);
      pos = await hooks.simulate(page, d0 / 1.45 + 0.5, ["KeyW"]);
      worst = Math.max(worst, Math.hypot(p.x - pos.x, p.y - pos.y));
    }
    const end = pts.at(-1)!;
    const miss = Math.hypot(end.x - pos.x, end.y - pos.y);
    const r = { s, edgeId: step.edgeId, mode: step.mode, vertices: pts.length, end: pos, missM: Math.round(miss * 100) / 100, worstVertexMissM: Math.round(worst * 100) / 100, dz: Math.round((pos.z - end.z) * 100) / 100 };
    if (miss > 1) await page.screenshot({ path: shotPath(testInfo, `${key}-probe-step${String(s).padStart(2, "0")}.png`) });
    results.push(r);
  }
  save(testInfo, `${key}-step-probe.json`, { from, to, results });
  expect.soft(results.filter((r) => typeof r.missM === "number" && (r.missM as number) > 1), "steps that stop more than 1 m short of their end").toEqual([]);
});
