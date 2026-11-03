import type { FieldStation } from "./data.ts";

export interface Observation {
  id: string; stopId: string; private?: true; target: string; side: "left" | "right" | "n/a"; offsetM: string;
  floorLabel: string; confirmation: "CLOSED" | "OPEN"; stepFree: string;
  observedText: string; note: string; poiId: string; itemId: string; paid: string; observedAt: string;
}

export function nowJst(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) + "+09:00";
}

export function newObservation(stopId: string, privateStop?: true): Observation {
  const id = globalThis.crypto?.randomUUID?.() ?? `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { id, stopId, ...(privateStop ? { private: true as const } : {}), target: "", side: "n/a", offsetM: "", floorLabel: "", confirmation: "OPEN", stepFree: "",
    observedText: "", note: "", poiId: "", itemId: "", paid: "", observedAt: nowJst() };
}

export function isPrivateObservation(station: FieldStation, record: Observation): boolean {
  return !!record.private || !!station.stops.find((stop) => stop.id === record.stopId)?.private
    || !!station.privateCatalog?.targetIds.includes(record.target) || !!station.privateCatalog?.poiIds.includes(record.poiId);
}

export function buildReceipt(station: FieldStation, records: Observation[], privateReceipt = false) {
  if (privateReceipt && !station.privateCatalog) throw new Error("非公開の記録は非公開ビルドで書き出してください / Export private records from the private build");
  const isPrivate = (record: Observation) => isPrivateObservation(station, record);
  const entries = records.filter((record) => isPrivate(record) === privateReceipt).map((record) => {
    const parts = record.observedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+09:00$/)?.slice(1).map((part) => Number(part ?? 0));
    const date = new Date(0);
    if (parts) {
      date.setUTCFullYear(parts[0]!, parts[1]! - 1, parts[2]!);
      date.setUTCHours(parts[3]!, parts[4]!, parts[5]!, 0);
    }
    if (!parts || [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
      .some((part, index) => part !== parts[index]))
      throw new Error(`${record.stopId}: observedAt needs a valid JST time with +09:00.`);
    if (!["CLOSED", "OPEN"].includes(record.confirmation)) throw new Error(`${record.stopId}: invalid confirmation.`);
    if (record.stepFree && !/^(level|steps:\d+|lift|escalator)$/.test(record.stepFree))
      throw new Error(`${record.stopId}: stepFree must be level, steps:<n>, lift, escalator or empty.`);
    if (!record.observedText.trim()) throw new Error(`${record.stopId}: enter the observed text (or the reason it was unread).`);
    const nodeId = station.nodeIds.includes(record.target) ? record.target : undefined;
    const edgeId = station.edgeIds.includes(record.target) ? record.target : undefined;
    const poiId = station.pois.some((p) => p.id === record.poiId) ? record.poiId : undefined;
    const paid = record.paid === "true" ? true : record.paid === "false" ? false : null;
    const item = /^\d+$/.test(record.itemId) ? Number(record.itemId) : undefined;
    return {
      item,
      status: item !== undefined && item > 0 && record.confirmation === "CLOSED" && nodeId && poiId && paid !== null ? "CLOSED" as const : "OPEN" as const,
      poiId, nodeId, paid, observedText: record.observedText, observedAt: record.observedAt,
      floorLabel: record.floorLabel || null, stepFree: record.stepFree || null,
      stopId: record.stopId, edgeId, side: record.side, offsetM: record.offsetM === "" ? null : Number(record.offsetM),
      note: record.note, target: record.target, targetUnknown: !nodeId && !edgeId,
      confirmation: record.confirmation, itemId: record.itemId || null,
    };
  });
  const items = entries.filter((entry) => entry.item !== undefined && entry.item > 0);
  if (!items.length && !privateReceipt && !records.some(isPrivate)) throw new Error("Choose at least one numbered item before exporting a receipt. FC / unassigned notes stay saved and will be included as fieldNotes.");
  return { ...(privateReceipt ? { private: true as const } : {}), version: 1, station: station.id, fieldRun: station.fieldRun, sourceKind: "team_field", observer: "owner",
    items, fieldNotes: entries.filter((entry) => entry.item === undefined || entry.item <= 0) };
}

export function buildReceipts(station: FieldStation, records: Observation[]) {
  const receipts = [buildReceipt(station, records)].filter((receipt) => receipt.items.length || receipt.fieldNotes.length);
  if (station.privateCatalog && records.some((record) => isPrivateObservation(station, record))) {
    receipts.push(buildReceipt(station, records, true));
  }
  return receipts;
}

export interface RecorderState {
  station: string; positions: Record<string, number>; records: Record<string, Observation[]>; deletedIds?: string[];
}

/** Only locally edited IDs replace stored records; navigation cannot overwrite another tab's edits. */
export function mergeRecorderState(stored: RecorderState, local: RecorderState, changedIds: ReadonlySet<string>): RecorderState {
  const deletedIds = [...new Set([...(stored.deletedIds ?? []), ...(local.deletedIds ?? [])])];
  const deleted = new Set(deletedIds);
  const records: RecorderState["records"] = {};
  for (const station of new Set([...Object.keys(stored.records), ...Object.keys(local.records)])) {
    const merged = new Map((stored.records[station] ?? []).map((record) => [record.id, record]));
    for (const record of local.records[station] ?? []) {
      if (!merged.has(record.id) || changedIds.has(record.id)) merged.set(record.id, record);
    }
    records[station] = [...merged.values()].filter((record) => !deleted.has(record.id));
  }
  return { ...local, positions: { ...stored.positions, ...local.positions }, records, deletedIds };
}
