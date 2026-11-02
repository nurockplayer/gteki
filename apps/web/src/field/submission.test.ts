import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateReceipt, type FieldReceipt } from "../../../../stations/ikebukuro/pipeline/import_field_receipt.ts";
import { buildReceipt, newObservation, nowJst } from "./submission.ts";
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
