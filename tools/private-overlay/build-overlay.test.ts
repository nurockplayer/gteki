import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Edge, Floor, Node, Poi, Source, Tenant } from "../../packages/schema/src/index.ts";
import { parseStationFiles, TENANTS_SCHEMA_VERSION } from "../../packages/schema/src/index.ts";
import { createDemoFiles } from "../../apps/web/src/demo.ts";
import { createRouter } from "../../packages/navigation/src/index.ts";
import { createTenantFixtureBundle } from "../../packages/navigation/src/fixtures.ts";
import { buildPrivateSeam } from "../gis/src/s03-private-seam.ts";
import type { HeldGraphDocument } from "../gis/src/s03-nav-graph-route.ts";
import { buildOverlay, mergeStation, type Additions, type StationFiles } from "./build-overlay.ts";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-overlay-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function publicFiles(): StationFiles {
  const [manifest, graph, pois] = createDemoFiles();
  return { manifest, graph, pois };
}
function source(id = "private-source"): Source {
  return {
    id, title: "Synthetic private addition", publisher: "GTEki test", url: "https://example.invalid/",
    license: null, rights: "UNVERIFIED", attribution: "Synthetic test", modified: true,
    retrievedAt: null, datasetDate: null, notes: "[tier P] synthetic fixture",
  };
}
function floor(): Floor {
  return {
    id: "d-test", operatorId: "demo-rail", sourceLabels: [{ operatorId: "demo-rail", label: "Test", sourceId: "private-source" }],
    ordinal: 3, intermediate: false, elevationM: null, elevationSource: "unknown", renderElevationM: 1,
  };
}
function node(id: string): Node {
  return { id, floorId: "d-b1", position: { x: 1, y: 2, z: null }, kind: "junction", inOut: "inside", sourceRefs: [] };
}
function edge(id: string, from: string, to: string): Edge {
  return {
    id, from, to, direction: "both", mode: "walk", lengthM: null, paid: null, crossesFareBoundary: null,
    wheelchair: null, steps: null, hours: null, closed: false, verification: "synthetic",
    geometryEvidence: { sourceIds: ["private-source"], method: "synthetic-fixture", checkedDate: "2026-10-27" },
    accessEvidence: null,
  };
}
function poi(id: string): Poi {
  return {
    id, category: "shop", names: [{ lang: "en", text: "Private kiosk" }], aliases: [], floorId: "d-b1",
    displayPosition: null, connectorNodeIds: ["private-node"], paid: null,
    evidence: { sourceIds: ["private-source"], method: "synthetic-fixture", checkedDate: "2026-10-27" },
  };
}
/** The tenant fixture bundle as public files, with its tenants.json. */
function tenantFiles(): StationFiles {
  const { nodes, edges, pois, tenants, ...rest } = createTenantFixtureBundle();
  return {
    manifest: { schema: rest.schema, station: rest.station, sources: rest.sources, floors: rest.floors, coverage: rest.coverage },
    graph: { schema: rest.schema, stationId: rest.station.id, nodes, edges },
    pois: { schema: rest.schema, stationId: rest.station.id, pois },
    tenants: { schema: TENANTS_SCHEMA_VERSION, tenants },
  };
}
function tenant(id: string, ja: string): Tenant {
  return {
    id, poiId: "store", names: [{ lang: "ja", text: ja }], aliases: [], floorLabel: [{ lang: "ja", text: "B1F" }],
    evidence: { sourceIds: ["private-source"], method: "facts-only tenant directory listing (OD-34), UNVERIFIED", checkedDate: "2026-10-27" },
  };
}
const additions = (patch: Partial<Additions> = {}): Additions => ({ graphParts: [], ...patch });

