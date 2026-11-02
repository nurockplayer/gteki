import type { FieldStation } from "./data.ts";

export interface Observation {
  stopId: string; target: string; side: "left" | "right" | "n/a"; offsetM: string;
  floorLabel: string; confirmation: "CLOSED" | "OPEN"; stepFree: string;
  observedText: string; note: string; poiId: string; itemId: string; paid: string; observedAt: string;
}

export function nowJst(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+09:00";
}

export function newObservation(stopId: string): Observation {
  return { stopId, target: "", side: "n/a", offsetM: "", floorLabel: "", confirmation: "OPEN", stepFree: "",
    observedText: "", note: "", poiId: "", itemId: "", paid: "", observedAt: nowJst() };
}

export function buildReceipt(station: FieldStation, records: Observation[]) {
  const entries = records.map((record) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(record.observedAt) || Number.isNaN(Date.parse(record.observedAt)))
      throw new Error(`${record.stopId}: observedAt needs a valid JST time with +09:00.`);
    if (!["CLOSED", "OPEN"].includes(record.confirmation)) throw new Error(`${record.stopId}: invalid confirmation.`);
    if (record.stepFree && !/^(level|steps:\d+|lift|escalator)$/.test(record.stepFree))
      throw new Error(`${record.stopId}: stepFree must be level, steps:<n>, lift, escalator or empty.`);
    if (!record.observedText.trim()) throw new Error(`${record.stopId}: enter the observed text (or the reason it was unread).`);
    const nodeId = station.nodeIds.includes(record.target) ? record.target : undefined;
    const edgeId = station.edgeIds.includes(record.target) ? record.target : undefined;
    const poiId = station.pois.some((p) => p.id === record.poiId) ? record.poiId : undefined;
    const paid = record.paid === "true" ? true : record.paid === "false" ? false : null;
    return {
      item: /^\d+$/.test(record.itemId) ? Number(record.itemId) : undefined,
      status: record.confirmation === "CLOSED" && nodeId && poiId && paid !== null ? "CLOSED" as const : "OPEN" as const,
      poiId, nodeId, paid, observedText: record.observedText, observedAt: record.observedAt,
      floorLabel: record.floorLabel || null, stepFree: record.stepFree || null,
      stopId: record.stopId, edgeId, side: record.side, offsetM: record.offsetM === "" ? null : Number(record.offsetM),
      note: record.note, target: record.target, targetUnknown: !nodeId && !edgeId,
      confirmation: record.confirmation, itemId: record.itemId || null,
    };
  });
  const items = entries.filter((entry) => entry.item !== undefined && entry.item > 0);
  if (!items.length) throw new Error("Choose at least one numbered item before exporting a receipt. FC / unassigned notes stay saved and will be included as fieldNotes.");
  return { version: 1, station: station.id, fieldRun: station.fieldRun, sourceKind: "team_field", observer: "owner",
    items, fieldNotes: entries.filter((entry) => entry.item === undefined || entry.item <= 0) };
}
