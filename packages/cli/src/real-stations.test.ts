// route.ts on the committed Ikebukuro and Shinjuku bundles (what the Godot client shells out to / reads).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routeScript = fileURLToPath(new URL("./route.ts", import.meta.url));
const stationDir = (id: string) => fileURLToPath(new URL(`../../../stations/${id}`, import.meta.url));

interface RouteOutput {
  contract: string;
  stationId: string;
  result: { ok: boolean; nodeIds?: string[]; reason?: string; message?: string };
  path: { nodeId: string; renderer: number[]; heightSymbolic: boolean }[];
  polyline: { renderer: number[]; zKnown: boolean; stepIndex: number }[];
  instructions: { ja: { kind: string; text: string }[]; en: { kind: string; text: string }[] };
}

function route(id: string, args: string[]) {
  const run = spawnSync(process.execPath, ["--import", "tsx", routeScript, stationDir(id), ...args], { encoding: "utf8" });
  return { status: run.status, stderr: run.stderr, out: JSON.parse(run.stdout) as RouteOutput };
}

describe("@gteki/cli route on the real stations", { timeout: 30_000 }, () => {
  it("Ikebukuro: JR Central Gate 2 -> Exit 35 by node ids (the stations/ikebukuro routing golden)", () => {
    const { status, stderr, out } = route("ikebukuro", ["g_jr_c2", "x35"]);
    expect(status, stderr).toBe(0);
    expect(out.stationId).toBe("ikebukuro");
    expect(out.result.nodeIds).toEqual(["g_jr_c2", "c_g2", "c_c", "c_e1", "c_n", "c_e2", "e_27j", "e_hall", "e_hall_stair_top", "e_hall_stair_foot", "e_low", "x35"]);
    expect(out.path).toHaveLength(12);
    expect(out.polyline.length).toBeGreaterThan(out.path.length);
    expect(out.polyline.every((p) => p.renderer.length === 3 && typeof p.zKnown === "boolean")).toBe(true);
    expect(out.polyline[0]!.stepIndex).toBe(-1);
    expect(out.instructions.en[0]!.kind).toBe("start");
    expect(out.instructions.en.at(-1)!.kind).toBe("arrive");
    expect(out.instructions.ja).toHaveLength(out.instructions.en.length);
    expect(out.instructions.en.some((i) => /stairs/i.test(i.text))).toBe(true);
  });

  it("Ikebukuro: the same route by POI ids resolves connectors like the web explorer", () => {
    const byPoi = route("ikebukuro", ["jr-central-gate-2", "exit-35", "--from-poi", "--goal-poi"]);
    expect(byPoi.status, byPoi.stderr).toBe(0);
    expect(byPoi.out.result.nodeIds![0]).toBe("g_jr_c2");
    expect(byPoi.out.result.nodeIds!.at(-1)).toBe("x35");
    expect(byPoi.out.instructions.ja.length).toBeGreaterThan(2);
  });

  it("Shinjuku: Oedo platform -> street exit by POI ids; heights stay symbolic (zKnown false)", () => {
    const { status, stderr, out } = route("shinjuku", ["poi:platform:oedo", "poi:exit:1", "--from-poi", "--goal-poi"]);
    expect(status, stderr).toBe(0);
    expect(out.stationId).toBe("shinjuku");
    expect(out.path.length).toBeGreaterThan(2);
    expect(out.path.every((p) => p.heightSymbolic)).toBe(true);
    expect(out.polyline.length).toBeGreaterThan(0);
    expect(out.polyline.every((p) => !p.zKnown)).toBe(true);
    expect(out.instructions.en[0]!.kind).toBe("start");
    expect(out.instructions.en.at(-1)!.kind).toBe("arrive");
    expect(out.instructions.ja).toHaveLength(out.instructions.en.length);
  });

  it("Shinjuku: node-id goals still work (backwards compatible)", () => {
    const { status, out } = route("shinjuku", ["n:d9cd1bb0f76a440d83010e5b9f63ad65", "n:a06f3d191885497bac197b666c4daef9"]);
    expect(status).toBe(0);
    expect(out.result.ok).toBe(true);
    expect(out.path.length).toBeGreaterThan(1);
  });

  it.each([
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-mr-001", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#212)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-mr-002", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#212)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-mr-003", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#212)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-mr-004", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#212)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-mr-005", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#212)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-hope-001", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#407)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-echika-1129", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#407)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-metro-001", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#407)
    ["ikebukuro", ["jr-central-gate-2", "tobu-central-gate-2", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only POI: no verified entrance
    ["ikebukuro", ["jr-central-gate-2", "exit-c1", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only line POI (#414)
    ["ikebukuro", ["jr-central-gate-2", "metro-f-west-east-gate", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only line POI (#414)
    ["ikebukuro", ["jr-central-gate-2", "seibu-1f-gate", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only line POI (#414)
    ["ikebukuro", ["jr-central-gate-2", "jr-north-gate", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only North gate (#420)
    ["ikebukuro", ["jr-central-gate-2", "tobu-north-gate", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only North gate (#420)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-tobudept", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#432)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-lumine-000415", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#432)
    ["ikebukuro", ["jr-central-gate-2", "shop-ikb-esola-1147", "--from-poi", "--goal-poi"], "unknown_goal"], // search-only shop (#432)
    ["ikebukuro", ["g_jr_c2", "no-such-node"], "unknown_goal"],
    ["shinjuku", ["poi:platform:oedo", "poi:nope", "--from-poi", "--goal-poi"], "unknown_goal"],
    ["shinjuku", ["poi:nope", "poi:exit:1", "--from-poi", "--goal-poi"], "unknown_start"],
  ] as const)("%s %j fails safely: exit 1, empty path and polyline, no instructions", (id, args, reason) => {
    const { status, out } = route(id, [...args]);
    expect(status).toBe(1);
    expect(out.result).toMatchObject({ ok: false, reason });
    expect(out.path).toEqual([]);
    expect(out.polyline).toEqual([]);
    expect(out.instructions).toEqual({ ja: [], en: [] });
  });

  // Endpoint fare policy must match routeBetween for every POI/node mix. poi:elevator:1 has paid: null (unknown).
  // The endpoints below are connected over edges that --unpaid-only itself allows (paid=false, crossesFareBoundary=false,
  // accessEvidence present, verified, no hours): poi:elevator:1's six connectors, poi:exit:4 (n:e4cf..., paid false),
  // poi:exit:6 and poi:gate:3 all lie in the same 47-node unpaid component, so the router alone WOULD route them.
  // The asserted message proves the fare check fired, not a missing edge. (poi:exit:1 is in a different unpaid
  // component and is deliberately not used here.)
  const E4_NODE = "n:e4cfe61e944e4f5e8ad8caeb6d521750"; // connector of poi:exit:4
  const E6_NODE = "n:5cbcddf0b6e34fb89c2b7ee1220b35b2"; // connector of poi:exit:6
  const GATE3_NODE = "n:4b5ce9646e484f8485cee4bd66f187c7"; // connector of poi:gate:3
  const NOT_OUTSIDE = "not known to be outside the paid area";

  it.each([
    ["POI origin, node goal", ["poi:elevator:1", E4_NODE, "--from-poi"], "origin poi:elevator:1"],
    ["node origin, POI goal", [E4_NODE, "poi:elevator:1", "--goal-poi"], "destination poi:elevator:1"],
    ["POI origin, POI goal", ["poi:elevator:1", "poi:exit:4", "--from-poi", "--goal-poi"], "origin poi:elevator:1"],
    ["POI origin, POI goal (unknown goal)", ["poi:exit:4", "poi:elevator:1", "--from-poi", "--goal-poi"], "destination poi:elevator:1"],
  ] as const)("Shinjuku --unpaid-only with a paid-unknown POI fails closed by the fare check (%s)", (_label, args, who) => {
    const open = route("shinjuku", [...args]);
    expect(open.status, open.stderr).toBe(0); // routable under the default profile
    expect(open.out.result.ok).toBe(true);
    expect(open.out.path.length).toBeGreaterThan(1);

    const { status, out } = route("shinjuku", [...args, "--unpaid-only"]);
    expect(status).toBe(1);
    expect(out.result).toMatchObject({ ok: false, reason: "no_path" });
    expect(out.result.message).toContain(NOT_OUTSIDE);
    expect(out.result.message).toContain(who);
    expect(out.path).toEqual([]);
    expect(out.polyline).toEqual([]);
    expect(out.instructions).toEqual({ ja: [], en: [] });
  });

  it.each([
    ["POI origin, node goal", ["poi:exit:4", GATE3_NODE, "--from-poi"]],
    ["node origin, POI goal", [GATE3_NODE, "poi:exit:4", "--goal-poi"]],
    ["POI origin, POI goal", ["poi:exit:4", "poi:exit:6", "--from-poi", "--goal-poi"]],
    ["POI origin, node goal (exit 6)", ["poi:exit:4", E6_NODE, "--from-poi"]],
  ] as const)("Shinjuku --unpaid-only routes between paid:false POIs over unpaid edges (positive control: %s)", (_label, args) => {
    const { status, stderr, out } = route("shinjuku", [...args, "--unpaid-only"]);
    expect(status, stderr).toBe(0);
    expect(out.result.ok).toBe(true);
    expect(out.path.length).toBeGreaterThan(1);
    expect(out.instructions.en.at(-1)!.kind).toBe("arrive");
  });
});