describe("private overlay builder", () => {
  it("merges additions in public order and validates the merged files", () => {
    const pub = publicFiles();
    const result = mergeStation(pub, additions({
      sources: [source()], floors: [floor()], pois: [poi("private-poi")],
      graphParts: [{ file: "graph.json", nodes: [node("private-node")], edges: [edge("private-edge", "private-node", "b1-c")] }],
    }));
    expect(result.graph.nodes.map((n) => n.id).slice(-1)).toEqual(["private-node"]);
    expect(result.graph.edges.map((e) => e.id).slice(-1)).toEqual(["private-edge"]);
    expect(result.pois.pois.map((p) => p.id).slice(-1)).toEqual(["private-poi"]);
    expect(result.manifest.floors.map((f) => f.id).slice(-1)).toEqual(["d-test"]);
    expect(parseStationFiles(result.manifest, result.graph, result.pois, result.tenants, { privateTier: true }).ok).toBe(true);
  });

  it("replaces an addition POI with a public id in place", () => {
    const pub = publicFiles();
    const index = pub.pois.pois.findIndex((item) => item.id === "toilet");
    const replacement = { ...pub.pois.pois[index], names: [{ lang: "en" as const, text: "Private restroom" }] };
    const result = mergeStation(pub, additions({ pois: [replacement] }));
    expect(result.pois.pois.map((item) => item.id)).toEqual(pub.pois.pois.map((item) => item.id));
    expect(result.pois.pois[index].names[0].text).toBe("Private restroom");
  });

  it("merges tenant additions by id, an addition winning a clash", () => {
    const pub = tenantFiles();
    const tenantsOf = (files: StationFiles) => (files.tenants as { tenants: Tenant[] }).tenants;
    const privateSource = { ...source(), usage: "facts-only" as const, decision: { url: "https://example.invalid/decision", date: "2026-10-27" } };
    const result = mergeStation(pub, additions({ sources: [privateSource], tenants: [tenant("tenant-store-1", "私的薬局"), tenant("tenant-p-1", "私的ブランド")] }));
    expect(tenantsOf(result).map((t) => t.id)).toEqual([...tenantsOf(pub).map((t) => t.id), "tenant-p-1"]);
    expect(tenantsOf(result)[0].names[0].text).toBe("私的薬局");
    // A station without a public tenants.json gets one from its additions alone.
    const { tenants: _, ...withoutTenants } = pub;
    expect(tenantsOf(mergeStation(withoutTenants, additions({ sources: [privateSource], tenants: [tenant("tenant-p-1", "私的ブランド")] }))).map((t) => t.id)).toEqual(["tenant-p-1"]);
    expect(() => mergeStation(pub, additions({ sources: [privateSource], tenants: [tenant("tenant-p-1", "a"), tenant("tenant-p-1", "b")] }))).toThrow(/tenant id tenant-p-1 appears twice in tenants\.json/);
    // The merged file is still validated: a tenant on an unknown POI fails.
    expect(() => mergeStation(pub, additions({ sources: [privateSource], tenants: [{ ...tenant("tenant-p-2", "x"), poiId: "nope" }] }))).toThrow(/tenant-p-2/);
  });

  it("rejects duplicate graph ids across addition files and identifies both files", () => {
    expect(() => mergeStation(publicFiles(), additions({ graphParts: [
      { file: "graph.json", nodes: [node("duplicate")], edges: [] },
      { file: "graph.s03.json", nodes: [node("duplicate")], edges: [] },
    ] }))).toThrow(/graph\.json.*graph\.s03\.json/);
    expect(() => mergeStation(publicFiles(), additions({ graphParts: [
      { file: "graph.s03.json", nodes: [node("twice"), node("twice")], edges: [] },
    ] }))).toThrow(/twice appears twice in graph\.s03\.json/);
  });

  it("merges floors carried inside a graph part", () => {
    const result = mergeStation(publicFiles(), additions({ sources: [source()], graphParts: [
      { file: "graph.s03.json", floors: [floor()], nodes: [{ ...node("s03-node"), floorId: "d-test" }], edges: [] },
    ] }));
    expect(result.manifest.floors.map((f) => f.id).slice(-1)).toEqual(["d-test"]);
    expect(() => mergeStation(publicFiles(), additions({ sources: [source()], floors: [floor()], graphParts: [
      { file: "graph.s03.json", floors: [floor()], nodes: [], edges: [] },
    ] }))).toThrow(/d-test appears in both floors\.json and graph\.s03\.json/);
  });

  it("requires private tier notes on every added source", () => {
    expect(() => mergeStation(publicFiles(), additions({ sources: [{ ...source(), notes: "not tiered" }] }))).toThrow(/private-source.*\[tier P\]/);
  });

  it("merges graph-part floors by id and rejects duplicates across addition files", () => {
    const pub = publicFiles();
    const replacement = { ...pub.manifest.floors[0], renderElevationM: 9, elevationM: 9 };
    const result = mergeStation(pub, additions({ sources: [source()], graphParts: [
      { file: "graph.s03.json", nodes: [], edges: [], floors: [replacement, floor()] },
    ] }));
    expect(result.manifest.floors.map(f => f.id)).toEqual([...pub.manifest.floors.map(f => f.id), floor().id]);
    expect(result.manifest.floors[0].renderElevationM).toBe(9);
    expect(() => mergeStation(pub, additions({ sources: [source()], floors: [floor()], graphParts: [
      { file: "graph.s03.json", nodes: [], edges: [], floors: [floor()] },
    ] }))).toThrow(/floors\.json.*graph\.s03\.json/);
  });

  it("validates generated private additions and routes across a seam into their new floor", () => {
    const pub = publicFiles();
    pub.manifest.sources.push(source("tokyo-s03-zip"));
    const runId = `nav-graph-${"a".repeat(20)}`;
    const held: HeldGraphDocument = { policy_version: "synthetic", digest: "a".repeat(20), run_id: runId,
      source_id: "tokyo-s03-zip", nodes: [
        { source_id: 1, level_id: 10, level_label: "B1F", level_z: -6, lon: 0, lat: 0, east_m: -1, north_m: 0, gate: null },
        { source_id: 2, level_id: 10, level_label: "B1F", level_z: -6, lon: 0, lat: 0, east_m: -1000, north_m: 0, gate: null },
        { source_id: 3, level_id: 20, level_label: "2F", level_z: 8, lon: 0, lat: 0, east_m: -2000, north_m: 0, gate: null },
      ], edges: [
        { link_id: 11, from_node: 1, to_node: 2, direction: 3, dz_m: null, length_m: 999, level_relation: "same_level", reason_codes: ["HELD_TEST"] },
        { link_id: 12, from_node: 3, to_node: 2, direction: 2, dz_m: null, length_m: 1000, level_relation: "cross_level", device: "elevator", reason_codes: [] },
        { link_id: 13, from_node: 1, to_node: 3, direction: 1, dz_m: null, length_m: 1999, level_relation: "cross_level", reason_codes: [] },
      ] };
    const part = buildPrivateSeam(held, pub, { runId, today: "2026-10-27" });
    const merged = mergeStation(pub, additions({ graphParts: [{ file: "graph.s03.json", ...part }] }));
    const parsed = parseStationFiles(merged.manifest, merged.graph, merged.pois, undefined, { privateTier: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const route = createRouter(parsed.bundle, { allowUnverified: true }).route("b1-c", "p:sjk:s03:n:3");
    expect(route.ok).toBe(true);
    if (!route.ok) throw new Error(JSON.stringify(route));
    expect(route.steps.some(step => step.edgeId.startsWith("p:sjk:s03:e:seam:"))).toBe(true);
    expect(route.steps.at(-1)?.toFloorId).toBe("p:sjk:s03:f:20");
  });

  it("writes overlay files and rejects an additions station without public data", () => {
    const root = tempDir();
    const privateDir = path.join(root, "private");
    const stationDir = path.join(root, "stations", "demo", "gteki");
    fs.mkdirSync(stationDir, { recursive: true });
    fs.mkdirSync(path.join(privateDir, "additions", "demo"), { recursive: true });
    const [manifest, graph, pois] = createDemoFiles();
    for (const [name, value] of [["station.json", manifest], ["graph.json", graph], ["pois.json", pois]] as const)
      fs.writeFileSync(path.join(stationDir, name), `${JSON.stringify(value)}\n`);
    fs.writeFileSync(path.join(privateDir, "additions", "demo", "graph.s03.json"), JSON.stringify({
      nodes: [], edges: [], floors: [{ ...manifest.floors[0], id: "private-file-floor" }],
    }));
    expect(buildOverlay({ repoRoot: root, privateDir })).toEqual(["demo"]);
    const overlayManifest = JSON.parse(fs.readFileSync(path.join(privateDir, "overlay", "demo", "gteki", "station.json"), "utf8"));
    expect(overlayManifest.floors.at(-1).id).toBe("private-file-floor");
    for (const file of ["station.json", "graph.json", "pois.json"])
      expect(fs.existsSync(path.join(privateDir, "overlay", "demo", "gteki", file))).toBe(true);
    // Removing a station's additions drops its overlay on the next full run.
    fs.mkdirSync(path.join(privateDir, "overlay", "gone", "gteki"), { recursive: true });
    buildOverlay({ repoRoot: root, privateDir });
    expect(fs.existsSync(path.join(privateDir, "overlay", "gone"))).toBe(false);
    fs.writeFileSync(path.join(privateDir, "additions", "demo", "tenants.json"), JSON.stringify({ schema: "gteki.tenants/9.9", tenants: [] }));
    expect(() => buildOverlay({ repoRoot: root, privateDir })).toThrow(/tenants\.json: schema must be gteki\.tenants\/0\.1/);
    fs.rmSync(path.join(privateDir, "additions", "demo", "tenants.json"));
    fs.mkdirSync(path.join(privateDir, "additions", "missing"));
    expect(() => buildOverlay({ repoRoot: root, privateDir })).toThrow(/additions\/missing.*no public station folder/);
  });
});
