// Per-vertex shading data derived at load time from the GLB's own surfaces (no layout is added or changed).
//  - floorY: the walking surface under each wall/column vertex, so the skirting and kick plates sit at a
//    fixed height above the *local* floor even though the station's floors step between 25.9 and 29 m TP.
//  - noseDistance: for stair surfaces, the distance of each tread vertex from the tread's front edge (the
//    edge a riser hangs from), so a non-slip nosing strip can be drawn exactly on it.
// Pure functions over world-space arrays: unit-tested in node, wrapped for three.js in scene.ts.

/** Sentinel for "no floor found": the shader falls back to absolute elevation and draws no skirting. */
export const NO_FLOOR = -1000;
/** Tread distance for vertices that are not on any tread (risers, landings, ramps). */
export const NO_NOSE = 1;

export interface FloorIndex {
  /** Highest floor surface at (x, z) that is at or below maxY (+ tolerance in the caller); NaN if none. */
  below(x: number, z: number, maxY: number): number;
}

/** `tris`: world-space xyz, 9 numbers per triangle. Only roughly horizontal triangles become floor. */
export function buildFloorIndex(tris: ArrayLike<number>, cell = 2): FloorIndex {
  const n = Math.floor(tris.length / 9);
  const buckets = new Map<number, number[]>();
  const keyOf = (ix: number, iz: number) => ix * 73856093 + iz * 19349663;
  const keep: number[] = [];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = tris[o + 3]! - tris[o]!, uy = tris[o + 4]! - tris[o + 1]!, uz = tris[o + 5]! - tris[o + 2]!;
    const vx = tris[o + 6]! - tris[o]!, vy = tris[o + 7]! - tris[o + 1]!, vz = tris[o + 8]! - tris[o + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || Math.abs(ny) / len < 0.5) continue;
    keep.push(t);
    const x0 = Math.min(tris[o]!, tris[o + 3]!, tris[o + 6]!), x1 = Math.max(tris[o]!, tris[o + 3]!, tris[o + 6]!);
    const z0 = Math.min(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!), z1 = Math.max(tris[o + 2]!, tris[o + 5]!, tris[o + 8]!);
    for (let ix = Math.floor(x0 / cell); ix <= Math.floor(x1 / cell); ix++)
      for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++) {
        const k = keyOf(ix, iz);
        const b = buckets.get(k);
        if (b) b.push(t);
        else buckets.set(k, [t]);
      }
  }
  const EPS = 1e-4;
  return {
    below(x, z, maxY) {
      const list = buckets.get(keyOf(Math.floor(x / cell), Math.floor(z / cell)));
      let best = NaN;
      if (!list) return best;
      for (const t of list) {
        const o = t * 9;
        const ax = tris[o]!, az = tris[o + 2]!, bx = tris[o + 3]!, bz = tris[o + 5]!, cx = tris[o + 6]!, cz = tris[o + 8]!;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -EPS || l2 < -EPS || l3 < -EPS) continue;
        const y = l1 * tris[o + 1]! + l2 * tris[o + 4]! + l3 * tris[o + 7]!;
        if (y <= maxY && !(y <= best)) best = y;
      }
      return best;
    },
  };
}

const PROBES: [number, number][] = [
  [0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12],
  [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3],
  [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6],
];

/**
 * Walking surface under a point of a wall/column. Wall vertices sit on the boundary of the floor polygons, so
 * probe a few offsets and take the highest surface that is not above the vertex (`tol` forgives a vertex
 * sitting a hair under the floor).
 */
export function floorYFor(index: FloorIndex, x: number, y: number, z: number, tol = 0.2): number {
  for (const [dx, dz] of PROBES) {
    const f = index.below(x + dx, z + dz, y + tol);
    if (!Number.isNaN(f) && y - f < 8) return f;
  }
  return NO_FLOOR;
}

/**
 * Height-above-floor attribute for a wall/column geometry. `pos`: world xyz per vertex.
 */
