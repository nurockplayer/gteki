// station.json `dataFiles` (#186): the non-code data the web bundle inlines is declared with the sources it is
// actually derived from. The expected sourceIds are computed here from the generators' inputs, so a declaration
// can neither miss a source a new input brings in nor keep one that no longer contributes.
//
// The two E27 resources are the only inputs to the NWD-derived parts; the street context comes from PLATEAU alone,
// filtered by the E27 exit nodes' positions. No file below is generated from OSM or field notes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const NWD = "mlit-hokonavi-e27-nwd";
const MAP = "mlit-hokonavi-e27-stationmap";
const PLATEAU = "plateau-13104-shinjuku-ku-2025";

interface Evidence { sourceIds: string[] }
interface Node { id: string; floorId: string; inOut: string; sourceRefs: { sourceId: string }[] }
interface Edge { from: string; to: string; verification: string; geometryEvidence?: Evidence; accessEvidence?: Evidence }
interface PlanLevel { spaces: unknown[] }
interface DataFile { id: string; path: string; sourceIds: string[]; modified: boolean; derivation?: string }

const station = read("gteki/station.json");
const graph = read("gteki/graph.json");
const plan = read("data/plan.json");
const nodes = new Map<string, Node>(graph.nodes.map((n: Node) => [n.id, n]));
const verified: Edge[] = graph.edges.filter((e: Edge) => e.verification === "verified");

/** tools/import-surface.ts bounds its PLATEAU selection by these street-level exit node positions. */
const surfaceExits = (): string[] =>
  graph.nodes
    .filter((n: Node) => ["toei-nwd-0", "toei-nwd-1"].includes(n.floorId) && n.inOut !== "inside")
    .flatMap((n: Node) => n.sourceRefs.map((r) => r.sourceId));

/** Every verified edge's geometry/access evidence and its end nodes — the lines the fare fences are traced along. */
const verifiedEdges = (): string[] =>
  verified.flatMap((e) => [
    ...(e.geometryEvidence?.sourceIds ?? []),
    ...(e.accessEvidence?.sourceIds ?? []),
    ...[e.from, e.to].flatMap((id) => nodes.get(id)!.sourceRefs.map((r) => r.sourceId)),
  ]);

/** data/plan.json carries the 構内地図 (stationmap) polygons, so the fare fences that follow them cite it. */
const planPolygons = (): string[] => {
  expect((plan.levels as PlanLevel[]).length).toBeGreaterThan(0);
  expect((plan.levels as PlanLevel[]).some((l) => l.spaces.length > 0)).toBe(true);
  return [MAP];
};

/** Stairwell recipes (#650) replay this bundle's cut: the sources the graph cites, and those the other scene files cite. */
const stairwellSources = (): string[] => {
  const cited = [
    ...graph.nodes.flatMap((n: Node) => n.sourceRefs.map((r) => r.sourceId)),
    ...graph.edges.flatMap((e: Edge) => [...(e.geometryEvidence?.sourceIds ?? []), ...(e.accessEvidence?.sourceIds ?? [])]),
    ...(station.dataFiles as DataFile[]).filter((d) => !d.path.startsWith("scene/stairwell-cut.")).flatMap((d) => d.sourceIds),
  ];
  return [...new Set(cited)];
};

const EXPECTED: Record<string, { script: string; sources: () => string[] }> = {
  "scene/stairwell-cut.high.b64.txt": { script: "packages/godot/src/stairwell-bake.ts", sources: stairwellSources },
  "scene/stairwell-cut.low.b64.txt": { script: "packages/godot/src/stairwell-bake.ts", sources: stairwellSources },
  "scene/shop_bays.json": { script: "tools/shop-bays.ts", sources: () => [NWD, MAP] },
  "scene/shop_placements.json": { script: "scene/shop_placements.json", sources: () => ["gteki-kit-0-1-0"] },
  "scene/shop_kit.json": { script: "scene/shop_kit.json", sources: () => ["gteki-kit-0-1-0"] },
  "data/plan.json": { script: "tools/import-e27.ts", sources: () => [NWD, MAP] },
  "data/surface.json": { script: "tools/import-surface.ts", sources: () => [PLATEAU, ...surfaceExits()] },
  "scene/fare-restricted.generated.json": { script: "test/helpers/generate-restricted-fences.ts", sources: () => [...planPolygons(), ...verifiedEdges()] },
  // #121: derived from surface.json, the bundle and the plan together.
  "data/surface-baked.json": { script: "tools/bake-surface.ts", sources: () => [PLATEAU, ...surfaceExits(), NWD, MAP] },
};

const declared: DataFile[] = station.dataFiles;

describe("shinjuku dataFiles", () => {
  it("declares exactly the data files the bundle inlines", () => {
    expect(declared.map((d) => d.path).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))("%s cites exactly the sources its generator reads", (path, { script, sources }) => {
    const d = declared.find((f) => f.path === path);
    expect(d, `${path} is not declared`).toBeDefined();
    expect(d!.sourceIds).toEqual([...new Set(sources())].sort());
    expect(d!.modified).toBe(true);
    expect(d!.derivation?.startsWith(`${script}`)).toBe(true);
  });

  it("declares nothing else and keeps unique ids", () => {
    const ids = declared.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(declared.map((d) => d.path).filter((p) => !(p in EXPECTED))).toEqual([]);
  });
});
