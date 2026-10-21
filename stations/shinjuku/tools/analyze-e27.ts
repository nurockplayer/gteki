/** Exploratory G0 analysis of the raw E27 data. Prints facts; writes nothing. */
import { EnuFrame } from "@gteki/geo";
import { loadRawE27, normId, pointInPolygon } from "./e27-raw.ts";

const raw = loadRawE27();
const frame = new EnuFrame({ lat: 35.6870, lon: 139.6994, h: 0 });
const enu = (lon: number, lat: number) => frame.toEnu({ lat, lon, h: 0 });

// floor id -> level label & ordinal
const floorInfo = new Map<string, { label: string; ordinal: number }>();
for (const lv of raw.levels) for (const f of lv.floors) floorInfo.set(normId(f.properties.id), { label: lv.label, ordinal: Number(f.properties.ordinal) });
console.log("map floors", [...floorInfo.entries()].map(([id, v]) => `${v.label}(${v.ordinal}) ${id.slice(0, 6)}`));

const spacesAll = raw.levels.flatMap((lv) => lv.spaces.map((s) => ({ lv: lv.label, s })));
const floorsAll = raw.levels.flatMap((lv) => lv.floors.map((f) => ({ lv: lv.label, f })));

// 1. which map floor polygon(s) contain each node, grouped by node.floor
const byNodeFloor = new Map<number, Map<string, number>>();
for (const n of raw.nodes) {
  const [lon, lat] = n.geometry.coordinates;
  const hits = floorsAll.filter(({ f }) => pointInPolygon(lon, lat, f.geometry.coordinates)).map(({ lv }) => lv);
  const key = n.properties.floor;
  const m = byNodeFloor.get(key) ?? new Map();
  const k = hits.length ? [...new Set(hits)].join("+") : "none";
  m.set(k, (m.get(k) ?? 0) + 1);
  byNodeFloor.set(key, m);
}
console.log("\nnode.floor -> containing map floors");
for (const [k, v] of [...byNodeFloor.entries()].sort((a, b) => b[0] - a[0])) console.log(" ", k, Object.fromEntries(v));

// 2. links: floor change + containing space toll for same-floor links
const nodeById = new Map(raw.nodes.map((n) => [n.properties.node_id, n]));
const levelForOrdinal = (o: number) => raw.levels.find((lv) => Number(lv.floors[0]?.properties.ordinal) === o)?.label;
let tollStats: Record<string, number> = {};
const crossings: string[] = [];
const rtByFloorChange: Record<string, number> = {};
for (const l of raw.links) {
  const a = nodeById.get(l.properties.start_id);
  const b = nodeById.get(l.properties.end_id);
  if (!a || !b) {
    console.log("dangling link", l.properties.link_id);
    continue;
  }
  const fa = a.properties.floor;
  const fb = b.properties.floor;
  const key = `${fa === fb ? "same" : "change"}:rt${l.properties.route_type}`;
  rtByFloorChange[key] = (rtByFloorChange[key] ?? 0) + 1;
  // toll of space at both ends + mid
  const coords = l.geometry.coordinates;
  const mid = coords[Math.floor(coords.length / 2)]!;
  const tollAt = (lon: number, lat: number, ord: number) => {
    const lab = levelForOrdinal(Math.round(ord));
    const cands = spacesAll.filter(({ lv, s }) => lv === lab && pointInPolygon(lon, lat, s.geometry.coordinates));
    return cands.map(({ s }) => `${s.properties.category}/t${s.properties.toll}/r${s.properties.restricted}`).join("|") || "none";
  };
  if (fa === fb) {
    const t = tollAt(mid[0], mid[1], fa);
    const tKey = t.split("|").map((x) => x.split("/")[1]).join("|");
    tollStats[tKey] = (tollStats[tKey] ?? 0) + 1;
    const ta = tollAt(a.geometry.coordinates[0], a.geometry.coordinates[1], fa).match(/t(\d)/)?.[1];
    const tb = tollAt(b.geometry.coordinates[0], b.geometry.coordinates[1], fb).match(/t(\d)/)?.[1];
    if (ta && tb && ta !== tb) crossings.push(`${l.properties.link_id.slice(0, 6)} floor ${fa} ${ta}->${tb} rt${l.properties.route_type} d${l.properties.distance}`);
  }
}
console.log("\nlinks by floor change/route_type", rtByFloorChange);
console.log("same-floor link midpoint space toll", tollStats);
console.log("toll transitions between endpoints:", crossings.length);
for (const c of crossings) console.log("  ", c);

// 3. ticket gates and exits
for (const lv of raw.levels)
  for (const f of lv.facilities) {
    const c = f.properties.category;
    if (c !== "F106" && c !== "F108") continue;
    const [lon, lat] = f.geometry.coordinates;
    const p = enu(lon, lat);
    let best = { d: 1e9, id: "", floor: 0, io: 0 };
    for (const n of raw.nodes) {
      const q = enu(n.geometry.coordinates[0], n.geometry.coordinates[1]);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) best = { d, id: n.properties.node_id.slice(0, 6), floor: n.properties.floor, io: n.properties.in_out };
    }
    console.log(`${c} ${lv.label} at (${p.x.toFixed(1)},${p.y.toFixed(1)}) nearest node ${best.id} floor ${best.floor} in_out ${best.io} d=${best.d.toFixed(1)}m`);
  }

// 4. components
const adj = new Map<string, string[]>();
for (const l of raw.links) {
  const { start_id: s, end_id: e } = l.properties;
  adj.set(s, [...(adj.get(s) ?? []), e]);
  adj.set(e, [...(adj.get(e) ?? []), s]);
}
const seen = new Set<string>();
const comps: number[] = [];
for (const n of raw.nodes) {
  if (seen.has(n.properties.node_id)) continue;
  let c = 0;
  const st = [n.properties.node_id];
  seen.add(n.properties.node_id);
  while (st.length) {
    const x = st.pop()!;
    c++;
    for (const y of adj.get(x) ?? []) if (!seen.has(y)) (seen.add(y), st.push(y));
  }
  comps.push(c);
}
console.log("\ncomponents", comps.sort((a, b) => b - a));

// 5. outside / boundary nodes (exits candidates)
for (const n of raw.nodes.filter((n) => n.properties.in_out !== 3)) {
  const p = enu(n.geometry.coordinates[0], n.geometry.coordinates[1]);
  console.log(`in_out ${n.properties.in_out} floor ${n.properties.floor} ${n.properties.node_id.slice(0, 6)} (${p.x.toFixed(1)},${p.y.toFixed(1)}) deg ${(adj.get(n.properties.node_id) ?? []).length}`);
}
// extent
const xs = raw.nodes.map((n) => enu(n.geometry.coordinates[0], n.geometry.coordinates[1]));
console.log("\nextent x", Math.min(...xs.map((p) => p.x)).toFixed(1), Math.max(...xs.map((p) => p.x)).toFixed(1), "y", Math.min(...xs.map((p) => p.y)).toFixed(1), Math.max(...xs.map((p) => p.y)).toFixed(1));
console.log("H_F nodes", raw.nodes.filter((n) => n.properties.H_F === 1).map((n) => `${n.properties.floor}/${n.properties.in_out}`));
console.log("H_F links", raw.links.filter((l) => l.properties.H_F === 1).map((l) => `rt${l.properties.route_type} d${l.properties.distance}`));
