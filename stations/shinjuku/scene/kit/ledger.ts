/**
 * Placeholder ledger: remembers which triangles of which merged placeholder mesh belong to which anchor,
 * so the kit swap can hide exactly the placeholders it replaces and nothing else.
 *
 * It is bookkeeping only. Tagging a geometry and binding a mesh read the geometry but never change it,
 * so a build that records into a ledger and then never calls `hide` is byte-identical to one that has no
 * ledger at all. Hiding rewrites only the index buffer of the bound mesh (then drops unreferenced vertices).
 */
import * as THREE from "three";
import type { PlaceholderGroup, PlaceholderLedgerView } from "./types.ts";

interface Range {
  key: string;
  /** First index in the merged index buffer, and how many. */
  start: number;
  count: number;
}

export class PlaceholderLedger implements PlaceholderLedgerView {
  private readonly tags = new WeakMap<THREE.BufferGeometry, { group: PlaceholderGroup; key: string }>();
  private readonly bound: { group: PlaceholderGroup; mesh: THREE.Mesh; ranges: Range[] }[] = [];

  constructor(private readonly track: <T extends { dispose(): void }>(x: T) => T) {}

  /** Mark a source geometry as belonging to `key`. Returns the geometry for chaining. */
  tag<G extends THREE.BufferGeometry>(group: PlaceholderGroup, key: string, geo: G): G {
    this.tags.set(geo, { group, key });
    return geo;
  }

  /**
   * Call after `mergeGeometries(geos)` produced `mesh`, with the same `geos` in the same order. Every geometry
   * must still carry its index (the build's `merged()` guarantees it), whose length is its slice of the result.
   */
  bind(group: PlaceholderGroup, mesh: THREE.Mesh, geos: readonly THREE.BufferGeometry[]): void {
    const ranges: Range[] = [];
    let start = 0;
    for (const g of geos) {
      const count = g.index ? g.index.count : g.attributes.position!.count;
      const tag = this.tags.get(g);
      if (tag && tag.group === group) ranges.push({ key: tag.key, start, count });
      start += count;
    }
    this.bound.push({ group, mesh, ranges });
  }

  keys(group: PlaceholderGroup): string[] {
    return [...new Set(this.bound.filter((b) => b.group === group).flatMap((b) => b.ranges.map((r) => r.key)))];
  }

  hide(group: PlaceholderGroup, anchorKeys: ReadonlySet<string>): number {
    let removed = 0;
    for (const entry of this.bound) {
      if (entry.group !== group) continue;
      const drop = entry.ranges.filter((r) => anchorKeys.has(r.key));
      if (!drop.length) continue;
      const geo = entry.mesh.geometry;
      const index = geo.index;
      if (!index) continue;
      const keep: number[] = [];
      let cursor = 0;
      for (const r of drop.sort((a, b) => a.start - b.start)) {
        for (let i = cursor; i < r.start; i++) keep.push(index.getX(i));
        cursor = r.start + r.count;
        removed += r.count / 3;
      }
      for (let i = cursor; i < index.count; i++) keep.push(index.getX(i));
      // Ranges after a hide would point at shifted indices: shrink them so a second hide stays correct.
      let shift = 0;
      const dropped = new Set(drop);
      entry.ranges = entry.ranges.filter((r) => !dropped.has(r)).map((r) => {
        shift = drop.filter((d) => d.start < r.start).reduce((s, d) => s + d.count, 0);
        return { ...r, start: r.start - shift };
      });
      if (!keep.length) {
        entry.mesh.removeFromParent();
        continue;
      }
      entry.mesh.geometry = this.track(compact(geo, keep));
    }
    return removed;
  }
}

/** A copy of `geo` holding only the vertices `indices` reference, renumbered in first-use order. */
export function compact(geo: THREE.BufferGeometry, indices: number[]): THREE.BufferGeometry {
  const map = new Map<number, number>();
  const order: number[] = [];
  for (const i of indices) if (!map.has(i)) { map.set(i, order.length); order.push(i); }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new (a.array.constructor as new (n: number) => typeof a.array)(order.length * a.itemSize);
    for (let n = 0; n < order.length; n++) for (let k = 0; k < a.itemSize; k++) arr[n * a.itemSize + k] = a.array[order[n]! * a.itemSize + k]!;
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(indices.map((i) => map.get(i)!));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
