import fs from "node:fs";
import path from "node:path";
import { routeWaypoints, stationData, type StationKey, type Vec3, type Waypoint } from "./gteki.ts";

/**
 * Wayfinding cues along a routed leg, from station data on disk (#108, A4).
 *
 * The app exposes no hook for "which signs are on screen" (nothing in main or in the repeater-sign PR #126
 * adds one), so cue spacing is computed from the route geometry and the files the scene itself loads:
 *   - signs: `stations/<key>/scene/signage.json` (positions, facing), the same file `scene.ts` builds from;
 *   - junctions: graph nodes with degree >= 3 on the route (interior nodes only);
 *   - fences: `scene/access_fences.json` "access unverified" segments (a visible cue, recorded separately).
 * Positions are along-route arc length `s` (m). Whether a cue is actually on screen is a separate,
 * approximate question (`aheadWithin`) and is only recorded.
 */

export type CueType = "sign" | "junction" | "fence";
export interface Cue { id: string; type: CueType; s: number; lateralM: number; /** sign only: dot of its facing with the walking direction; < 0 means its front faces the walker */ facingDot?: number; repeater?: boolean; /** #180 blue place boards (`sign-place-*`) */ place?: boolean }

export interface RouteLine { wps: Waypoint[]; s: number[]; lengthM: number; nodeS: number[] }

interface StepLike { edgeId: string; fromNodeId: string; toNodeId: string; reversed: boolean; mode: string }

/** Route polyline with cumulative arc length per waypoint and the arc length at every route node. */
export function routeLine(key: StationKey, steps: StepLike[]): RouteLine {
  const wps = routeWaypoints(key, steps);
  const s = [0];
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1]!.p, b = wps[i]!.p;
    s.push(s[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y)); // horizontal run: display heights are symbolic on stairs and lifts
  }
  // Node k's arc length: the last waypoint of step k-1 (node 0 is waypoint 0).
  const nodeS = [0];
  steps.forEach((_st, k) => {
    let last = 0;
    wps.forEach((w, i) => { if (w.stepIndex === k) last = i; });
    nodeS.push(s[last]!);
  });
  return { wps, s, lengthM: s.at(-1)!, nodeS };
}

/** Nearest point on the route to p: arc length, horizontal offset and height offset. `minS` keeps a one-way walk monotone. */
export function project(line: RouteLine, p: Vec3, minS = 0, dzWeight = 0.5): { s: number; lateralM: number; dz: number; dir: { x: number; y: number } } {
  let best = { cost: Infinity, s: 0, lateralM: Infinity, dz: 0, dir: { x: 1, y: 0 } };
  for (let i = 1; i < line.wps.length; i++) {
    if (line.s[i]! < minS) continue;
    const a = line.wps[i - 1]!.p, b = line.wps[i]!.p;
    const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
    if (len2 === 0) continue;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const lat = Math.hypot(p.x - (a.x + u * vx), p.y - (a.y + u * vy));
    const z = a.z + (b.z - a.z) * u;
    const dz = p.z - z;
    const cost = lat + dzWeight * Math.abs(dz);
    if (cost < best.cost) {
      const len = Math.sqrt(len2);
      best = { cost, s: line.s[i - 1]! + (line.s[i]! - line.s[i - 1]!) * u, lateralM: lat, dz, dir: { x: vx / len, y: vy / len } };
    }
  }
  return { s: best.s, lateralM: best.lateralM, dz: best.dz, dir: best.dir };
}

export interface SignRecord { id: string; position: Vec3; facing: { x: number; y: number } }

export function loadSigns(key: StationKey): SignRecord[] {
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const file = path.join(root, "stations", key, "scene", "signage.json");
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { signs: SignRecord[] }).signs;
}

export function loadFences(key: StationKey): { a: [number, number]; b: [number, number]; z0: number; z1: number }[] {
  const root = process.env.GTEKI_ROOT;
  if (!root) throw new Error("GTEKI_ROOT must point at the candidate checkout");
  const file = path.join(root, "stations", key, "scene", "access_fences.json");
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { fences: { a: [number, number]; b: [number, number]; z0: number; z1: number }[] }).fences ?? [];
}

