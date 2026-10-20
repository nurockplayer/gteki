/** Pinned CityGML 2.0 PLATEAU LOD1 bases → compact render-only ENU context.
 * No appearances, names, addresses, assets or routing facts are imported.
 * This deliberately narrow reader accepts the explicit bldg/gml tags used by the hashed
 * files, rejects other CRSs/axis orders, and never resolves XML entities or remote links.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EnuFrame } from "@gteki/geo";
import type { SurfaceBuilding, SurfaceData, SurfaceRoad } from "../scene/surface-data.ts";

export const ORIGIN = { lat: 35.687, lon: 139.6994, h: 0 };
const frame = new EnuFrame(ORIGIN);
/** EPSG:6697 axis order is latitude, longitude, height. Orthometric height is kept
 * separately; horizontal placement uses h=0, exactly as the station graph importer. */
export function surfaceEnu(lat: number, lon: number, h: number) {
  if (![lat, lon, h].every(Number.isFinite) || lat < 35 || lat > 36 || lon < 139 || lon > 140) throw new Error("Invalid EPSG:6697 lat/lon/h or axis order");
  const p = frame.toEnu({ lat, lon, h: 0 });
  return { x: p.x, y: p.y, z: h };
}
const quant = (n: number) => Math.round(n * 10) / 10 || 0;
type P = [number, number];
function distance(p: P, a: P, b: P) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function dp(ps: P[]): P[] {
  let max = 0.12, split = -1;
  for (let i = 1; i < ps.length - 1; i++) {
    const d = distance(ps[i]!, ps[0]!, ps.at(-1)!);
    if (d > max) { max = d; split = i; }
  }
  return split < 0 ? [ps[0]!, ps.at(-1)!] : [...dp(ps.slice(0, split + 1)).slice(0, -1), ...dp(ps.slice(split))];
}
/** Closed-ring Douglas–Peucker (0.12 m), then 0.1 m quantisation (<=0.071 m).
 * Total displacement <=0.191 m. Split at the farthest vertex to preserve closure. */
export function simplifyRing(ps: P[]): P[] {
  const open = ps.slice(0, -1);
  if (open.length < 3) throw new Error("Degenerate footprint");
  let split = 1;
  for (let i = 2; i < open.length; i++) if (Math.hypot(open[i]![0] - open[0]![0], open[i]![1] - open[0]![1]) > Math.hypot(open[split]![0] - open[0]![0], open[split]![1] - open[0]![1])) split = i;
  const a = dp(open.slice(0, split + 1)), b = dp([...open.slice(split), open[0]!]);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)].map(([x, y]): P => [quant(x), quant(y)]).filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
  if (out.length < 3) throw new Error("Quantisation collapsed footprint");
  return [...out, out[0]!];
}
function tuples(xml: string): [number, number, number][] {
  const text = xml.match(/<gml:posList(?:\s[^>]*)?>([\s\S]*?)<\/gml:posList>/)?.[1];
  if (!text) throw new Error("Expected explicit LOD1 posList");
  const ns = text.trim().split(/\s+/).map(Number);
  if (ns.length < 12 || ns.length % 3 || ns.some((n) => !Number.isFinite(n))) throw new Error("Malformed 3D posList");
  const out: [number, number, number][] = [];
  for (let i = 0; i < ns.length; i += 3) out.push([ns[i]!, ns[i + 1]!, ns[i + 2]!]);
  if (out[0]!.some((n, i) => n !== out.at(-1)![i])) throw new Error("Unclosed source ring");
  return out;
}
export function parseBuildings(xml: string, exits: P[], radius = 300): SurfaceBuilding[] {
  if (!/srsName="[^"]*(?:\/|:)6697"/.test(xml) || /<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error("Expected entity-free EPSG:6697 CityGML");
  const out: SurfaceBuilding[] = [];
  for (const feature of xml.matchAll(/<bldg:Building\s[^>]*gml:id="([^"]+)"[^>]*>([\s\S]*?)<\/bldg:Building>/g)) {
    const solid = feature[2]!.match(/<bldg:lod1Solid>([\s\S]*?)<\/bldg:lod1Solid>/)?.[1];
    if (!solid) throw new Error(`Missing explicit LOD1: ${feature[1]}`);
    const polys = [...solid.matchAll(/<gml:Polygon(?:\s[^>]*)?>([\s\S]*?)<\/gml:Polygon>/g)].map((p) => {
      const rings = [...p[1]!.matchAll(/<gml:LinearRing(?:\s[^>]*)?>([\s\S]*?)<\/gml:LinearRing>/g)].map((r) => tuples(r[1]!));
      if (!rings.length) throw new Error("Expected LOD1 polygon rings");
      return rings;
    });
    const heights = polys.flat(2).map((p) => p[2]);
    if (!heights.length) throw new Error(`Empty solid: ${feature[1]}`);
    const base = Math.min(...heights), top = Math.max(...heights);
    const measured = Number(feature[2]!.match(/<bldg:measuredHeight\s+uom="m">([^<]+)<\/bldg:measuredHeight>/)?.[1]);
    const height = Number.isFinite(measured) && measured > 0 ? measured : top - base;
    if (height <= 0) throw new Error(`Invalid height: ${feature[1]}`);
    const usage = feature[2]!.match(/<bldg:usage(?:\s[^>]*)?>([^<]+)<\/bldg:usage>/)?.[1]?.trim() ?? null;
    const storeysValue = Number(feature[2]!.match(/<bldg:storeysAboveGround(?:\s[^>]*)?>([^<]+)<\/bldg:storeysAboveGround>/)?.[1]);
    const storeys = Number.isInteger(storeysValue) && storeysValue > 0 && storeysValue < 9999 ? storeysValue : null;
    let part = 0;
    for (const poly of polys) {
      if (!poly[0]!.every((p) => Math.abs(p[2] - base) < 0.02)) continue;
      const rings = poly.map((r) => r.map(([lat, lon, h]): P => { const p = surfaceEnu(lat, lon, h); return [p.x, p.y]; }));
      // Keep polygons whose bounding box intersects the context radius, including a
      // large station-adjacent building whose vertices all lie beyond the exit.
      const xs = rings[0]!.map((p) => p[0]), ys = rings[0]!.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      if (!exits.some(([x, y]) => Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minY - y, 0, y - maxY)) <= radius)) continue;
      out.push({ id: `${feature[1]}:${part++}`, rings: rings.map(simplifyRing), height: quant(height), groundHeight: quant(base), heightSource: Number.isFinite(measured) && measured > 0 ? "measuredHeight" : "lod1Solid", usage, storeys });
    }
  }
  return out;
}
/** Parse PLATEAU tran:Road LOD1 MultiSurface polygons. Each polygon is a separate
 * compact render record, preserving its exterior and any interior rings. */
