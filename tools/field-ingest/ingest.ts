// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { merchantPrecision } from "../../apps/web/src/ui/merchantCard.ts";
import { applyFieldReceipt, fieldSource, updatePoi, validateReceipt, type FieldReceipt } from "../../stations/ikebukuro/pipeline/import_field_receipt.ts";
import { applyFieldReceipts, loadReceipts } from "../../stations/shinjuku/tools/field-receipts.ts";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const text = (value: unknown, indent?: number) => JSON.stringify(value, null, indent) + "\n";
const normalFloor = (label: string) => label.normalize("NFKC").trim().toUpperCase()
  .replace(/^地下(\d+)階$/, "B$1").replace(/^(B\d+)F$/, "$1").replace(/^(\d+)階$/, "$1F");

function withSnapshot(files: string[], apply: () => void) {
  const before = files.map((file) => ({ file, bytes: existsSync(file) ? readFileSync(file) : null }));
  const missingDirs = new Set<string>();
  for (const file of files) {
    for (let dir = dirname(file); !existsSync(dir); dir = dirname(dir)) missingDirs.add(dir);
  }
  try { apply(); }
  catch (error) {
    for (const { file, bytes } of before) {
      if (bytes === null) rmSync(file, { force: true });
      else writeFileSync(file, bytes);
    }
    for (const dir of [...missingDirs].sort((a, b) => b.length - a.length)) {
      if (existsSync(dir)) rmdirSync(dir);
    }
    throw error;
  }
}

