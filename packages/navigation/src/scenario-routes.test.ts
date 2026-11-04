import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createRouter, routeBetween, routePolyline, type NavmeshEdgePaths } from "./index.ts";
import { stationClock } from "../../../apps/web/src/stationClock.ts";

type Scenario = {
  id: string; from: string; to: string; expect: "ok" | "fail" | "record";
  profile?: { stepFree?: boolean; unpaidOnly?: boolean; strictHours?: boolean }; modes?: string[];
};
const read = (file: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
const scenarios = read("tests/e2e/fixtures/scenarios.json") as Record<string, Scenario[]>;

for (const station of ["ikebukuro", "shinjuku"]) {
  describe(`${station} scenario routes`, () => {
    const dir = `stations/${station}/gteki`;
    const parsed = parseStationFiles(read(`${dir}/station.json`), read(`${dir}/graph.json`), read(`${dir}/pois.json`), read(`${dir}/tenants.json`));
    if (!parsed.ok) throw new Error(`${station}: ${JSON.stringify(parsed.issues)}`);
    const bundle = parsed.bundle;
    const router = createRouter(bundle);
    const paths = read(`stations/${station}/navmesh-paths.json`) as {
      edges: NavmeshEdgePaths; joins?: Record<string, readonly (readonly number[])[]>;
    };

    for (const scenario of scenarios[station]!) {
      if (scenario.expect === "record") continue;
      it(`${scenario.id}: ${scenario.from} → ${scenario.to}`, () => {
        const from = bundle.pois.find((poi) => poi.id === scenario.from);
        const to = bundle.pois.find((poi) => poi.id === scenario.to);
        if (!from || !to) throw new Error(`${scenario.id}: missing POI`);
        const clock = stationClock(new Date(), "Asia/Tokyo");
        const route = routeBetween(router, { kind: "poi", poi: from }, to, {
          fare: scenario.profile?.unpaidOnly ? "unpaid_only" : "ticketed",
          stepFree: scenario.profile?.stepFree ?? false,
          hours: scenario.profile?.strictHours ? "require_known" : "warn_unknown",
          at: { weekday: clock.weekday, minutes: clock.minutes }, today: clock.date, timeZone: "Asia/Tokyo",
        });
        expect(route.ok, `${scenario.id} route`).toBe(scenario.expect === "ok");
        if (route.ok && scenario.expect === "ok") {
          for (const mode of scenario.modes ?? []) expect(route.steps.map((step) => step.mode)).toContain(mode);
          expect(routePolyline(bundle, route, undefined, paths.edges, paths.joins).length, `${scenario.id} guide`).toBeGreaterThan(0);
        }
      });
    }
  });
}
