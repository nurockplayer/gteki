/** Independent, swept-body audit of the two published walking representations. */
import * as THREE from "three";
import clipping, { type Polygon, type MultiPolygon } from "polygon-clipping";
import { WALKER_BODY, type WallSegment } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import {
  pointInRings,
  type Layout,
  type Plan,
  type WallSeg,
  type XY,
  type XYZ,
} from "../scene/layout.ts";

export const RESOLUTION = 0.25;
const R = WALKER_BODY.radiusM;
const EPS = 1e-5;
export interface Patch {
  rings: XY[][];
  height(p: XY): number;
}
interface Band {
  a: XY;
  b: XY;
  min: number;
  max: number;
}
export interface WalkerAudit {
  name: string;
  patches: Patch[];
  bands: Band[];
  propBands?: Band[];
  up: number;
  down: number;
  ground(p: XY, z: number): number | null;
}
export interface Sample extends XYZ {
  ix: number;
  iy: number;
  paid: string[];
  free: string[];
  mapped: boolean;
  level: string;
}
export interface Leak {
  level: string;
  position: XYZ;
  paidSpace: string;
  freeSpace: string;
}
export interface AuditResult {
  walker: string;
  samples: number;
  paidSeeds: number;
  leaks: Leak[];
  unmapped: XYZ[];
  reachableUnmapped: XYZ[];
  blockedEdges: string[];
}

