/**
 * Where the PLATEAU context buildings meet the station's own walkable street: for every building, the area of
 * its footprint (every triangle's plan projection, roofs included, so an overhang counts) that lies inside a
 * walkable or opened street zone. Zones are the evidence-limited street pads, exit-top landings and link
 * strips (streetFootprint), the stair and lift openings, the entrance canopies and roofed-run glazing the
 * street layer draws, and every graph corridor that reaches street height (walker radius either side).
 */
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { StationBundle } from "@gteki/schema";
import type { Layout } from "../scene/layout.ts";
import { graphSegments, streetFootprint, surfaceEntrances, surfaceOpenings, surfaceRoofs } from "../scene/surface-layout.ts";
import { type FeatureRow, type GlbMesh } from "./context-glb.ts";

export type ZoneName = "street" | "opening" | "canopy" | "roof" | "route";
export type Zones = Record<ZoneName, MultiPolygon>;

const rect = (cx: number, cy: number, ux: number, uy: number, halfLength: number, halfWidth: number): Polygon => {
  const nx = -uy, ny = ux;
  const c = (a: number, b: number): [number, number] => [cx + ux * halfLength * a + nx * halfWidth * b, cy + uy * halfLength * a + ny * halfWidth * b];
  return [[c(-1, -1), c(1, -1), c(1, 1), c(-1, 1), c(-1, -1)]];
};
const snap = (mp: MultiPolygon): MultiPolygon => mp.map((poly) => poly.map((r) => r.map(([x, y]) => [Math.round(x! * 1000) / 1000, Math.round(y! * 1000) / 1000] as [number, number])));
const union = (polys: Polygon[]): MultiPolygon => (polys.length ? polygonClipping.union(...(polys.map((p) => snap([p])[0]!) as [Polygon, ...Polygon[]])) : []);

export function walkableZones(layout: Layout, bundle: StationBundle, walkerRadiusM = 0.3): Zones {
  const route: Polygon[] = [];
  for (const { a, b } of graphSegments(layout, bundle).filter((s) => Math.max(s.a.z, s.b.z) > -2.0)) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.01) route.push(rect(a.x, a.y, 1, 0, walkerRadiusM, walkerRadiusM));
    else route.push(rect((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / L, (b.y - a.y) / L, L / 2, walkerRadiusM));
  }
  const entrances = surfaceEntrances(layout, bundle);
  return {
    street: snap(streetFootprint(layout)),
    opening: snap(surfaceOpenings(layout, bundle)),
    canopy: union(entrances.map((e) => rect(e.center.x, e.center.y, e.u.x, e.u.y, e.halfLength, e.halfWidth))),
    roof: union(surfaceRoofs(layout, bundle, entrances).map((r) => rect(r.center.x, r.center.y, r.u.x, r.u.y, r.halfLength, r.halfWidth))),
    route: union(route),
  };
}

const area = (mp: MultiPolygon) => mp.reduce((total, poly) => total + poly.reduce((s, ring, i) => {
  let a = 0;
  for (let k = 1; k < ring.length; k++) a += ring[k - 1]![0] * ring[k]![1] - ring[k]![0] * ring[k - 1]![1];
  return s + (i === 0 ? 1 : -1) * Math.abs(a / 2);
}, 0), 0);

const bboxOf = (mp: MultiPolygon) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of mp) for (const [x, y] of poly[0]!) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};

export interface Intrusion { gmlId: string; zone: ZoneName; areaM2: number }

/** Every (building, zone) pair whose footprint covers more than `toleranceM2` of the zone. */
export function contextIntrusions(meshes: readonly GlbMesh[], rows: readonly FeatureRow[], zones: Zones, toleranceM2 = 0): Intrusion[] {
  const byName = new Map(meshes.map((m) => [m.name, m]));
  const boxes = (Object.keys(zones) as ZoneName[]).map((z) => ({ z, polys: zones[z].map((p) => ({ p: [p] as MultiPolygon, box: bboxOf([p]) })) }));
  const out: Intrusion[] = [];
  for (const row of rows) {
    const mesh = byName.get(row.mesh);
    if (!mesh) throw new Error(`feature ${row.gmlId}: mesh ${row.mesh} is not in the GLB`);
    const hits = new Map<ZoneName, MultiPolygon[]>();
    for (let t = row.triStart; t < row.triStart + row.triCount; t++) {
      const v = [0, 1, 2].map((k) => mesh.indices[t * 3 + k]!);
      // Plan view: ENU x = glTF x, ENU y = -glTF z.
      // Millimetre grid, as the street layer does for its own clipping: polygon-clipping's sweep line is not robust to near-coincident float edges.
      const pts = v.map((i) => [Math.round(mesh.positions[i * 3]! * 1000) / 1000, Math.round(-mesh.positions[i * 3 + 2]! * 1000) / 1000] as [number, number]);
      const cross = (pts[1]![0] - pts[0]![0]) * (pts[2]![1] - pts[0]![1]) - (pts[2]![0] - pts[0]![0]) * (pts[1]![1] - pts[0]![1]);
      if (Math.abs(cross) < 1e-9) continue; // a wall seen edge-on has no plan area
      const tri: Polygon = [[pts[0]!, pts[1]!, pts[2]!, pts[0]!]];
      const tx0 = Math.min(pts[0]![0], pts[1]![0], pts[2]![0]), tx1 = Math.max(pts[0]![0], pts[1]![0], pts[2]![0]);
      const ty0 = Math.min(pts[0]![1], pts[1]![1], pts[2]![1]), ty1 = Math.max(pts[0]![1], pts[1]![1], pts[2]![1]);
      for (const zone of boxes) for (const piece of zone.polys) {
        if (tx1 < piece.box.x0 || tx0 > piece.box.x1 || ty1 < piece.box.y0 || ty0 > piece.box.y1) continue;
        const hit = polygonClipping.intersection(tri, piece.p[0]!);
        if (hit.length) (hits.get(zone.z) ?? hits.set(zone.z, []).get(zone.z)!).push(hit);
      }
    }
    for (const [zone, parts] of hits) {
      const covered = area(polygonClipping.union(parts[0]!, ...parts.slice(1)));
      if (covered > toleranceM2) out.push({ gmlId: row.gmlId, zone, areaM2: Math.round(covered * 1000) / 1000 });
    }
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2);
}
