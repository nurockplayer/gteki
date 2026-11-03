import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateReceipt, type FieldReceipt } from "../../../../stations/ikebukuro/pipeline/import_field_receipt.ts";
import { buildReceipt, buildReceipts, mergeRecorderState, newObservation, nowJst, type RecorderState } from "./submission.ts";
import type { FieldStation } from "./data.ts";

for (const id of ["ikebukuro", "shinjuku"]) {
  describe(`${id} receipt export`, () => {
    const graph = JSON.parse(readFileSync(`stations/${id}/gteki/graph.json`, "utf8"));
    const pois = JSON.parse(readFileSync(`stations/${id}/gteki/pois.json`, "utf8")).pois.filter((p: { category: string }) => p.category === "shop");
    const station: FieldStation = { id, title: id, fieldRun: `docs/research/field/${id}-route.md`, stops: [],
      nodeIds: graph.nodes.map((n: { id: string }) => n.id), edgeIds: graph.edges.map((e: { id: string }) => e.id), pois: pois.map((p: { id: string }) => ({ id: p.id, label: p.id })) };
    const observation = () => ({ ...newObservation(id === "ikebukuro" ? "IK-01" : "SJ-02"),
      target: station.nodeIds[0]!, itemId: id === "ikebukuro" ? "1" : "39", poiId: station.pois[0]!.id,
      paid: "false", confirmation: "CLOSED" as const, observedText: "Public door plate", side: "left" as const, offsetM: "2.5", note: "Facing passage", floorLabel: "B1F" });
    it("exports the v1 team receipt and extras accepted by the shared importer", () => {
      for (const stepFree of ["", "level", "steps:12", "lift", "escalator"]) {
        const receipt = JSON.parse(JSON.stringify(buildReceipt(station, [{ ...observation(), stepFree }])));
        expect(receipt).toMatchObject({ version: 1, station: id, fieldRun: station.fieldRun, sourceKind: "team_field", observer: "owner" });
        expect(receipt.items[0]).toMatchObject({ item: Number(observation().itemId), status: "CLOSED", nodeId: station.nodeIds[0], paid: false, side: "left", offsetM: 2.5, stepFree: stepFree || null });
        expect(receipt.items[0].observedAt).toMatch(/\+09:00$/);
        expect(() => validateReceipt(receipt as FieldReceipt, id, (value) => station.pois.some((p) => p.id === value), (value) => station.nodeIds.includes(String(value)))).not.toThrow();
      }
    });
    it("retains edge/unknown confirmations as OPEN, and unnumbered notes outside importer items", () => {
      const receipt = buildReceipt(station, [{ ...observation(), target: station.edgeIds[0]! }, { ...observation(), target: "unmapped door" }, { ...observation(), itemId: "FC-NOTE" }, { ...observation(), itemId: "" }]);
      expect(receipt.items).toHaveLength(2);
      expect(receipt.items[0]).toMatchObject({ status: "OPEN", edgeId: station.edgeIds[0], confirmation: "CLOSED", targetUnknown: false });
      expect(receipt.items[1]).toMatchObject({ status: "OPEN", targetUnknown: true });
      expect(receipt.fieldNotes).toHaveLength(2);
      expect(() => validateReceipt(receipt as unknown as FieldReceipt, id, () => true, () => true)).not.toThrow();
      expect(() => buildReceipt(station, [{ ...observation(), itemId: "" }])).toThrow("numbered item");
    });
    it("keeps an unnumbered CLOSED confirmation with known node, POI and paid as an OPEN field note", () => {
      const receipt = buildReceipt(station, [observation(), { ...observation(), itemId: "" }]);
      expect(receipt.items).toHaveLength(1);
      expect(receipt.items[0]).toMatchObject({ status: "CLOSED" });
      expect(receipt.fieldNotes).toHaveLength(1);
      expect(receipt.fieldNotes[0]).toMatchObject({ status: "OPEN", confirmation: "CLOSED", nodeId: station.nodeIds[0], poiId: station.pois[0]!.id, paid: false });
    });
    it("rejects invalid JST, status and stepFree at export", () => {
      for (const patch of [{ observedAt: "2026-11-03T01:00:00Z" }, { confirmation: "PARTIAL" }, { stepFree: "ramp" }]) {
        expect(() => buildReceipt(station, [{ ...observation(), ...patch } as ReturnType<typeof observation>])).toThrow();
      }
    });
  });
}
it("fills in the JST date across midnight", () => {
  expect(nowJst(new Date("2026-11-02T16:01:02Z"))).toBe("2026-11-03T01:01:02+09:00");
});