export function parseRoads(xml: string, exits: P[], radius = 300): SurfaceRoad[] {
  if (!/srsName="[^"]*(?:\/|:)6697"/.test(xml) || /<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error("Expected entity-free EPSG:6697 CityGML");
  const out: SurfaceRoad[] = [];
  for (const feature of xml.matchAll(/<tran:Road\s[^>]*gml:id="([^"]+)"[^>]*>([\s\S]*?)<\/tran:Road>/g)) {
    const multi = feature[2]!.match(/<tran:lod1MultiSurface>([\s\S]*?)<\/tran:lod1MultiSurface>/)?.[1];
    if (!multi) continue;
    let part = 0;
    for (const polygon of multi.matchAll(/<gml:Polygon(?:\s[^>]*)?>([\s\S]*?)<\/gml:Polygon>/g)) {
      const sourceRings = [...polygon[1]!.matchAll(/<gml:LinearRing(?:\s[^>]*)?>([\s\S]*?)<\/gml:LinearRing>/g)].map((ring) => tuples(ring[1]!));
      if (!sourceRings.length) continue;
      const rings = sourceRings.map((ring) => ring.map(([lat, lon, h]): P => { const p = surfaceEnu(lat, lon, h); return [p.x, p.y]; }));
      const xs = rings[0]!.map((p) => p[0]), ys = rings[0]!.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      if (!exits.some(([x, y]) => Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minY - y, 0, y - maxY)) <= radius)) continue;
      out.push({ id: `${feature[1]}:${part++}`, rings: rings.map(simplifyRing) });
    }
  }
  return out;
}
const here = dirname(fileURLToPath(import.meta.url));
export function importSurface(check = false) {
  const manifest = JSON.parse(readFileSync(join(here, "../sources/surface-manifest.json"), "utf8"));
  const raw = join(process.env.GTEKI_RAW_SHINJUKU ?? join(homedir(), "Developer/gteki-raw/shinjuku"), "plateau-bldg");
  const graph = JSON.parse(readFileSync(join(here, "../gteki/graph.json"), "utf8"));
  const exits: P[] = graph.nodes.filter((n: { floorId: string; inOut: string }) => ["toei-nwd-0", "toei-nwd-1"].includes(n.floorId) && n.inOut !== "inside").map((n: { position: { x: number; y: number } }) => [n.position.x, n.position.y]);
  const buildings: SurfaceBuilding[] = [];
  const roads: SurfaceRoad[] = [];
  for (const f of manifest.files) {
    const data = readFileSync(join(raw, f.path));
    if (data.byteLength !== f.bytes || createHash("sha256").update(data).digest("hex") !== f.sha256) throw new Error(`Hash/bytes mismatch: ${f.path}`);
    if (f.kind === "bldg") buildings.push(...parseBuildings(data.toString("utf8"), exits));
    if (f.kind === "tran") roads.push(...parseRoads(data.toString("utf8"), exits));
  }
  buildings.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  roads.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!buildings.length || new Set(buildings.map((b) => b.id)).size !== buildings.length) throw new Error("Empty or duplicate context");
  if (!roads.length || new Set(roads.map((r) => r.id)).size !== roads.length) throw new Error("Empty or duplicate road context");
  const surface: SurfaceData = {
    version: 1, origin: ORIGIN, attribution: "東京都 3D都市モデル（Project PLATEAU）新宿区（2025年度） / CC BY 4.0. Modified by GTEki: LOD1 building footprints and road polygons simplified; buildings extruded; procedural facades, sidewalks and markings; terrain flattened. Not an official model.",
    license: manifest.license, source: manifest.datasetUrl, note: "render-only context, not routing",
    heightNote: "Source EPSG:6697 orthometric groundHeight is retained for provenance. Render bases are flattened to symbolic station street z=0; source measuredHeight (or LOD1 height) is preserved. No datum registration to underground symbolic floors is asserted.",
    buildings, roads,
  };
  const bytes = JSON.stringify(surface) + "\n";
  if (Buffer.byteLength(bytes) >= 1_500_000) throw new Error("Surface exceeds 1.5 MB budget");
  const target = join(here, "../data/surface.json");
  if (check) { if (readFileSync(target, "utf8") !== bytes) throw new Error("surface.json differs; run import:surface"); }
  else writeFileSync(target, bytes);
  console.log(`${check ? "Checked" : "Wrote"} ${buildings.length} building parts and ${roads.length} road polygons, ${Buffer.byteLength(bytes)} bytes`);
  return bytes;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) importSurface(process.argv.includes("--check"));
