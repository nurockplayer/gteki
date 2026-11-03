import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fieldPrivate, readFieldPrivate } from "../../field-private.ts";
import { mergePrivateStops, type Stop } from "./route.ts";

const stop = (id: string): Stop => ({ id, title: "Synthetic stop", items: ["GAP-01"], ids: ["synthetic-node"], instructions: "Synthetic only" });
it("inserts private stops after their public stop, preserving file order", () => {
  const publicStops = [stop("SJ-01"), stop("SJ-02")];
  const merged = mergePrivateStops(publicStops, [
    { ...stop("SJ-02P"), after: "SJ-02" },
    { ...stop("P-SJ-01"), after: "SJ-01" },
    { ...stop("P-SJ-02"), after: "SJ-01" },
  ]);
  expect(merged.map((entry) => entry.id)).toEqual(["SJ-01", "P-SJ-01", "P-SJ-02", "SJ-02", "SJ-02P"]);
  expect(merged.filter((entry) => entry.private).map((entry) => entry.id)).toEqual(["P-SJ-01", "P-SJ-02", "SJ-02P"]);
  expect(mergePrivateStops(publicStops, [])).toEqual(publicStops);
  expect(publicStops.every((entry) => !entry.private)).toBe(true);
});

it("serves an empty public module and reads only synthetic overlay stops and choices", () => {
  expect(readFieldPrivate(null)).toEqual({});
  const plugin = fieldPrivate(null);
  const load = plugin.load as (id: string) => string;
  expect(load("\0virtual:gteki-field-private")).toBe("export default {};");
  const overlay = mkdtempSync(join(tmpdir(), "field-private-"));
  try {
    const dir = join(overlay, "shinjuku");
    mkdirSync(join(dir, "field"), { recursive: true });
    mkdirSync(join(dir, "gteki"));
    const stops = [{ ...stop("P-SJ-01"), after: "SJ-01" }];
    writeFileSync(join(dir, "gteki/graph.json"), JSON.stringify({ nodes: [{ id: "synthetic-node" }], edges: [{ id: "synthetic-edge" }] }));
    writeFileSync(join(dir, "gteki/pois.json"), JSON.stringify({ pois: [
      { id: "synthetic-shop", category: "shop", names: [{ text: "Synthetic shop" }] },
      { id: "synthetic-gate", category: "gate", names: [] },
    ] }));
    expect(readFieldPrivate(overlay).shinjuku?.stops).toEqual([]);
    writeFileSync(join(dir, "field/private-stops.json"), JSON.stringify(stops));
    expect(readFieldPrivate(overlay)).toEqual({ shinjuku: { stops, nodeIds: ["synthetic-node"], edgeIds: ["synthetic-edge"], pois: [{ id: "synthetic-shop", label: "Synthetic shop" }] } });
  } finally { rmSync(overlay, { recursive: true, force: true }); }
});
