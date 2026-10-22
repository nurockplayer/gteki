/**
 * Minimal triangle BVH for "is anything in the way?" queries (label occlusion) and for picking the
 * triangles a ray may hit (the explorer's ray tests, see meshBvh.ts). Engine-free so it can
 * be unit-tested: built from any position/index accessor (three's BufferAttribute fits), queried with a
 * segment o + t·d, t ∈ [0, 1], in the same space as the positions. Merged station meshes reach tens of
 * thousands of triangles, which a plain per-triangle raycast cannot test within a phone's frame.
 */

export interface Vec3Accessor {
  readonly count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}

export interface IndexAccessor {
  readonly count: number;
  getX(i: number): number;
}

/** Which faces block: as three's material.side (front = counter-clockwise seen from the ray's origin). */
export type Cull = "front-only" | "back-only" | "both";

const LEAF = 8;
/**
 * Barycentric slack (fraction of the triangle): rounding must never let a segment slip between two
 * triangles that share an edge. For an occlusion test, a hit 1e-7 outside a triangle is harmless.
 */
const EDGE_EPS = 1e-7;

/**
 * Does the segment o → o + d (t ∈ [0, 1]) touch the box stored as min xyz, max xyz at `box[at…at+5]`?
 * A zero direction component (±0) only asks whether the origin lies inside that slab.
 */
export function segmentHitsBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, box: ArrayLike<number>, at = 0): boolean {
  let t0 = 0, t1 = 1;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = box[at + axis]!, hi = box[at + 3 + axis]!;
    if (d === 0) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) { const tmp = a; a = c; c = tmp; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  return true;
}

/** As segmentHitsBox, for o + t·d with t ∈ [0, tMax], against the box grown by `pad` on every side. */
function rayHitsPaddedBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, pad: number, box: ArrayLike<number>, at: number): boolean {
  let t0 = 0, t1 = tMax;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = box[at + axis]! - pad, hi = box[at + 3 + axis]! + pad;
    if (d === 0) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) { const tmp = a; a = c; c = tmp; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  return true;
}

export class TriangleBvh {
  private constructor(
    /** 9 floats per triangle, in leaf order. */
    private readonly tris: Float32Array,
    /** Each leaf-order triangle's number in the geometry (index position / 3). */
    private readonly ids: Uint32Array,
    /** 6 floats per node: min xyz, max xyz. */
    private readonly bounds: Float32Array,
    /** 3 ints per node: [first child or -1 for a leaf, first triangle, triangle count]; second child = first + 1. */
    private readonly nodes: Int32Array,
  ) {}

  get triangleCount(): number {
    return this.tris.length / 9;
  }

