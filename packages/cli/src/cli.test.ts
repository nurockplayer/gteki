import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";

const exportScript = fileURLToPath(new URL("./export-fixture.ts", import.meta.url));
const routeScript = fileURLToPath(new URL("./route.ts", import.meta.url));

function invoke(script: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8" });
}

async function fixtureDir(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "gteki-cli-"));
  const exported = invoke(exportScript, [root]);
  if (exported.status !== 0) throw new Error(exported.stderr || "fixture export failed");
  return root;
}

const stationFile = (root: string, name: string) => resolve(root, "gteki", name);

// Each case spawns `tsx` subprocesses; allow for a loaded machine (CI, parallel suites).
describe("@gteki/cli", { timeout: 30_000 }, () => {
  it("exports deterministic station files that pass the shared parser", async () => {
    const firstRoot = await mkdtemp(resolve(tmpdir(), "gteki-cli-first-"));
    const secondRoot = await mkdtemp(resolve(tmpdir(), "gteki-cli-second-"));
    try {
      expect(invoke(exportScript, [firstRoot]).status).toBe(0);
      expect(invoke(exportScript, [secondRoot]).status).toBe(0);
      const names = ["station.json", "graph.json", "pois.json"];
      const outputs = await Promise.all([firstRoot, secondRoot].map(async (root) =>
        Promise.all(names.map((name) => readFile(resolve(root, "gteki", name), "utf8")))));
      expect(outputs[0]).toEqual(outputs[1]);
      const parsed = parseStationFiles(...outputs[0]!.map((text) => JSON.parse(text) as unknown) as [unknown, unknown, unknown]);
      expect(parsed.ok).toBe(true);
    } finally {
      await Promise.all([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })]);
    }
  });

  it("reads the optional store brand directory and refuses an invalid one (#419)", async () => {
    const root = await fixtureDir();
    try {
      const file = stationFile(root, "tenants.json");
      await writeFile(file, JSON.stringify({ schema: "gteki.tenants/0.1", tenants: [] }), "utf8");
      expect(invoke(routeScript, [root, "start", "goal"]).status).toBe(0);
      const invalid = {
        schema: "gteki.tenants/0.1",
        tenants: [{
          id: "tenant-store-1", poiId: "no-such-poi", names: [{ lang: "ja", text: "テスト" }], aliases: [],
          floorLabel: [{ lang: "ja", text: "1F" }],
          evidence: { sourceIds: ["demo-synthetic"], method: "field-survey", checkedDate: "2026-10-22" },
        }],
      };
      await writeFile(file, JSON.stringify(invalid), "utf8");
      const bad = invoke(routeScript, [root, "start", "goal"]);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain("tenant.poi");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes start to goal and emits ENU plus renderer coordinates", async () => {
    const root = await fixtureDir();
    try {
      const result = invoke(routeScript, [root, "start", "goal"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as { contract: string; result: { ok: boolean; nodeIds: string[] }; path: { nodeId: string; enu: { x: number; y: number; z: number | null }; renderer: number[]; heightSymbolic: boolean }[] };
      expect(output.contract).toBe("gteki.route/0.1");
      expect(output.result.ok).toBe(true);
      expect(output.result.nodeIds).toEqual(["start", "a", "goal"]);
      expect(output.path[1]).toEqual({ nodeId: "a", enu: { x: 10, y: 0, z: 0 }, renderer: [10, 0, 0], heightSymbolic: false });
      const extra = JSON.parse(result.stdout) as { polyline: { renderer: number[]; zKnown: boolean; stepIndex: number }[]; instructions: { ja: { kind: string; text: string }[]; en: { kind: string }[] } };
      expect(extra.polyline[0]).toMatchObject({ stepIndex: -1, renderer: output.path[0]!.renderer });
      expect(extra.polyline.at(-1)!.renderer).toEqual(output.path.at(-1)!.renderer);
      expect(extra.instructions.en.map((i) => i.kind)[0]).toBe("start");
      expect(extra.instructions.en.at(-1)!.kind).toBe("arrive");
      expect(extra.instructions.ja.length).toBe(extra.instructions.en.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps unknown ENU height null while using the node render-height fallback", async () => {
    const root = await fixtureDir();
    try {
      const graphPath = stationFile(root, "graph.json");
      const graph = JSON.parse(await readFile(graphPath, "utf8")) as { nodes: { id: string; position: { z: number | null }; renderZ?: number }[] };
      const node = graph.nodes.find((candidate) => candidate.id === "a")!;
      node.position.z = null;
      const knownHeight = graph.nodes.find((candidate) => candidate.id === "goal")!;
      knownHeight.position.z = 0;
      knownHeight.renderZ = 5;
      await writeFile(graphPath, JSON.stringify(graph), "utf8");

      const result = invoke(routeScript, [root, "start", "a,goal"]);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.result.nodeIds).toEqual(["start", "a"]);
      expect(output.path[1]).toEqual({
        nodeId: "a", enu: { x: 10, y: 0, z: null }, renderer: [10, 0, 0], heightSymbolic: true,
      });
      const known = invoke(routeScript, [root, "start", "goal"]);
      expect(JSON.parse(known.stdout).path[2]).toEqual({
        nodeId: "goal", enu: { x: 20, y: 0, z: 0 }, renderer: [20, 0, 0], heightSymbolic: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a JSON route failure and applies profile options", async () => {
    const root = await fixtureDir();
    try {
      const failure = invoke(routeScript, [root, "start", "isolated"]);
      expect(failure.status).toBe(1);
      expect(JSON.parse(failure.stdout)).toMatchObject({ result: { ok: false, reason: "no_path" }, path: [], polyline: [] });

      const badOption = invoke(routeScript, [root, "start", "goal", "--today", "2026-02-30"]);
      expect(badOption.status).toBe(2);
      expect(badOption.stdout).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects node and POI argument shape mismatches after loading the station", async () => {
    const root = await fixtureDir();
    try {
      const cases = [
        { args: [root, "start", "goal", "--from-poi"], message: "--from-poi expects a POI id; start is a node id" },
        { args: [root, "exit-a1", "goal"], message: "exit-a1 is a POI id; add --from-poi" },
        { args: [root, "start", "goal", "--goal-poi"], message: "--goal-poi expects a POI id; goal is a node id" },
        { args: [root, "start", "toilet"], message: "toilet is a POI id; add --goal-poi" },
      ];
      for (const { args, message } of cases) {
        const result = invoke(routeScript, args);
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(`${message}\nUsage: route.ts <stationDir> <from> <comma-separated goals> [--step-free] [--unpaid-only] [--strict-hours] [--today YYYY-MM-DD] [--from-poi] [--goal-poi]\n`);
      }

      const unknownFrom = invoke(routeScript, [root, "poi:nope", "goal", "--from-poi"]);
      expect(unknownFrom.status).toBe(1);
      expect(JSON.parse(unknownFrom.stdout)).toMatchObject({ result: { ok: false, reason: "unknown_start" } });
      const unknownGoal = invoke(routeScript, [root, "start", "poi:nope", "--goal-poi"]);
      expect(unknownGoal.status).toBe(1);
      expect(JSON.parse(unknownGoal.stdout)).toMatchObject({ result: { ok: false, reason: "unknown_goal" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies constrained profiles and fails closed on invalid files", async () => {
    const root = await fixtureDir();
    try {
      const graphPath = stationFile(root, "graph.json");
      const originalGraph = await readFile(graphPath, "utf8");
      const defaultRoute = invoke(routeScript, [root, "start", "goal"]);
      expect(defaultRoute.status).toBe(0);

      const graph = JSON.parse(originalGraph) as { stationId: string; edges: { wheelchair: boolean | null; paid: boolean | null; crossesFareBoundary: boolean | null; hours: unknown }[] };
      for (const edge of graph.edges) edge.wheelchair = null;
      await writeFile(graphPath, JSON.stringify(graph), "utf8");
      expect(invoke(routeScript, [root, "start", "goal"]).status).toBe(0);
      expect(invoke(routeScript, [root, "start", "goal", "--step-free"]).status).toBe(1);

      for (const edge of graph.edges) {
        edge.wheelchair = true;
        edge.paid = null;
        edge.crossesFareBoundary = null;
      }
      await writeFile(graphPath, JSON.stringify(graph), "utf8");
      expect(invoke(routeScript, [root, "start", "goal", "--unpaid-only"]).status).toBe(1);

      for (const edge of graph.edges) {
        edge.paid = false;
        edge.crossesFareBoundary = false;
        edge.hours = null;
      }
      await writeFile(graphPath, JSON.stringify(graph), "utf8");
      expect(invoke(routeScript, [root, "start", "goal", "--strict-hours"]).status).toBe(1);
      expect(invoke(routeScript, [root, "start", "goal", "--step-free", "--unpaid-only", "--strict-hours", "--today", "2026-10-20"]).status).toBe(1);

      const stationPath = stationFile(root, "station.json");
      const station = JSON.parse(await readFile(stationPath, "utf8")) as { station: { names: unknown } };
      station.station.names = "broken-shape";
      await writeFile(stationPath, JSON.stringify(station), "utf8");
      const structural = invoke(routeScript, [root, "start", "goal"]);
      expect(structural.status).toBe(2);
      expect(structural.stdout).toBe("");
      expect(structural.stderr).toContain("shape.type");

      station.station.names = [{ lang: "en", text: "Synthetic test station (not for navigation)" }];
      await writeFile(stationPath, JSON.stringify(station), "utf8");
      graph.stationId = "different-station";
      await writeFile(graphPath, JSON.stringify(graph), "utf8");
      const identity = invoke(routeScript, [root, "start", "goal"]);
      expect(identity.status).toBe(2);
      expect(identity.stdout).toBe("");
      expect(identity.stderr).toContain("file.station");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON without emitting route output", async () => {
    const root = await fixtureDir();
    try {
      await writeFile(stationFile(root, "graph.json"), "{ broken", "utf8");
      const result = invoke(routeScript, [root, "start", "goal"]);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("graph.json:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
