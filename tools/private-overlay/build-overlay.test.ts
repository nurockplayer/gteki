import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Edge, Floor, Node, Poi, Source } from "../../packages/schema/src/index.ts";
import { parseStationFiles } from "../../packages/schema/src/index.ts";
import { createDemoFiles } from "../../apps/web/src/demo.ts";
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

  it("rejects duplicate graph ids across addition files and identifies both files", () => {
    expect(() => mergeStation(publicFiles(), additions({ graphParts: [
      { file: "graph.json", nodes: [node("duplicate")], edges: [] },
      { file: "graph.s03.json", nodes: [node("duplicate")], edges: [] },
    ] }))).toThrow(/graph\.json.*graph\.s03\.json/);
  });

  it("requires private tier notes on every added source", () => {
    expect(() => mergeStation(publicFiles(), additions({ sources: [{ ...source(), notes: "not tiered" }] }))).toThrow(/private-source.*\[tier P\]/);
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
    expect(buildOverlay({ repoRoot: root, privateDir })).toEqual(["demo"]);
    for (const file of ["station.json", "graph.json", "pois.json"])
      expect(fs.existsSync(path.join(privateDir, "overlay", "demo", "gteki", file))).toBe(true);
    fs.mkdirSync(path.join(privateDir, "additions", "missing"));
    expect(() => buildOverlay({ repoRoot: root, privateDir })).toThrow(/additions\/missing.*no public station folder/);
  });
});
