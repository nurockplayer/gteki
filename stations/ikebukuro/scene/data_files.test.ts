// station.json `dataFiles` (#186): the scene data the web bundle inlines is declared with the sources it is actually
// derived from. The expected sourceIds are computed here from the generators' inputs, so a declaration can neither
// miss a source a new input brings in nor keep one that no longer contributes. Where a generator's exact inputs are
// hard to pin down the set is the wide one (all verified edges), as each entry's derivation says.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const PLATEAU = "plateau-ubld-13116";

interface Evidence { sourceIds: string[] }
interface Edge { from: string; to: string; verification: string; geometryEvidence?: Evidence; accessEvidence?: Evidence }
interface DataFile { id: string; path: string; sourceIds: string[]; modified: boolean; authored?: boolean; derivation?: string }

const src = read("data/graph.src.json");
const station = read("gteki/station.json");
const graph = read("gteki/graph.json");
const pois = new Map<string, { evidence: Evidence }>(read("gteki/pois.json").pois.map((p: { id: string }) => [p.id, p]));
const nodes = new Map<string, { sourceRefs: { sourceId: string }[] }>(graph.nodes.map((n: { id: string }) => [n.id, n]));
const verified: Edge[] = graph.edges.filter((e: Edge) => e.verification === "verified");

/** Sources of the routable coverage areas (their polygons bound the fences and the crowd lanes). */
const routableAreas = (): string[] =>
  src.coverage.areas.filter((a: { status: string; polygon?: unknown }) => a.status === "routable" && a.polygon)
    .flatMap((a: Evidence) => a.sourceIds);
/** Every verified edge's geometry and access evidence, and its end nodes' sourceRefs (the wide edge set). */
const verifiedEdges = (): string[] =>
  verified.flatMap((e) => [
    ...(e.geometryEvidence?.sourceIds ?? []),
    ...(e.accessEvidence?.sourceIds ?? []),
    ...[e.from, e.to].flatMap((id) => nodes.get(id)!.sourceRefs.map((r) => r.sourceId)),
  ]);
/** Evidence of every POI (exit, gate) a sign shows, front or back. */
function shownPois(): string[] {
  const ids = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      const id = (o as { id?: unknown }).id;
      if (typeof id === "string" && pois.has(id)) ids.add(id);
      Object.values(o).forEach(walk);
    }
  };
  walk(read("scene/signage.json").signs);
  expect(ids.size).toBeGreaterThan(0);
  return [...ids].flatMap((id) => pois.get(id)!.evidence.sourceIds);
}

/** Derived files name their generating script and cite the sources it reads; an authored file (GTEki's own config,
 *  #256) cites none and its derivation says it is GTEki-authored. */
const EXPECTED: Record<string, { script: string; sources: () => string[]; authored?: boolean }> = {
  "scene/walk_bridges.json": { script: "pipeline/build_walkfix.py", sources: () => [PLATEAU] },
  "scene/access_fences.json": { script: "pipeline/build_access.py", sources: () => [PLATEAU, ...routableAreas()] },
  "scene/crowd_lanes.json": { script: "pipeline/build_station.py", sources: () => [PLATEAU, ...routableAreas(), ...verifiedEdges()] },
  "scene/signage.json": { script: "pipeline/build_signage.py", sources: () => [PLATEAU, ...verifiedEdges(), ...shownPois()] },
  "scene/finishes.json": { script: "GTEki-authored", sources: () => [], authored: true },
};

const declared: DataFile[] = src.dataFiles;

describe("ikebukuro dataFiles", () => {
  it("station.json carries graph.src.json's dataFiles unchanged", () => {
    expect(station.dataFiles).toEqual(declared);
  });

  it.each(Object.entries(EXPECTED))("%s cites exactly the sources its generator reads", (path, { script, sources, authored }) => {
    const d = declared.find((f) => f.path === path);
    expect(d, `${path} is not declared`).toBeDefined();
    expect(d!.sourceIds).toEqual([...new Set(sources())].sort());
    expect(d!.modified).toBe(true);
    expect(d!.authored ?? false).toBe(authored ?? false);
    expect(d!.derivation?.startsWith(`${script}`)).toBe(true);
  });

  it("declares nothing else", () => {
    expect(declared.map((d) => d.path).filter((p) => !(p in EXPECTED))).toEqual([]);
  });
});
