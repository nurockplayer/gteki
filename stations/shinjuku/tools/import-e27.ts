/**
 * Build the shared-contract station files stations/shinjuku/gteki/{station,graph,pois}.json
 * and the render-only plan stations/shinjuku/data/plan.json from the raw MLIT/Toei E27 dataset.
 *
 *   pnpm --filter @gteki/station-shinjuku import:e27            # writes files
 *   pnpm --filter @gteki/station-shinjuku import:e27 --check    # fails if outputs would change
 *
 * Every derived fact records its method. Findings that shape the derivation
 * (verified against the dataset itself, see docs/stations/shinjuku/README.md):
 *  - route_type 5/6 are swapped relative to the 2024 spec text in this dataset:
 *    rt6 links lie in GSI escalator spaces (B023), rt5 links in stair spaces (B021).
 *    Mode is therefore taken from the containing CAD space category.
 *  - No link-level fare attribute (tfc_restr) is published; paid/unpaid comes from
 *    the GSI space attribute `toll` (2 = paid, 3 = free, 1 = unknown) by spatial join,
 *    propagated along non-gate links, and validated so that the only paid↔free
 *    transitions are links next to published ticket-gate points (F106).
 *  - No elevations are published. Render heights are SYMBOLIC estimates from
 *    escalator/stair run lengths (30° escalators, stair rise ratio 0.5) — never measured.
 *    After switchback interpolation, plan-overlapping graph edges/runs constrain overhead
 *    walking surfaces to >=2.3 m (2.1 m head + 0.2 m slab),
 *    except true abutments (±0.05 m) and their 0.6 m endpoint joins. Deeper levels move down;
 *    street floors 0/1 remain pinned and monotonic floor gaps are retained.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EnuFrame } from "@gteki/geo";
import {
  SCHEMA_VERSION,
  validateBundle,
  type Asset,
  type BuildingHours,
  type CoverageArea,
  type CoverageGap,
  type DataFile,
  type Edge,
  type EdgeMode,
  type EvidenceRef,
  type Floor,
  type HoursText,
  type LocalizedText,
  type Node,
  type Poi,
  type Source,
  type StationBundle,
  type Tri,
} from "@gteki/schema";
import { runWidth } from "../scene/layout.ts";
import { floorLabel } from "../app/src/narrate.ts";
import { SURFACE_CREDIT } from "./import-surface.ts";
import { loadRawE27, normId, pointInPolygon, RAW_DIR, type GeoFeature, type PolyG, type RawSpaceP } from "./e27-raw.ts";
import { applyFieldReceipts, loadReceipts } from "./field-receipts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../data");
const OUT_GTEKI = join(HERE, "../gteki");
/**
 * Pinned acquisition time of the hashed inputs (sources/manifest.json). Output provenance uses this,
 * never a local fetch timestamp, so identical input hashes always reproduce identical files.
 */
const ACQUIRED_AT = (JSON.parse(readFileSync(join(HERE, "../sources/manifest.json"), "utf8")) as { acquiredAt: string }).acquiredAt;
const CHECKED = "2026-10-20";
/**
 * Owner policy (option A, 2026-10-20): three statuses are tracked separately.
 * - Publication period: the dataset page says 「公共交通オープンデータチャレンジ2026 の期間中（2027年3月12日まで）のみの限定公開」.
 *   That is the provider's *publication* period, not a confirmed end of any licence, so it is NOT
 *   written to Source.validUntil (which the router treats as data validity → stale).
 * - Reuse licence: unconfirmed. The two E27 resources ship under the Owner's override at #16; the Owner decided at #39
 *   (Q11 = No) that PDL 1.0 is NOT treated as covering them, so no output may claim it does. Reuse of derived data
 *   after the period is unconfirmed (coverage gap).
 * - Navigation freshness: datasetDate (and link maint_date) with the router's staleAfterDays.
 */
