import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStationFiles, validateBundle } from "@gteki/schema";
import { applyFieldReceipts, loadReceipts } from "../tools/field-receipts.ts";
import type { FieldReceipt } from "../../ikebukuro/pipeline/import_field_receipt.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): any => JSON.parse(fs.readFileSync(path.join(HERE, "../gteki", name), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/field-receipt.example.json"), "utf8")) as FieldReceipt;
const nodeId = "n:27509b411f0d494dbb99dff291a1cc3f";

describe("Shinjuku field receipts (#533)", () => {
  it("applies CLOSED observations and validates the resulting bundle", () => {
    const station = structuredClone(read("station.json"));
    const graph = structuredClone(read("graph.json"));
    const poisFile = structuredClone(read("pois.json"));
    const tenants = structuredClone(read("tenants.json"));
    const pois = structuredClone(poisFile.pois);
    const sources = structuredClone(station.sources);
    const beforeOpen = structuredClone(pois.find((poi: any) => poi.id === "shop-sjk-lumine2"));

    expect(applyFieldReceipts(pois, sources, new Set(graph.nodes.map((node: any) => node.id)), [structuredClone(fixture)])).toEqual([31]);
    expect(pois.find((poi: any) => poi.id === "shop-sjk-lumine1")).toMatchObject({
      connectorNodeIds: [nodeId],
      paid: false,
      evidence: { sourceIds: expect.arrayContaining(["field-shinjuku-2026-10-27"]) },
    });
    expect(sources.some((source: any) => source.id === "field-shinjuku-2026-10-27")).toBe(true);
    expect(pois.find((poi: any) => poi.id === "shop-sjk-lumine2")).toEqual(beforeOpen);

    const parsed = parseStationFiles({ ...station, sources }, graph, { ...poisFile, pois }, tenants);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.bundle) throw new Error("Shinjuku bundle failed to parse after field receipt application");
    expect(validateBundle(parsed.bundle).filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("rejects another station and an unknown node", () => {
    const graph = read("graph.json");
    const pois = read("pois.json").pois;
    const wrongStation = structuredClone(fixture);
    wrongStation.station = "ikebukuro";
    expect(() => applyFieldReceipts(structuredClone(pois), [], new Set(graph.nodes.map((node: any) => node.id)), [wrongStation]))
      .toThrow(/station must be "shinjuku"/);

    const unknownNode = structuredClone(fixture);
    unknownNode.items[0]!.nodeId = "unknown-node";
    expect(() => applyFieldReceipts(structuredClone(pois), [], new Set(graph.nodes.map((node: any) => node.id)), [unknownNode]))
      .toThrow(/item 31.*unknown node/);
  });

  it("returns no receipts for a missing directory", () => {
    expect(loadReceipts(path.join(HERE, "__missing-field-receipts__"), "shinjuku")).toEqual([]);
  });
});
