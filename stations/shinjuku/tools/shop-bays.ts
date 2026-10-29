/** Derive illustrative shop bays from the same layout and anchors used by the scene. */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import polygonClipping, { type Polygon } from "polygon-clipping";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation } from "../scene/build.ts";
import { exitTopAnchors, toiletAnchors } from "../scene/kit/anchors.ts";
import type { KitApplyContext } from "../scene/kit/types.ts";
import { pointInRings, type Plan, type XY } from "../scene/layout.ts";
import type { Opening } from "../../ikebukuro/scene/kit_shops.ts";

const plan = planJson as unknown as Plan;
const path = join(dirname(fileURLToPath(import.meta.url)), "../scene/shop_bays.json");
const round = (x: number) => Math.round(x * 1000) / 1000;
const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const segmentDistance = (p: XY, a: XY, b: XY) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
};
const rect = (a: XY, b: XY, halfWidth: number): Polygon => {
  const length = distance(a, b), nx = -(b.y - a.y) / length * halfWidth, ny = (b.x - a.x) / length * halfWidth;
  return [[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny], [a.x + nx, a.y + ny]]];
};

export function shopBays(): { openings: Opening[] } {
  const { bundle } = loadShinjukuBundle();
  // The actual lift wall points are only exposed to the kit callback during the normal build.
  const context = new Proxy({}, { get: (_t, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
  const global = globalThis as { document?: unknown }, before = global.document;
  global.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
  let capture: KitApplyContext | undefined;
  try {
    const built = buildStation(bundle, plan, { quality: "low", kit: { apply(ctx) { capture = ctx; return null; } } });
    built.dispose();
  } finally { global.document = before; }
  if (!capture) throw new Error("Station build did not supply anchors");
  const { layout, liftAnchors } = capture as KitApplyContext;
  const points = [
    ...layout.runs.flatMap((r) => [r.a, r.b]),
    ...liftAnchors.map((a) => a.wallPoint),
    ...exitTopAnchors(layout, bundle).map((a) => a.top),
    ...toiletAnchors(layout, plan).map((a) => a.point),
  ];
  const gates = layout.gates.map((g) => {
    const u = { x: -g.dir.y * g.width / 2, y: g.dir.x * g.width / 2 };
    return [{ x: g.center.x - u.x, y: g.center.y - u.y }, { x: g.center.x + u.x, y: g.center.y + u.y }] as const;
  });
  const candidates: { key: string; centre: XY; z: number; width: number; normal: XY }[] = [];
  for (const level of layout.levels) {
    if (level.ceilingZ - level.z < 3) continue;
    for (const [index, wall] of level.walls.entries()) {
      const dx = wall.b.x - wall.a.x, dy = wall.b.y - wall.a.y, length = Math.hypot(dx, dy);
      if (wall.kind !== "room" || length < 3.6) continue;
      const centre = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
      const normal = { x: -dy / length * wall.side, y: dx / length * wall.side };
      const walk = { x: centre.x + normal.x * 0.5, y: centre.y + normal.y * 0.5 };
      if (!level.slabs.some((s) => s.fare === "free" && pointInRings(walk, s.rings))) continue;
      if (points.some((p) => distance(centre, p) < 5) || gates.some(([a, b]) => segmentDistance(centre, a, b) < 5)) continue;
      const width = Math.min(length - 1.2, 4.8), ux = dx / length, uy = dy / length;
      const a = { x: centre.x - ux * width / 2, y: centre.y - uy * width / 2 }, b = { x: centre.x + ux * width / 2, y: centre.y + uy * width / 2 };
      const strip: Polygon = [[[a.x, a.y], [b.x, b.y], [b.x + normal.x, b.y + normal.y], [a.x + normal.x, a.y + normal.y], [a.x, a.y]]];
      if (layout.runs.some((r) => polygonClipping.intersection(strip, rect(r.a, r.b, r.width / 2)).length > 0)) continue;
      candidates.push({ key: `${level.floorId}:${String(index).padStart(6, "0")}`, centre, z: level.z, width, normal });
    }
  }
  candidates.sort((a, b) => b.width - a.width || a.key.localeCompare(b.key));
  const selected: typeof candidates = [];
  for (const c of candidates) if (selected.length < 6 && selected.every((s) => distance(c.centre, s.centre) >= 10)) selected.push(c);
  return { openings: selected.map((c, i) => {
    const id = `sjk-bay-${i + 1}`;
    return { type: "Door", opening_id: id, polygon_ids: [id], base_z: round(c.z), height: 2.4, width: round(c.width), centre: [round(c.centre.x), round(c.centre.y), round(c.z)], normal_deg: round((Math.atan2(c.normal.y, c.normal.x) * 180 / Math.PI + 360) % 360), nearest_edge: null, edge_distance_m: 0 };
  }) };
}
export const shopBaysText = () => `${JSON.stringify(shopBays(), null, 2)}\n`;
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) writeFileSync(path, shopBaysText());
