import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type ReceiptItem = {
  item: number;
  status: "CLOSED" | "OPEN";
  poiId?: string;
  nodeId?: string;
  paid?: boolean;
  observedText: string;
  observedAt: string;
  floorLabel?: string | null;
  stepFree?: "level" | `steps:${number}` | "lift" | "escalator" | null;
};

type FieldReceipt = {
  version: number;
  station: string;
  fieldRun: string;
  /** Director 2026-10-26: only the GTEki team's own field readings for now; crowd contributions need a contributor licence first. */
  sourceKind: "team_field";
  /** Role only, never a name (e.g. "owner"). */
  observer: string;
  items: ReceiptItem[];
};

type SkippedItem = { item: number; reason: string };

const OBSERVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/;
const JA_SEARCH_ONLY = "位置・入口は未確認（検索のみ。案内ルートなし）。";
const EN_SEARCH_ONLY = "Location and entrance not verified (search only, no route).";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(item: unknown, message: string): never {
  throw new Error(`item ${String(item ?? "?")}: ${message}`);
}

function validate(receipt: FieldReceipt, src: any, pois: any): void {
  if (receipt?.version !== 1) fail("?", "version must be 1");
  if (receipt?.station !== "ikebukuro") fail("?", 'station must be "ikebukuro"');
  if (receipt.sourceKind !== "team_field") fail("?", 'sourceKind must be "team_field" (crowd contributions are not accepted yet)');
  if (typeof receipt.observer !== "string" || !/^[a-z][a-z-]*$/.test(receipt.observer)) fail("?", "observer must be a role such as \"owner\", not a name");
  if (!Array.isArray(receipt.items)) fail("?", "items must be an array");
  if (receipt.items.length === 0) fail("?", "items must contain at least one item");
  for (const item of receipt.items) {
    const number = item?.item;
    if (!Number.isInteger(number) || number <= 0) fail(number, "item must be a positive integer");
    if (item.status !== "CLOSED" && item.status !== "OPEN") fail(number, "status must be CLOSED or OPEN");
    if (typeof item.observedText !== "string" || item.observedText.trim().length === 0) fail(number, "observedText must be non-empty");
    if (typeof item.observedAt !== "string" || !OBSERVED_AT.test(item.observedAt) || Number.isNaN(Date.parse(item.observedAt))) {
      fail(number, "observedAt must include a valid +09:00 timestamp");
    }
    if (item.status === "CLOSED") {
      if (typeof item.paid !== "boolean") fail(number, "paid must be a boolean for CLOSED items");
      if (!src.pois?.some((poi: any) => poi.id === item.poiId)) fail(number, `unknown source POI ${String(item.poiId)}`);
      if (!pois.pois?.some((poi: any) => poi.id === item.poiId)) fail(number, `unknown gteki POI ${String(item.poiId)}`);
      if (!src.nodes?.some((node: any) => node.id === item.nodeId)) fail(number, `unknown node ${String(item.nodeId)}`);
    }
  }
}

function appendUnique(values: unknown, value: string): string[] {
  const current = Array.isArray(values) ? values.filter((entry): entry is string => typeof entry === "string") : [];
  return current.includes(value) ? current : [...current, value];
}

function updatePoi(poi: any, item: ReceiptItem, sourceId: string): any {
  const date = item.observedAt.slice(0, 10);
  const sentenceJa = `入口は現地で確認（#533 項目${item.item}、${item.observedAt}）：「${item.observedText}」。`;
  const sentenceEn = `Entrance checked on site (#533 item ${item.item}, ${item.observedAt}): 「${item.observedText}」.`;
  const method = `field observation (#533 item ${item.item}): 「${item.observedText}」 read on site ${item.observedAt}; connector = ${item.nodeId}`
    + (item.floorLabel ? `; floor ${item.floorLabel}` : "")
    + (item.stepFree ? `; step-free: ${item.stepFree}` : "");
  const notes = Array.isArray(poi.notes) ? poi.notes.map((note: any) => {
    const sentence = note.lang === "ja" ? sentenceJa : note.lang === "en" ? sentenceEn : null;
    const oldPhrase = note.lang === "ja" ? JA_SEARCH_ONLY : note.lang === "en" ? EN_SEARCH_ONLY : null;
    if (!sentence) return note;
    const text = typeof note.text === "string" ? note.text : "";
    if (text.includes(sentence)) return note;
    return { ...note, text: text.includes(oldPhrase!) ? text.replace(oldPhrase!, sentence) : `${text}${text ? " " : ""}${sentence}` };
  }) : [];
  for (const [lang, sentence] of [["ja", sentenceJa], ["en", sentenceEn]] as const) {
    if (!notes.some((note: any) => note.lang === lang)) notes.push({ lang, text: sentence });
  }
  return {
    ...poi,
    connectorNodeIds: appendUnique(poi.connectorNodeIds, item.nodeId!),
    paid: item.paid,
    evidence: {
      ...poi.evidence,
      sourceIds: appendUnique(poi.evidence?.sourceIds, sourceId),
      method,
      checkedDate: date,
    },
    notes,
  };
}

