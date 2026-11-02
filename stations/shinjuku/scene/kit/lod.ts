import * as THREE from "three";
import { batchKitPlacements, type BatchResult } from "./batch.ts";
import { totalsFor } from "./place.ts";
import type { KitAnchors, KitApplyContext, KitBudget, KitPlacement } from "./types.ts";

/** World-space clusters retain their parents through the explorer's render-only cuts. */
export function batchDistanceKit(
  args: Parameters<typeof batchKitPlacements>[0],
  anchors: KitAnchors,
  ledger: KitApplyContext["ledger"],
  budget: KitBudget,
  caps: Parameters<typeof totalsFor>[2],
) {
  const clusters = new Map<string, KitPlacement[]>();
  for (const p of args.placed) {
    const key = p.role === "stairs" || p.role === "escalator"
      ? `${Math.floor(p.position[0] / 96)}:${Math.floor(p.position[2] / 96)}` : "static";
    const list = clusters.get(key) ?? [];
    list.push(p);
    clusters.set(key, list);
  }
  const group = new THREE.Group();
  group.name = "kit-swap";
  const result: BatchResult = { group, meshes: [], tinted: [], triangles: 0, geometryBytes: 0, missing: [], drawn: new Set() };
  const cells: { near: THREE.Group; far: THREE.Group; bounds: THREE.Box3; placed: KitPlacement[]; triangles: number; draws: number }[] = [];
  const active = new Set<string>();
  let staticTriangles = 0, staticDraws = 0;
  for (const [key, placed] of clusters) {
    const batch = batchKitPlacements({ ...args, placed });
    // Small cluster bounds already cull tightly. Keep plain meshes so explorer cuts do not create
    // an extracted copy alongside a zero-scaled one-instance draw for each LOD finish.
    if (key !== "static") for (const mesh of batch.meshes) mesh.userData.kitLod = true;
    const drawn = placed.filter((p) => batch.drawn.has(p));
    group.add(batch.group);
    batch.group.name = `kit-near:${key}`;
    result.meshes.push(...batch.meshes);
    result.tinted.push(...batch.tinted);
    result.triangles += batch.triangles;
    result.geometryBytes += batch.geometryBytes;
    result.missing.push(...batch.missing);
    for (const p of drawn) result.drawn.add(p);
    const totals = totalsFor(drawn, args.manifest, caps);
    const draws = batch.meshes.reduce((n, mesh) => n + (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .reduce((sum, m) => sum + (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1), 0), 0);
    const triangles = Math.max(totals.triangles, batch.triangles);
    if (key === "static") { staticTriangles += triangles; staticDraws += draws; continue; }
    const far = new THREE.Group();
    far.name = "kit-fallback";
    const bounds = new THREE.Box3();
    for (const role of ["stairs", "escalator"] as const) {
      const keys = new Set(drawn.filter((p) => p.role === role).map((p) => p.anchorKey));
      if (keys.size) far.add(ledger.copy(role === "stairs" ? "stair-nosing" : "escalator-balustrade", keys));
      for (const run of anchors.runs.filter((r) => keys.has(r.key))) {
        bounds.expandByPoint(new THREE.Vector3(run.lo.x, run.lo.z, -run.lo.y));
        bounds.expandByPoint(new THREE.Vector3(run.hi.x, run.hi.z, -run.hi.y));
      }
    }
    group.add(far);
    batch.group.visible = false;
    cells.push({ near: batch.group, far, bounds, placed: drawn, triangles, draws });
  }
  result.tinted = [...new Set(result.tinted)].sort();
  const viewer = new THREE.Vector3();
  const lod = {
    active,
    update(position: { x: number; y: number; z: number }) {
      // The station viewer uses ENU; geometry uses Three's Y-up frame.
      viewer.set(position.x, position.z, -position.y);
      let triangles = staticTriangles, draws = staticDraws;
      active.clear();
      const ordered = cells.map((cell) => ({ cell, distance: cell.bounds.distanceToPoint(viewer) }))
        .sort((a, b) => a.distance - b.distance);
      for (const { cell, distance } of ordered) {
        const near = distance <= (cell.near.visible ? 32 : 24)
          && triangles + cell.triangles <= budget.maxTriangles && draws + cell.draws <= budget.maxDraws;
        cell.near.visible = near;
        cell.far.visible = !near;
        if (near) {
          triangles += cell.triangles;
          draws += cell.draws;
          for (const p of cell.placed) active.add(p.anchorKey);
        }
      }
    },
  };
  return { ...result, lod };
}