  /** One tree over all of a geometry's triangles; groups and draw ranges are applied per query. */
  static build(position: Vec3Accessor, index: IndexAccessor | null): TriangleBvh {
    const n = Math.floor((index ? index.count : position.count) / 3);
    const vert = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    const src = new Float32Array(n * 9);
    const cent = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const v = vert(t, k);
        src[t * 9 + k * 3] = position.getX(v);
        src[t * 9 + k * 3 + 1] = position.getY(v);
        src[t * 9 + k * 3 + 2] = position.getZ(v);
      }
      for (let a = 0; a < 3; a++) cent[t * 3 + a] = (src[t * 9 + a]! + src[t * 9 + 3 + a]! + src[t * 9 + 6 + a]!) / 3;
    }
    const order = new Uint32Array(n);
    for (let t = 0; t < n; t++) order[t] = t;

    const bounds: number[] = [];
    const nodes: number[] = [];
    const addNode = () => { nodes.push(-1, 0, 0); bounds.push(0, 0, 0, 0, 0, 0); return nodes.length / 3 - 1; };
    const root = addNode();
    const stack: [number, number, number][] = [[root, 0, n]];
    while (stack.length) {
      const [node, start, end] = stack.pop()!;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = start; i < end; i++) {
        const t = order[i]!;
        for (let k = 0; k < 9; k += 3) {
          const x = src[t * 9 + k]!, y = src[t * 9 + k + 1]!, z = src[t * 9 + k + 2]!;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        const cx = cent[t * 3]!, cy = cent[t * 3 + 1]!, cz = cent[t * 3 + 2]!;
        if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx;
        if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy;
        if (cz < cz0) cz0 = cz; if (cz > cz1) cz1 = cz;
      }
      bounds.splice(node * 6, 6, x0, y0, z0, x1, y1, z1);
      nodes[node * 3 + 1] = start;
      nodes[node * 3 + 2] = end - start;
      if (end - start <= LEAF) continue;
      // Split at the middle of the longest centroid extent; fall back to halves if that separates nothing.
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = axis === 0 ? (cx0 + cx1) / 2 : axis === 1 ? (cy0 + cy1) / 2 : (cz0 + cz1) / 2;
      let split = start;
      for (let i = start; i < end; i++) {
        if (cent[order[i]! * 3 + axis]! < mid) { const tmp = order[i]!; order[i] = order[split]!; order[split] = tmp; split++; }
      }
      if (split === start || split === end) split = (start + end) >> 1;
      const left = addNode();
      addNode();
      nodes[node * 3] = left;
      stack.push([left, start, split], [left + 1, split, end]);
    }

    const tris = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) tris.set(src.subarray(order[i]! * 9, order[i]! * 9 + 9), i * 9);
    return new TriangleBvh(tris, order, new Float32Array(bounds), new Int32Array(nodes));
  }

  /**
   * Does the segment o → o + d hit any triangle (respecting `cull`)? `start`/`count` limit it to the
   * whole triangles inside a range in index (or, unindexed, vertex) units, like three's geometry
   * groups and draw range, so only what a material actually draws counts.
   */
  anyHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cull: Cull = "both", start = 0, count = Infinity): boolean {
    const end = start + count;
    if (this.tris.length === 0) return false;
    const b = this.bounds;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (!segmentHitsBox(ox, oy, oz, dx, dy, dz, b, node * 6)) continue;
      const child = this.nodes[node * 3]!;
      if (child >= 0) { stack.push(child, child + 1); continue; }
      const first = this.nodes[node * 3 + 1]!;
      const leafEnd = first + this.nodes[node * 3 + 2]!;
      for (let t = first; t < leafEnd; t++) {
        const at = this.ids[t]! * 3;
        if (at >= start && at + 3 <= end && this.hitTriangle(t, ox, oy, oz, dx, dy, dz, cull)) return true;
      }
    }
    return false;
  }

  /**
   * Push the number (index position / 3) of every triangle in a leaf whose box the ray o + t·d, t ∈ [0, tMax],
   * passes near. Conservative: boxes grow by a millionth of the tree's largest coordinate (plus 1e-6), far
   * beyond the rounding of a point three's Ray.intersectTriangle reports, so every triangle the ray hits is
   * pushed (each once, in no order).
   */
  rayCandidates(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number, out: number[]): void {
    if (this.tris.length === 0) return;
    const b = this.bounds;
    let reach = 0;
    for (let i = 0; i < 6; i++) reach = Math.max(reach, Math.abs(b[i]!));
    const pad = 1e-6 * (1 + reach);
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (!rayHitsPaddedBox(ox, oy, oz, dx, dy, dz, tMax, pad, b, node * 6)) continue;
      const child = this.nodes[node * 3]!;
      if (child >= 0) { stack.push(child, child + 1); continue; }
      const first = this.nodes[node * 3 + 1]!;
      const leafEnd = first + this.nodes[node * 3 + 2]!;
      for (let t = first; t < leafEnd; t++) out.push(this.ids[t]!);
    }
  }

  /** Bytes held by the tree (triangles, ids, bounds, nodes). */
  get byteLength(): number {
    return this.tris.byteLength + this.ids.byteLength + this.bounds.byteLength + this.nodes.byteLength;
  }

  /** Möller–Trumbore with three's face convention (Ray.intersectTriangle), closed under EDGE_EPS. */
  private hitTriangle(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cull: Cull): boolean {
    const p = this.tris;
    const k = t * 9;
    const ax = p[k]!, ay = p[k + 1]!, az = p[k + 2]!;
    const e1x = p[k + 3]! - ax, e1y = p[k + 4]! - ay, e1z = p[k + 5]! - az;
    const e2x = p[k + 6]! - ax, e2y = p[k + 7]! - ay, e2z = p[k + 8]! - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    let ddn = dx * nx + dy * ny + dz * nz;
    if (ddn === 0) return false;
    // ddn < 0: the ray meets the front face.
    if (cull === "front-only" && ddn > 0) return false;
    if (cull === "back-only" && ddn < 0) return false;
    const sign = ddn > 0 ? 1 : -1;
    ddn *= sign;
    const qx = ox - ax, qy = oy - ay, qz = oz - az;
    const slack = EDGE_EPS * ddn;
    // d · (q × e2)
    const b1 = sign * (dx * (qy * e2z - qz * e2y) + dy * (qz * e2x - qx * e2z) + dz * (qx * e2y - qy * e2x));
    if (b1 < -slack) return false;
    // d · (e1 × q)
    const b2 = sign * (dx * (e1y * qz - e1z * qy) + dy * (e1z * qx - e1x * qz) + dz * (e1x * qy - e1y * qx));
    if (b2 < -slack || b1 + b2 > ddn + slack) return false;
    const qdn = -sign * (qx * nx + qy * ny + qz * nz);
    return qdn >= 0 && qdn <= ddn;
  }
}
