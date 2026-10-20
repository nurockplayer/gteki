/**
 * Build the shared-contract station files stations/shinjuku/gteki/{station,graph,pois}.json
 * and the render-only plan stations/shinjuku/data/plan.json from the raw MLIT/Toei E27 dataset.
 *
 *   pnpm --filter @gteki/station-shinjuku import:e27            # writes files
 *   pnpm --filter @gteki/station-shinjuku import:e27 --check    # fails if outputs would change
 *
 * Every derived fact records its method. Findings that shape the derivation
 * (verified against the dataset itself, see docs/G0-evidence.md):
 *  - route_type 5/6 are swapped relative to the 2024 spec text in this dataset:
 *    rt6 links lie in GSI escalator spaces (B023), rt5 links in stair spaces (B021).
 *    Mode is therefore taken from the containing CAD space category.
 *  - No link-level fare attribute (tfc_restr) is published; paid/unpaid comes from
 *    the GSI space attribute `toll` (2 = paid, 3 = free, 1 = unknown) by spatial join,
 *    propagated along non-gate links, and validated so that the only paid↔free
 *    transitions are links next to published ticket-gate points (F106).
 *  - No elevations are published. Render heights are SYMBOLIC estimates from
 *    escalator/stair run lengths (30° escalators, stair rise ratio 0.5) — never measured.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EnuFrame } from "@gteki/geo";
import {
  SCHEMA_VERSION,
  validateBundle,
  type CoverageArea,
  type CoverageGap,
  type Edge,
  type EdgeMode,
  type EvidenceRef,
  type Floor,
  type Node,
  type Poi,
  type Source,
  type StationBundle,
  type Tri,
} from "@gteki/schema";
import { loadRawE27, normId, pointInPolygon, RAW_DIR, type GeoFeature, type PolyG, type RawSpaceP } from "./e27-raw.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../data");
const OUT_GTEKI = join(HERE, "../gteki");
const CHECKED = "2026-10-20";
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
// Enforce monotonic order with ≥2.2 m clearance between distinct non-intermediate levels.
const sortedOrd = [...floorOrdinals].sort((a, b) => b - a);
for (let i = 1; i < sortedOrd.length; i++) {
  const above = H.get(sortedOrd[i - 1]!)!;
  const o = sortedOrd[i]!;
  const minGap = pinned.has(o) && pinned.has(sortedOrd[i - 1]!) ? 0 : 1.2;
  if (H.get(o)! > above - minGap) H.set(o, above - minGap);
}

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
const floorById = new Map(floors.map((f) => [f.id, f]));

// ---------------------------------------------------------------- node render heights (chains interpolate)
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
  level: string;
  d: number;
}
const exits: ExitInfo[] = [];
for (const { level, f, p } of allFacilities) {
  if (f.properties.category !== "F108") continue;
  const best = nearestNode(p, () => true);
  if (best && best.d <= 6) {
    exits.push({ nodeId: best.id, p, level: level.label, d: best.d });
    nodeKind.set(best.id, "exit");
  } else anomalies.push(`exit point on ${level.label} has no node within 6 m`);
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
exits.forEach((x, i) => {
  const [ja, en] = compass(x.p);
  const n = rawNodes.get(x.nodeId)!;
  pois.push({
    id: `poi:exit:${i + 1}`,
    category: "exit",
    names: [
      { lang: "ja", text: `出口（${x.level === "1" ? "地上" : "地下1階"}・${ja}側）` },
      { lang: "en", text: `Exit (${x.level === "1" ? "street level" : "B1"}, ${en} side)` },
    ],
    aliases: [
      { lang: "ja-Hrkt", text: "でぐち" },
      { lang: "ja-Latn", text: "deguchi" },
      { lang: "en", text: "exit" },
    ],
    floorId: floorId(n.properties.floor),
    displayPosition: { ...x.p, z: null },
    connectorNodeIds: [`n:${x.nodeId}`],
    paid: nodeToll.get(x.nodeId) === "paid" ? true : nodeToll.get(x.nodeId) === "free" ? false : null,
    evidence: vEv(`GSI facility F108 → nearest NWD node (${x.d.toFixed(1)} m)`, "Exit number not in source; see exit-labels.osm.json for community cross-check"),
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
    evidence: vEv("toll transition links clustered (≤30 m) + GSI F106 ≤8 m"),
  });
});
// Platform
const platformNodes = nodes.filter((n) => n.kind === "platform").map((n) => n.id);
pois.push({
  id: "poi:platform:oedo",
  category: "platform",
  names: [
    { lang: "ja", text: "大江戸線 ホーム" },
    { lang: "en", text: "Oedo Line platform" },
  ],
  aliases: [
    { lang: "ja-Hrkt", text: "おおえどせん ほーむ" },
    { lang: "ja-Latn", text: "oedo sen platform" },
    { lang: "en", text: "E27" },
    { lang: "zh-Hant", text: "大江戶線 月台" },
    { lang: "ja", text: "都庁前・光が丘方面" },
    { lang: "ja", text: "六本木・両国方面" },
  ],
  floorId: floorId(-6),
  displayPosition: null,
  connectorNodeIds: platformNodes,
  paid: true,
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
shafts.forEach((s, i) => {
  const fl = [...new Set([...s.nodeIds].map((id) => rawNodes.get(id)!.properties.floor))].sort((a, b) => b - a);
  const label = fl.map((f) => (f > 0 ? `${f}F` : f === 0 ? "地上" : `B${Math.abs(f)}`)).join("・");
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
    evidence: vEv("NWD route_type=4 links (elevator code 5: wheelchair + visually-impaired accessible) grouped ≤4 m"),
  });
});
// Toilets (GSI F001–F003) — connector = nearest node on same map level & same fare side as most nearby space.
const TOILET: Record<string, [string, string]> = { F001: ["トイレ（男性）", "Toilet (men)"], F002: ["トイレ（女性）", "Toilet (women)"], F003: ["多機能トイレ／男女共用", "Toilet (all-gender)"] };
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
    evidence: vEv(`GSI facility ${f.properties.category} → nearest same-floor NWD node (${best.d.toFixed(1)} m)`, "Connector is the nearest walkway node, not a surveyed doorway"),
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
    license: { name: "公共データ利用規約（第1.0版）PDL 1.0", url: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0" },
    rights: "REUSABLE_WITH_CONDITIONS",
    attribution: "「歩行空間ネットワークデータ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成",
    modified: true,
    retrievedAt: readFileSync(join(RAW_DIR, "acquired_at.txt"), "utf8").trim(),
    sha256: { "nwd_oedo_shinjuku_geojson.zip": sha["nwd_oedo_shinjuku_geojson.zip"]! },
    datasetDate: "2026-09-17",
    validUntil: "2027-03-12",
    notes: "Limited publication for 公共交通オープンデータチャレンジ2026 (until 2027-03-12). Links maint_date 2025-09-19. Spec: 歩行空間ネットワークデータ整備仕様 (MLIT 2024-07), layer-1 attributes only.",
  },
  {
    id: SRC_MAP,
    title: "構内地図データ（都営地下鉄大江戸線 新宿駅）［GeoJSON形式］",
    publisher: "国土交通省（ほこナビDP）",
    url: "https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45",
    downloadUrls: ["https://ckan.hokonavi.go.jp/dataset/2d8ff84b-f110-41ad-b5e5-7b8ec9c6cb45/resource/9c5ecc7b-a6e4-4d92-978c-9b66ca642172/download/stationmap_oedo_shinjuku_geojson.zip"],
    license: { name: "公共データ利用規約（第1.0版）PDL 1.0", url: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0" },
    rights: "REUSABLE_WITH_CONDITIONS",
    attribution: "「構内地図データ（都営地下鉄大江戸線 新宿駅）」（国土交通省）を加工して作成",
    modified: true,
    retrievedAt: readFileSync(join(RAW_DIR, "acquired_at.txt"), "utf8").trim(),
    sha256: { "stationmap_oedo_shinjuku_geojson.zip": sha["stationmap_oedo_shinjuku_geojson.zip"]! },
    datasetDate: "2026-09-17",
    validUntil: "2027-03-12",
    notes: "階層別屋内地理空間情報データ仕様書（GSI 2019-03）; source=2 (CAD data).",
  },
];

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
  { id: "gap:transfers", floorId: null, zone: "Connections to JR, Keio/Keio New Line, Odakyu, Toei Shinjuku Line (S01), Tokyo Metro (M08), Shinjuku-nishiguchi (E01)", missingFact: "Verified public passages beyond the E27 dataset boundary; operator-specific floor labels", approximateExtent: "north/east edges of the dataset", sourceDate: null, fieldWorkNeeded: "Obtain open network data per operator (e.g. MLIT 新宿 R2 indoor map rights check) or permitted survey of each boundary" },
  { id: "gap:heights", floorId: null, zone: "All levels", missingFact: "Measured floor elevations (source has no z)", sourceDate: "2025-09-19", fieldWorkNeeded: "Permitted survey or a licensed BIM/CityGML source covering E27; current heights are symbolic estimates from escalator run lengths" },
  { id: "gap:exit-numbers", floorId: null, zone: "Exits", missingFact: "Official exit numbers/names (A1, 3, 4 …) are not in the dataset", sourceDate: null, fieldWorkNeeded: "Operator confirmation or field check; OSM labels used only as flagged cross-check" },
  { id: "gap:hours", floorId: null, zone: "All links", missingFact: "Operating hours (start_time/end_time) not published", sourceDate: null, fieldWorkNeeded: "Operator hours per exit/passage" },
  { id: "gap:escalator-direction", floorId: null, zone: "Escalators", missingFact: "Escalator directions are a 2025-09 snapshot; time-of-day reversals unknown", sourceDate: "2025-09-19", fieldWorkNeeded: "Field check at peak/off-peak" },
  { id: "gap:platform-sides", floorId: floorId(-6), zone: "Platform (地下6階)", missingFact: "Which side serves which direction (都庁前 / 両国・六本木)", sourceDate: null, fieldWorkNeeded: "Field check or licensed operator data" },
  { id: "gap:closures", floorId: null, zone: "Construction areas around 新宿駅西口・南口", missingFact: "Current closures (e.g. OSM notes exit 2 closed since 2024-03-30 for building demolition — outside E27 data)", sourceDate: null, fieldWorkNeeded: "Operator notices + field check before any real-world guidance" },
];
const coverage = {
  summary: [
    { lang: "ja", text: "都営大江戸線 新宿駅（E27）の公開歩行空間ネットワーク／構内地図の範囲のみ。他社線・乗換通路は未収録。高さは推定値（実測ではない）。" },
    { lang: "en", text: "Only the published Toei Oedo Line Shinjuku (E27) indoor network and floor-plan extent. Other operators and transfer passages are not included. Heights are estimates, not measurements." },
  ],
  areas,
  gaps,
  freshness: "2025-09-19",
};

// Suggested free-walk starts (user-chosen; no indoor positioning is claimed):
// first ticket-gate cluster, then platform, then a street exit.
const spawnNodeIds = (["ticket_gate", "platform", "exit"] as const).flatMap((cat) => {
  const poi = pois.filter((p) => p.category === cat).sort((a, b) => a.id.localeCompare(b.id))[0];
  return poi?.connectorNodeIds[0] ? [poi.connectorNodeIds[0]] : [];
});

const bundle: StationBundle = {
  schema: SCHEMA_VERSION,
  station: {
    id: "shinjuku",
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
};

// ---------------------------------------------------------------- plan (render geometry)
const plan = {
  note: "Render-only geometry derived from GSI 構内地図データ (PDL 1.0). Not routing truth. Heights are symbolic.",
  attribution: sources.map((s) => s.attribution),
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
  heightModel: { escalatorDegrees: 30, escalatorFlatM: ESC_FLAT, stairRiseRatio: STAIR_RATIO, constraints: constraints.length },
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
