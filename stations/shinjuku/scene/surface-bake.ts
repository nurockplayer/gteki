/**
 * Baked street-layer derivations (#72). The slowest part of opening Shinjuku is not drawing the street
 * context but deriving its polygons: road/ground/building unions and differences in polygon-clipping, wall
 * runs, furniture placement. They are pure functions of committed data (surface.json, the station bundle
 * and plan), so they are computed once by `pnpm --filter ./stations/shinjuku bake:surface` and stored in
 * data/surface-baked.json. The Three.js geometry is still built at load from those polygons, so what is
 * drawn is unchanged by construction.
 *
 * A baked table is used only when its `inputKey` equals the key of the inputs in hand; otherwise the same
 * functions run as before. The key covers surface.json, the bundle, the plan AND the layout fields the
 * derivations read (the values include colliders: pad, column, canopy and building walls), so a changed pad
 * or run falls back to deriving.
 *
 * What the key cannot cover is the derivation CODE: hashing source files at load is impractical (no file access
 * in the browser build, and minified function text differs). Instead `sourceKey` (a hash of the derivation
 * sources and the polygon-clipping version, written by bake:surface) is checked by surface-bake.test.ts and
 * `bake:surface --check`, which fail if any derivation source changed without a rebake. Those run locally
 * today and in CI once the root suite does (pending root CI). See docs/stations/shinjuku/surface-bake.md.
 */
import type { StationBundle } from "@gteki/schema";
import { contentKey } from "./content-key.ts";
import type { Layout, Plan } from "./layout.ts";
import { surfaceBuildingFootprints, surfaceCanopyWalls, surfaceColumns, surfacePadWalls, withSurfaceMemo, type SurfaceSeed } from "./surface-layout.ts";
import { surfaceKerbs, surfaceLampRails, surfacePaving, surfaceStreets } from "./surface-street.ts";
import type { SurfaceData } from "./surface-data.ts";

/** Bump when the derivation code (not its inputs) changes, so old tables are ignored rather than trusted. */
export const SURFACE_BAKE_VERSION = 1;

export type BakedSurfaceValues = {
  surfaceStreets: ReturnType<typeof surfaceStreets>;
  surfacePaving: ReturnType<typeof surfacePaving>;
  surfaceKerbs: ReturnType<typeof surfaceKerbs>;
  surfaceLampRails: ReturnType<typeof surfaceLampRails>;
  surfaceBuildingFootprints: ReturnType<typeof surfaceBuildingFootprints>;
  surfacePadWalls: ReturnType<typeof surfacePadWalls>;
  surfaceColumns: ReturnType<typeof surfaceColumns>;
  surfaceCanopyWalls: ReturnType<typeof surfaceCanopyWalls>;
};
export interface BakedSurface { version: number; inputKey: string; values: BakedSurfaceValues }
/** The shipped form (data/surface-baked.json): the values as one JSON string, parsed only if the key matches and
 * dropped after the build. As module-level objects they would stay resident (~4 MB of heap for 0.3 MB of text). */
export interface BakedSurfaceModule { version: number; inputKey: string; sourceKey: string; valuesJson: string }

type Edge = { a: { x: number; y: number }; b: { x: number; y: number } };
const packEdges = (edges: Edge[]) => edges.map(({ a, b }) => [a.x, a.y, b.x, b.y]);
const unpackEdges = (rows: number[][]): Edge[] => rows.map(([ax, ay, bx, by]) => ({ a: { x: ax!, y: ay! }, b: { x: bx!, y: by! } }));
/** Kerb and rail edges are thousands of tiny {a:{x,y},b:{x,y}} objects; store them as [ax, ay, bx, by] rows. */
export function packValues(values: BakedSurfaceValues): string {
  return JSON.stringify({ ...values, surfaceKerbs: packEdges(values.surfaceKerbs), surfaceLampRails: packEdges(values.surfaceLampRails) });
}
export function unpackValues(json: string): BakedSurfaceValues {
  const raw = JSON.parse(json) as BakedSurfaceValues & { surfaceKerbs: number[][]; surfaceLampRails: number[][] };
  return { ...raw, surfaceKerbs: unpackEdges(raw.surfaceKerbs), surfaceLampRails: unpackEdges(raw.surfaceLampRails) };
}

export function bakedFileText(baked: BakedSurface, sourceKey: string): string {
  const entry = { version: baked.version, inputKey: baked.inputKey, sourceKey, valuesJson: packValues(baked.values) };
  return JSON.stringify(entry) + "\n";
}

/** The layout as the derivations see it. Everything except per-level `walls`, which buildStation appends to
 * after this point and which the street layer never reads; `nodeZ` is a Map, which JSON drops, so it is
 * spelled out. Deliberately generous (also soffits, rails, rooms, ...): over-invalidating only costs time. */
export function layoutFingerprintInput(layout: Layout) {
  const { levels, nodeZ, ...rest } = layout;
  return [rest, levels.map(({ walls: _walls, ...level }) => level), [...nodeZ]];
}

/** Everything the derivations read: the street data, the station bundle, the plan and the built layout. */
export function surfaceInputKey(surface: SurfaceData, bundle: StationBundle, plan: Plan, layout: Layout): string {
  return contentKey("surface-bake", SURFACE_BAKE_VERSION, surface, bundle, plan, layoutFingerprintInput(layout));
}

/** Fresh derivation, exactly what the street layer computes without a table. */
export function deriveSurface(surface: SurfaceData, layout: Layout, bundle: StationBundle): BakedSurfaceValues {
  return withSurfaceMemo(() => ({
    surfaceStreets: surfaceStreets(surface, layout, bundle),
    surfacePaving: surfacePaving(surface, layout, bundle),
    surfaceKerbs: surfaceKerbs(surface, layout, bundle),
    surfaceLampRails: surfaceLampRails(surface, layout, bundle),
    surfaceBuildingFootprints: surfaceBuildingFootprints(surface, layout, bundle),
    surfacePadWalls: surfacePadWalls(layout, bundle),
    surfaceColumns: surfaceColumns(layout, bundle),
    surfaceCanopyWalls: surfaceCanopyWalls(layout, bundle),
  }));
}

export function bakeSurface(surface: SurfaceData, layout: Layout, bundle: StationBundle, plan: Plan): BakedSurface {
  return { version: SURFACE_BAKE_VERSION, inputKey: surfaceInputKey(surface, bundle, plan, layout), values: deriveSurface(surface, layout, bundle) };
}

/** A seed for withSurfaceMemo when the table matches these inputs, otherwise null (derive as usual). */
export function surfaceSeed(baked: BakedSurfaceModule | null | undefined, surface: SurfaceData, layout: Layout, bundle: StationBundle, plan: Plan): SurfaceSeed | null {
  if (!baked || baked.version !== SURFACE_BAKE_VERSION || !baked.valuesJson || baked.inputKey !== surfaceInputKey(surface, bundle, plan, layout)) return null;
  return { layout, bundle, surface, values: unpackValues(baked.valuesJson) };
}