export function applyFieldReceipt(srcInput: any, poisInput: any, stationInput: any, receipt: FieldReceipt) {
  const src = clone(srcInput);
  const pois = clone(poisInput);
  const station = clone(stationInput);
  validate(receipt, src, pois);

  // Provenance comes from CLOSED items only; a receipt with none changes nothing.
  const closed = receipt.items.filter((item) => item.status === "CLOSED");
  const skippedOpen: SkippedItem[] = receipt.items.filter((item) => item.status === "OPEN").map(({ item }) => ({ item, reason: "OPEN" }));
  if (!closed.length) return { src, pois, station, applied: [] as number[], skipped: skippedOpen };
  const latest = closed.reduce((a, b) => Date.parse(a.observedAt) >= Date.parse(b.observedAt) ? a : b);
  const date = latest.observedAt.slice(0, 10);
  const sourceId = `field-ikebukuro-${date}`;
  const itemNumbers = closed.map(({ item }) => item).join(", ");
  const source = {
    id: sourceId,
    title: `GTEki field run ${date} (#533)`,
    publisher: "GTEki contributors",
    url: `https://github.com/nurockplayer/gteki/blob/main/${receipt.fieldRun}`,
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    rights: "REUSABLE_WITH_CONDITIONS",
    usage: "facts-only",
    attribution: "GTEki contributors, field observation (facts only; photos not published)",
    modified: false,
    retrievedAt: latest.observedAt,
    datasetDate: null,
    notes: `On-site reading of public signage by the ${receipt.observer} (${receipt.sourceKind}) for #533 items ${itemNumbers}. Photos stay private (field-run rules).`,
  };
  for (const target of [src, station]) {
    if (!Array.isArray(target.sources)) target.sources = [];
    const index = target.sources.findIndex((entry: any) => entry.id === sourceId);
    if (index < 0) target.sources.push(clone(source));
    else target.sources[index] = clone(source);
  }

  const applied: number[] = [];
  const skipped: SkippedItem[] = [];
  for (const item of receipt.items) {
    if (item.status === "OPEN") {
      skipped.push({ item: item.item, reason: "OPEN" });
      continue;
    }
    const srcIndex = src.pois.findIndex((poi: any) => poi.id === item.poiId);
    const poisIndex = pois.pois.findIndex((poi: any) => poi.id === item.poiId);
    src.pois[srcIndex] = updatePoi(src.pois[srcIndex], item, sourceId);
    pois.pois[poisIndex] = updatePoi(pois.pois[poisIndex], item, sourceId);
    applied.push(item.item);
  }
  return { src, pois, station, applied, skipped };
}

async function main(): Promise<void> {
  const receiptPath = process.argv[2];
  if (!receiptPath) throw new Error("usage: node stations/ikebukuro/pipeline/import_field_receipt.ts <receipt.json>");
  // Only a real receipt may be written into the station data; the test fixture is not an observation.
  if (!path.resolve(receiptPath).includes(`${path.sep}docs${path.sep}research${path.sep}field${path.sep}receipts${path.sep}`))
    throw new Error("refusing a receipt outside docs/research/field/receipts/");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const stationDir = path.resolve(here, "..");
  const srcPath = path.join(stationDir, "data", "graph.src.json");
  const poisPath = path.join(stationDir, "gteki", "pois.json");
  const stationPath = path.join(stationDir, "gteki", "station.json");
  const result = applyFieldReceipt(
    JSON.parse(fs.readFileSync(srcPath, "utf8")),
    JSON.parse(fs.readFileSync(poisPath, "utf8")),
    JSON.parse(fs.readFileSync(stationPath, "utf8")),
    JSON.parse(fs.readFileSync(receiptPath, "utf8")),
  );
  for (const [file, value] of [[srcPath, result.src], [poisPath, result.pois], [stationPath, result.station]] as const) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  }
  console.log(`applied: ${JSON.stringify(result.applied)} skipped: ${JSON.stringify(result.skipped)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