it("keeps records from two stale tabs, applies the last edited ID, and retains deletions", () => {
  const first = { ...newObservation("IK-01"), observedText: "First tab" };
  const second = { ...newObservation("IK-01"), observedText: "Second tab" };
  const empty: RecorderState = { station: "ikebukuro", positions: {}, records: {} };
  const tabA = { ...empty, records: { ikebukuro: [first] } };
  const tabB = { ...empty, records: { ikebukuro: [second] } };
  const savedA = mergeRecorderState(empty, tabA, new Set([first.id]));
  const savedB = mergeRecorderState(savedA, tabB, new Set([second.id]));
  expect(savedB.records.ikebukuro).toEqual([first, second]);
  const edited = { ...first, observedText: "Updated in A" };
  const savedEdit = mergeRecorderState(savedB, { ...tabA, records: { ikebukuro: [edited] } }, new Set([first.id]));
  const staleNavigation = mergeRecorderState(savedEdit, savedB, new Set());
  expect(staleNavigation.records.ikebukuro).toEqual([edited, second]);
  const removed = mergeRecorderState(staleNavigation, { ...tabA, records: { ikebukuro: [] }, deletedIds: [first.id] }, new Set());
  expect(mergeRecorderState(removed, tabA, new Set([first.id])).records.ikebukuro).toEqual([second]);
});

it("rejects nonexistent JST dates and accepts a valid minute-precision timestamp", () => {
  const station: FieldStation = { id: "ikebukuro", title: "Ikebukuro", fieldRun: "docs/research/field/ikebukuro-route.md",
    stops: [], nodeIds: [], edgeIds: [], pois: [] };
  const record = { ...newObservation("IK-01"), itemId: "1", observedText: "Public plate" };
  for (const observedAt of ["2026-02-30T12:00+09:00", "2026-13-01T12:00+09:00"]) {
    expect(() => buildReceipt(station, [{ ...record, observedAt }])).toThrow("observedAt needs a valid JST time with +09:00.");
  }
  const observedAt = "2026-11-03T08:50+09:00";
  expect(buildReceipt(station, [{ ...record, observedAt }]).items[0]!.observedAt).toBe(observedAt);
});

