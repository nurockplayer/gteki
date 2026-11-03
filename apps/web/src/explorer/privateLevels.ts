import polygonClipping, { type Polygon } from "polygon-clipping";
import { regionPolygon, type Region } from "./walkableModel.ts";

export type PolygonRegion = Extract<Region, { kind: "polygon" }>;
export type LevelSelection = { walkable: string[]; holes: string[] };
export type PrivateLevels = { levels: {
  floorId: string; renderElevationM: number;
  features: { facility: string | null; polygons: Polygon[] }[];
}[] };

/** The caller supplies all class names privately. Output contains geometry only, in renderer coordinates. */
export function privateLevelRegions(input: PrivateLevels, selection: LevelSelection): PolygonRegion[] {
  if (!Array.isArray(selection?.walkable) || !Array.isArray(selection?.holes)
    || ![...selection.walkable, ...selection.holes].every((value) => typeof value === "string"))
    throw new Error("Private level selection requires string arrays");
  const walkable = new Set(selection.walkable), holes = new Set(selection.holes);
  const out: PolygonRegion[] = [];
  for (const level of input.levels) {
    const floors = level.features.filter((f) => f.facility !== null && walkable.has(f.facility)).flatMap((f) => f.polygons);
    const cuts = level.features.filter((f) => f.facility !== null && holes.has(f.facility)).flatMap((f) => f.polygons);
    if (!floors.length) continue;
    const union = polygonClipping.union(floors[0]!, ...floors.slice(1));
    const polygons = cuts.length ? polygonClipping.difference(union, ...cuts) : union;
    for (const polygon of polygons) {
      const region: PolygonRegion = { kind: "polygon", level: level.floorId, y: level.renderElevationM,
        rings: polygon.map((ring) => ring.map(([east, north]) => ({ x: east, z: -north }))) };
      region.rings = regionPolygon(region)[0]!;
      out.push(region);
    }
  }
  return out;
}

/** Selected floors replace procedural flat surfaces at this level/elevation, including their excluded space. */
export function privateFloorAt(regions: readonly PolygonRegion[], level: string, y: number): boolean {
  return regions.some((region) => region.level === level && Math.abs(region.y - y) < 1e-6);
}