const PUBLICATION_PERIOD_END = "2027-03-12";
const PERIOD_NOTE = `Publication period (公開提供期限): limited publication for 公共交通オープンデータチャレンジ2026 until ${PUBLICATION_PERIOD_END}, per the dataset page. This is the provider's publication period, not a confirmed end of any licence; reuse of derived data after that date is unconfirmed with the provider (see coverage gap:reuse-after-publication). Licence basis for this resource is unconfirmed: it ships under the Owner's override at the #16 merge, and PDL 1.0 is not treated as covering it (Owner decision #39, Q11 = No).`;
/**
 * Honest licence value for the E27 resources: validate.ts requires a data source to name a licence with an
 * http(s) link, so link the provider's dataset page. Both languages state the same status (#297); the ja
 * text reuses the credits dialog's controlled wording for this right.
 */
const E27_LICENSE = {
  name: [
    { lang: "ja", text: "ライセンス未確認・オーナー判断により公開（#16）" },
    { lang: "en", text: "Licence unconfirmed — published under the Owner's override (#16)" },
  ],
  url: "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45",
};
// #130: the E27 resources ship under the Owner's recorded override (the #16 merge), not under a confirmed licence.
const E27_OVERRIDE = { decision: "https://github.com/nurockplayer/gteki/pull/16#issuecomment-6313815757", date: "2026-10-21" };
const SRC_NWD = "mlit-hokonavi-e27-nwd";
const SRC_MAP = "mlit-hokonavi-e27-stationmap";
const OP = "toei";

const raw = loadRawE27();
const ORIGIN = { lat: 35.687, lon: 139.6994 };
const frame = new EnuFrame({ ...ORIGIN, h: 0 });
const enu = (lon: number, lat: number) => {
  const p = frame.toEnu({ lat, lon, h: 0 });
  return { x: round(p.x, 2), y: round(p.y, 2) };
};
function round(v: number, d: number) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
const ev = (sourceIds: string[], method: string, note?: string): EvidenceRef => ({
  sourceIds,
  method,
  checkedDate: CHECKED,
  ...(note ? { note } : {}),
});

// ---------------------------------------------------------------- map layers
interface MapLevel {
  label: string;
  ordinal: number;
  spaces: (GeoFeature<RawSpaceP, PolyG> & { enu: { x: number; y: number }[][] })[];
}
const mapLevels: MapLevel[] = raw.levels
  .map((lv) => ({
    label: lv.label,
    ordinal: Number(lv.floors[0]!.properties.ordinal),
    spaces: lv.spaces.map((s) => ({ ...s, enu: s.geometry.coordinates.map((ring) => ring.map(([lo, la]) => enu(lo, la))) })),
  }))
  .sort((a, b) => b.ordinal - a.ordinal);
/** GSI map level used for spatial joins of an NWD floor ordinal (nearest map ordinal at or above). */
function mapLevelFor(nwdFloor: number): MapLevel | undefined {
  const exact = mapLevels.find((m) => m.ordinal === nwdFloor);
  if (exact) return exact;
  if (nwdFloor === 0) return mapLevels.find((m) => m.ordinal === 1);
  // intermediate (x.5) floors: candidates above and below
  return undefined;
}
function spacesAt(lon: number, lat: number, levels: (MapLevel | undefined)[]) {
  const out: { level: MapLevel; space: MapLevel["spaces"][number] }[] = [];
  for (const level of levels) if (level) for (const space of level.spaces) if (pointInPolygon(lon, lat, space.geometry.coordinates)) out.push({ level, space });
  return out;
}

// ---------------------------------------------------------------- nodes / links
const rawNodes = new Map(raw.nodes.map((n) => [n.properties.node_id, n]));
const links = raw.links;
const incident = new Map<string, typeof links>();
for (const l of links) for (const id of [l.properties.start_id, l.properties.end_id]) incident.set(id, [...(incident.get(id) ?? []), l]);

const floorOrdinals = [...new Set(raw.nodes.map((n) => n.properties.floor))].sort((a, b) => b - a);
const floorId = (o: number) => `toei-nwd-${o < 0 ? "m" : ""}${String(Math.abs(o)).replace(".", "_")}`;

// Mode per link from the containing CAD space (see header).
function sampleAlong(c: [number, number][], t: number): [number, number] {
  const i = (c.length - 1) * t;
  const a = c[Math.floor(i)]!;
  const b = c[Math.ceil(i)]!;
  const f = i - Math.floor(i);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
const allLevels = mapLevels;
... (+1596 lines) [see remaining: rtk proxy git show 'e73fc4c0^:stations/shinjuku/tools/import-e27.ts' | tail -n +157]
