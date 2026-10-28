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
const modeEvidence = new Map<string, { mode: EdgeMode; method: string; note?: string }>();
const anomalies: string[] = [];
for (const l of links) {
  const p = l.properties;
  const cats = new Set<string>();
  for (const t of [0.25, 0.5, 0.75]) {
    const [x, y] = sampleAlong(l.geometry.coordinates, t);
    for (const { space } of spacesAt(x, y, allLevels)) cats.add(space.properties.category);
  }
  let mode: EdgeMode = "walk";
  let method = "source-attribute:route_type=1";
  let note: string | undefined;
  if (p.route_type === 4) {
    mode = "elevator";
    method = "source-attribute:route_type=4 + space:B022";
    if (!cats.has("B022")) anomalies.push(`elevator link ${p.link_id} outside B022 space`);
  } else if (p.route_type === 5 || p.route_type === 6) {
    if (cats.has("B023") && !cats.has("B021")) mode = "escalator";
    else if (cats.has("B021") && !cats.has("B023")) mode = "stairs";
    else mode = p.route_type === 6 ? "escalator" : "stairs"; // fallback: dataset-wide observed convention
    method = `space-category:${[...cats].filter((c) => /B02[1-5]/.test(c)).join("+") || "none"} (route_type=${p.route_type})`;
    note = "route_type 5/6 swapped vs 2024 spec text in this dataset; CAD space category decides";
  } else if (p.route_type === 7) {
    mode = "ramp";
    method = "source-attribute:route_type=7";
  } else if (p.route_type !== 1) {
    anomalies.push(`unhandled route_type ${p.route_type} on ${p.link_id}`);
  }
  modeEvidence.set(p.link_id, { mode, method, ...(note ? { note } : {}) });
}

// ---------------------------------------------------------------- fare area (toll) per node
type Toll = "paid" | "free" | null;
const tollOf = (t: string): Toll => (t === "2" ? "paid" : t === "3" ? "free" : null);
const nodeToll = new Map<string, Toll>();
const nodeTollMethod = new Map<string, string>();
for (const n of raw.nodes) {
  const [lon, lat] = n.geometry.coordinates;
  const f = n.properties.floor;
  const levels = Number.isInteger(f) ? [mapLevelFor(f)] : [mapLevelFor(Math.floor(f)), mapLevelFor(Math.ceil(f))];
  const hits = spacesAt(lon, lat, levels).map((h) => tollOf(h.space.properties.toll));
  const known = [...new Set(hits.filter((h): h is "paid" | "free" => h !== null))];
  if (known.length === 1) {
    nodeToll.set(n.properties.node_id, known[0]!);
    nodeTollMethod.set(n.properties.node_id, "spatial-join:space.toll");
  } else {
    nodeToll.set(n.properties.node_id, null);
    if (known.length > 1) anomalies.push(`node ${n.properties.node_id} in both paid and free spaces`);
  }
}
// Gate candidates: links whose endpoints have opposite known tolls.
const gatePoints = raw.levels.flatMap((lv) =>
  lv.facilities.filter((f) => f.properties.category === "F106").map((f) => ({ level: lv.label, ...enu(...f.geometry.coordinates) })),
);
const gateLinks = new Set<string>();
for (const l of links) {
  const a = nodeToll.get(l.properties.start_id);
  const b = nodeToll.get(l.properties.end_id);
  if (a && b && a !== b) {
    const A = rawNodes.get(l.properties.start_id)!;
    const B = rawNodes.get(l.properties.end_id)!;
    const pa = enu(...A.geometry.coordinates);
    const pb = enu(...B.geometry.coordinates);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const near = gatePoints.some((g) => Math.hypot(g.x - mid.x, g.y - mid.y) <= 8);
    if (near && modeEvidence.get(l.properties.link_id)!.mode === "walk") gateLinks.add(l.properties.link_id);
    else anomalies.push(`fare transition on ${l.properties.link_id} without a ticket-gate point within 8 m (mode ${modeEvidence.get(l.properties.link_id)!.mode})`);
  }
}
// Propagate known tolls across non-gate links to unknown nodes (stairs mid-landings etc.).
for (let pass = 0; pass < 50; pass++) {
  let changed = false;
  for (const n of raw.nodes) {
    const id = n.properties.node_id;
    if (nodeToll.get(id) !== null) continue;
    const neigh = new Set<Toll>();
    for (const l of incident.get(id) ?? []) {
      if (gateLinks.has(l.properties.link_id)) continue;
      const other = l.properties.start_id === id ? l.properties.end_id : l.properties.start_id;
      const t = nodeToll.get(other);
      if (t) neigh.add(t);
    }
    if (neigh.size === 1) {
      nodeToll.set(id, [...neigh][0]!);
      nodeTollMethod.set(id, "propagated-along-non-gate-links");
      changed = true;
    }
  }
  if (!changed) break;
}
// Validation: after propagation, every non-gate link must be toll-consistent.
for (const l of links) {
  if (gateLinks.has(l.properties.link_id)) continue;
  const a = nodeToll.get(l.properties.start_id);
  const b = nodeToll.get(l.properties.end_id);
  if (a && b && a !== b) anomalies.push(`non-gate link ${l.properties.link_id} joins paid and free after propagation`);
}

// ---------------------------------------------------------------- symbolic floor heights
// Unknowns: one height per NWD floor; floor 0 and floor 1 (at-grade building entrance) pinned to 0.
// Constraints come from vertical chains: maximal runs of stair/escalator links between "level nodes".
const ESC_TAN = Math.tan((30 * Math.PI) / 180);
const ESC_FLAT = 2.4; // metres of flat landing included in an escalator link's horizontal run
const STAIR_RATIO = 0.5;
const linkLen = new Map(links.map((l) => [l.properties.link_id, l.properties.distance]));
const isVertical = (id: string) => ["stairs", "escalator"].includes(modeEvidence.get(id)!.mode);
const levelNode = (id: string) => (incident.get(id) ?? []).some((l) => !isVertical(l.properties.link_id));
interface Chain {
  from: string;
  to: string;
  linkIds: string[];
  mode: "stairs" | "escalator";
  run: number;
}
const chains: Chain[] = [];
const seenChain = new Set<string>();
for (const l of links) {
  const id = l.properties.link_id;
  if (!isVertical(id) || seenChain.has(id)) continue;
  // walk both directions until level nodes
  const ids = [id];
  seenChain.add(id);
  const ends: string[] = [];
  for (const startNode of [l.properties.start_id, l.properties.end_id]) {
    let cur = startNode;
    let prevLink = id;
    for (;;) {
      if (levelNode(cur)) break;
      const next = (incident.get(cur) ?? []).filter((x) => x.properties.link_id !== prevLink && isVertical(x.properties.link_id));
      if (next.length !== 1) break; // branching stair: stop
      const nl = next[0]!;
      if (seenChain.has(nl.properties.link_id)) break;
      seenChain.add(nl.properties.link_id);
      ids.push(nl.properties.link_id);
      prevLink = nl.properties.link_id;
      cur = nl.properties.start_id === cur ? nl.properties.end_id : nl.properties.start_id;
    }
    ends.push(cur);
  }
  const mode = modeEvidence.get(id)!.mode as "stairs" | "escalator";
  chains.push({ from: ends[0]!, to: ends[1]!, linkIds: ids, mode, run: ids.reduce((s, x) => s + linkLen.get(x)!, 0) });
}
const floorOfNode = (id: string) => rawNodes.get(id)!.properties.floor;
// Least squares (Gauss–Seidel style iteration) for floor heights.
const H = new Map<number, number>(floorOrdinals.map((o) => [o, o <= 0 ? o * 5 : 0]));
const pinned = new Set([0, 1]);
const constraints = chains
  .filter((c) => floorOfNode(c.from) !== floorOfNode(c.to))
  .map((c) => {
    const dh = c.mode === "escalator" ? Math.max(0, c.run - ESC_FLAT) * ESC_TAN : c.run * STAIR_RATIO;
    const [hi, lo] = floorOfNode(c.from) > floorOfNode(c.to) ? [floorOfNode(c.from), floorOfNode(c.to)] : [floorOfNode(c.to), floorOfNode(c.from)];
    return { hi, lo, dh, w: c.mode === "escalator" ? 3 : 1 };
  });
for (let it = 0; it < 2000; it++) {
  for (const o of floorOrdinals) {
    if (pinned.has(o)) continue;
    let num = 0;
    let den = 0;
    for (const c of constraints) {
      if (c.lo === o) (num += c.w * (H.get(c.hi)! - c.dh), (den += c.w));
      if (c.hi === o) (num += c.w * (H.get(c.lo)! + c.dh), (den += c.w));
    }
    if (den > 0) H.set(o, num / den);
  }
}
// Preserve a >=1.2 m monotonic gap between successive symbolic ordinals (street 0/1 coincide).
const sortedOrd = [...floorOrdinals].sort((a, b) => b - a);
for (let i = 1; i < sortedOrd.length; i++) {
  const above = H.get(sortedOrd[i - 1]!)!;
  const o = sortedOrd[i]!;
  const minGap = pinned.has(o) && pinned.has(sortedOrd[i - 1]!) ? 0 : 1.2;
  if (H.get(o)! > above - minGap) H.set(o, above - minGap);
}

// ---------------------------------------------------------------- node render heights (chains interpolate)
function renderNodeHeights(H: Map<number, number>) {
  const nodeZ = new Map<string, number>();
  for (const n of raw.nodes) nodeZ.set(n.properties.node_id, H.get(n.properties.floor)!);
  for (const c of chains) {
    if (c.linkIds.length < 2) continue;
    // order links from c.from
    let cur = c.from;
    let acc = 0;
    const z0 = H.get(floorOfNode(c.from))!;
    const z1 = H.get(floorOfNode(c.to))!;
    const remaining = new Set(c.linkIds);
    while (remaining.size) {
      const l = [...remaining].map((id) => links.find((x) => x.properties.link_id === id)!).find((x) => x.properties.start_id === cur || x.properties.end_id === cur);
      if (!l) break;
      remaining.delete(l.properties.link_id);
      acc += l.properties.distance;
      cur = l.properties.start_id === cur ? l.properties.end_id : l.properties.start_id;
      if (!levelNode(cur)) nodeZ.set(cur, z0 + (z1 - z0) * (acc / c.run));
    }
  }

  // Walk links that change floor next to a stair/escalator foot (2 in E27, flagged by the validator):
  // render the stair as carrying the height change by moving the stair-end node's *display* height to
  // the far floor, so the walk stays flat. Floor ids and routing are untouched.
  const displayHeightAdjusted: string[] = [];
  for (const l of links) {
    if (isVertical(l.properties.link_id)) continue;
    const a = l.properties.start_id;
    const b = l.properties.end_id;
    if (floorOfNode(a) === floorOfNode(b)) continue;
    const vert = (id: string) => (incident.get(id) ?? []).some((x) => isVertical(x.properties.link_id));
    const [stairEnd, other] = vert(a) && !vert(b) ? [a, b] : vert(b) && !vert(a) ? [b, a] : [null, null];
    if (!stairEnd || !other) continue;
    if (nodeZ.get(stairEnd) !== nodeZ.get(other)) displayHeightAdjusted.push(`n:${stairEnd}`);
    nodeZ.set(stairEnd, nodeZ.get(other)!);
  }

  // Stacked switchbacks: the source puts every landing of a multi-flight stair on one floor, so the
  // middle flights would render flat (and overlap the flights above/below them in plan, or leave the
  // last flight absurdly steep). For each stair/escalator link with both ends on one floor, take the
  // maximal chain of same-floor links through 2-link nodes. Each chain end is anchored either by the
  // link leaving the floor (anchor = far node, the link's rise counts) or, at a branch/dead end, by
  // its own height. The rise between the anchors is spread over the chain by flight length (walks
  // stay flat). Display only: floor ids and routing are untouched.
  const landingSpread: string[] = [];
  const other = (l: (typeof links)[0], id: string) => (l.properties.start_id === id ? l.properties.end_id : l.properties.start_id);
  const rise = (l: (typeof links)[0]) => (isVertical(l.properties.link_id) ? l.properties.distance : 0);
  const spreadDone = new Set<string>();
  for (const f0 of links) {
    const fl = floorOfNode(f0.properties.start_id);
    if (!isVertical(f0.properties.link_id) || floorOfNode(f0.properties.end_id) !== fl || spreadDone.has(f0.properties.link_id)) continue;
    const deg = (id: string) => (incident.get(id) ?? []).length;
    // extend from f0 in one direction: returns links (outward order) and the end node
    const extend = (from: string, via: (typeof links)[0]) => {
      const chain: (typeof links)[0][] = [];
      let cur = from;
      let prev = via;
      while (deg(cur) === 2) {
        const l = incident.get(cur)!.find((x) => x !== prev)!;
        if (floorOfNode(other(l, cur)) !== fl) return { chain, end: cur, leave: l };
        chain.push(l);
        spreadDone.add(l.properties.link_id);
        prev = l;
        cur = other(l, cur);
        if (cur === from) return null; // loop
      }
      return { chain, end: cur, leave: null as (typeof links)[0] | null };
    };
    spreadDone.add(f0.properties.link_id);
    const A = extend(f0.properties.start_id, f0);
    const B = extend(f0.properties.end_id, f0);
    if (!A || !B) continue;
    // ordered node list A.end … B.end and the links between them
    const seq = [...A.chain.reverse(), f0, ...B.chain];
    const nodesSeq = [A.end];
    for (const l of seq) nodesSeq.push(other(l, nodesSeq.at(-1)!));
    const za = A.leave ? nodeZ.get(other(A.leave, A.end))! : nodeZ.get(A.end)!;
    const zb = B.leave ? nodeZ.get(other(B.leave, B.end))! : nodeZ.get(B.end)!;
    const total = (A.leave ? rise(A.leave) : 0) + seq.reduce((t, l) => t + rise(l), 0) + (B.leave ? rise(B.leave) : 0);
    if (!total) continue;
    let acc = A.leave ? rise(A.leave) : 0;
    for (let i = 0; i < nodesSeq.length; i++) {
      if (i > 0) acc += rise(seq[i - 1]!);
      const id = nodesSeq[i]!;
      if ((i === 0 && !A.leave) || (i === nodesSeq.length - 1 && !B.leave)) continue; // anchors stay
      nodeZ.set(id, za + (zb - za) * (acc / total));
      if (Math.abs(za - zb) >= 0.05) landingSpread.push(`n:${id}`);
    }
  }

  return { nodeZ, displayHeightAdjusted, landingSpread };
}

