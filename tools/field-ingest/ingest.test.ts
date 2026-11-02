// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";
import { merchantPrecision } from "../../apps/web/src/ui/merchantCard.ts";
import { loadReceipts } from "../../stations/shinjuku/tools/field-receipts.ts";
import { ingest } from "./ingest.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup(station: string) {
  const root = mkdtempSync(join(tmpdir(), "field-ingest-"));
  roots.push(root);
  const dir = join(root, "stations", station);
  mkdirSync(join(dir, "gteki"), { recursive: true });
  for (const file of ["station", "graph", "pois", "tenants"]) cpSync(join(repo, "stations", station, "gteki", `${file}.json`), join(dir, "gteki", `${file}.json`));
  if (station === "ikebukuro") {
    mkdirSync(join(dir, "data"));
    cpSync(join(repo, "stations/ikebukuro/data/graph.src.json"), join(dir, "data/graph.src.json"));
  }
  const node = read(join(dir, "gteki/graph.json")).nodes.find((n: any) => n.floorId === (station === "ikebukuro" ? "b1" : "toei-nwd-m1"));
  const poiId = station === "ikebukuro" ? "shop-ikb-esola" : "shop-sjk-lumine1";
  const receipt = { version: 1, station, fieldRun: "docs/research/lines/field-run-2026-10-26.md", sourceKind: "team_field", observer: "owner",
    items: [{ item: 25, status: "CLOSED", poiId, nodeId: node.id, paid: false, observedText: "SYNTHETIC — not an observation",
      observedAt: "2026-10-28T10:12+09:00", floorLabel: "地下1階", stepFree: "level", stopId: "shop", confirmation: "confirmed", targetUnknown: false },
    { item: 26, status: "OPEN", observedText: "Not confirmed", observedAt: "2026-10-28T10:13+09:00" }],
    fieldNotes: [{ observedText: "Unnumbered observation; never apply", poiId, nodeId: "not-a-node" }] };
  const file = join(root, "receipt.json");
  const save = () => writeFileSync(file, JSON.stringify(receipt));
  save();
  return { root, dir, node, poiId, receipt, file, save, poi: () => read(join(dir, "gteki/pois.json")).pois.find((p: any) => p.id === poiId) };
}

