import polygonClipping, { type Polygon } from "polygon-clipping";
import { ShapeUtils, Vector2 } from "three";
import { regionPolygon, type Region, type PlanPolygon, type PlanExclusion } from "./walkableModel.ts";

export type PolygonRegion = Extract<Region, { kind: "polygon" }> & { /** Explicit selection masks, independent of the floor footprint. */ exclusions?: PlanPolygon[] };
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
    if (!floors.length && !cuts.length) continue;
    const union = floors.length ? polygonClipping.union(floors[0]!, ...floors.slice(1)) : [];
    const polygons = union.length && cuts.length ? polygonClipping.difference(union, ...cuts) : union;
    const first = out.length;
    for (const polygon of polygons) {
      const region: PolygonRegion = { kind: "polygon", level: level.floorId, y: level.renderElevationM,
        rings: polygon.map((ring) => ring.map(([east, north]) => ({ x: east, z: -north }))) };
      region.rings = regionPolygon(region)[0]!;
      out.push(region);
    }
    if (cuts.length) {
      if (out.length === first) out.push({ kind: "polygon", level: level.floorId, y: level.renderElevationM, rings: [] });
      out[first]!.exclusions = polygonClipping.union(cuts[0]!, ...cuts.slice(1)).map((polygon) => polygon.map((ring) => ring.map(([east, north]) => ({ x: east, z: -north }))));
    }
  }
  return out;
}

/** Only explicitly selected exclusion features remove procedural floor or block routing. */
export function privateHolePlanes(regions: readonly PolygonRegion[]): PlanExclusion[] {
  return regions.filter((region) => region.exclusions?.length).map((region) => ({ level: region.level, y: region.y,
    triangles: region.exclusions!.flatMap((polygon) => {
      const rings = polygon.map((ring) => ring.map((p) => new Vector2(p.x, p.z)));
      const faces = ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)), points = rings.flat();
      return faces.map((face) => face.map((i) => ({ x: points[i]!.x, z: points[i]!.y })));
    }),
  }));
}