/** Apply to a public bundle root; an optional station rebuild shares the same rollback snapshot. */
export function ingest(receiptPath: string, dryRun = false, root = process.cwd(), rebuild?: () => void) {
  const receipt = read(receiptPath) as FieldReceipt;
  if (!["ikebukuro", "shinjuku"].includes(receipt?.station)) throw new Error("station must be ikebukuro or shinjuku");
  const stationDir = join(root, "stations", receipt.station);
  const poisPath = join(stationDir, "gteki/pois.json");
  const stationPath = join(stationDir, "gteki/station.json");
  const graph = read(join(stationDir, "gteki/graph.json"));
  const pois = read(poisPath);
  const station = read(stationPath);
  const srcPath = join(stationDir, "data/graph.src.json");
  const src = receipt.station === "ikebukuro" ? read(srcPath) : null;
  const issues: string[] = [];
  try {
    validateReceipt(receipt, receipt.station,
      (id) => pois.pois.some((poi: any) => poi.id === id) && (!src || src.pois.some((poi: any) => poi.id === id)),
      (id) => graph.nodes.some((node: any) => node.id === id) && (!src || src.nodes.some((node: any) => node.id === id)));
  } catch (error) { issues.push(...(error as Error).message.split("\n")); }
  const archived = loadReceipts(join(root, "docs/research/field/receipts"), receipt.station);
  const seen = new Set<string>();
  for (const item of Array.isArray(receipt.items) ? receipt.items : []) {
    if (!item) continue;
    const fail = (message: string) => { issues.push(`item ${item.item}: ${message}`); };
    const poi = pois.pois.find((p: any) => p.id === item.poiId);
    const node = graph.nodes.find((n: any) => n.id === item.nodeId);
    if (item.status === "OPEN") {
      if (item.poiId && !poi) fail(`unknown POI ${item.poiId}`);
      if (item.nodeId && !node) fail(`unknown node ${item.nodeId}`);
    }
    if (item.edgeId && !graph.edges.some((edge: any) => edge.id === item.edgeId)) fail(`unknown edge ${item.edgeId}`);
    if (node && item.floorLabel) {
      const floor = station.floors.find((f: any) => f.id === node.floorId);
      const labels = [floor.id, ...(floor.displayNames ?? []).map((n: any) => n.text),
        ...(floor.sourceLabels ?? []).map((s: any) => s.label)];
      if (!floor.intermediate && Number.isInteger(floor.ordinal)) labels.push(floor.ordinal < 0 ? `B${-floor.ordinal}` : `${floor.ordinal}F`);
      if (!labels.some((label: string) => normalFloor(label) === normalFloor(item.floorLabel!))) {
        fail(`floor mismatch: ${item.floorLabel} vs ${node.floorId}`);
      }
    }
    if (Date.parse(item.observedAt) > Date.now()) fail("observedAt is in the future (JST)");
    if (item.poiId && item.nodeId) {
      const key = JSON.stringify([item.poiId, item.nodeId]);
      if (seen.has(key)) fail(`duplicate poiId+nodeId ${item.poiId} + ${item.nodeId}`);
      seen.add(key);
      const pair = `read on site ${item.observedAt}; connector = ${item.nodeId}`;
      const marker = `; field receipt ${JSON.stringify([item.nodeId, item.observedAt])}`;
      if (poi?.connectorNodeIds.includes(item.nodeId) && (poi.evidence.method.includes(`${pair};`) || poi.evidence.method.endsWith(pair)
        || poi.evidence.method.includes(marker)
        || archived.some((old) => old.items.some((entry) => entry.status === "CLOSED" && entry.poiId === item.poiId && entry.nodeId === item.nodeId && entry.observedAt === item.observedAt)))) {
        fail(`duplicate existing connector ${item.nodeId} at ${item.observedAt}`);
      }
    }
  }
  const closed = (Array.isArray(receipt.items) ? receipt.items : []).filter((item) => item?.status === "CLOSED");
  if (!issues.length) {
    const provenance = fieldSource(receipt, receipt.station);
    const previous = provenance && station.sources.find((source: any) => source.id === provenance.sourceId);
    const archive = closed.length && archived.find((old) => old.items.some((item) => item.status === "CLOSED"
      && item.observedAt.slice(0, 10) === closed.map((entry) => entry.observedAt.slice(0, 10)).sort().at(-1)));
    if ((previous && (previous.url !== provenance!.source.url || !previous.notes?.includes(`by the ${receipt.observer} (`)))
      || (archive && (archive.fieldRun !== receipt.fieldRun || archive.observer !== receipt.observer))) {
      issues.push("daily field source already has different fieldRun/observer provenance; use the original envelope metadata");
    }
  }
  const preview = closed.map((item) => {
    const poi = pois.pois.find((p: any) => p.id === item.poiId);
    const node = graph.nodes.find((n: any) => n.id === item.nodeId);
    const after = poi && node && typeof item.observedAt === "string" ? updatePoi(poi, item, "preview", node.position) : null;
    return `${item.poiId} node=${item.nodeId} checkedDate ${poi?.evidence.checkedDate ?? "unknown"} → ${after?.evidence.checkedDate ?? String(item.observedAt).slice(0, 10)}; precision ${poi ? merchantPrecision(poi) : "unknown"} → ${after ? merchantPrecision(after) : "unknown"}`;
  });
  // Print the complete preview even if validation will fail. Validation always precedes writes.
  for (const line of preview) console.log(line);
  if (issues.length) throw new Error(issues.join("\n"));
  if (dryRun || !closed.length) return preview;
  const date = closed.map((item) => item.observedAt.slice(0, 10)).sort().at(-1)!;
  const archive = join(root, "docs/research/field/receipts", `${date}-${receipt.station}.json`);
  // Keep the original envelope, OPEN items and fieldNotes alongside earlier same-day observations.
  const previous = existsSync(archive) ? read(archive) : null;
  const saved = previous ? { ...receipt, items: [...previous.items, ...receipt.items],
    fieldNotes: [...(previous.fieldNotes ?? []), ...(receipt.fieldNotes ?? [])] } : receipt;
  const files = [archive, poisPath, stationPath, ...(receipt.station === "ikebukuro" ? [srcPath] : [
    join(stationDir, "gteki/graph.json"), join(stationDir, "data/plan.json"),
    join(stationDir, "data/import-report.json"), join(stationDir, "data/surface-baked.json"),
  ])];
  withSnapshot(files, () => {
    mkdirSync(dirname(archive), { recursive: true });
    writeFileSync(archive, text(saved, 1));
    if (receipt.station === "ikebukuro") {
      const result = applyFieldReceipt(src, pois, station, receipt, graph);
      for (const [file, value] of [[srcPath, result.src], [poisPath, result.pois], [stationPath, result.station]] as const) {
        writeFileSync(file, text(value, 1));
      }
    } else {
      applyFieldReceipts(pois.pois, station.sources, new Set<string>(graph.nodes.map((node: any) => node.id)), [receipt], graph.nodes);
      writeFileSync(poisPath, text(pois));
      writeFileSync(stationPath, text(station));
    }
    rebuild?.();
  });
  return preview;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2];
    if (!file || process.argv.slice(3).some((arg) => arg !== "--dry-run")) throw new Error("usage: pnpm field:ingest <receipt.json> [--dry-run]");
    const dryRun = process.argv.includes("--dry-run");
    const preview = ingest(file, dryRun, process.cwd(), () => {
      if (read(file).station === "shinjuku") {
        execFileSync("pnpm", ["--filter", "@gteki/station-shinjuku", "import:e27"], { stdio: "inherit" });
        execFileSync("pnpm", ["--filter", "@gteki/station-shinjuku", "bake:surface"], { stdio: "inherit" });
      }
    });
    console.log(dryRun ? "dry run: no files written" : `applied ${preview.length} CLOSED items`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