for (const station of ["ikebukuro", "shinjuku"]) describe(station, () => {
  it("applies CLOSED evidence, leaves OPEN/fieldNotes alone, and makes a verified point", () => {
    const s = setup(station);
    const before = read(join(s.dir, "gteki/pois.json"));
    expect(merchantPrecision(s.poi())).not.toBe("point");
    const preview = ingest(s.file, false, s.root);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toContain("→ point");
    expect(s.poi()).toMatchObject({ displayPosition: s.node.position, connectorNodeIds: [s.node.id], evidence: { checkedDate: "2026-10-28" } });
    expect(s.poi().evidence.method).toContain("displayPosition = public connector node position");
    expect(merchantPrecision(s.poi())).toBe("point");
    expect(read(join(s.dir, "gteki/pois.json")).pois.filter((p: any) => p.id !== s.poiId)).toEqual(before.pois.filter((p: any) => p.id !== s.poiId));
    if (station === "ikebukuro") expect(read(join(s.dir, "data/graph.src.json")).pois.find((p: any) => p.id === s.poiId)).toEqual(s.poi());
    else expect(loadReceipts(join(s.root, "docs/research/field/receipts"), station)).toEqual([s.receipt]);
    const parsed = parseStationFiles(read(join(s.dir, "gteki/station.json")), read(join(s.dir, "gteki/graph.json")), read(join(s.dir, "gteki/pois.json")), read(join(s.dir, "gteki/tenants.json")));
    expect(parsed.ok).toBe(true);
    expect(() => ingest(s.file, false, s.root)).toThrow("duplicate existing connector");
  });

  it("reports all graph, floor, duplicate and timestamp errors without writing", () => {
    const s = setup(station);
    const before = readFileSync(join(s.dir, "gteki/pois.json"), "utf8");
    s.receipt.items = [
      { ...s.receipt.items[0]!, poiId: "missing-poi", nodeId: "missing-node", edgeId: "missing-edge", observedAt: "2026-10-28T10:12Z" },
      { ...s.receipt.items[0]!, item: 27, floorLabel: "B9F", observedAt: "2099-01-01T00:00+09:00" },
      { ...s.receipt.items[0]!, item: 28 },
      { ...s.receipt.items[0]!, item: 29, observedAt: "2026-02-31T10:12+09:00" },
    ] as typeof s.receipt.items;
    s.save();
    let message = "";
    try { ingest(s.file, true, s.root); } catch (error) { message = (error as Error).message; }
    for (const issue of ["unknown POI missing-poi", "unknown node missing-node", "unknown edge missing-edge", "floor mismatch", "duplicate poiId+nodeId", "valid +09:00 timestamp", "future (JST)", "item 29: observedAt"]) expect(message).toContain(issue);
    expect(readFileSync(join(s.dir, "gteki/pois.json"), "utf8")).toBe(before);
    expect(existsSync(join(s.root, "docs"))).toBe(false);
  });

  it("runs the CLI dry run without changing any station file or archiving a receipt", () => {
    const s = setup(station);
    const files = ["gteki/pois.json", "gteki/station.json", "gteki/graph.json", ...(station === "ikebukuro" ? ["data/graph.src.json"] : [])];
    const before = files.map((f) => readFileSync(join(s.dir, f), "utf8"));
    const output = execFileSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "tools/field-ingest/ingest.ts"), s.file, "--dry-run"], { cwd: s.root, encoding: "utf8" });
    expect(output).toContain(`${s.poiId} node=${s.node.id} checkedDate`);
    expect(output).toContain("→ 2026-10-28; precision");
    expect(output).toContain("→ point");
    expect(output).toContain("dry run: no files written");
    expect(files.map((f) => readFileSync(join(s.dir, f), "utf8"))).toEqual(before);
    expect(existsSync(join(s.root, "docs"))).toBe(false);
  }, 15_000);

  it("keeps an existing display position and ignores OPEN-only receipts", () => {
    const s = setup(station);
    const poisPath = join(s.dir, "gteki/pois.json");
    const catalog = read(poisPath);
    const position = { x: 1, y: 2, z: null };
    catalog.pois.find((p: any) => p.id === s.poiId).displayPosition = position;
    writeFileSync(poisPath, JSON.stringify(catalog));
    ingest(s.file, false, s.root);
    expect(s.poi().displayPosition).toEqual(position);
    s.receipt.items = s.receipt.items.filter((item) => item.status === "OPEN");
    s.save();
    const before = readFileSync(poisPath, "utf8");
    expect(ingest(s.file, false, s.root)).toEqual([]);
    expect(readFileSync(poisPath, "utf8")).toBe(before);
  });

  it("preserves daily provenance instead of relabelling earlier observations", () => {
    const s = setup(station);
    ingest(s.file, false, s.root);
    const before = readFileSync(join(s.dir, "gteki/station.json"), "utf8");
    s.receipt.fieldRun = "docs/research/lines/different-field-run.md";
    s.receipt.items[0]!.observedAt = "2026-10-28T11:00+09:00";
    s.save();
    expect(() => ingest(s.file, false, s.root)).toThrow("different fieldRun/observer provenance");
    expect(readFileSync(join(s.dir, "gteki/station.json"), "utf8")).toBe(before);
    if (station === "shinjuku") expect(loadReceipts(join(s.root, "docs/research/field/receipts"), station)[0]!.fieldRun).not.toBe(s.receipt.fieldRun);
  });

  it("keeps newer evidence while accepting a backdated reading of another connector at the same time", () => {
    const s = setup(station);
    ingest(s.file, false, s.root);
    const other = read(join(s.dir, "gteki/graph.json")).nodes.find((n: any) => n.floorId === s.node.floorId && n.id !== s.node.id);
    s.receipt.items[0]!.nodeId = other.id;
    s.receipt.items[0]!.observedAt = "2026-10-29T11:00+09:00";
    s.receipt.items[0]!.paid = true;
    s.save();
    ingest(s.file, false, s.root);
    const latestMethod = s.poi().evidence.method;
    s.receipt.items[0]!.observedAt = "2026-10-28T10:12+09:00";
    s.receipt.items[0]!.paid = false;
    s.save();
    expect(ingest(s.file, false, s.root)[0]).toContain("checkedDate 2026-10-29 → 2026-10-29");
    expect(s.poi()).toMatchObject({ paid: true, connectorNodeIds: [s.node.id, other.id], displayPosition: s.node.position,
      evidence: { checkedDate: "2026-10-29" } });
    expect(s.poi().evidence.method).toContain(latestMethod);
    expect(() => ingest(s.file, false, s.root)).toThrow("duplicate existing connector");
  });

  // #747 is a separate, still-open PR. Exercise its actual row function once available.
  it.skipIf(!existsSync(join(repo, "tools/data-age/report.ts")))("shows the field entrance date in the data-age row (#747)", async () => {
    const s = setup(station);
    ingest(s.file, false, s.root);
    const parsed = parseStationFiles(read(join(s.dir, "gteki/station.json")), read(join(s.dir, "gteki/graph.json")), read(join(s.dir, "gteki/pois.json")), read(join(s.dir, "gteki/tenants.json")));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const { ageRows } = await import(pathToFileURL(join(repo, "tools/data-age/report.ts")).href);
    expect(ageRows([parsed.bundle]).find((row: any) => row.poiId === s.poiId).entranceDate).toBe("2026-10-28");
  });
});

it("runs a real Ikebukuro CLI ingest on copied bundles", () => {
  const s = setup("ikebukuro");
  const output = execFileSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "tools/field-ingest/ingest.ts"), s.file], { cwd: s.root, encoding: "utf8" });
  expect(output).toContain("applied 1 CLOSED items");
  expect(s.poi().evidence.checkedDate).toBe("2026-10-28");
  expect(merchantPrecision(s.poi())).toBe("point");
});