it("splits private stops into a separate receipt, including GAP notes and persisted private records", () => {
  const station: FieldStation = { id: "shinjuku", title: "Synthetic", fieldRun: "synthetic.md",
    stops: [{ id: "SJ-01", title: "Public", items: [], ids: [], instructions: "" },
      { id: "P-SJ-01", title: "Synthetic private", items: [], ids: [], instructions: "", private: true }],
    privateCatalog: { targetIds: ["overlay-node", "overlay-edge"], poiIds: ["overlay-shop"] },
    nodeIds: ["public-node", "overlay-node"], edgeIds: ["overlay-edge"], pois: [{ id: "overlay-shop", label: "Synthetic" }] };
  const publicRecord = { ...newObservation("SJ-01"), itemId: "1", observedText: "Public synthetic text" };
  const privateRecord = { ...newObservation("P-SJ-01", true), itemId: "2", target: "overlay-node", poiId: "overlay-shop",
    paid: "false", confirmation: "CLOSED" as const, observedText: "Private synthetic text" };
  const gap = { ...privateRecord, itemId: "GAP-01", target: "overlay-edge" };
  const receipts = buildReceipts(station, [publicRecord, privateRecord, gap]);
  expect(receipts).toHaveLength(2);
  expect(receipts[0]).toEqual(buildReceipt(station, [publicRecord]));
  expect(JSON.stringify(receipts[0])).not.toContain("Private synthetic");
  expect(receipts[0]).not.toHaveProperty("private");
  expect(receipts[1]).toMatchObject({ private: true, items: [{ stopId: "P-SJ-01", status: "CLOSED", nodeId: "overlay-node" }],
    fieldNotes: [{ itemId: "GAP-01", edgeId: "overlay-edge", targetUnknown: false }] });
  const publicBuild = { ...station, privateCatalog: undefined, stops: station.stops.filter((stop) => !stop.private) };
  expect(buildReceipts(publicBuild, [publicRecord, privateRecord])[0]).toEqual(receipts[0]);
  expect(buildReceipts(station, [publicRecord])).toEqual([receipts[0]]);
  const privateOnly = buildReceipts(station, [gap]);
  expect(privateOnly).toHaveLength(1);
  expect(privateOnly[0]).toMatchObject({ private: true, items: [] });
  expect(privateOnly[0]!.fieldNotes).toHaveLength(1);
  expect(() => validateReceipt(privateOnly[0] as unknown as FieldReceipt, "shinjuku", () => true, () => true)).not.toThrow();
});

it("exports an overlay-only store selected at a public SJ-02 stop only in the private receipt", () => {
  const station: FieldStation = { id: "shinjuku", title: "Synthetic", fieldRun: "synthetic.md",
    stops: [{ id: "SJ-02", title: "Public stop", items: ["39"], ids: ["public-node"], instructions: "" }],
    nodeIds: ["public-node"], edgeIds: [], pois: [{ id: "overlay-shop", label: "Synthetic overlay store" }],
    privateCatalog: { targetIds: [], poiIds: ["overlay-shop"] } };
  const record = { ...newObservation("SJ-02"), itemId: "39", target: "public-node", poiId: "overlay-shop",
    paid: "false", confirmation: "CLOSED" as const, observedText: "Synthetic overlay store" };
  const receipts = buildReceipts(station, [record]);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ private: true, items: [{ poiId: "overlay-shop", nodeId: "public-node", status: "CLOSED" }] });
});

it("keeps saved private records untouched and omits their file when no overlay is loaded", () => {
  const station: FieldStation = { id: "shinjuku", title: "Synthetic public build", fieldRun: "synthetic.md",
    stops: [], nodeIds: [], edgeIds: [], pois: [] };
  const records = [{ ...newObservation("P-SJ-01", true), itemId: "39", target: "overlay-node", poiId: "overlay-shop",
    paid: "false", confirmation: "CLOSED" as const, observedText: "Synthetic saved private record" }];
  const before = structuredClone(records);
  const receipts = buildReceipts(station, records);
  expect(receipts).toEqual([]);
  expect(records).toEqual(before);
  expect(() => buildReceipt(station, records, true)).toThrow("非公開の記録は非公開ビルドで書き出してください / Export private records from the private build");
});

it("produces only the private download for a private-only run", () => {
  const station: FieldStation = { id: "shinjuku", title: "Synthetic", fieldRun: "synthetic.md", stops: [],
    nodeIds: ["overlay-node"], edgeIds: [], pois: [{ id: "overlay-shop", label: "Synthetic" }],
    privateCatalog: { targetIds: ["overlay-node"], poiIds: ["overlay-shop"] } };
  const record = { ...newObservation("P-SJ-01", true), itemId: "39", target: "overlay-node", poiId: "overlay-shop",
    paid: "false", confirmation: "CLOSED" as const, observedText: "Synthetic private-only run" };
  const receipts = buildReceipts(station, [record]);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ private: true, items: [{ status: "CLOSED", nodeId: "overlay-node", poiId: "overlay-shop" }], fieldNotes: [] });
  expect(() => validateReceipt(receipts[0] as unknown as FieldReceipt, "shinjuku", () => true, () => true)).not.toThrow();
});
