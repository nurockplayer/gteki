// #533 field receipts for Shinjuku (#554 format: docs/research/field/receipt-format.md). Only CLOSED team_field
// items add a connector; the shared validation, provenance and POI update are Ikebukuro's (#554).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Poi, Source } from "@gteki/schema";
import { fieldSource, updatePoi, validateReceipt, type FieldReceipt } from "../../ikebukuro/pipeline/import_field_receipt.ts";

export function loadReceipts(dir: string, station: string): FieldReceipt[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(`-${station}.json`) && /^\d{4}-\d{2}-\d{2}-/.test(f)).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as FieldReceipt);
}

/** Applies the receipts in place (import-e27 builds its arrays by mutation) and returns the applied #533 item numbers. */
export function applyFieldReceipts(pois: Poi[], sources: Source[], nodeIds: ReadonlySet<string>, receipts: readonly FieldReceipt[]): number[] {
  const applied: number[] = [];
  for (const receipt of receipts) {
    validateReceipt(receipt, "shinjuku", (id) => pois.some((p) => p.id === id), (id) => typeof id === "string" && nodeIds.has(id));
    const provenance = fieldSource(receipt, "shinjuku");
    if (!provenance) continue;
    const at = sources.findIndex((s) => s.id === provenance.sourceId);
    if (at < 0) sources.push(provenance.source as unknown as Source); else sources[at] = provenance.source as unknown as Source;
    for (const item of provenance.closed) {
      const index = pois.findIndex((p) => p.id === item.poiId);
      pois[index] = updatePoi(pois[index], item, provenance.sourceId);
      applied.push(item.item);
    }
  }
  return applied;
}