export function lanePatches(layout: Layout): Patch[] {
  const slabs = [
    ...layout.levels.flatMap((l) => l.slabs),
    ...layout.pads,
    ...layout.linkStrips,
    ...layout.streetPads,
  ];
  return [
    ...slabs.map((s) => ({ rings: s.rings, height: () => s.z })),
    ...layout.runs.map((r) => {
      const dx = r.b.x - r.a.x,
        dy = r.b.y - r.a.y,
        ll = dx * dx + dy * dy,
        len = Math.sqrt(ll),
        nx = ((-dy / len) * r.width) / 2,
        ny = ((dx / len) * r.width) / 2;
      return {
        rings: [
          [
            { x: r.a.x + nx, y: r.a.y + ny },
            { x: r.a.x - nx, y: r.a.y - ny },
            { x: r.b.x - nx, y: r.b.y - ny },
            { x: r.b.x + nx, y: r.b.y + ny },
          ],
        ],
        height: (p: XY) =>
          r.a.z +
          ((r.b.z - r.a.z) * ((p.x - r.a.x) * dx + (p.y - r.a.y) * dy)) / ll,
      };
    }),
  ];
}
/** Read actual exported proxy triangles, including their transforms and interpolated heights. */
export function proxyPatches(meshes: THREE.Object3D[]): Patch[] {
  const patches: Patch[] = [];
  for (const obj of meshes) {
    const m = obj as THREE.Mesh,
      g = m.geometry,
      pos = g.getAttribute("position"),
      index = g.index;
    const at = (i: number): XYZ => {
      const p = new THREE.Vector3()
        .fromBufferAttribute(pos, index ? index.getX(i) : i)
        .applyMatrix4(m.matrixWorld);
      return { x: p.x, y: -p.z, z: p.y };
    };
    for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
      const a = at(i),
        b = at(i + 1),
        c = at(i + 2),
        det = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(det) < 1e-9) continue;
      const sx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / det;
      const sy = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / det;
      patches.push({
        rings: [[a, b, c]],
        height: (p) => a.z + sx * (p.x - a.x) + sy * (p.y - a.y),
      });
    }
  }
  return patches;
}
export function laneBands(walls: WallSeg[]): Band[] {
  return walls.map((w) => ({
    a: w.a,
    b: w.b,
    min: Math.max(w.zMin - 1.7, w.bodyMin ?? -Infinity),
    max: Math.min(w.zMax - 0.3, w.bodyMax ?? Infinity),
  }));
}
export function explorerBands(walls: WallSegment[]): Band[] {
  return walls.map((w) => ({
    a: w.a,
    b: w.b,
    min: w.zMin - WALKER_BODY.bodyTopM,
    max: w.zMax - WALKER_BODY.bodyBottomM,
  }));
}
function d2(p: XY, a: XY, b: XY) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
}
function cross(a: XY, b: XY, c: XY) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
export function segmentDistance2(a: XY, b: XY, c: XY, d: XY) {
  if (
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0 &&
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) >= Math.min(a.y, b.y)
  )
    return 0;
  return Math.min(d2(a, c, d), d2(b, c, d), d2(c, a, b), d2(d, a, b));
}
export class BodySweep {
  private cells = new Map<string, Band[]>();
  constructor(bands: Band[]) {
    for (const w of bands)
      for (
        let ix = Math.floor((Math.min(w.a.x, w.b.x) - R) / 2);
        ix <= Math.floor((Math.max(w.a.x, w.b.x) + R) / 2);
        ix++
      )
        for (
          let iy = Math.floor((Math.min(w.a.y, w.b.y) - R) / 2);
          iy <= Math.floor((Math.max(w.a.y, w.b.y) + R) / 2);
          iy++
        ) {
          const k = `${ix},${iy}`,
            list = this.cells.get(k) ?? [];
          list.push(w);
          this.cells.set(k, list);
        }
  }
  blocked(a: XYZ, b: XYZ) {
    const seen = new Set<Band>();
    for (
      let ix = Math.floor(Math.min(a.x, b.x) / 2);
      ix <= Math.floor(Math.max(a.x, b.x) / 2);
      ix++
    )
      for (
        let iy = Math.floor(Math.min(a.y, b.y) / 2);
        iy <= Math.floor(Math.max(a.y, b.y) / 2);
        iy++
      ) {
        for (const w of this.cells.get(`${ix},${iy}`) ?? []) {
          if (seen.has(w)) continue;
          seen.add(w);
          let lo = 0,
            hi = 1;
          const dz = b.z - a.z;
          if (Math.abs(dz) < EPS) {
            if (a.z < w.min - EPS || a.z > w.max + EPS) continue;
          } else {
            const t0 = (w.min - a.z) / dz,
              t1 = (w.max - a.z) / dz;
            lo = Math.max(0, Math.min(t0, t1));
            hi = Math.min(1, Math.max(t0, t1));
            if (lo > hi + EPS) continue;
          }
          const p = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo },
            q = { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
          if (segmentDistance2(p, q, w.a, w.b) < (R - EPS) ** 2) return true;
        }
      }
    return false;
  }
}
function patchCells(
  p: Patch,
  visit: (ix: number, iy: number, z: number) => void,
) {
  const pts = p.rings[0]!;
  for (
    let ix = Math.ceil(Math.min(...pts.map((p) => p.x)) / RESOLUTION - 0.5);
    ix <= Math.floor(Math.max(...pts.map((p) => p.x)) / RESOLUTION - 0.5);
    ix++
  )
    for (
      let iy = Math.ceil(Math.min(...pts.map((p) => p.y)) / RESOLUTION - 0.5);
      iy <= Math.floor(Math.max(...pts.map((p) => p.y)) / RESOLUTION - 0.5);
      iy++
    ) {
      const q = { x: (ix + 0.5) * RESOLUTION, y: (iy + 0.5) * RESOLUTION };
      if (pointInRings(q, p.rings)) visit(ix, iy, p.height(q));
    }
}
export function surfaceGrid(patches: Patch[]) {
  const grid = new Map<string, number[]>();
  for (const p of patches)
    patchCells(p, (ix, iy, z) => {
      const key = `${ix},${iy}`,
        zs = grid.get(key) ?? [];
      if (!zs.some((h) => Math.abs(h - z) < 1e-4)) zs.push(z);
      grid.set(key, zs);
    });
  return grid;
}
/** A proxy ground sampler independent of WalkWorld; barycentric interpolation matches downward rays. */
export function proxyGround(patches: Patch[]) {
  const bins = new Map<string, Patch[]>();
  for (const p of patches) {
    const pts = p.rings[0]!;
    for (
      let x = Math.floor(Math.min(...pts.map((p) => p.x)) / 4);
      x <= Math.floor(Math.max(...pts.map((p) => p.x)) / 4);
      x++
    )
      for (
        let y = Math.floor(Math.min(...pts.map((p) => p.y)) / 4);
        y <= Math.floor(Math.max(...pts.map((p) => p.y)) / 4);
        y++
      ) {
        const k = `${x},${y}`,
          v = bins.get(k) ?? [];
        v.push(p);
        bins.set(k, v);
      }
  }
  return (p: XY, z: number): number | null => {
    let best = -Infinity;
    for (const patch of bins.get(
      `${Math.floor(p.x / 4)},${Math.floor(p.y / 4)}`,
    ) ?? []) {
      if (
        !pointInRings(p, patch.rings) &&
        !patch.rings.some((r) =>
          r.some((a, i) => d2(p, a, r[(i + 1) % r.length]!) < 1e-10),
        )
      )
        continue;
      const h = patch.height(p);
      if (
        h <= z + WALKER_BODY.stepUpM + EPS &&
        h >= z - WALKER_BODY.stepDownM - EPS
      )
        best = Math.max(best, h);
    }
    return best === -Infinity ? null : best;
  };
}
function labels(grid: Map<string, number[]>, layout: Layout, plan: Plan) {
  const out: Sample[] = [],
    cells = new Map<string, number[]>();
  // Independent authority: unrestricted source spaces + verified-link strips/run landings + street pads.
  // Generic elevator envelopes are deliberately NOT accepted as mapped network space.
  const network = [
    ...layout.linkStrips,
    ...layout.pads.filter((p) => p.spaceId.startsWith("pad:")),
    ...layout.streetPads,
  ];
  const mapped = surfaceGrid([
    ...network.map((s) => ({ rings: s.rings, height: () => s.z })),
    ...lanePatches({
      ...layout,
      levels: [],
      pads: [],
      linkStrips: [],
      streetPads: [],
    } as Layout),
  ]);
  const fare = new Map<
    string,
    { z: number; paid: string[]; free: string[]; mapped: boolean }[]
  >();
  for (const lv of plan.levels)
    for (const s of lv.spaces) {
      if (s.restricted) continue;
      patchCells(
        { rings: s.rings, height: () => lv.renderElevationM },
        (ix, iy, z) => {
          const key = `${ix},${iy}`,
            list = fare.get(key) ?? [];
          let row = list.find((r) => Math.abs(r.z - z) < 0.02);
          if (!row) {
            row = { z, paid: [], free: [], mapped: true };
            list.push(row);
          }
          if (s.toll) row[s.toll].push(s.id);
          fare.set(key, list);
        },
      );
    }
  for (const [key, zs] of grid) {
    const [ix, iy] = key.split(",").map(Number) as [number, number];
    const ids: number[] = [];
    for (const z of zs) {
      const f = fare.get(key)?.find((r) => Math.abs(r.z - z) < 0.02);
      const level = layout.levels.reduce((a, b) =>
        Math.abs(a.z - z) < Math.abs(b.z - z) ? a : b,
      ).label;
      ids.push(out.length);
      out.push({
        ix,
        iy,
        x: (ix + 0.5) * RESOLUTION,
        y: (iy + 0.5) * RESOLUTION,
        z,
        paid: f?.paid ?? [],
        free: f?.free ?? [],
        mapped:
          !!f || (mapped.get(key) ?? []).some((h) => Math.abs(h - z) < 0.02),
        level,
      });
    }
    cells.set(key, ids);
  }
  return { out, cells };
}
export function gateCrossing(
  a: XYZ,
  b: XYZ,
  layout: Layout,
  plan: Plan,
  walker: WalkerAudit,
) {
  let p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  // Test the actual fare boundary intersection, not a grid-cell midpoint that can
  // overshoot the 1 m corridor by half a sample. This keeps the corridor exactly 1 m.
  const paid = plan.levels
    .filter((l) => Math.abs(l.renderElevationM - p.z) < 0.02)
    .flatMap((l) => l.spaces.filter((s) => !s.restricted && s.toll === "paid"));
  const inPaid = (q: XY) => paid.some((s) => pointInRings(q, s.rings));
  if (inPaid(a) && !inPaid(b)) {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 24; i++) {
      const t = (lo + hi) / 2,
        q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (inPaid(q)) lo = t;
      else hi = t;
    }
    p = {
      x: a.x + (b.x - a.x) * hi,
      y: a.y + (b.y - a.y) * hi,
      z: a.z + (b.z - a.z) * hi,
    };
  }
  // A fare crossing is authorized only at the verified gate edge, not merely anywhere along a row.
  return layout.gates.some((g) => {
    if (
      Math.abs(g.center.z - p.z) >= 0.15 ||
      Math.abs((p.x - g.center.x) * g.dir.x + (p.y - g.center.y) * g.dir.y) > 1
    )
      return false;
    const normal = (q: XY) =>
      (q.x - g.center.x) * -g.dir.y + (q.y - g.center.y) * g.dir.x;
    const machines = (walker.propBands ?? [])
      .filter((w) => {
        const dx = w.b.x - w.a.x,
          dy = w.b.y - w.a.y;
        const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
        return (
          Math.abs(Math.hypot(dx, dy) - 1.5) < 0.001 &&
          Math.abs(dx * g.dir.y - dy * g.dir.x) < 0.001 &&
          g.center.z >= w.min &&
          g.center.z <= w.max &&
          Math.abs(
            (mid.x - g.center.x) * g.dir.x + (mid.y - g.center.y) * g.dir.y,
          ) < 0.05
        );
      })
      .map((w) => normal({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }));
    if (machines.some((n) => Math.abs(n) < R)) return false;
    const left = Math.max(...machines.filter((n) => n < 0)),
      right = Math.min(...machines.filter((n) => n > 0));
    // This must be the aisle straddling the verified edge, never an adjacent machine aisle.
    return (
      Number.isFinite(left) &&
      Number.isFinite(right) &&
      normal(p) > left &&
      normal(p) < right &&
      Math.abs(normal(p)) <= g.width / 2
    );
  });
}
export function graphObstructions(
  walker: WalkerAudit,
  layout: Layout,
  bundle: StationBundle,
) {
  const body = new BodySweep(walker.bands),
    props = new BodySweep(walker.propBands ?? walker.bands),
    nodes = new Map(bundle.nodes.map((n) => [n.id, n])),
    bad: string[] = [];
  for (const e of bundle.edges) {
    const a = nodes.get(e.from)!,
      b = nodes.get(e.to)!,
      za = layout.nodeZ.get(a.id)!,
      zb = layout.nodeZ.get(b.id)!;
    const pts = e.geometry?.length ? e.geometry : [a.position, b.position],
      lens = [0];
    for (let i = 1; i < pts.length; i++)
      lens.push(
        lens[i - 1]! +
          Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y),
      );
    let previous: XYZ | undefined;
    outer: for (let j = 1; j < pts.length; j++) {
      const p = pts[j - 1]!,
        q = pts[j]!,
        len = lens[j]! - lens[j - 1]!,
        steps = Math.max(1, Math.ceil(Math.max(len, Math.abs(zb - za)) / 0.1));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps,
          s =
            lens.at(-1)! > EPS
              ? (lens[j - 1]! + len * t) / lens.at(-1)!
              : (j - 1 + t) / (pts.length - 1),
          v = {
            x: p.x + (q.x - p.x) * t,
            y: p.y + (q.y - p.y) * t,
            z: za + (zb - za) * s,
          };
        // Elevators carry the player between endpoint floors. Check the entire swept
        // shaft for prop barriers; the controller provides elevator transport, not
        // a walkable floor between landings. Structural lift liners are not passage walls.
        if (e.mode !== "elevator") {
          const ground = walker.ground(v, previous?.z ?? v.z);
          if (ground === null) {
            bad.push(
              `${e.id} ${e.mode} missing ground at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`,
            );
            break outer;
          }
          v.z = ground;
        }
        if ((e.mode === "elevator" ? props : body).blocked(previous ?? v, v)) {
          bad.push(
            `${e.id} ${e.mode} barrier at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`,
          );
          break outer;
        }
        previous = v;
      }
    }
  }
  return bad;
}
/** Continuous configuration-space supplement for level fare/access boundaries.
 * Inscribed (not circumscribed) radius capsules deliberately UNDER-block walls: every
 * genuinely clear path survives subtraction, including an arbitrarily narrow >2r gap.
 * This can conservatively flag a sub-millimetre near miss; it cannot seal a real gap.
 * The swept 3D flood below still verifies stairs, step limits and floor transitions.
 */