// Heights after interpolation are affine in the floor heights, including switchback landings.
// Sample the same straight run footprints as layout.ts; constrain unrelated plan overlaps,
// retaining true abutments and the first/last 0.6 m where neighbouring proxies meet.
const initialNodeZ = renderNodeHeights(H).nodeZ;
const basis = floorOrdinals.map((o) => renderNodeHeights(new Map(floorOrdinals.map((f) => [f, f === o ? 1 : 0]))).nodeZ);
const xyNodes = new Map(raw.nodes.map((n) => [n.properties.node_id, enu(...n.geometry.coordinates)]));
const flatWalks = links.filter((l) => ["walk", "gate", "ramp"].includes(modeEvidence.get(l.properties.link_id)!.mode) && Math.abs(initialNodeZ.get(l.properties.start_id)! - initialNodeZ.get(l.properties.end_id)!) < 0.05).flatMap((l) => {
  const pts = l.geometry.coordinates.map(([lon, lat]) => enu(lon, lat));
  return pts.slice(1).map((p, i) => ({ a: { ...pts[i]!, z: initialNodeZ.get(l.properties.start_id)! }, b: { ...p, z: initialNodeZ.get(l.properties.end_id)! } }));
});
const runWidths = new Map(links.filter((l) => isVertical(l.properties.link_id)).map((l) => {
  const p = l.properties;
  return [p.link_id, runWidth(p.width, modeEvidence.get(p.link_id)!.mode, { ...xyNodes.get(p.start_id)!, z: initialNodeZ.get(p.start_id)! }, { ...xyNodes.get(p.end_id)!, z: initialNodeZ.get(p.end_id)! }, flatWalks)];
}));
const clearanceConstraints: { coefficients: number[]; lower: string; upper: string }[] = [];
const nodeCoefficients = (id: string) => basis.map((b) => b.get(id)!);
const interpolate = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
for (const edge of links) {
  const ep = edge.properties;
  const points = edge.geometry.coordinates.map(([lon, lat]) => enu(lon, lat));
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  const ca = nodeCoefficients(ep.start_id), cb = nodeCoefficients(ep.end_id);
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, length = lengths[i - 1]!;
    const dz = initialNodeZ.get(ep.end_id)! - initialNodeZ.get(ep.start_id)!;
    const segmentRise = total ? dz * length / total : dz;
    const count = Math.max(1, Math.ceil(Math.hypot(length, segmentRise) / 0.25));
    const samples = new Set(Array.from({ length: count + 1 }, (_, j) => j / count));
    // Include exact footprint entry/exit parameters, not just a sampling grid: the gap
    // is affine along each overlap, so its minimum occurs at one of these boundaries.
    for (const run of links) {
      const rp = run.properties;
      if (!isVertical(rp.link_id) || rp.link_id === ep.link_id) continue;
      const ra = xyNodes.get(rp.start_id)!, rb = xyNodes.get(rp.end_id)!;
      const dx = rb.x - ra.x, dy = rb.y - ra.y, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      let lo = 0, hi = 1;
      const clip = (v0: number, v1: number, min: number, max: number) => {
        if (Math.abs(v1 - v0) < 1e-12) return v0 >= min && v0 <= max;
        const ts = [(min - v0) / (v1 - v0), (max - v0) / (v1 - v0)].sort((a, b) => a - b);
        lo = Math.max(lo, ts[0]!); hi = Math.min(hi, ts[1]!); return hi >= lo;
      };
      const u = (p: {x:number;y:number}) => ((p.x - ra.x) * dx + (p.y - ra.y) * dy) / l2;
      const off = (p: {x:number;y:number}) => ((p.x - ra.x) * dy - (p.y - ra.y) * dx) / Math.sqrt(l2);
      const half = runWidths.get(rp.link_id)! / 2;
      if (!clip(u(a), u(b), 0, 1) || !clip(off(a), off(b), -half, half)) continue;
      const fullLength = Math.hypot(total, dz);
      const t0 = total ? acc / total : 0, span = total ? length / total : 1;
      if (span && fullLength) { lo = Math.max(lo, (0.6 / fullLength - t0) / span); hi = Math.min(hi, (1 - 0.6 / fullLength - t0) / span); }
      if (hi > lo) { samples.add(lo + 1e-8); samples.add(hi - 1e-8); }
    }
    for (const fraction of samples) {
      const along = acc + length * fraction;
      const t = total ? along / total : fraction;
      const travelled = t * Math.hypot(total, dz), remaining = (1 - t) * Math.hypot(total, dz);
      if (travelled < 0.6 || remaining < 0.6) continue;
      const p = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
      const lower = interpolate(ca, cb, t);
      const z = initialNodeZ.get(ep.start_id)! + (initialNodeZ.get(ep.end_id)! - initialNodeZ.get(ep.start_id)!) * t;
      for (const run of links) {
        const rp = run.properties;
        if (!isVertical(rp.link_id) || rp.link_id === ep.link_id) continue;
        if ([rp.start_id, rp.end_id].some((id) => id === ep.start_id || id === ep.end_id)) continue;
        const ra = xyNodes.get(rp.start_id)!, rb = xyNodes.get(rp.end_id)!;
        const dx = rb.x - ra.x, dy = rb.y - ra.y, l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const u = ((p.x - ra.x) * dx + (p.y - ra.y) * dy) / l2;
        if (Math.abs(initialNodeZ.get(rp.start_id)! - initialNodeZ.get(rp.end_id)!) < 0.2) continue;
        const width = runWidths.get(rp.link_id)!;
        if (u < 0 || u > 1 || Math.abs((p.x - ra.x) * dy - (p.y - ra.y) * dx) / Math.sqrt(l2) > width / 2) continue;
        const rz = initialNodeZ.get(rp.start_id)! + (initialNodeZ.get(rp.end_id)! - initialNodeZ.get(rp.start_id)!) * u;
        if (rz - z <= 0.05) continue; // same walking surface or the lower run
        const upper = interpolate(nodeCoefficients(rp.start_id), nodeCoefficients(rp.end_id), u);
        clearanceConstraints.push({ coefficients: upper.map((v, k) => v - lower[k]!), lower: ep.link_id, upper: rp.link_id });
      }
    }
    acc += length;
  }
}
// Lower a suffix of the floor stack: the street remains pinned and existing deeper gaps stay
// intact. 30 mm reserve survives centimetre rounding in emitted node heights and floor slabs.
for (let pass = 0; pass < 100; pass++) {
  let changed = false;
  for (const c of clearanceConstraints) {
    const gap = c.coefficients.reduce((sum, v, i) => sum + v * H.get(floorOrdinals[i]!)!, 0);
    if (gap >= 2.33 - 1e-7) continue;
    const options = floorOrdinals.filter((o) => !pinned.has(o)).map((o) => ({ o, gain: -c.coefficients.reduce((sum, v, i) => sum + (floorOrdinals[i]! <= o ? v : 0), 0) })).filter((v) => v.gain > 1e-6);
    options.sort((a, b) => b.gain - a.gain || b.o - a.o);
    const best = options[0];
    if (!best) throw new Error(`Unresolvable symbolic clearance: ${c.lower} below ${c.upper}`);
    const delta = (2.33 - gap) / best.gain;
    for (const o of floorOrdinals) if (o <= best.o && !pinned.has(o)) H.set(o, H.get(o)! - delta);
    changed = true;
  }
  // Preserve the pre-existing monotonic gap rule after every clearance projection.
  for (let i = 1; i < sortedOrd.length; i++) {
    const o = sortedOrd[i]!, above = sortedOrd[i - 1]!;
    const minGap = pinned.has(o) && pinned.has(above) ? 0 : 1.2;
    H.set(o, Math.min(H.get(o)!, H.get(above)! - minGap));
  }
  if (!changed) break;
  if (pass === 99) throw new Error("Symbolic clearance solve failed to converge");
}
const { nodeZ, displayHeightAdjusted, landingSpread } = renderNodeHeights(H);

const floors: Floor[] = floorOrdinals.map((o) => {
  const ml = mapLevels.find((m) => m.ordinal === o);
  const labels: Floor["sourceLabels"] = [{ operatorId: OP, label: `NWD floor=${o}`, sourceId: SRC_NWD }];
  if (ml) labels.push({ operatorId: OP, label: `GSI ${ml.label} (${raw.levels.find((l) => l.label === ml.label)!.floors[0]!.properties.name})`, sourceId: SRC_MAP });
  if (o === -4.5) labels.push({ operatorId: OP, label: "spatially within GSI 地下5階 (B5) polygons — equivalence not asserted", sourceId: SRC_MAP });
  return {
    id: floorId(o),
    operatorId: OP,
    sourceLabels: labels,
    ordinal: o,
    intermediate: !Number.isInteger(o),
    elevationM: null,
    elevationSource: "symbolic",
    renderElevationM: round(H.get(o)!, 2),
  };
});
// Display names (UI wording only; the same rule as the lane app's floor labels).
for (const f of floors) {
  const l = floorLabel(f);
  if (f.ordinal !== null) f.displayNames = [{ lang: "ja", text: l.ja }, { lang: "en", text: l.en }];
}
const floorById = new Map(floors.map((f) => [f.id, f]));

// ---------------------------------------------------------------- facilities → nodes
const allFacilities = raw.levels.flatMap((lv) => lv.facilities.map((f) => ({ level: mapLevels.find((m) => m.label === lv.label)!, f, p: enu(...f.geometry.coordinates) })));
function nearestNode(p: { x: number; y: number }, filter: (n: (typeof raw.nodes)[number]) => boolean) {
  let best: { id: string; d: number } | null = null;
  for (const n of raw.nodes) {
    if (!filter(n)) continue;
    const q = enu(...n.geometry.coordinates);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { id: n.properties.node_id, d };
  }
  return best;
}

const nodeKind = new Map<string, Node["kind"]>();
for (const n of raw.nodes) {
  const inc = incident.get(n.properties.node_id) ?? [];
  const modes = new Set(inc.map((l) => modeEvidence.get(l.properties.link_id)!.mode));
  let kind: Node["kind"] = "junction";
  if (modes.has("elevator")) kind = "elevator";
  else if (modes.has("escalator")) kind = "escalator_end";
  else if (modes.has("stairs")) kind = "stair_end";
  else if (modes.has("ramp")) kind = "ramp_end";
  if (inc.some((l) => gateLinks.has(l.properties.link_id))) kind = "ticket_gate";
  if (n.properties.floor === -6 && nodeToll.get(n.properties.node_id) === "paid" && kind === "junction") kind = "platform";
  nodeKind.set(n.properties.node_id, kind);
}