export function floorYAttribute(pos: ArrayLike<number>, index: FloorIndex): Float32Array {
  const n = Math.floor(pos.length / 3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = floorYFor(index, pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
  return out;
}

/**
 * Distance (m) of each vertex from the nose of the tread it belongs to; NO_NOSE elsewhere. A tread's nose edge
 * is the one whose vertices coincide with the top edge of a riser (a vertical triangle). `pos`: world xyz per
 * vertex; `index`: triangle list or null for unindexed.
 */
export function noseDistances(pos: ArrayLike<number>, index: ArrayLike<number> | null): Float32Array {
  const nv = Math.floor(pos.length / 3);
  const out = new Float32Array(nv).fill(NO_NOSE);
  const ntri = index ? Math.floor(index.length / 3) : Math.floor(nv / 3);
  const vi = (t: number, k: number) => (index ? index[t * 3 + k]! : t * 3 + k);
  const Q = 0.004;
  const cellKey = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;
  const tops = new Set<string>();
  const nrm = new Float32Array(ntri);
  for (let t = 0; t < ntri; t++) {
    const a = vi(t, 0) * 3, b = vi(t, 1) * 3, c = vi(t, 2) * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm[t] = Math.abs(ny) / len;
    if (nrm[t]! < 0.1) {
      const top = Math.max(pos[a + 1]!, pos[b + 1]!, pos[c + 1]!);
      for (const p of [a, b, c]) if (pos[p + 1]! >= top - 0.003) tops.add(cellKey(Math.round(pos[p]! / Q), Math.round(pos[p + 1]! / Q), Math.round(pos[p + 2]! / Q)));
    }
  }
  const isTop = (p: number) => {
    const ix = Math.round(pos[p]! / Q), iy = Math.round(pos[p + 1]! / Q), iz = Math.round(pos[p + 2]! / Q);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) if (tops.has(cellKey(ix + dx, iy + dy, iz + dz))) return true;
    return false;
  };
  // Pass 1: treads with two nose vertices define the nose line for all their vertices.
  const lineOf = new Map<number, [number, number, number, number, number]>(); // vertex -> ax, az, bx, bz, len
  const weld = new Map<string, number>(); // position -> first vertex index (indexed data may split vertices per face)
  const welded = (p: number) => {
    const k = cellKey(Math.round(pos[p]! / 0.001), Math.round(pos[p + 1]! / 0.001), Math.round(pos[p + 2]! / 0.001));
    const w = weld.get(k);
    if (w === undefined) {
      weld.set(k, p / 3);
      return p / 3;
    }
    return w;
  };
  for (let t = 0; t < ntri; t++) {
    if (nrm[t]! < 0.9) continue;
    const ps = [vi(t, 0) * 3, vi(t, 1) * 3, vi(t, 2) * 3];
    const nose = ps.filter(isTop);
    if (nose.length !== 2) continue;
    const [a, b] = nose as [number, number];
    const len = Math.hypot(pos[b]! - pos[a]!, pos[b + 2]! - pos[a + 2]!);
    if (len < 0.05) continue;
    const L: [number, number, number, number, number] = [pos[a]!, pos[a + 2]!, pos[b]!, pos[b + 2]!, len];
    for (const p of ps) lineOf.set(welded(p), L);
    for (const p of nose) out[p / 3] = 0;
  }
  // Pass 2: remaining vertices of tread triangles (including the quad's second triangle) measure against the line
  // their welded vertices carry.
  for (let t = 0; t < ntri; t++) {
    if (nrm[t]! < 0.9) continue;
    const ps = [vi(t, 0) * 3, vi(t, 1) * 3, vi(t, 2) * 3];
    let L: [number, number, number, number, number] | undefined;
    for (const p of ps) L ??= lineOf.get(welded(p));
    if (!L) continue;
    for (const p of ps) {
      if (isTop(p)) {
        out[p / 3] = 0;
        continue;
      }
      const d = Math.abs((L[2] - L[0]) * (L[1] - pos[p + 2]!) - (L[0] - pos[p]!) * (L[3] - L[1])) / L[4];
      out[p / 3] = Math.min(out[p / 3]!, Math.min(d, NO_NOSE));
    }
  }
  return out;
}