export interface CueOptions {
  /** A sign or fence counts as on the route within this horizontal distance of it (m). */
  lateralMaxM?: number;
  /** ...and within this height of the route (signs hang ~2.5 m above the floor). */
  dzMaxM?: number;
}

/** All cues on the route, sorted by arc length. Junctions are interior route nodes of degree >= 3 in the graph. */
export function cuesAlong(key: StationKey, line: RouteLine, nodeIds: string[], opts: CueOptions = {}): Cue[] {
  const lateralMax = opts.lateralMaxM ?? 8, dzMax = opts.dzMaxM ?? 4;
  const cues: Cue[] = [];
  const { graph } = stationData(key);
  const degree = new Map<string, number>();
  for (const e of graph.edges) for (const n of [e.from, e.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  nodeIds.forEach((id, k) => {
    if (k === 0 || k === nodeIds.length - 1) return;
    if ((degree.get(id) ?? 0) >= 3) cues.push({ id: `junction:${id}`, type: "junction", s: line.nodeS[k]!, lateralM: 0 });
  });
  for (const sg of loadSigns(key)) {
    const pr = project(line, sg.position);
    if (pr.lateralM > lateralMax || Math.abs(pr.dz) > dzMax) continue;
    cues.push({ id: sg.id, type: "sign", s: pr.s, lateralM: pr.lateralM, facingDot: sg.facing.x * pr.dir.x + sg.facing.y * pr.dir.y, repeater: sg.id.startsWith("sign-rep-"), place: sg.id.startsWith("sign-place-") });
  }
  loadFences(key).forEach((f, i) => {
    const mid = { x: (f.a[0] + f.b[0]) / 2, y: (f.a[1] + f.b[1]) / 2, z: (f.z0 + f.z1) / 2 };
    const pr = project(line, mid);
    if (pr.lateralM > lateralMax || Math.abs(pr.dz) > dzMax + 2) return;
    cues.push({ id: `fence:${i}`, type: "fence", s: pr.s, lateralM: pr.lateralM });
  });
  return cues.sort((x, y) => x.s - y.s);
}

/** Gaps (m) between consecutive cue positions, with the leg's start and end as boundaries. */
export function gaps(cues: Pick<Cue, "id" | "s">[], lengthM: number): { maxGapM: number; from: string; to: string; list: { from: string; to: string; fromS: number; toS: number; gapM: number }[] } {
  const pts = [{ id: "start", s: 0 }, ...cues.map((c) => ({ id: c.id, s: c.s })), { id: "end", s: lengthM }].sort((a, b) => a.s - b.s);
  const list = [];
  for (let i = 1; i < pts.length; i++) list.push({ from: pts[i - 1]!.id, to: pts[i]!.id, fromS: round(pts[i - 1]!.s), toS: round(pts[i]!.s), gapM: round(pts[i]!.s - pts[i - 1]!.s) });
  const worst = list.reduce((m, g) => (g.gapM > m.gapM ? g : m), list[0]!);
  return { maxGapM: worst.gapM, from: worst.from, to: worst.to, list };
}

/** Cues from `s` up to `aheadM` further along the route (what the walker is approaching). */
export function aheadWithin(cues: Cue[], s: number, aheadM: number, behindM = 2): Cue[] {
  return cues.filter((c) => c.s >= s - behindM && c.s <= s + aheadM);
}

/**
 * Runs of consecutive samples that carry the same key (instruction + cues ahead) and together span more
 * than `minSpanM` of travel: stretches where nothing changes on the HUD or in the approaching cues.
 */
export function stagnantRuns<T extends { key: string; sM: number; i: number }>(samples: T[], minSpanM: number): { fromI: number; toI: number; fromS: number; toS: number; spanM: number; key: string }[] {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= samples.length; i++) {
    if (i < samples.length && samples[i]!.key === samples[start]!.key) continue;
    const a = samples[start]!, b = samples[i - 1]!;
    const spanM = b.sM - a.sM;
    if (i - start >= 2 && spanM > minSpanM) runs.push({ fromI: a.i, toI: b.i, fromS: round(a.sM), toS: round(b.sM), spanM: round(spanM), key: a.key });
    start = i;
  }
  return runs;
}

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