// Exits: GSI exit points (F108) matched to nearest node within 6 m whose floor is at/near the exit level.
interface ExitInfo {
  nodeId: string;
  p: { x: number; y: number };
  lonlat: [number, number];
  level: string;
  d: number;
}
const exits: ExitInfo[] = [];
// Floor equivalence GSI map level → NWD floors (map "1" covers NWD 1F and the GL street nodes 0).
// No equivalence across intermediate landings is assumed; unmatched exits stay out of routing.
const exitFloors = (mapOrdinal: number) => (mapOrdinal === 1 ? [1, 0] : [mapOrdinal]);
for (const { level, f, p } of allFacilities) {
  if (f.properties.category !== "F108") continue;
  const floors = exitFloors(level.ordinal);
  const onFloor = (n: (typeof raw.nodes)[number]) => floors.includes(n.properties.floor);
  // Prefer a street-side node (in_out = outside) when one is close; otherwise the nearest same-floor node.
  const outside = nearestNode(p, (n) => onFloor(n) && n.properties.in_out === 1);
  const best = outside && outside.d <= 6 ? outside : nearestNode(p, onFloor);
  if (best && best.d <= 6) {
    exits.push({ nodeId: best.id, p, lonlat: f.geometry.coordinates, level: level.label, d: best.d });
    nodeKind.set(best.id, "exit");
  } else anomalies.push(`exit point on ${level.label} has no same-floor node within 6 m (left unroutable)`);
}
// Outdoor dead-ends (in_out=1, street side) are exit approaches too.
for (const n of raw.nodes) if (n.properties.in_out === 1) nodeKind.set(n.properties.node_id, "exit");

const SRC_EVIDENCE = [SRC_NWD];
const nodes: Node[] = raw.nodes.map((n) => {
  const p = enu(...n.geometry.coordinates);
  return {
    id: `n:${n.properties.node_id}`,
    floorId: floorId(n.properties.floor),
    position: { x: p.x, y: p.y, z: null },
    // Display-only symbolic height (see heightModel in plan.json); never routed on.
    renderZ: round(nodeZ.get(n.properties.node_id)!, 2),
    kind: nodeKind.get(n.properties.node_id)!,
    inOut: n.properties.in_out === 1 ? "outside" : n.properties.in_out === 2 ? "boundary" : n.properties.in_out === 3 ? "inside" : null,
    sourceRefs: [{ sourceId: SRC_NWD, featureId: n.properties.node_id }],
  };
});

// ---------------------------------------------------------------- edges
const wheelchairFor = (mode: EdgeMode, l: (typeof links)[number]["properties"]): Tri => {
  if (mode === "stairs" || mode === "escalator") return false;
  if (mode === "elevator") return l.elevator === 3 || l.elevator === 5 ? true : l.elevator === 2 ? false : null;
  if (l.lev_diff === 5 || l.lev_diff === 4) return false;
  if ([5, 6, 7, 8].includes(l.vtcl_slope)) return false;
  if (l.width === 1) return false;
  if (l.lev_diff === 99 || l.vtcl_slope === 99 || l.width === 99) return null;
  return true;
};
const edges: Edge[] = links.map((l) => {
  const p = l.properties;
  const me = modeEvidence.get(p.link_id)!;
  const isGate = gateLinks.has(p.link_id);
  const mode: EdgeMode = isGate ? "gate" : me.mode;
  const ta = nodeToll.get(p.start_id);
  const tb = nodeToll.get(p.end_id);
  let paid: Tri = null;
  if (isGate) paid = true;
  else if (ta && tb && ta === tb) paid = ta === "paid";
  else if ((ta && !tb) || (!ta && tb)) paid = (ta ?? tb) === "paid";
  const geometry = l.geometry.coordinates.map(([lo, la]) => ({ ...enu(lo, la), z: null }));
  const wheelchair = wheelchairFor(me.mode, p);
  const tollMethods = [nodeTollMethod.get(p.start_id), nodeTollMethod.get(p.end_id)].filter(Boolean).join(" / ");
  return {
    id: `e:${p.link_id}`,
    from: `n:${p.start_id}`,
    to: `n:${p.end_id}`,
    direction: p.direction === 2 ? "forward" : "both",
    mode,
    lengthM: me.mode === "elevator" ? null : p.distance,
    geometry,
    paid,
    crossesFareBoundary: isGate ? true : paid === null ? null : false,
    wheelchair,
    steps: me.mode === "stairs" ? true : p.lev_diff === 5 || p.lev_diff === 4 ? true : p.lev_diff === 99 ? null : false,
    hours: null,
    closed: false,
    verification: "verified",
    geometryEvidence: ev(SRC_EVIDENCE, me.method, me.note),
    accessEvidence: ev(
      [SRC_NWD, SRC_MAP],
      `nwd-link-present(maint_date=${p.maint_date}); fare: ${isGate ? "gate: toll transition + F106 ≤8 m" : tollMethods || "unknown"}`,
      "Operating hours not published in this dataset (start_time/end_time absent) → UNKNOWN",
    ),
    attributes: {
      route_type: p.route_type,
      direction: p.direction,
      width: p.width,
      vtcl_slope: p.vtcl_slope,
      lev_diff: p.lev_diff,
      brail_tile: p.brail_tile,
      elevator: p.elevator,
      roof: p.roof,
      rank: p.rank,
      maint_date: p.maint_date,
      H_F: p.H_F,
    },
  };
});

