import { expect, test, type Page } from "@playwright/test";
import { chooseBySearch, hooks, openStation, routeWaypoints, save, shotPath, stationData, type Vec3, type Waypoint } from "../lib/gteki.ts";
test.use({ trace: "off" });

/**
 * Shinjuku hanging-sign readability on the phone tier after #279 halved the sign atlas (#276). For the six signs
 * sjk-visual-13 picked on spec 03's two routes, the guide is played at its default speed and the screen is shot
 * when the walker's distance along the route is 15, 10 and 6 m before each sign's node. The signs are two-sided
 * boards on the sign-faces atlas, so their position on screen is not read from the scene: the frames are judged
 * by a reviewer (the report lists every shot with its sign, face direction and the measured stand-off).
 *
 * Distances are horizontal, along the routed polyline, from the walker's projection onto it to the sign node's.
 * Skipped unless GTEKI_SIGN_READ=1; run on phone-chromium (low tier) one invocation at a time.
 */
test.skip(process.env.GTEKI_SIGN_READ !== "1", "set GTEKI_SIGN_READ=1 to run the Shinjuku sign readability probe");

const SIGNS = ["1ecbdf77f58f423fa3142d1b71e078bf", "2d2bc35b4043433da2914b2705ef69bb", "453ea111f1524cef8f3ac139bbf2e26b",
  "c2d390021c29442f86dda359e503febd", "e31954cbec9e4b1cac647326d5bcb4e4", "3516783a1d9c4dc1828424aa135173a6"];
const STANDOFFS = [15, 10, 6];
const routes = [
  { label: "exit1-platform", from: ["north side", /street level, north side/] as [string, RegExp], to: ["platform", /Oedo Line platform/] as [string, RegExp] },
  { label: "platform-exit2", from: ["platform", /Oedo Line platform/] as [string, RegExp], to: ["northwest", /street level, northwest side/] as [string, RegExp] },
];

/** Horizontal arc length along the polyline at the projection of p (nearest segment in 3D, so floors stay apart). */
function along(wps: Waypoint[], p: Vec3): { s: number; off: number } {
  let acc = 0, best = { s: 0, off: Infinity, d: Infinity };
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1]!.p, b = wps[i]!.p;
    const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z, len2 = vx * vx + vy * vy + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy + (p.z - a.z) * vz) / len2));
    const q = { x: a.x + vx * t, y: a.y + vy * t, z: a.z + vz * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y, (p.z - q.z) * 2);
    const seg = Math.hypot(vx, vy);
    if (d < best.d) best = { s: acc + seg * t, off: Math.hypot(p.x - q.x, p.y - q.y), d };
    acc += seg;
  }
  return { s: best.s, off: best.off };
}

async function guideMode(page: Page) { return hooks.mode(page); }

for (const r of routes) {
  test(`shinjuku signs on ${r.label}: shots at 15/10/6 m @phone`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    await openStation(page, "shinjuku");
    await chooseBySearch(page, "from", r.from[0], r.from[1]);
    await chooseBySearch(page, "to", r.to[0], r.to[1]);
    const route = await hooks.route(page);
    expect(route?.ok, "route exists").toBe(true);
    const wps = routeWaypoints("shinjuku", route.steps);
    const total = along(wps, wps.at(-1)!.p).s;
    const { graph } = stationData("shinjuku");
    const targets = SIGNS.map((id) => {
      const n = graph.nodes.find((x) => x.id === `n:${id}` || x.id === id || x.id.endsWith(id));
      if (!n) return { id, node: null, s: null, off: null };
      const z = n.position.z ?? (n as { renderZ?: number }).renderZ ?? 0;
      const a = along(wps, { x: n.position.x, y: n.position.y, z });
      return { id, node: n.id, s: Math.round(a.s * 10) / 10, off: Math.round(a.off * 10) / 10 };
    });
    const offRoute = targets.filter((t) => t.s === null || t.off === null || t.off >= 4).map((t) => ({ id: t.id, node: t.node, offM: t.off }));
    const onRoute = targets.filter((t) => t.s !== null && t.off !== null && t.off < 4);
    const shots: { sign: string; standoffM: number; measuredM: number; file: string; avatar: Vec3; t: number }[] = [];
    const pending = onRoute.flatMap((t) => STANDOFFS.filter((d) => t.s! - d > 0.5).map((d) => ({ sign: t.id, d, at: t.s! - d })));
    await page.locator(".sheet .card.route button.primary").click();
    await expect.poll(() => guideMode(page)).toBe("guide");
    const t0 = Date.now();
    while (pending.length && Date.now() - t0 < 360_000 && (await guideMode(page)) === "guide") {
      const av = await hooks.avatar(page);
      const s = along(wps, av).s;
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]!;
        if (s >= p.at) {
          const file = shotPath(testInfo, `sign-${r.label}-${p.sign.slice(0, 8)}-${p.d}m.png`);
          await page.screenshot({ path: file });
          const sign = onRoute.find((x) => x.id === p.sign)!;
          shots.push({ sign: p.sign, standoffM: p.d, measuredM: Math.round((sign.s! - s) * 10) / 10, file, avatar: av, t: Date.now() - t0 });
          pending.splice(i, 1);
        }
      }
      await page.waitForTimeout(150);
    }
    const tier = await page.evaluate(() => (window as any).__gteki?.quality?.() ?? (window as any).__gteki?.sceneInfo?.()?.quality ?? null);
    save(testInfo, `sign-read-${r.label}.json`, { project: testInfo.project.name, viewport: page.viewportSize(), tier, routeLengthM: Math.round(total), targets: onRoute, notOnRoute: offRoute, missed: pending, shots });
    // Readability is judged on the frames; this only guards against a run that shot nothing it was asked for.
    expect.soft(pending, "every planned shot was taken").toEqual([]);
    expect.soft(shots.length, "shots taken").toBeGreaterThan(0);
  });
}
