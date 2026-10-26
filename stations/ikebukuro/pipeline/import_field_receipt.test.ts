import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyFieldReceipt } from "./import_field_receipt.ts";

const stationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = JSON.parse(fs.readFileSync(path.join(stationDir, "data", "graph.src.json"), "utf8"));
const pois = JSON.parse(fs.readFileSync(path.join(stationDir, "gteki", "pois.json"), "utf8"));
const station = JSON.parse(fs.readFileSync(path.join(stationDir, "gteki", "station.json"), "utf8"));
const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "field-receipt.example.json"), "utf8"));

describe("applyFieldReceipt", () => {
  it("applies CLOSED observations to both POI catalogs and records the field source", () => {
    const result = applyFieldReceipt(src, pois, station, receipt);
    const srcPoi = result.src.pois.find((poi: any) => poi.id === "shop-ikb-esola");
    const poi = result.pois.pois.find((entry: any) => entry.id === "shop-ikb-esola");
    const sourceId = "field-ikebukuro-2026-10-27";
    const method = "field observation (#533 item 25): 「EXAMPLE — not an observation」 read on site 2026-10-27T10:12+09:00; connector = x4f; floor B1F; step-free: level";
    const ja = "入口は現地で確認（#533 項目25、2026-10-27T10:12+09:00）：「EXAMPLE — not an observation」。";
    const en = "Entrance checked on site (#533 item 25, 2026-10-27T10:12+09:00): 「EXAMPLE — not an observation」.";

    expect(srcPoi.connectorNodeIds).toEqual(["x4f"]);
    expect(srcPoi.paid).toBe(false);
    expect(srcPoi.evidence.sourceIds).toContain(sourceId);
    expect(srcPoi.evidence.method).toBe(method);
    expect(srcPoi.notes.find((note: any) => note.lang === "ja").text).toContain(ja);
    expect(srcPoi.notes.find((note: any) => note.lang === "en").text).toContain(en);
    expect(poi).toEqual(srcPoi);
    expect(result.src.sources.find((source: any) => source.id === sourceId)).toBeDefined();
    expect(result.station.sources.find((source: any) => source.id === sourceId)).toBeDefined();
  });

  it("skips OPEN items without changing their POI and is idempotent", () => {
    const result = applyFieldReceipt(src, pois, station, receipt);
    expect(result.applied).toEqual([25]);
    expect(result.skipped).toEqual([{ item: 27, reason: "OPEN" }]);
    expect(result.pois.pois.find((poi: any) => poi.id === "shop-ikb-parco")).toEqual(pois.pois.find((poi: any) => poi.id === "shop-ikb-parco"));
    expect(applyFieldReceipt(result.src, result.pois, result.station, receipt)).toEqual(result);
  });

  it("rejects invalid timestamps and unknown connector nodes", () => {
    for (const observedAt of ["2026-10-27T10:12", "2026-10-27T10:12Z"]) {
      const bad = structuredClone(receipt);
      bad.items[0].observedAt = observedAt;
      expect(() => applyFieldReceipt(src, pois, station, bad)).toThrow(/item 25.*observedAt/);
    }
    const badNode = structuredClone(receipt);
    badNode.items[0].nodeId = "unknown-node";
    expect(() => applyFieldReceipt(src, pois, station, badNode)).toThrow(/item 25.*unknown node/);
  });

  it("does not mutate any input", () => {
    const before = structuredClone({ src, pois, station, receipt });
    applyFieldReceipt(src, pois, station, receipt);
    expect({ src, pois, station, receipt }).toEqual(before);
  });
});