export function continuousBoundaries(walker: WalkerAudit, layout: Layout, plan: Plan) {
  const polygon = (rs: XY[][]): Polygon => rs.map(r => r.map(p => [p.x, p.y]));
  const union = (ps: Polygon[]): MultiPolygon => ps.length ? clipping.union(ps[0]!, ...ps.slice(1)) : [];
  const area = (ps: MultiPolygon) => ps.reduce((sum, p) => sum + p.reduce((a, r, i) => {
    const signed = Math.abs(r.reduce((n, v, j) => { const w = r[(j + 1) % r.length]!; return n + v[0] * w[1] - v[1] * w[0]; }, 0)) / 2;
    return a + (i ? -signed : signed);
  }, 0), 0);
  const capsule = (w: Band): Polygon => {
    const angle = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x), r: number[][] = [];
    for (const [c, offset] of [[w.b, -Math.PI / 2], [w.a, Math.PI / 2]] as const)
      for (let i = 0; i <= 32; i++) {
        const t = angle + offset + i * Math.PI / 32;
        // Snap only blockers, with an inward guard larger than rounding error.
        // Near-coincident CAD walls otherwise destabilize polygon-clipping's sweep.
        r.push([c.x + (R - EPS - 1e-7) * Math.cos(t), c.y + (R - EPS - 1e-7) * Math.sin(t)]
          .map(v => Math.round(v * 1e7) / 1e7));
      }
    r.push(r[0]!);
    return [r];
  };
  const leaks: Leak[] = [], unmapped: XYZ[] = [];
  for (const lv of layout.levels) {
    const support = walker.patches.filter(p => p.rings.flat().every(v => Math.abs(p.height(v) - lv.z) < 1e-4)).map(p => polygon(p.rings));
    if (!support.length) continue;
    const floor = union(support), source = plan.levels.find(l => Math.abs(l.renderElevationM - lv.z) < .02);
    const active = walker.bands.filter(w => w.min <= lv.z + EPS && w.max >= lv.z - EPS);
    const blocks = active.map(capsule);
    // Closing the authorized corridor in the audit separates legitimate paid/free
    // components. No physical machines => no exemption. Adjacent aisles stay audited.
    for (const g of layout.gates) {
      if (Math.abs(g.center.z - lv.z) > .02 || !gateCrossing(g.center, g.center, layout, plan, walker)) continue;
      const normal = { x: -g.dir.y, y: g.dir.x }, width = g.width / 2;
      const corners = [[-1, -width], [1, -width], [1, width], [-1, width], [-1, -width]];
      blocks.push([corners.map(([u, v]) => [g.center.x + u! * g.dir.x + v! * normal.x, g.center.y + u! * g.dir.y + v! * normal.y])]);
    }
    const open = blocks.length ? clipping.difference(floor, union(blocks)) : floor;
    const paid = source?.spaces.filter(s => !s.restricted && s.toll === "paid") ?? [];
    const free = source?.spaces.filter(s => !s.restricted && s.toll === "free") ?? [];
    const mapped = union([
      ...(source?.spaces.filter(s => !s.restricted).map(s => polygon(s.rings)) ?? []),
      ...[...layout.linkStrips, ...layout.pads.filter(p => p.spaceId.startsWith("pad:")), ...layout.streetPads]
        .filter(p => Math.abs(p.z - lv.z) < .02).map(p => polygon(p.rings)),
    ]);
    for (const component of open) {
      const hits = (spaces: typeof paid) => spaces.filter(s => area(clipping.intersection(component, polygon(s.rings))) > 1e-8);
      const a = hits(paid), b = hits(free);
      for (const p of a) for (const f of b) {
        const witness = clipping.intersection(component, polygon(f.rings))[0]![0]![0]!;
        leaks.push({ level: lv.label, position: { x: witness[0], y: witness[1], z: lv.z }, paidSpace: p.id, freeSpace: f.id });
      }
      // Proxy Float32 vertices can overshoot their ENU source boundary by microns.
      // Tolerate only a thin boundary sliver, never an arbitrary small-area region.
      const outside = mapped.length ? clipping.difference(component, mapped) : [component];
      const boundary = mapped.flatMap(p => p.flatMap(r => r.slice(1).map((v, i) => ({
        a: { x: r[i]![0], y: r[i]![1] }, b: { x: v[0], y: v[1] },
      }))));
      for (const piece of outside) {
        const size = area([piece]);
        const perimeter = piece.reduce((sum, r) => sum + r.slice(1).reduce((n, v, i) => n + Math.hypot(v[0] - r[i]![0], v[1] - r[i]![1]), 0), 0);
        const floatSliver = size / perimeter < 1e-5 && piece.flat().every(v =>
          boundary.some(w => d2({ x: v[0], y: v[1] }, w.a, w.b) < 1e-10));
        if (size <= 1e-10 || floatSliver) continue;
        const v = piece[0]![0]!;
        unmapped.push({ x: v[0], y: v[1], z: lv.z });
      }
    }
  }
  return { leaks, unmapped };
}