// ---------------------------------------------------------------- POIs
const pois: Poi[] = [];
const centroid = (() => {
  const ps = nodes.map((n) => n.position);
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
})();
const compass = (p: { x: number; y: number }) => {
  const a = (Math.atan2(p.x - centroid.x, p.y - centroid.y) * 180) / Math.PI;
  const dirs = [
    ["北", "north"],
    ["北東", "northeast"],
    ["東", "east"],
    ["南東", "southeast"],
    ["南", "south"],
    ["南西", "southwest"],
    ["西", "west"],
    ["北西", "northwest"],
  ] as const;
  return dirs[(Math.round(((a + 360) % 360) / 45) % 8) as 0]!;
};
const vEv = (method: string, note?: string) => ev([SRC_NWD, SRC_MAP], method, note);
// ---- Exit display names (issue #106) -------------------------------------------------------
// The dataset has NO official exit numbers (gap:exit-numbers), so a display name is built only from
// descriptors that trace to a source field, and every word below is a description, never a number:
//  - level: the GSI map level of the F108 point (street / B1);
//  - compass side: the F108 point's bearing from the centroid of the mapped network nodes (computed
//    from coordinates; the ENU origin is itself at the south end of the network, so it would give
//    meaningless bearings for the three exits within 12 m of it);
//  - roof: E27 link attribute 屋根の有無 (1 = なし, 2 = あり, 99 = 不明), street-level exits only
//    (a roof says nothing about a B1 exit). The codes of ALL links within ROOF_RADIUS_M of the F108
//    point (any floor: the plan view is what a person standing there sees) are collected, plus every
//    link inside the stairs / elevator / escalator space the name cites. A roof word is said only
//    when all of them agree and none is 99; otherwise the roof word is omitted;
//  - adjacent GSI space category: the stairs / elevator / escalator / walkway space (GSI indoor spec
//    2019: B021 / B022 / B023 / B029) that contains the F108 point or touches it within 0.5 m. "Other
//    room" (B019) and other categories are not informative enough to name.
const ADJACENT_RADIUS_M = 0.5;
const ROOF_RADIUS_M = 1.5;
const SPACE_WORDS: Record<string, { ja: string; en: string; zh: string; kana: string; romaji: string }> = {
  B021: { ja: "階段", en: "stairs", zh: "樓梯", kana: "かいだん", romaji: "kaidan" },
  B022: { ja: "エレベーター", en: "elevator", zh: "電梯", kana: "えれべーたー", romaji: "erebeta" },
  B023: { ja: "エスカレーター", en: "escalator", zh: "手扶梯", kana: "えすかれーたー", romaji: "esukareta" },
  B029: { ja: "通路/コンコース", en: "walkway/concourse", zh: "通道", kana: "つうろ こんこーす", romaji: "tsuro konkosu" },
};
const COMPASS_WORDS: Record<string, { zh: string; kana: string; romaji: string }> = {
  北: { zh: "北", kana: "きた", romaji: "kita" },
  北東: { zh: "東北", kana: "ほくとう", romaji: "hokuto" },
  東: { zh: "東", kana: "ひがし", romaji: "higashi" },
  南東: { zh: "東南", kana: "なんとう", romaji: "nanto" },
  南: { zh: "南", kana: "みなみ", romaji: "minami" },
  南西: { zh: "西南", kana: "なんせい", romaji: "nansei" },
  西: { zh: "西", kana: "にし", romaji: "nishi" },
  北西: { zh: "西北", kana: "ほくせい", romaji: "hokusei" },
};
function distToRing(p: { x: number; y: number }, ring: { x: number; y: number }[]) {
  let m = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i]!, b = ring[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    m = Math.min(m, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return m;
}
/** GSI spaces (informative categories only) that contain or touch an exit's F108 point, in SPACE_WORDS order. */
function adjacentSpaces(x: ExitInfo) {
  const level = mapLevels.find((m) => m.label === x.level)!;
  const found = level.spaces.filter((sp) => sp.properties.category in SPACE_WORDS && (pointInPolygon(x.lonlat[0], x.lonlat[1], sp.geometry.coordinates) || sp.enu.some((ring) => distToRing(x.p, ring) <= ADJACENT_RADIUS_M)));
  const order = Object.keys(SPACE_WORDS);
  return found.sort((a, b) => order.indexOf(a.properties.category) - order.indexOf(b.properties.category));
}
const CONVEYANCE_SPACES = new Set(["B021", "B022", "B023"]);
/**
 * E27 roof codes around an exit: every link within ROOF_RADIUS_M of the F108 point, plus every link
 * (on a floor equivalent to the exit's map level) whose midpoint lies in a cited stairs / elevator /
 * escalator space. "roofed" / "open" only when all agree and none is 99 (不明); otherwise null.
 */
function exitRoof(x: ExitInfo, spaces: ReturnType<typeof adjacentSpaces>): { roof: "roofed" | "open" | null; codes: number[] } {
  const floorsHere = exitFloors(mapLevels.find((m) => m.label === x.level)!.ordinal);
  const codes = new Set<number>();
  for (const l of links) {
    const pts = l.geometry.coordinates.map(([lo, la]) => enu(lo, la));
    let near = false;
    for (let i = 0; i + 1 < pts.length && !near; i++) near = distToRing(x.p, [pts[i]!, pts[i + 1]!]) <= ROOF_RADIUS_M;
    if (!near) {
      const onFloor = [l.properties.start_id, l.properties.end_id].some((id) => floorsHere.includes(rawNodes.get(id)!.properties.floor));
      const [mx, my] = sampleAlong(l.geometry.coordinates, 0.5);
      near = onFloor && spaces.some((sp) => CONVEYANCE_SPACES.has(sp.properties.category) && pointInPolygon(mx, my, sp.geometry.coordinates));
    }
    if (near) codes.add(l.properties.roof);
  }
  const list = [...codes].sort((a, b) => a - b);
  const roof = list.length === 1 ? (list[0] === 2 ? "roofed" : list[0] === 1 ? "open" : null) : null;
  return { roof, codes: list };
}
const exitDescriptors = exits.map((x) => {
  if (x.level !== "1" && x.level !== "B1") throw new Error(`exit on map level ${x.level}: no level wording defined`);
  const street = x.level === "1";
  const [cja, cen] = compass(x.p);
  const adjacent = adjacentSpaces(x);
  const spaces = adjacent.map((sp) => sp.properties.category);
  const { roof, codes: roofCodes } = street ? exitRoof(x, adjacent) : { roof: null, codes: [] as number[] };
  const cw = COMPASS_WORDS[cja]!;
  const sw = spaces.map((c) => SPACE_WORDS[c]!);
  const parts = {
    ja: [street ? "地上" : "地下1階", `${cja}側`, ...(sw.length ? [`${sw.map((w) => w.ja).join("と")}に隣接`] : []), ...(roof ? [roof === "roofed" ? "屋根あり" : "屋根なし"] : [])],
    en: [street ? "street level" : "underground level B1", `${cen} side`, ...(sw.length ? [`next to ${sw.map((w) => w.en).join(" and ")}`] : []), ...(roof ? [roof === "roofed" ? "roofed" : "no roof"] : [])],
  };
  // Readings of the same descriptors. The romaji level word goes last: "chijo" has a "j", and any
  // later "r" in the string would let a "JR" query match this exit through the ranker's fuzzy subsequence rule.
  const kana = ["でぐち", street ? "ちじょう" : "ちかいっかい", `${cw.kana}がわ`, ...sw.map((w) => w.kana), ...(roof ? [roof === "roofed" ? "やねあり" : "やねなし"] : [])].join(" ");
  const romaji = ["deguchi", `${cw.romaji}-gawa`, ...sw.map((w) => w.romaji), ...(roof ? [roof === "roofed" ? "yane ari" : "yane nashi"] : []), street ? "chijo" : "chika ikkai"].join(" ");
  const en = ["exit", street ? "street level" : "underground level B1", cen, ...sw.map((w) => w.en), ...(roof ? [roof === "roofed" ? "roofed" : "no roof"] : [])].join(" ");
  const zh = ["出口", street ? "地面" : "地下1樓", `${cw.zh}側`, ...sw.map((w) => w.zh), ...(roof ? [roof === "roofed" ? "有屋頂" : "無屋頂"] : [])].join(" ");
  return { parts, kana, romaji, en, zh, roof, roofCodes, spaces };
});
for (const lang of ["ja", "en"] as const) {
  const names = exitDescriptors.map((d) => d.parts[lang].join("・"));
  if (new Set(names).size !== names.length) throw new Error(`exit display names are not unique in ${lang}: ${names.join(" | ")}`);
}
exits.forEach((x, i) => {
  const n = rawNodes.get(x.nodeId)!;
  const d = exitDescriptors[i]!;
  pois.push({
    id: `poi:exit:${i + 1}`,
    category: "exit",
    names: [
      { lang: "ja", text: `出口（${d.parts.ja.join("・")}）` },
      { lang: "en", text: `Exit (${d.parts.en.join(", ")})` },
    ],
    aliases: [
      { lang: "ja-Hrkt", text: "でぐち" },
      { lang: "ja-Latn", text: "deguchi" },
      { lang: "en", text: "exit" },
      { lang: "zh-Hant", text: "出口" },
      { lang: "ja-Hrkt", text: d.kana },
      { lang: "ja-Latn", text: d.romaji },
      { lang: "en", text: d.en },
      { lang: "zh-Hant", text: d.zh },
    ],
    floorId: floorId(n.properties.floor),
    displayPosition: { ...x.p, z: null },
    connectorNodeIds: [`n:${x.nodeId}`],
    paid: nodeToll.get(x.nodeId) === "paid" ? true : nodeToll.get(x.nodeId) === "free" ? false : null,
    evidence: vEv(
      `GSI facility F108 on map level ${x.level} → nearest NWD node on an equivalent floor (${x.d.toFixed(1)} m); name words: level of the F108 map level, compass side from the F108 point vs the node centroid, ` +
        `adjacent GSI space ${d.spaces.length ? d.spaces.join("+") : "none"} (contains or touches the F108 point within ${ADJACENT_RADIUS_M} m), ` +
        `E27 屋根の有無 roof: ${x.level === "1" ? (d.roof ?? `not stated (codes ${d.roofCodes.join("/")} within ${ROOF_RADIUS_M} m and in the cited stairs/lift/escalator space are mixed or unknown)`) : "not stated (below street level)"} (all links within ${ROOF_RADIUS_M} m of the F108 point, plus links in the cited stairs/lift/escalator space)`,
      "Exit number/name not in source (coverage gap); the words in the name are descriptors, not official exit numbers",
    ),
  });
});
// Ticket gates: cluster gate links by GSI gate points.
const gateClusters: { p: { x: number; y: number }; level: string; links: string[] }[] = [];
for (const id of gateLinks) {
  const l = links.find((x) => x.properties.link_id === id)!;
  const a = enu(...rawNodes.get(l.properties.start_id)!.geometry.coordinates);
  const c = gateClusters.find((g) => Math.hypot(g.p.x - a.x, g.p.y - a.y) < 30);
  const lvl = rawNodes.get(l.properties.start_id)!.properties.floor === -1 ? "B1" : "B2";
  if (c) c.links.push(id);
  else gateClusters.push({ p: a, level: lvl, links: [id] });
}
gateClusters.forEach((g, i) => {
  const [ja, en] = compass(g.p);
  // Each F106 point on this level is counted once, for the nearest gate cluster on the same level.
  const f106Near = allFacilities.filter((f) => {
    if (f.f.properties.category !== "F106" || f.level.label !== g.level) return false;
    const nearest = gateClusters.filter((c) => c.level === g.level).reduce((best, c) => (Math.hypot(f.p.x - c.p.x, f.p.y - c.p.y) < Math.hypot(f.p.x - best.p.x, f.p.y - best.p.y) ? c : best));
    return nearest === g;
  }).length;
  const nodeIds = [...new Set(g.links.flatMap((id) => { const l = links.find((x) => x.properties.link_id === id)!; return [l.properties.start_id, l.properties.end_id]; }))];
  const freeSide = nodeIds.filter((id) => nodeToll.get(id) === "free").map((id) => `n:${id}`);
  pois.push({
    id: `poi:gate:${i + 1}`,
    category: "ticket_gate",
    names: [
      { lang: "ja", text: `改札（${g.level === "B1" ? "地下1階" : "地下2階"}・${ja}側）` },
      { lang: "en", text: `Ticket gates (${g.level}, ${en} side)` },
    ],
    aliases: [
      { lang: "ja-Hrkt", text: "かいさつ" },
      { lang: "ja-Latn", text: "kaisatsu" },
      { lang: "en", text: "gate" },
      { lang: "zh-Hant", text: "剪票口" },
    ],
    floorId: floorId(g.level === "B1" ? -1 : -2),
    displayPosition: { ...g.p, z: null },
    connectorNodeIds: freeSide,
    paid: false,
    notes: [
      { lang: "ja", text: "位置は地図上の改札の位置から求めた目安です。" },
      { lang: "en", text: "Position is approximate, taken from the mapped ticket gates." },
    ],
    evidence: vEv(`toll transition links clustered (≤30 m) + GSI F106 ≤8 m; ${g.links.length} gate link(s); F106 points nearest this cluster on this level: ${f106Near}`),
  });
});
// Platform
const platformNodes = nodes.filter((n) => n.kind === "platform").map((n) => n.id);
pois.push({
  id: "poi:platform:oedo",
  category: "platform",
  // Station-name anchor (issue #106). The names reuse the station record's own wording (station.names:
  // 新宿駅（都営大江戸線） / Shinjuku Station (Toei Oedo Line) / 新宿站（都營大江戶線); code E27), so
  // searching 新宿 / Shinjuku lands on the Toei Oedo Line station. Other operators' names are added separately as search-only POIs from S03 (#411), appended at the end of the array.
  names: [
    { lang: "ja", text: "新宿駅（都営大江戸線）ホーム" },
    { lang: "en", text: "Toei Oedo Line platform (Shinjuku Station, E27)" },
  ],
  aliases: [
    { lang: "ja-Hrkt", text: "おおえどせん ほーむ" },
    { lang: "ja-Latn", text: "oedo sen platform" },
    { lang: "en", text: "E27" },
    { lang: "zh-Hant", text: "大江戶線 月台" },
    { lang: "ja", text: "都庁前・光が丘方面" },
    { lang: "ja", text: "六本木・両国方面" },
    { lang: "ja", text: "新宿" },
    { lang: "ja", text: "新宿駅" },
    { lang: "ja", text: "都営大江戸線" },
    { lang: "ja", text: "大江戸線" },
    { lang: "ja", text: "大江戸線 ホーム" },
    { lang: "ja-Hrkt", text: "しんじゅく" },
    { lang: "ja-Hrkt", text: "しんじゅくえき" },
    { lang: "ja-Hrkt", text: "とえいおおえどせん" },
    { lang: "ja-Hrkt", text: "おおえどせん" },
    { lang: "ja-Latn", text: "shinjuku" },
    { lang: "ja-Latn", text: "shinjuku eki" },
    { lang: "ja-Latn", text: "toei oedo sen" },
    { lang: "ja-Latn", text: "oedo sen" },
    { lang: "en", text: "Shinjuku" },
    { lang: "en", text: "Shinjuku Station" },
    { lang: "en", text: "Toei Oedo Line" },
    { lang: "en", text: "Oedo Line" },
    { lang: "en", text: "Oedo" },
    { lang: "en", text: "Oedo Line platform" },
    { lang: "zh-Hant", text: "新宿" },
    { lang: "zh-Hant", text: "新宿站" },
    { lang: "zh-Hant", text: "都營大江戶線" },
    { lang: "zh-Hant", text: "大江戶線" },
  ],
  floorId: floorId(-6),
  displayPosition: null,
  connectorNodeIds: platformNodes,
  paid: true,
  notes: [
    { lang: "ja", text: "都営大江戸線 新宿駅（E27）のデータです。JR・京王・小田急・東京メトロ丸ノ内線の改札とホームは、東京都都市整備局の2020年3月時点の資料にある名前を検索用に収録しています。改札と乗換の一部には同資料の形状から求めたおおよその位置（検索表示のみ、経路案内には不使用）を付けていますが、経路はありません。都営新宿線などその他の路線は収録していません。" },
    { lang: "en", text: "Data for the Toei Oedo Line station (E27). Ticket gates and platforms of JR, Keio, Odakyu and the Tokyo Metro Marunouchi Line are listed by name, for search, from Tokyo Metropolitan Government data as of March 2020; some gates and transfers also carry an approximate position derived from that data's shapes (search display only, not for routing). There is no route for them. The Toei Shinjuku Line and other lines are not modelled." },
  ],
  evidence: vEv("NWD floor=-6 nodes inside GSI paid (toll=2) walkway on 地下6階", "Track/direction assignment per platform side not in source → not shown"),
});
// Elevators: group elevator links into shafts by xy proximity.
const elevLinks = links.filter((l) => modeEvidence.get(l.properties.link_id)!.mode === "elevator");
const shafts: { p: { x: number; y: number }; nodeIds: Set<string> }[] = [];
for (const l of elevLinks) {
  for (const id of [l.properties.start_id, l.properties.end_id]) {
    const p = enu(...rawNodes.get(id)!.geometry.coordinates);
    const s = shafts.find((s) => Math.hypot(s.p.x - p.x, s.p.y - p.y) < 4);
    if (s) s.nodeIds.add(id);
    else shafts.push({ p, nodeIds: new Set([id]) });
  }
}
// Merge shafts that share a link (car link connects two floors at ~same xy).
// Cross-check against the GSI lift points (F012, "エレベーターの範囲の代表点"): a shaft and a point agree when
// they lie within 4 m in plan; the GSI map levels of a shaft's points are compared with the E27 floors it serves.
const liftPoints = allFacilities.filter((f) => f.f.properties.category === "F012");
const mapOrdinalOfFloor = (f: number) => (f === 0 ? 1 : f);
const liftCrossCheck: { poi: string; e27Floors: number[]; gsiLevels: number[]; missingInGsi: number[]; missingInE27: number[] }[] = [];
const claimedLifts = new Set<(typeof liftPoints)[number]>();
shafts.forEach((s, i) => {
  const fl = [...new Set([...s.nodeIds].map((id) => rawNodes.get(id)!.properties.floor))].sort((a, b) => b - a);
  const label = fl.map((f) => (f > 0 ? `${f}F` : f === 0 ? "地上" : `B${Math.abs(f)}`)).join("・");
  const near = liftPoints.filter((f) => Math.hypot(f.p.x - s.p.x, f.p.y - s.p.y) <= 4);
  near.forEach((f) => claimedLifts.add(f));
  const e27Floors = [...new Set(fl.map(mapOrdinalOfFloor))].sort((a, b) => b - a);
  const gsiLevels = [...new Set(near.map((f) => f.level.ordinal))].sort((a, b) => b - a);
  const missingInGsi = e27Floors.filter((o) => !gsiLevels.includes(o));
  const missingInE27 = gsiLevels.filter((o) => !e27Floors.includes(o));
  const lvl = (o: number) => (o > 0 ? "1F" : `B${Math.abs(o)}`);
  const agree = missingInGsi.length === 0 && missingInE27.length === 0 && near.length > 0;
  const jaCheck = agree
    ? `GSI構内地図のエレベーター代表点（F012）と照合済み：E27の停止階（${e27Floors.map(lvl).join("・")}）と一致します。`
    : `GSI構内地図のエレベーター代表点（F012）と照合：E27の停止階（${e27Floors.map(lvl).join("・")}）に対し、F012は${gsiLevels.length ? gsiLevels.map(lvl).join("・") : "なし"}。${missingInGsi.length ? `${missingInGsi.map(lvl).join("・")}にはF012がありません（不一致）。` : ""}${missingInE27.length ? `${missingInE27.map(lvl).join("・")}のF012にE27の停止がありません（不一致）。` : ""}`;
  const enCheck = agree
    ? `Cross-checked against the GSI station-map lift points (F012): they agree with the E27 stops (${e27Floors.map(lvl).join(", ")}).`
    : `Cross-check against the GSI station-map lift points (F012): E27 stops at ${e27Floors.map(lvl).join(", ")}; F012 points on ${gsiLevels.length ? gsiLevels.map(lvl).join(", ") : "no level"}. ${missingInGsi.length ? `No F012 point on ${missingInGsi.map(lvl).join(", ")} (mismatch). ` : ""}${missingInE27.length ? `F012 on ${missingInE27.map(lvl).join(", ")} has no E27 stop (mismatch).` : ""}`.trim();
  const jaNote = `停止階：${e27Floors.map(lvl).join("・")}${missingInGsi.length ? `（${missingInGsi.map(lvl).join("・")}の停止は構内地図で確認できません）` : ""}${missingInE27.length ? `（${missingInE27.map(lvl).join("・")}は構内地図にありますが、歩行ネットワークに停止がありません）` : ""}。`;
  const enNote = `Stops: ${e27Floors.map(lvl).join(", ")}${missingInGsi.length ? ` (the ${missingInGsi.map(lvl).join(", ")} stop is not confirmed by the station map)` : ""}${missingInE27.length ? ` (the station map shows the lift on ${missingInE27.map(lvl).join(", ")}, but the walking network has no stop there)` : ""}.`;
  liftCrossCheck.push({ poi: `poi:elevator:${i + 1}`, e27Floors, gsiLevels, missingInGsi, missingInE27 });
  pois.push({
    id: `poi:elevator:${i + 1}`,
    category: "elevator",
    names: [
      { lang: "ja", text: `エレベーター（${label}）` },
      { lang: "en", text: `Elevator (${label})` },
    ],
    aliases: [
      { lang: "ja-Hrkt", text: "えれべーたー" },
      { lang: "ja-Latn", text: "erebeta" },
      { lang: "en", text: "lift" },
      { lang: "zh-Hant", text: "電梯" },
    ],
    floorId: null,
    displayPosition: { ...s.p, z: null },
    connectorNodeIds: [...s.nodeIds].map((id) => `n:${id}`),
    paid: null,
    notes: [
      {
        lang: "ja",
        text: jaNote,
      },
      {
        lang: "en",
        text: enNote,
      },
    ],
    evidence: vEv(`NWD route_type=4 links (elevator code 5: wheelchair + visually-impaired accessible) grouped ≤4 m; cross-checked against GSI F012 within 4 m; ${jaCheck} / ${enCheck}`),
  });
});
const unmatchedLifts = liftPoints.filter((f) => !claimedLifts.has(f)).map((f) => `${f.level.label} ${f.p.x},${f.p.y}`);
if (unmatchedLifts.length) anomalies.push(`GSI lift point(s) with no E27 lift shaft within 4 m: ${unmatchedLifts.join("; ")}`);
// Toilets (GSI F001–F003) — connector = nearest node on same map level & same fare side as most nearby space.
const TOILET: Record<string, [string, string]> = { F001: ["トイレ（男性）", "Toilet (men)"], F002: ["トイレ（女性）", "Toilet (women)"], F003: ["トイレ（男女共用）", "Toilet (unisex)"] };
let ti = 0;
for (const { level, f, p } of allFacilities) {
  const t = TOILET[f.properties.category];
  if (!t) continue;
  const best = nearestNode(p, (n) => n.properties.floor === level.ordinal);
  if (!best || best.d > 20) {
    anomalies.push(`toilet ${f.properties.id} has no same-floor node within 20 m`);
    continue;
  }
  pois.push({
    id: `poi:toilet:${++ti}`,
    category: "toilet",
    names: [
      { lang: "ja", text: `${t[0]}（${level.label === "1" ? "1階" : `地下${level.label.slice(1)}階`}）` },
      { lang: "en", text: `${t[1]} (${level.label})` },
    ],
    aliases: [
      { lang: "ja-Hrkt", text: "といれ" },
      { lang: "ja", text: "お手洗い" },
      { lang: "ja-Latn", text: "toire" },
      { lang: "en", text: "restroom" },
      { lang: "en", text: "wc" },
      { lang: "zh-Hant", text: "廁所" },
    ],
    floorId: floorId(level.ordinal),
    displayPosition: { ...p, z: null },
    connectorNodeIds: [`n:${best.id}`],
    paid: nodeToll.get(best.id) === "paid" ? true : nodeToll.get(best.id) === "free" ? false : null,
    notes: [
      { lang: "ja", text: "位置はトイレ空間の代表点で、出入口の位置ではありません。" },
      { lang: "en", text: "Position is a representative point of the toilet space, not the door." },
    ],
    evidence: vEv(`GSI facility ${f.properties.category} → nearest same-floor NWD node (${best.d.toFixed(1)} m); GSI ${f.properties.category} space representative point`, "Connector is the nearest walkway node, not a surveyed doorway"),
  });
}

// ---------------------------------------------------------------- sources, coverage
const sha = raw.sha256;
const sources: Source[] = [
  {
    id: SRC_NWD,
    title: "歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）［GeoJSON形式］",
    publisher: "国土交通省（ほこナビDP）",
    url: "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45",
    downloadUrls: ["https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/d4519a9a-917a-4de8-9104-83e21246c04c/download/nwd_oedo_shinjuku_geojson.zip"],
    license: E27_LICENSE,
    rights: "PUBLISHED_UNDER_OWNER_OVERRIDE",
    override: E27_OVERRIDE,
    attribution: "「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成",
    modified: true,
    retrievedAt: ACQUIRED_AT,
    sha256: { "nwd_oedo_shinjuku_geojson.zip": sha["nwd_oedo_shinjuku_geojson.zip"]! },
    datasetDate: "2026-09-17",
    validUntil: null,
    notes: `${PERIOD_NOTE} Links maint_date 2025-09-19. Spec: 歩行空間ネットワークデータ整備仕様 (MLIT 2024-07), layer-1 attributes only.`,
  },
  {
    id: SRC_MAP,
    title: "構内地図データ（都営地下鉄大江戸線 新宿駅）［GeoJSON形式］",
    publisher: "国土交通省（ほこナビDP）",
    url: "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45",
    downloadUrls: ["https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip"],
    license: E27_LICENSE,
    rights: "PUBLISHED_UNDER_OWNER_OVERRIDE",
    override: E27_OVERRIDE,
    attribution: "「構内地図データ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成",
    modified: true,
    retrievedAt: ACQUIRED_AT,
    sha256: { "stationmap_oedo_shinjuku_geojson.zip": sha["stationmap_oedo_shinjuku_geojson.zip"]! },
    datasetDate: "2026-09-17",
    validUntil: null,
    notes: `${PERIOD_NOTE} 階層別屋内地理空間情報データ仕様書（GSI 2019-03）; source=2 (CAD data).`,
  },
];

// Render-only street context (stage 2): PLATEAU bldg/tran around the exits, imported by
// tools/import-surface.ts into data/surface.json. Cited here so the rights trail of everything the
// app ships stays in the station record (it adds no nodes, edges, POIs or coverage).
{
  const m = JSON.parse(readFileSync(join(HERE, "../sources/surface-manifest.json"), "utf8")) as {
    dataset: string; datasetUrl: string; license: string; licenseUrl: string; year: number;
    files: { path: string; url: string; sha256: string; kind: string; acquiredAt: string }[];
  };
  const data = m.files.filter((f) => f.kind === "bldg" || f.kind === "tran");
  sources.push({
    id: "plateau-13104-shinjuku-ku-2025",
    title: `${m.dataset} — bldg / tran CityGML（E27 出口周辺 4 メッシュ）`,
    publisher: "国土交通省 Project PLATEAU",
    url: m.datasetUrl,
    downloadUrls: data.map((f) => f.url),
    // Catalogue licence (PLATEAU Site Policy §3). The CC BY 4.0 clause inside the data metadata is unconfirmed evidence, not shown (#161).
    license: { name: m.license, url: m.licenseUrl },
    rights: "REUSABLE_WITH_CONDITIONS",
    usage: "data",
    attribution: SURFACE_CREDIT,
    modified: true,
    retrievedAt: data.map((f) => f.acquiredAt).sort().at(-1)!,
    sha256: Object.fromEntries(data.map((f) => [f.path, f.sha256])),
    datasetDate: null,
    validUntil: null,
    notes: "Render-only street context in data/surface.json: LOD1 building footprints/heights and road polygons, simplified; terrain flattened to the symbolic street level. Not used for routing; no datum registration to the underground floors is asserted.",
  });
}

const areas: CoverageArea[] = mapLevels.flatMap((ml) => {
  const nwdOrd = ml.ordinal === -5 ? -4.5 : ml.ordinal;
  return raw.levels
    .find((l) => l.label === ml.label)!
    .floors.map((f, i) => ({
      id: `cov:${ml.label}:${i}`,
      floorId: floorById.has(floorId(nwdOrd)) ? floorId(nwdOrd) : null,
      status: "routable" as const,
      label: [
        { lang: "ja", text: `都営大江戸線 新宿駅 ${f.properties.name}（公開データ範囲）` },
        { lang: "en", text: `Toei Oedo Line Shinjuku ${ml.label} (published data extent)` },
      ],
      polygon: f.geometry.coordinates[0]!.map(([lo, la]) => enu(lo, la)),
      sourceIds: [SRC_NWD, SRC_MAP],
    }));
});
const gaps: CoverageGap[] = [
  { id: "gap:transfers", floorId: null, zone: [{ lang: "en", text: "Connections to JR, Keio/Keio New Line, Odakyu, Toei Shinjuku Line (S01), Tokyo Metro (M08), Shinjuku-nishiguchi (E01)" }, { lang: "ja", text: "JR・京王線／京王新線・小田急線・都営新宿線（S01）・東京メトロ（M08）・新宿西口（E01）への接続" }], missingFact: [{ lang: "en", text: "Verified public passages beyond the E27 dataset boundary; operator-specific floor labels" }, { lang: "ja", text: "E27 のデータ範囲の外にある、一般の人が通れる通路について確認された情報と、事業者ごとの階数表記" }], approximateExtent: [{ lang: "en", text: "north/east edges of the dataset" }, { lang: "ja", text: "データ範囲の北側・東側の端" }], sourceDate: null, fieldWorkNeeded: [{ lang: "en", text: "Obtain open network data per operator (e.g. MLIT 新宿 R2 indoor map rights check) or permitted survey of each boundary" }, { lang: "ja", text: "事業者ごとの公開ネットワークデータを入手する（例: MLIT 新宿 R2 屋内地図の権利確認）、または各境界の許可を得た現地調査" }] },
  { id: "gap:heights", floorId: null, zone: [{ lang: "en", text: "All levels" }, { lang: "ja", text: "全階層" }], missingFact: [{ lang: "en", text: "Measured floor elevations (source has no z)" }, { lang: "ja", text: "実測の階の高さ（元データに z 座標がない）" }], sourceDate: "2025-09-19", fieldWorkNeeded: [{ lang: "en", text: "Permitted survey or a licensed BIM/CityGML source covering E27; current heights are SYMBOLIC estimates from run lengths and generic 2.3 m overhead-clearance constraints, never measured" }, { lang: "ja", text: "許可を得た現地測量、または E27 を対象とする利用許諾のある BIM/CityGML データ。現在の高さは、通路の長さと一般的な頭上の有効高さ 2.3 m という制約から求めた推定値で、実測したものではない。" }] },
  { id: "gap:exit-numbers", floorId: null, zone: [{ lang: "en", text: "Exits" }, { lang: "ja", text: "出口" }], missingFact: [{ lang: "en", text: "Official exit numbers/names (A1, 3, 4 …) are not in the dataset" }, { lang: "ja", text: "正式な出口番号・名称（A1、3、4 など）はデータセットに含まれていない" }], sourceDate: null, fieldWorkNeeded: [{ lang: "en", text: "Operator confirmation or field check; OSM labels used only as flagged cross-check" }, { lang: "ja", text: "事業者による確認または現地確認。OSM のラベルは照合の参考にのみ使い、その旨を明示する" }] },
  { id: "gap:hours", floorId: null, zone: [{ lang: "en", text: "All links" }, { lang: "ja", text: "すべての経路" }], missingFact: [{ lang: "en", text: "Operating hours (start_time/end_time) not published" }, { lang: "ja", text: "出口・通路ごとの利用できる時間（開始・終了時刻）は公開されていない" }], sourceDate: null, fieldWorkNeeded: [{ lang: "en", text: "Operator hours per exit/passage" }, { lang: "ja", text: "事業者による、出口・通路ごとの利用できる時間" }] },
  { id: "gap:escalator-direction", floorId: null, zone: [{ lang: "en", text: "Escalators" }, { lang: "ja", text: "エスカレーター" }], missingFact: [{ lang: "en", text: "Escalator directions are a 2025-09 snapshot; time-of-day reversals unknown" }, { lang: "ja", text: "エスカレーターの運転方向（上り・下り）は 2025 年 9 月時点の情報で、時間帯によって切り替わるかどうかは不明" }], sourceDate: "2025-09-19", fieldWorkNeeded: [{ lang: "en", text: "Field check at peak/off-peak" }, { lang: "ja", text: "ピーク時と閑散時の現地確認" }] },
  { id: "gap:platform-sides", floorId: floorId(-6), zone: [{ lang: "en", text: "Platform (地下6階)" }, { lang: "ja", text: "ホーム（地下6階）" }], missingFact: [{ lang: "en", text: "Which side serves which direction (都庁前 / 両国・六本木)" }, { lang: "ja", text: "どちら側のホームがどの方面か（都庁前 / 両国・六本木）" }], sourceDate: null, fieldWorkNeeded: [{ lang: "en", text: "Field check or licensed operator data" }, { lang: "ja", text: "現地確認、またはライセンスのある事業者データ" }] },
  { id: "gap:reuse-after-publication", floorId: null, zone: [{ lang: "en", text: "All E27-derived data (graph, geometry, POIs)" }, { lang: "ja", text: "E27 由来の全データ（経路網、形状、施設情報）" }], missingFact: [{ lang: "en", text: `Provider confirmation that GTEki's derived Web 3D data may still be reused/distributed (incl. commercially) after the publication period ends ${PUBLICATION_PERIOD_END}. The licence basis for the E27 resources is unconfirmed (published under the Owner's override at #16; PDL 1.0 is not treated as covering them, #39 Q11 = No).` }, { lang: "ja", text: `公開提供期限（${PUBLICATION_PERIOD_END}）の経過後も GTEki の派生 Web 3D データを再利用・配布（商用を含む）してよいかは、提供者の確認待ち。E27 資料のライセンス根拠は未確認で、オーナー判断により公開している。PDL 1.0 の対象とはみなしていない。` }], sourceDate: "2026-09-17", fieldWorkNeeded: [{ lang: "en", text: "Written answer from MLIT ほこナビDP窓口; E27 itself ships under the Owner's #16 override; any other public release relying on it stays HOLD until confirmed" }, { lang: "ja", text: "MLIT ほこナビDP窓口からの書面での回答。E27 自体はオーナー判断により公開している。確認が取れるまで、これに依拠する他の公開は保留。" }] },
  { id: "gap:closures", floorId: null, zone: [{ lang: "en", text: "Construction areas around 新宿駅西口・南口" }, { lang: "ja", text: "新宿駅西口・南口周辺の工事区域" }], missingFact: [{ lang: "en", text: "Current closures (e.g. OSM notes exit 2 closed since 2024-03-30 for building demolition — outside E27 data)" }, { lang: "ja", text: "現在の通行止め（例: OSM のメモによると出口 2 は 2024-03-30 から建物解体のため閉鎖、E27 データの範囲外）" }], sourceDate: null, fieldWorkNeeded: [{ lang: "en", text: "Operator notices + field check before any real-world guidance" }, { lang: "ja", text: "実際の案内を出す前に、事業者からの告知の確認と現地確認" }] },
];
// ---------------------------------------------------------------- S03 search-only line POIs (#411)
// Contract: docs/research/lines/shinjuku-line-pois-contract.md. Names only: no position, floor, connector or paid value.
// These are other operators' names from tokyo-s03-zip (facts only). They are routable nowhere (connectorNodeIds []).
type S03Source = {
  id: string; title: string; publisher: string; url: string; license: string; rights: string; attribution: string;
  modified: boolean; changeNotice: string; retrievedAt: string; datasetDate: string; sha256: string; usage: string;
};
type S03Poi = {
  id: string; category: string; names: LocalizedText[]; aliases: LocalizedText[]; floorId: string | null;
  displayPosition: Poi["displayPosition"]; connectorNodeIds: string[]; paid: Poi["paid"]; evidence: EvidenceRef;
  notes: LocalizedText[]; operatorIds?: string[]; line?: string; s03?: unknown;
};
const S03_SOURCE_ID = "tokyo-s03-zip";
// The research file's own change notice and usage describe that file, which still carries names only. The
// shipped station data also carries the approximate points (#463), so its notice is stated here (NOTICE 4.7).
const S03_STATION_CHANGE_NOTICE = "GTEki が名称を抽出し検索用に再構成。改札・乗換の一部に形状から求めたおおよその代表点を付加（経路案内には不使用）";
const S03_STATION_USAGE = "plain names; approximate representative points derived from the source shapes for some gates and transfers (CRS UNKNOWN; not for routing)";
/** The contract's §2 categories; anything else (an exit, a toilet) is not a line name and is refused. */
const S03_CATEGORIES = new Set<string>(["ticket_gate", "transfer", "platform"]);
const s03 = JSON.parse(readFileSync(join(HERE, "../../../docs/research/lines/shinjuku-line-pois.json"), "utf8")) as { sources: S03Source[]; pois: S03Poi[] };
if (s03.sources.length !== 1 || s03.sources[0]!.id !== S03_SOURCE_ID) throw new Error(`S03 import: expected exactly one source ${S03_SOURCE_ID}`);
const s03Src = s03.sources[0]!;

// #463: approximate representative points for some S03 gates and transfers. GIS derived one point per pointed
// POI from the source shapes (contract: docs/gis/s03/positions-import-contract.md); the committed derived input
// carries no name, entity id, level or coordinate reference. These points are search display only: no connector,
// no displayPosition, floor UNVERIFIED, NOT_FOR_ROUTING.
type S03ApproxEntry = { poiId: string; east: number; north: number; uncertaintyM: number; method: string; labels: Record<string, string> };
const S03_APPROX_LABELS: Record<string, string> = {
  position: "approximate (±max(5 m, polygon radius))",
  navigation_use: "NOT_FOR_ROUTING",
  gteki_role: "context",
  floor: "UNVERIFIED",
};
const S03_APPROX_METHODS = new Set(["area_weighted_centroid", "largest_part_closest_point"]);
const s03Approx = JSON.parse(readFileSync(join(HERE, "../sources/s03-approx-positions.json"), "utf8")) as {
  contract: string; sourceId: string; inputDigest: string; positions: S03ApproxEntry[];
};
if (s03Approx.contract !== "docs/gis/s03/positions-import-contract.md") throw new Error(`S03 positions: unexpected contract ${s03Approx.contract}`);
if (s03Approx.sourceId !== S03_SOURCE_ID) throw new Error(`S03 positions: expected source ${S03_SOURCE_ID}, got ${s03Approx.sourceId}`);
const s03PoiById = new Map<string, S03Poi>();
for (const raw of s03.pois) {
  if (s03PoiById.has(raw.id)) throw new Error(`S03 import: ${raw.id} appears twice in the line-POI file`);
  s03PoiById.set(raw.id, raw);
}
const s03ApproxById = new Map<string, S03ApproxEntry>();
const approxLabelKeys = Object.keys(S03_APPROX_LABELS).sort();
for (const entry of s03Approx.positions) {
  if (s03ApproxById.has(entry.poiId)) throw new Error(`S03 positions: ${entry.poiId} appears twice in the positions file`);
  if (entry.poiId === "poi:keio-gate:1") throw new Error("S03 positions: poi:keio-gate:1 is unpointed (SOURCE_DEFECT_HOLE_OUTSIDE_SHELL)");
  const linePoi = s03PoiById.get(entry.poiId);
  if (!linePoi) throw new Error(`S03 positions: ${entry.poiId} is not an S03 line POI`);
  if (linePoi.category !== "ticket_gate" && linePoi.category !== "transfer") throw new Error(`S03 positions: ${entry.poiId} is a ${linePoi.category}; only gates and transfers get a point`);
  const entryKeys = Object.keys(entry.labels).sort();
  if (entryKeys.length !== approxLabelKeys.length || entryKeys.some((k, i) => k !== approxLabelKeys[i]) || approxLabelKeys.some((k) => entry.labels[k] !== S03_APPROX_LABELS[k]))
    throw new Error(`S03 positions: ${entry.poiId} labels differ from the contract`);
  if (!Number.isFinite(entry.east) || !Number.isFinite(entry.north)) throw new Error(`S03 positions: ${entry.poiId} has a non-finite coordinate`);
  if (typeof entry.uncertaintyM !== "number" || !Number.isFinite(entry.uncertaintyM) || entry.uncertaintyM < 5)
    throw new Error(`S03 positions: ${entry.poiId} has uncertainty ${entry.uncertaintyM}; the contract's label is max(5 m, radius)`);
  if (!S03_APPROX_METHODS.has(entry.method)) throw new Error(`S03 positions: ${entry.poiId} has unknown method ${entry.method}`);
  s03ApproxById.set(entry.poiId, entry);
}
sources.push({
  id: S03_SOURCE_ID,
  title: s03Src.title,
  publisher: s03Src.publisher,
  url: s03Src.url,
  // Stated at dataset level only (Owner Q2; REUSE LicenseRef-S03), so the shown name says so.
  license: {
    name: [
      { lang: "ja", text: `${s03Src.license}（データセット単位の表示）` },
      { lang: "en", text: `${s03Src.license} (stated at dataset level)` },
    ],
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  rights: s03Src.rights as Source["rights"],
  // Not `usage: "facts-only"`: that tells the app the source has no licence, and S03 is CC BY 4.0. Its plain names
  // ship under that licence with the credit and change notice (Owner Q2/Q3, #39 comment of 2026-10-22 JST).
  decision: { url: "https://github.com/nurockplayer/gteki/issues/39#issuecomment-6324726321", date: "2026-10-22" },
  attribution: s03Src.attribution,
  modified: s03Src.modified,
  retrievedAt: s03Src.retrievedAt,
  datasetDate: s03Src.datasetDate,
  notes: `${S03_STATION_CHANGE_NOTICE}. Approximate representative points (area-weighted centroids, or the closest boundary point of the largest part) derived by GTEki for ${s03Approx.positions.length} gates and transfers; search display only, NOT_FOR_ROUTING, floor UNVERIFIED (#463). ZIP sha256 ${s03Src.sha256}. ${S03_STATION_USAGE}. Licence claimed at dataset level by catalogue t000008d0000000037; shipped under LicenseRef-S03 (Owner Q2).`,
});
const usedApprox = new Set<string>();
for (const raw of s03.pois) {
  if (raw.floorId !== null || raw.displayPosition !== null || raw.paid !== null) throw new Error(`S03 import: ${raw.id} carries a floor, position or paid value`);
  if (raw.connectorNodeIds.length > 0) throw new Error(`S03 import: ${raw.id} has connectorNodeIds`);
  if (raw.evidence.sourceIds.length !== 1 || raw.evidence.sourceIds[0] !== S03_SOURCE_ID) throw new Error(`S03 import: ${raw.id} must cite exactly ${S03_SOURCE_ID}`);
  if (!S03_CATEGORIES.has(raw.category)) throw new Error(`S03 import: ${raw.id} has category ${raw.category}`);
  if (raw.aliases.length > 0 || raw.names.length !== 1 || raw.names[0]!.lang !== "ja" || !raw.names[0]!.text) throw new Error(`S03 import: ${raw.id} must carry exactly one ja name and no aliases`);
  if (pois.some((p) => p.id === raw.id)) throw new Error(`S03 import: duplicate id ${raw.id}`);
  const approx = s03ApproxById.get(raw.id);
  if (approx) usedApprox.add(approx.poiId);
  pois.push({
    id: raw.id,
    category: raw.category as "ticket_gate" | "transfer" | "platform",
    names: raw.names,
    aliases: raw.aliases,
    floorId: raw.floorId,
    displayPosition: raw.displayPosition,
    // #463: search display only, never routing (the schema keeps this key right after displayPosition).
    ...(approx
      ? {
          approximatePosition: {
            east: approx.east,
            north: approx.north,
            uncertaintyM: approx.uncertaintyM,
            method: approx.method,
            navigationUse: "NOT_FOR_ROUTING" as const,
            floor: "UNVERIFIED" as const,
          },
        }
      : {}),
    connectorNodeIds: raw.connectorNodeIds,
    paid: raw.paid,
    evidence: raw.evidence,
    notes: raw.notes,
  });
}
if (usedApprox.size !== s03ApproxById.size) throw new Error(`S03 positions: ${s03ApproxById.size - usedApprox.size} entries do not match an appended POI`);

// ---------------------------------------------------------------- merchant shops (#214)
// Facts-only transcription already on main: docs/research/merchants/shinjuku-merchants-batch1.json (Toei +
// Tokyo Metro, #418), batch2 (LUMINE EST, LUMINE, NEWoMan) and shinjuku-odakyu-dept.json (the department store
// itself). Contracts: docs/research/merchants/shinjuku-import-contract.md and shinjuku-batch2-contract.md.
// Every shop is search-only: the sources give no position or entrance, so floorId, displayPosition, paid stay
// null and connectorNodeIds stays empty. Brand lists are not POIs (#419); see gteki/tenants.json.
// shinjuku-dept-stores.json (director, 2026-10-25) adds one store-level POI per printed building: LUMINE 1,
// LUMINE 2, LUMINE EST, NEWoMan and the three 新宿マルイ buildings. It cites the LUMINE floor-guide sources the
// batch files already registered, so it declares only its own Marui source; the check below catches a typo.
type MerchantFile = { sources: Source[]; pois: Poi[] };
const MERCHANT_POI_FILES = ["shinjuku-merchants-batch1.json", "shinjuku-merchants-batch2.json", "shinjuku-odakyu-dept.json", "shinjuku-dept-stores.json"];
// A file may cite sources another file registered only when the pair is listed here, so a POI cannot
// borrow an unrelated merchant source and pass the check below. The store POIs reuse the LUMINE /
// NEWoMan floor-guide sources that batch2 already declares.
const MERCHANT_CROSS_FILE_SOURCES: Record<string, readonly string[]> = {
  "shinjuku-dept-stores.json": ["lumine-shinjuku-floorguide-2026-10", "lumine-est-shinjuku-floorguide-2026-10", "newoman-shinjuku-floorguide-2026-10"],
};
const MERCHANT_SOURCE_IDS = new Set<string>();
for (const file of MERCHANT_POI_FILES) {
  const m = JSON.parse(readFileSync(join(HERE, "../../../docs/research/merchants", file), "utf8")) as MerchantFile;
  for (const src of m.sources) {
    MERCHANT_SOURCE_IDS.add(src.id);
    // The research hand-off writes `usage: null` for a reusable source; the schema's absent value means the same.
    const { usage, ...rest } = src;
    sources.push(usage == null ? (rest as Source) : { ...rest, usage });
  }
  const own = new Set(m.sources.map((s) => s.id));
  const allowed = new Set([...own, ...(MERCHANT_CROSS_FILE_SOURCES[file] ?? [])]);
  for (const poi of m.pois) {
    for (const id of poi.evidence.sourceIds)
      if (!allowed.has(id)) throw new Error(`merchant import: ${poi.id} (${file}) cites ${id}, which this file does not declare`);
    if (poi.evidence.sourceIds.length === 0) throw new Error(`merchant import: ${poi.id} cites no source`);
    if (poi.connectorNodeIds.length > 0) throw new Error(`merchant import: ${poi.id} (${file}) has connectorNodeIds; a store connector comes only from a field receipt (docs/research/field/receipts)`);
    pois.push(poi);
  }
}

// ---------------------------------------------------------------- printed shop hours (OD-32)
// Transcription: docs/research/merchants/shinjuku-hours-batch1.json. Each row is the hours line an official
// page printed for one shop (matched by poiId) or for a whole building (poiId null → station.json
// buildingHours). Text stays as printed; nothing is parsed into open/closed state. Rows for shops that are
// not shipped yet (the recovery batch) have no POI here and are skipped.
type HoursEntry = {
  poiId: string | null;
  building?: string;
  url: string;
  retrievedAt: string;
  pageDate: string | null;
  status: "OK" | "UNKNOWN";
  hoursText?: string;
  basis?: HoursText["basis"];
  note?: string;
};
const hoursResearch = JSON.parse(readFileSync(join(HERE, "../../../docs/research/merchants/shinjuku-hours-batch1.json"), "utf8")) as { entries: HoursEntry[] };
const hoursOf = (e: HoursEntry): HoursText => ({
  ...(e.status === "OK" ? { text: e.hoursText! } : {}),
  sourceUrl: e.url,
  retrievedAt: e.retrievedAt.slice(0, 10),
  // A page date alone does not date the hours (OD-32): shop-sjk-odakyudept's 2025-01-15 is a parking notice,
  // and PUPA's pageDate is the day the page was read. Only an explicit research `basis` makes a row dated.
  basis: e.basis ?? "undated-official",
  status: e.status,
});
const poiById = new Map(pois.map((p) => [p.id, p]));
const buildingHours: BuildingHours[] = [];
for (const e of hoursResearch.entries) {
  if (e.poiId === null) {
    buildingHours.push({
      ...hoursOf(e),
      building: [{ lang: "ja", text: e.building! }],
      floorRange: null,
      ...(e.note ? { note: [{ lang: "ja", text: e.note }] } : {}),
    });
    continue;
  }
  const poi = poiById.get(e.poiId);
  if (poi) poi.hours = hoursOf(e);
}

// ---------------------------------------------------------------- WP4 line POIs (#501 gap table)
// Research: docs/research/lines/shinjuku-line-pois-wp4.json (PR #421), transcribed from the Tokyo Metro
// Shinjuku (M08) station/accessibility/print pages and the Toei Shinjuku station page. Search-only: the
// sources print these exits, lifts and escalators by name only, so floorId, displayPosition and paid stay
// null and connectorNodeIds stays empty. The Toei page prints one station-level exit list that does not say
// whether an exit serves the Shinjuku Line (S01) or the Oedo Line (E27), so no line is assigned.
// Held, not imported: poi:tokyometro-gate:3 / :4, which may duplicate the shipped S03 pair :1 / :2; their
// identity waits for the WP10 field check (gap-table-2026-10-25-poi-ids.md).
type Wp4Poi = Poi & { operatorId: string; line: string | null };
const WP4_FILE = "shinjuku-line-pois-wp4.json";
const WP4_HELD = new Set(["poi:tokyometro-gate:3", "poi:tokyometro-gate:4"]);
const WP4_CATEGORIES = new Set<string>(["exit", "elevator", "escalator"]);
const wp4 = JSON.parse(readFileSync(join(HERE, "../../../docs/research/lines", WP4_FILE), "utf8")) as { sources: Source[]; pois: Wp4Poi[] };
const WP4_SOURCE_IDS = new Set(wp4.sources.map((s) => s.id));
const wp4Imported = wp4.pois.filter((p) => !WP4_HELD.has(p.id));
if (wp4.pois.length - wp4Imported.length !== WP4_HELD.size) throw new Error(`WP4 import: expected ${WP4_HELD.size} held gates, found ${wp4.pois.length - wp4Imported.length}`);
for (const src of wp4.sources) sources.push(src);
for (const raw of wp4Imported) {
  if (raw.floorId !== null || raw.displayPosition !== null || raw.paid !== null) throw new Error(`WP4 import: ${raw.id} carries a floor, position or paid value`);
  if (raw.connectorNodeIds.length > 0) throw new Error(`WP4 import: ${raw.id} has connectorNodeIds`);
  if (raw.evidence.sourceIds.length === 0 || raw.evidence.sourceIds.some((id) => !WP4_SOURCE_IDS.has(id))) throw new Error(`WP4 import: ${raw.id} cites a source outside the WP4 file`);
  if (!WP4_CATEGORIES.has(raw.category)) throw new Error(`WP4 import: ${raw.id} has category ${raw.category}`);
  if (raw.names.length < 1 || raw.names.length > 2 || raw.names[0]!.lang !== "ja" || !raw.names[0]!.text || (raw.names.length === 2 && (raw.names[1]!.lang !== "en" || !raw.names[1]!.text))) throw new Error(`WP4 import: ${raw.id} must carry ja and optionally en`);
  if (raw.names.length === 2 && !raw.evidence.sourceIds.some((id) => id.includes("-en-") && WP4_SOURCE_IDS.has(id))) throw new Error(`WP4 import: ${raw.id} English name requires a declared English source`);
  if (raw.aliases.some((a) => !raw.names[0]!.text.startsWith(a.text))) throw new Error(`WP4 import: ${raw.id} has an alias not printed in its name`);
  if (pois.some((p) => p.id === raw.id)) throw new Error(`WP4 import: duplicate id ${raw.id}`);
  pois.push({
    id: raw.id,
    category: raw.category as "exit" | "elevator" | "escalator",
    names: raw.names,
    aliases: raw.aliases,
    floorId: null,
    displayPosition: null,
    connectorNodeIds: [],
    paid: null,
    evidence: raw.evidence,
    notes: raw.notes,
  });
}

// ---------------------------------------------------------------- line-code and English line-name aliases
// Gap (ds-core findings, 10-25): searching a station-numbering code (M08) or an operator's printed English
// line name ("Marunouchi Line") found nothing, because the line POIs carried no code or romaji alias.
// Tokyo Metro's English Shinjuku page prints both; it is registered here as a facts-only source (decision #26)
// and was read through the Wayback snapshot noted on the source record, since the live host answers 403 to a
// plain fetch from this environment (recorded as a GAP in its notes). Only lines our data already states get an
// alias: the 34 WP4 Metro POIs (line "marunouchi") and the two S03 Metro gates, whose printed name starts
// 丸の内線. Toei's nine station exits carry no line (the page does not split S01 from E27), so they get none.
// JR East, Keio and Odakyu pages are corroboration only (OD-34), so their codes and English line names stay
// GAPs; so does any Toei code or English name, because the Toei page cannot be read here.
const LINE_ALIAS_SOURCE = "tokyometro-shinjuku-station-en-2026-10";
sources.push({
  id: LINE_ALIAS_SOURCE,
  title: "Shinjuku Station/M08 | Route/Station Information | Tokyo Metro Line",
  publisher: "東京地下鉄",
  url: "https://www.tokyometro.jp/lang_en/station/shinjuku/index.html",
  license: null,
  rights: "REFERENCE_ONLY",
  usage: "facts-only",
  decision: { url: "https://github.com/nurockplayer/gteki/issues/26#issuecomment-6302797404", date: "2026-10-21" },
  attribution: "東京メトロ 新宿駅 (English station page) (facts only; not reproduced)",
  modified: false,
  retrievedAt: "2026-10-25T21:45:00+09:00",
  datasetDate: null,
  notes: "ライセンスなし・事実のみ参照（複製なし）。駅名・英語路線名・駅番号のみ採用: Marunouchi Line と M08（ページ表記）。ライブのホストは他の東京メトロページと同じくこの環境から 403 を返すため、Wayback の 2026-04-15 スナップショット (http://web.archive.org/web/20260415001230/https://www.tokyometro.jp/lang_en/station/shinjuku/index.html) で読んだ。403 は GAP として記録。",
});
const LINE_ALIASES: Record<string, { code: string; en: string }> = { marunouchi: { code: "M08", en: "Marunouchi Line" } };
const s03MetroGateIds = ["poi:tokyometro-gate:1", "poi:tokyometro-gate:2"];
const marunouchiIds = [...wp4Imported.filter((p) => p.line === "marunouchi").map((p) => p.id), ...s03MetroGateIds];
if (marunouchiIds.length !== 36) throw new Error(`line aliases: expected 36 Marunouchi POIs, found ${marunouchiIds.length}`);
for (const id of marunouchiIds) {
  const poi = pois.find((p) => p.id === id);
  if (!poi) throw new Error(`line aliases: ${id} is not a POI`);
  const alias = LINE_ALIASES.marunouchi!;
  poi.aliases.push({ lang: "en", text: alias.code }, { lang: "en", text: alias.en });
  poi.evidence = { ...poi.evidence, sourceIds: [...poi.evidence.sourceIds, LINE_ALIAS_SOURCE], checkedDate: "2026-10-25" };
}
// The two S03 gates state their line only in the printed name; fail if that ever stops matching.
for (const id of s03MetroGateIds) {
  const poi = pois.find((p) => p.id === id)!;
  if (!poi.names[0]!.text.startsWith("丸の内線")) throw new Error(`line aliases: ${id} no longer names 丸の内線`);
}

const coverage = {
  summary: [
    { lang: "ja", text: "都営大江戸線 新宿駅（E27）の公開歩行空間ネットワーク／構内地図の範囲のみ。他社線の改札・ホームは2020年3月時点の資料から名前を収録し、改札と乗換の一部に同資料の形状から求めたおおよその位置を付加（検索表示のみ、±5 m 以上、経路案内には不使用）。他社の出口・エレベーター・エスカレーターは各事業者の公開ページから名前のみ収録（検索のみ）。乗換通路は未収録。高さは推定値（実測ではない）。" },
    { lang: "en", text: "Only the published Toei Oedo Line Shinjuku (E27) indoor network and floor-plan extent. Other operators' gates and platforms are listed by name from March 2020 data, with approximate positions for some gates and transfers derived from the same shapes (search display only, ±5 m or more, not for routing). Other operators' exits, lifts and escalators are listed by name only from their own published pages (search only). Transfer passages are not included. Heights are estimates, not measurements." },
  ],
  areas,
  gaps,
  freshness: "2025-09-19",
};

// Suggested free-walk starts (user-chosen; no indoor positioning is claimed):
// first ticket-gate cluster, then platform, then a street exit. Only routable POIs qualify: the search-only
// S03 POIs (#411) have no connector and sort before the E27 ids in some categories.
const spawnNodeIds = (["ticket_gate", "platform", "exit"] as const).flatMap((cat) => {
  const poi = pois.filter((p) => p.category === cat && p.connectorNodeIds.length > 0).sort((a, b) => a.id.localeCompare(b.id))[0];
  return poi?.connectorNodeIds[0] ? [poi.connectorNodeIds[0]] : [];
});

// Walk-entry headings (degrees, 0 = north, clockwise; docs/core/contract.md), measured by the visual lead
// against the #348 identity boards. Only the default spawn (B1 gate 1) has one: 70 faces the 「新宿」 spawn board
// 3.25 m away, front side, clear line of sight (#342 Q2: the old default faced away from it). The platform spawn
// needs none (its walk-entry heading already frames the #348 platform board) and the street spawn waits for a re-measure.
const SPAWN_HEADING_BY_NODE: Record<string, number> = { "n:fe13251e6885410b870179837c3832cf": 70 };
const spawnHeadings = Object.fromEntries(spawnNodeIds.flatMap((id) => (id in SPAWN_HEADING_BY_NODE ? [[id, SPAWN_HEADING_BY_NODE[id]!]] : [])));

// Non-code data the web bundle inlines (#186). Declared here so station.json carries the same
// source and rights gate as assets; each derivation names the script that writes the file.
const dataFiles: DataFile[] = [
  {
    id: "plan",
    path: "data/plan.json",
    sourceIds: [SRC_NWD, SRC_MAP].sort(),
    modified: true,
    derivation: "tools/import-e27.ts: render-only plan from the 構内地図 polygons (level outlines, spaces and their restricted/toll flags, facilities) and the NWD node positions behind nodeRenderZ; heights are symbolic estimates from stair/escalator run lengths, not measurements. It is not routing truth.",
  },
  {
    id: "surface",
    path: "data/surface.json",
    sourceIds: [SRC_NWD, "plateau-13104-shinjuku-ku-2025"].sort(),
    modified: true,
    derivation: "tools/import-surface.ts: LOD1 building footprints/heights and road polygons from the PLATEAU bldg/tran CityGML around the E27 exits, simplified and flattened to the symbolic street level; gteki/graph.json only supplies the street-level exit node positions that bound the selection radius. Render-only context, not routing.",
  },
  {
    id: "surface-baked",
    path: "data/surface-baked.json",
    sourceIds: [...new Set([SRC_NWD, SRC_MAP, "plateau-13104-shinjuku-ku-2025"])].sort(),
    modified: true,
    derivation: "tools/bake-surface.ts (bake:surface): generated street-layer polygon derivations (streets, paving, kerbs, lamp rails, building footprints, pad/canopy walls, columns) for exactly this surface.json + bundle + plan, used only when inputKey matches, otherwise the same functions run at load; render-only, not routing.",
  },
  {
    id: "fare-restricted",
    path: "scene/fare-restricted.generated.json",
    sourceIds: [SRC_NWD, SRC_MAP].sort(),
    modified: true,
    derivation: "test/helpers/generate-restricted-fences.ts: fare/access containment geometry recomputed from the bundle's verified edges (gteki/graph.json) and the restricted spaces/ 構内地図 polygons in data/plan.json; it never supplies or alters routing edges.",
  },
];

// ---------------------------------------------------------------- assets (Lane E kit, Issue #94 batch 2)
// The station's own built escalator dressing: one mobile-profile bundle with the ten catalog pieces, loaded by the
// scene's kit swap on by default (scene/kit/load.ts). Original GTEki art; the pins below are the exact shipped bytes.
const SRC_CATALOG = "gteki-sjk-catalog-0-1-0";
const KIT_BUNDLE = "assets/kit/mobile.glb";
const KIT_MANIFEST = "assets/kit/mobile.manifest.json";
const kitSha = Object.fromEntries([KIT_BUNDLE, KIT_MANIFEST].map((f) => [f, createHash("sha256").update(readFileSync(join(OUT_GTEKI, f))).digest("hex")]));
sources.push({
  id: SRC_CATALOG,
  title: "GTEki Shinjuku station catalog 0.1.0 (Lane E, Golden Slice batch 2): ten escalator dressings, each with balustrade, handrail, newel and comb",
  publisher: "GTEki contributors",
  url: "https://github.com/nurockplayer/gteki/tree/main/stations/shinjuku/kit",
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  rights: "REUSABLE_WITH_CONDITIONS",
  attribution: "GTEki contributors, CC BY 4.0. Procedural Blender kit pieces built from the station catalog (stations/shinjuku/kit/catalog.json) and bundled unmodified into gteki/assets/kit/mobile.glb. Sizes are the symbolic dimensions the drawn plan suggests (data/plan.json, declared separately), not a survey of the station.",
  modified: false,
  // The build date, not a fetch: the bundle is our own output. Pinned so regenerating changes the record.
  retrievedAt: "2026-10-28T00:00:00+09:00",
  datasetDate: "2026-10",
  sha256: kitSha,
  notes: "Visual only: every piece has gteki_role null, so nothing here is walkable, a collider or route evidence; collision, walkable floors and camera blockers stay the station's own layout geometry (test/kit-bundle.test.ts checks the lists are unchanged). Mobile profile only (one bundle, KTX2 not decoded by the explorer yet). Rebuild: tools/blender build.sh (mobile profile) then python3 tools/blender/bundle_kit.py bundle --library <output> --all --out stations/shinjuku/gteki/assets/kit/mobile.glb; the sidecar manifest is that build's manifest.json with its catalog pointer made repo-relative.",
});
const nodeFloor = new Map(nodes.map((n) => [n.id, n.floorId]));
const kitFloorIds = floors.map((f) => f.id).filter((id) => edges.some((e) => e.mode === "escalator" && (nodeFloor.get(e.from) === id || nodeFloor.get(e.to) === id)));
const assets: Asset[] = [{
  id: "kit-mobile",
  uri: KIT_BUNDLE,
  format: "glb",
  floorIds: kitFloorIds,
  role: "visual",
  sourceIds: [SRC_CATALOG],
  files: [KIT_MANIFEST],
  derivation: "tools/blender build + bundle_kit.py bundle (mobile profile) from stations/shinjuku/kit/catalog.json: ten escalator dressings (balustrade, handrail, newel, comb; AO baked), one self-contained GLB with shared textures. Loaded by the scene's kit swap (scene/kit/load.ts), not by the asset loader: visual only, never walkable, never a collider, never route evidence. The manifest beside it is what scene/kit/manifest.ts reads.",
}];

const bundle: StationBundle = {
  schema: SCHEMA_VERSION,
  station: {
    id: "shinjuku",
    identity: { names: [
      { lang: "ja", text: "新宿" },
      { lang: "ja-Hrkt", text: "しんじゅく" },
      { lang: "en", text: "Shinjuku" },
    ] },
    names: [
      { lang: "ja", text: "新宿駅（都営大江戸線）" },
      { lang: "en", text: "Shinjuku Station (Toei Oedo Line)" },
      { lang: "zh-Hant", text: "新宿站（都營大江戶線）" },
    ],
    codes: [{ operatorId: OP, code: "E27" }],
    operators: [{ id: OP, names: [{ lang: "ja", text: "東京都交通局" }, { lang: "en", text: "Toei (Tokyo Metropolitan Bureau of Transportation)" }] }],
    origin: { ...ORIGIN, hM: null, datum: "JGD2011", crs: "EPSG:6668" },
    frame: "ENU",
    datasetVersion: `e27-nwd@2026-09-17+map@2026-09-17/import@${CHECKED}`,
    generatedAt: CHECKED,
    synthetic: false,
  },
  sources,
  floors,
  nodes,
  edges,
  pois,
  coverage,
  spawnNodeIds,
  spawnHeadings,
  assets,
  dataFiles,
  buildingHours,
};

// ---------------------------------------------------------------- field receipts (#533, #554)
// CLOSED team_field observations add a store or gate connector; nothing else may (see the merchant guard above).
const fieldApplied = applyFieldReceipts(pois, sources, new Set(nodes.map((n) => n.id)), loadReceipts(join(HERE, "../../../docs/research/field/receipts"), "shinjuku"));
if (fieldApplied.length) console.log(`field receipts: applied #533 items ${fieldApplied.join(", ")}`);

// ---------------------------------------------------------------- plan (render geometry)
const plan = {
  note: "Render-only geometry derived from 構内地図データ（都営地下鉄大江戸線 新宿駅）（国土交通省）, published under the Owner's #16 override; licence basis unconfirmed. Not routing truth. Heights are symbolic.",
  // S03 (#411), the merchant sources (#214), the WP4 line sources (#501) and the kit catalog (nothing in the plan)
  // supply POIs or art only, nothing in the plan, so their credit is not listed here.
  attribution: sources.filter((s) => s.id !== S03_SOURCE_ID && s.id !== LINE_ALIAS_SOURCE && s.id !== SRC_CATALOG && !MERCHANT_SOURCE_IDS.has(s.id) && !WP4_SOURCE_IDS.has(s.id)).map((s) => s.attribution),
  levels: mapLevels.map((ml) => {
    const nwdOrd = ml.ordinal === -5 ? -4.5 : ml.ordinal;
    return {
      label: ml.label,
      ordinal: ml.ordinal,
      floorId: floorId(nwdOrd),
      renderElevationM: round(H.get(nwdOrd)!, 2),
      outline: raw.levels.find((l) => l.label === ml.label)!.floors.map((f) => f.geometry.coordinates.map((ring) => ring.map(([lo, la]) => enu(lo, la)))),
      spaces: ml.spaces.map((s) => ({
        id: normId(s.properties.id),
        category: s.properties.category,
        restricted: s.properties.restricted === "1",
        toll: tollOf(s.properties.toll),
        rings: s.enu,
      })),
      facilities: allFacilities.filter((f) => f.level.label === ml.label).map((f) => ({ id: normId(f.f.properties.id), category: f.f.properties.category, ...f.p })),
    };
  }),
  // Render heights for every node (chain-interpolated on stairs/escalators), keyed by bundle node id.
  nodeRenderZ: Object.fromEntries(raw.nodes.map((n) => [`n:${n.properties.node_id}`, round(nodeZ.get(n.properties.node_id)!, 2)])),
  heightModel: { escalatorDegrees: 30, escalatorFlatM: ESC_FLAT, stairRiseRatio: STAIR_RATIO, constraints: constraints.length, overheadClearanceM: 2.3, overheadConstraints: clearanceConstraints.length, displayHeightAdjusted, landingSpread },
};

// ---------------------------------------------------------------- report & write
const issues = validateBundle(bundle);
const errors = issues.filter((i) => i.level === "error");
const report = {
  nodes: nodes.length,
  edges: edges.length,
  pois: pois.length,
  floors: floors.map((f) => `${f.id}: ${f.renderElevationM} m`),
  modes: edges.reduce<Record<string, number>>((m, e) => ((m[e.mode] = (m[e.mode] ?? 0) + 1), m), {}),
  paid: edges.reduce<Record<string, number>>((m, e) => ((m[String(e.paid)] = (m[String(e.paid)] ?? 0) + 1), m), {}),
  gates: gateLinks.size,
  gateClusters: gateClusters.length,
  exits: exits.length,
  exitNameBasis: { compass: "bearing of the F108 point from the centroid of the mapped NWD nodes (not the ENU origin)", compassCentroidEnu: { x: round(centroid.x, 2), y: round(centroid.y, 2) }, adjacentSpaceRadiusM: ADJACENT_RADIUS_M, roofRadiusM: ROOF_RADIUS_M },
  liftCrossCheck,
  anomalies,
  validation: { errors: errors.length, warnings: issues.length - errors.length, sample: issues.slice(0, 5) },
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_GTEKI, { recursive: true });
const write = (name: string, data: unknown, dir = OUT) => {
  const path = join(dir, name);
  const text = JSON.stringify(data) + "\n";
  if (process.argv.includes("--check")) {
    let old = "";
    try {
      old = readFileSync(path, "utf8");
    } catch {}
    if (old !== text) {
      console.error(`${name} is out of date`);
      process.exit(1);
    }
  } else writeFileSync(path, text);
};
const { nodes: _n, edges: _e, pois: _p, ...manifest } = bundle;
write("station.json", manifest, OUT_GTEKI);
write("graph.json", { schema: SCHEMA_VERSION, stationId: bundle.station.id, nodes, edges }, OUT_GTEKI);
write("pois.json", { schema: SCHEMA_VERSION, stationId: bundle.station.id, pois }, OUT_GTEKI);
write("plan.json", plan);
write("import-report.json", report);
