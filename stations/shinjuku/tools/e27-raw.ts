/**
 * Loader for the raw MLIT ほこナビDP dataset
 * 「歩行空間ネットワークデータ／構内地図データ（都営地下鉄大江戸線 新宿駅）」 (PDL 1.0).
 *
 * Raw files are NOT committed (see stations/shinjuku/sources/manifest.json for URLs + sha256).
 * Set GTEKI_RAW_SHINJUKU to the directory produced by `tools/fetch-sources.sh`.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RAW_DIR = process.env.GTEKI_RAW_SHINJUKU ?? join(homedir(), "Developer/gteki-raw/shinjuku");

export interface GeoFeature<P, G> {
  type: "Feature";
  properties: P;
  geometry: G;
}
export type PointG = { type: "Point"; coordinates: [number, number] };
export type LineG = { type: "LineString"; coordinates: [number, number][] };
export type PolyG = { type: "Polygon"; coordinates: [number, number][][] };

export interface RawNodeP {
  node_id: string;
  lat: number;
  lon: number;
  floor: number;
  in_out: number;
  H_F: number;
}
export interface RawLinkP {
  link_id: string;
  start_id: string;
  end_id: string;
  distance: number;
  rank: string;
  r_method: string;
  maint_date: string;
  rt_struct: number;
  route_type: number;
  direction: number;
  width: number;
  vtcl_slope: number;
  lev_diff: number;
  tfc_signal: number;
  tfc_s_type: number;
  brail_tile: number;
  elevator: number;
  roof: number;
  H_F: number;
}
export interface RawFloorP {
  id: string;
  category: string;
  name: string;
  ordinal: string;
  source: string;
}
export interface RawSpaceP {
  id: string;
  category: string;
  floor_id: string;
  restricted: string;
  nonpublic: string;
  toll: string;
  source: string;
}
export interface RawFacilityP {
  id: string;
  category: string;
  floor_id: string;
  source: string;
}

export interface RawLevel {
  /** File label, e.g. "B1", "1". */
  label: string;
  floors: GeoFeature<RawFloorP, PolyG>[];
  spaces: GeoFeature<RawSpaceP, PolyG>[];
  facilities: GeoFeature<RawFacilityP, PointG>[];
}

export interface RawE27 {
  nodes: GeoFeature<RawNodeP, PointG>[];
  links: GeoFeature<RawLinkP, LineG>[];
  levels: RawLevel[];
  sha256: Record<string, string>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Normalise ids: the B6 layer mixes dashed UUIDs and undashed ids for the same floor. */
export const normId = (s: string) => s.trim().replace(/-/g, "").toLowerCase();

export function loadRawE27(dir = RAW_DIR): RawE27 {
  const e27 = join(dir, "e27");
  const nwd = join(e27, "nwd");
  const map = join(e27, "map");
  if (!existsSync(join(nwd, "node.geojson")))
    throw new Error(`raw E27 data not found under ${e27}; run stations/shinjuku/tools/fetch-sources.sh`);
  const sha256: Record<string, string> = {};
  for (const f of ["nwd_oedo_shinjuku_geojson.zip", "stationmap_oedo_shinjuku_geojson.zip"]) {
    sha256[f] = createHash("sha256").update(readFileSync(join(e27, f))).digest("hex");
  }
  const nodes = readJson<{ features: GeoFeature<RawNodeP, PointG>[] }>(join(nwd, "node.geojson")).features;
  const links = readJson<{ features: GeoFeature<RawLinkP, LineG>[] }>(join(nwd, "link.geojson")).features;
  const labels = [
    ...new Set(
      readdirSync(map)
        .map((f) => /^Shinjuku_(.+)_(Floor|Space|Facility)\.geojson$/.exec(f)?.[1])
        .filter((x): x is string => !!x),
    ),
  ];
  const levels: RawLevel[] = labels.map((label) => {
    const read = <P, G>(kind: string) =>
      readJson<{ features: GeoFeature<P, G>[] }>(join(map, `Shinjuku_${label}_${kind}.geojson`)).features;
    return {
      label,
      floors: read<RawFloorP, PolyG>("Floor"),
      spaces: read<RawSpaceP, PolyG>("Space"),
      facilities: read<RawFacilityP, PointG>("Facility"),
    };
  });
  return { nodes, links, levels, sha256 };
}

export function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, y: number, poly: [number, number][][]): boolean {
  if (!poly[0] || !pointInRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (pointInRing(x, y, poly[h]!)) return false;
  return true;
}