export function audit(
  walker: WalkerAudit,
  layout: Layout,
  plan: Plan,
  bundle: StationBundle,
): AuditResult {
  const grid = surfaceGrid(walker.patches),
    { out, cells } = labels(grid, layout, plan),
    body = new BodySweep(walker.bands);
  const clear = out.map((p) => !body.blocked(p, p)),
    seen = new Uint8Array(out.length),
    origin = new Array<string>(out.length),
    queue: number[] = [],
    leaks: Leak[] = [],
    unmapped: XYZ[] = [],
    reachableUnmapped: XYZ[] = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i]!;
    if (clear[i] && !p.mapped) unmapped.push({ x: p.x, y: p.y, z: p.z });
    if (clear[i] && p.paid.length) {
      seen[i] = 1;
      origin[i] = p.paid[0]!;
      queue.push(i);
      // Overlapping paid/free source polygons are a conflict, not a paid-label override.
      if (p.free.length && !gateCrossing(p, p, layout, plan, walker)) {
        leaks.push({
          level: p.level,
          position: { x: p.x, y: p.y, z: p.z },
          paidSpace: p.paid[0]!,
          freeSpace: p.free[0]!,
        });
      }
    }
  }
  const paidSeeds = queue.length,
    leaked = new Set<string>();
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!,
      p = out[id]!;
    if (!p.mapped) reachableUnmapped.push({ x: p.x, y: p.y, z: p.z });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const ids = cells.get(`${p.ix + dx!},${p.iy + dy!}`);
      if (!ids) continue;
      // The highest admissible surface wins, as in each real ground sampler.
      const qid = ids
        .filter(
          (i) =>
            out[i]!.z <= p.z + walker.up + EPS &&
            out[i]!.z >= p.z - walker.down - EPS,
        )
        .sort((a, b) => out[b]!.z - out[a]!.z)[0];
      if (qid === undefined || seen[qid] || !clear[qid]) continue;
      const q = out[qid]!,
        ground = walker.ground(q, p.z);
      if (
        ground === null ||
        Math.abs(ground - q.z) > 0.002 ||
        body.blocked(p, q)
      )
        continue;
      if (q.free.length && !q.paid.length) {
        if (!gateCrossing(p, q, layout, plan, walker)) {
          const k = `${qid}:${origin[id]}`;
          if (!leaked.has(k)) {
            leaked.add(k);
            leaks.push({
              level: q.level,
              position: { x: q.x, y: q.y, z: q.z },
              paidSpace: origin[id]!,
              freeSpace: q.free[0]!,
            });
          }
        }
        continue;
      }
      seen[qid] = 1;
      origin[qid] = origin[id]!;
      queue.push(qid);
    }
  }
  const continuous = continuousBoundaries(walker, layout, plan);
  leaks.push(...continuous.leaks);
  unmapped.push(...continuous.unmapped);
  return {
    walker: walker.name,
    samples: out.length,
    paidSeeds,
    leaks,
    unmapped,
    reachableUnmapped,
    blockedEdges: graphObstructions(walker, layout, bundle),
  };
}
