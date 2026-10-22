/**
 * Turns Shinjuku anchors into kit instances (asset id + transform) and enforces the per-scene budget.
 *
 * Pure: it reads a manifest and anchors, and returns placements, drops and gaps. It never touches a scene.
 * Conventions come from asset-contract §1: a `linear` piece has its entry edge at z = 0 and runs along
 * local -Z; a `wall` piece has the wall plane at z = 0 and projects into the room along +Z; every piece
 * stands on y = 0. Sockets are read from the manifest.
 */
import {
  ESCALATOR_FLAT_STEPS, ESCALATOR_STEP_DEPTH_M, ESCALATOR_STEP_INSET_M, ESCALATOR_TRANSITION_M, FLOOR_LIFT_M, GATE_CLEAR_RANGE_M, KIT_GEOMETRY_BYTES_PER_TRIANGLE, ROLE_DISABLED, ROLE_RANK, ROLE_REPLACES, ROLE_SELECTORS, type ActiveRole, RUN_FIT, WALL_CLEARANCE_M, type TierCaps,
} from "./config.ts";
import { selectAssets, socketOf } from "./manifest.ts";
import type {
  ExitTopAnchor, GateRowAnchor, KitAnchors, KitAsset, KitBudget, KitDrop, KitGap, KitManifest, KitPlacement, KitRole, KitTotals, LiftAnchor, RunAnchor,
} from "./types.ts";

export interface PlaceInput {
  anchors: KitAnchors;
  manifest: KitManifest;
  budget: KitBudget;
  caps: TierCaps;
  /** Roles whose placeholder (if any) the build records. Defaults to the roles marked hooked in config.ts. */
  placeable?: ReadonlySet<KitRole>;
  log?: (message: string) => void;
}

export interface PlaceResult {
  placed: KitPlacement[];
  dropped: KitDrop[];
  gaps: KitGap[];
  totals: KitTotals;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ENU (x east, y north) to the renderer frame (x, z, -y). */
const flow3 = (d: { x: number; y: number }) => ({ x: d.x, z: -d.y });

/** Yaw about +Y that turns local +Z onto the renderer-frame horizontal direction d. */
export const yawFacing = (d: { x: number; z: number }) => Math.atan2(d.x, d.z);

/** Local +X after a yaw, in renderer-frame XZ. */
const localX = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

export function gatePlacement(a: GateRowAnchor, asset: KitAsset): Pick<KitPlacement, "position" | "yaw"> | null {
  const span = Array.isArray(asset.params.cabinet_span_z_m) ? asset.params.cabinet_span_z_m.filter((v): v is number => typeof v === "number") : [];
  const centres = Array.isArray(asset.params.aisle_centers_x_m) ? asset.params.aisle_centers_x_m.filter((v): v is number => typeof v === "number") : [];
  if (span.length !== 2 || centres.length !== 1) return null;
  const clear = Array.isArray(asset.params.aisle_widths_m) ? num(asset.params.aisle_widths_m[0]) : num(asset.params.wide_w);
  if (clear !== null && (clear < GATE_CLEAR_RANGE_M[0] - 1e-6 || clear > GATE_CLEAR_RANGE_M[1] + 1e-6)) return null;
  const f = flow3(a.dir);
  // Local -Z is the travel axis, so +Z faces against the passenger flow.
  const yaw = yawFacing({ x: -f.x, z: -f.z });
  const along = -(span[0]! + span[1]!) / 2; // entry edge to the middle of the cabinets, positive along travel
  const x = localX(yaw);
  const aisleX = centres[0]!;
  return {
    position: [a.center.x - f.x * along - x.x * aisleX, a.center.z + FLOOR_LIFT_M, -a.center.y - f.z * along - x.z * aisleX],
    yaw,
  };
}

export function liftPlacement(a: LiftAnchor, asset: KitAsset): Pick<KitPlacement, "position" | "yaw"> {
  const n = flow3(a.normal);
  // The portal's door plane is SOCKET_end (z < 0, recessed). Put that plane on the existing wall plane,
  // so the door is not hidden behind the station's wall quad; the surround then stands proud of the wall.
  const end = socketOf(asset, "end");
  const recess = end && end.position[2] < 0 ? -end.position[2] : 0;
  const offset = recess + WALL_CLEARANCE_M;
  return { position: [a.wallPoint.x + n.x * offset, a.z + FLOOR_LIFT_M, -a.wallPoint.y + n.z * offset], yaw: yawFacing(n) };
}

/** A transform, plus how far the piece is from the drawn anchor (sum of errors in units of their tolerance; 0 = exact). */
export type Fitted = Pick<KitPlacement, "position" | "yaw"> & { misfit?: number };

/** `null` when any error is beyond its tolerance, so a piece that does not fit is never placed. */
function fitted(t: Pick<KitPlacement, "position" | "yaw">, errors: [error: number, tolerance: number][]): Fitted | null {
  if (errors.some(([e, tol]) => Math.abs(e) > tol)) return null;
  return { ...t, misfit: errors.reduce((s, [e, tol]) => s + Math.abs(e) / tol, 0) };
}

/** Where the run goes: origin on the lower end, local -Z climbing toward the upper end. Shared by both dressing pieces. */
function runFrame(a: RunAnchor): Pick<KitPlacement, "position" | "yaw"> {
  const f = flow3(a.dir);
  return { position: [a.lo.x, a.lo.z + FLOOR_LIFT_M, -a.lo.y], yaw: yawFacing({ x: -f.x, z: -f.z }) };
}

const runGeometry = (a: RunAnchor) => ({
  rise: a.hi.z - a.lo.z,
  length: Math.hypot(a.hi.x - a.lo.x, a.hi.y - a.lo.y),
});

/**
 * `stair_dressing` with parts [nosing]: origin on the floor under the first nosing, risers climbing toward -Z.
 * Fits when step_count * riser, step_count * tread and width_mm match the drawn run.
 */
export function stairPlacement(a: RunAnchor, asset: KitAsset): Fitted | null {
  const n = num(asset.params.step_count), riser = num(asset.params.riser_mm), tread = num(asset.params.tread_mm), width = num(asset.params.width_mm);
  if (n === null || riser === null || tread === null || width === null) return null;
  const g = runGeometry(a);
  return fitted(runFrame(a), [[(n * riser) / 1000 - g.rise, RUN_FIT.riseM], [(n * tread) / 1000 - g.length, RUN_FIT.lengthM], [width / 1000 - a.width, RUN_FIT.widthM]]);
}

/** Comb-to-comb horizontal run of an escalator_dressing piece, from the manifest (comb_run_m) or its params. */
export function combRunM(params: Record<string, unknown>): number | null {
  const stated = num(params.comb_run_m);
  if (stated !== null) return stated;
  const rise = num(params.rise_mm);
  if (rise === null) return null;
  const run = num(params.run_mm) ?? (num(params.angle_deg) !== null ? (rise / Math.tan((num(params.angle_deg)! * Math.PI) / 180)) : null);
  if (run === null) return null;
  const flat = num(params.flat_steps) ?? ESCALATOR_FLAT_STEPS;
  return run / 1000 + 2 * flat * ESCALATOR_STEP_DEPTH_M + ESCALATOR_TRANSITION_M;
}

/**
 * `escalator_dressing` with parts [comb, newel]: origin on the bottom comb plate line, rising toward -Z. Fits when
 * rise_mm, the step width and the comb-to-comb run match the drawn run.
 */
export function escalatorPlacement(a: RunAnchor, asset: KitAsset): Fitted | null {
  const rise = num(asset.params.rise_mm), width = num(asset.params.width_mm), comb = combRunM(asset.params);
  if (rise === null || width === null || comb === null) return null;
  const g = runGeometry(a);
  return fitted(runFrame(a), [[rise / 1000 - g.rise, RUN_FIT.riseM], [comb - g.length, RUN_FIT.lengthM], [width / 1000 + ESCALATOR_STEP_INSET_M - a.width, RUN_FIT.widthM]]);
}

export function exitPlacement(a: ExitTopAnchor, _asset: KitAsset): Pick<KitPlacement, "position" | "yaw"> {
  // A canopy is a `free` piece centred on its footprint; its long axis lies along the exit run (a.u).
  const n = flow3(a.u);
  return { position: [a.center.x, a.z + FLOOR_LIFT_M, -a.center.y], yaw: yawFacing(n) };
}

/** Budget numbers for a set of placements, from the manifest alone (no GLB needed). */
export function totalsFor(placed: readonly KitPlacement[], manifest: KitManifest, caps: TierCaps): KitTotals {
  const batches = new Set<string>();
  const textures = new Map<string, number>();
  let triangles = 0;
  for (const p of placed) {
    const asset = manifest.byId.get(p.assetId)!;
    triangles += asset.triangles;
    for (const m of asset.materials) batches.add(`${p.floorId}|${materialKey(m)}`);
    for (const [name, plan] of Object.entries(asset.textures)) {
      const bytes = plan.res * plan.res * (4 / 3) * plan.maps.length * (caps.ktx2 ? 1 : 4);
      const key = materialKey(name);
      textures.set(key, Math.max(textures.get(key) ?? 0, bytes));
    }
  }
  return {
    draws: batches.size,
    triangles,
    geometryBytes: triangles * KIT_GEOMETRY_BYTES_PER_TRIANGLE,
    gpuTextureBytes: Math.round([...textures.values()].reduce((s, v) => s + v, 0)),
  };
}

/** `<material>~<asset_id>` (AO-baked clone) batches with `<material>`; `extras.gteki_name` says the same at runtime. */
export const materialKey = (name: string) => name.replace(/~.*$/, "");

function breach(t: KitTotals, b: KitBudget): string | null {
  if (t.draws > b.maxDraws) return `draws ${t.draws} > ${b.maxDraws}`;
  if (t.triangles > b.maxTriangles) return `triangles ${t.triangles} > ${b.maxTriangles}`;
  if (t.geometryBytes > b.maxGeometryBytes) return `geometry ${t.geometryBytes} B > ${b.maxGeometryBytes} B`;
  if (t.gpuTextureBytes > b.maxGpuTextureBytes) return `GPU textures ${t.gpuTextureBytes} B > ${b.maxGpuTextureBytes} B`;
  return null;
}

export function planKitPlacements(input: PlaceInput): PlaceResult {
  const { anchors, manifest, budget, caps } = input;
  const log = input.log ?? (() => {});
  const placeable = input.placeable ?? new Set((Object.keys(ROLE_REPLACES) as KitRole[]).filter((r) => ROLE_REPLACES[r].hooked));
  const gaps: KitGap[] = [];
  const candidates: KitPlacement[] = [];
  const dropped: KitDrop[] = [];

  const consider = <A extends { key: string; floorId: string }>(role: KitRole, list: A[], place: (a: A, asset: KitAsset) => Fitted | null) => {
    if (!list.length) return;
    const disabled = ROLE_DISABLED[role];
    if (disabled) {
      gaps.push({ role, anchors: list.length, reason: disabled });
      return;
    }
    if (!placeable.has(role)) {
      gaps.push({ role, anchors: list.length, reason: "the build does not record this role's placeholder geometry yet; placing a piece would double it" });
      return;
    }
    const pool = selectAssets(manifest, ROLE_SELECTORS[role as ActiveRole]);
    if (!pool.length) {
      gaps.push({ role, anchors: list.length, reason: `no ${role} piece in the ${manifest.tier} manifest fits Shinjuku (a gap for Lane E)` });
      return;
    }
    let unfit = 0;
    for (const a of list) {
      // The closest fit wins; among equals the cheaper piece (pool order) does.
      let chosen: { asset: KitAsset; t: Fitted } | null = null;
      for (const asset of pool) {
        const t = place(a, asset);
        if (t && (!chosen || (t.misfit ?? 0) < (chosen.t.misfit ?? 0) - 1e-9)) chosen = { asset, t };
      }
      if (!chosen) { unfit++; dropped.push({ role, anchorKey: a.key, assetId: pool[0]!.id, reason: "no piece fits this anchor" }); continue; }
      candidates.push({
        role, anchorKey: a.key, assetId: chosen.asset.id, rank: ROLE_RANK[role], floorId: a.floorId,
        position: chosen.t.position, yaw: chosen.t.yaw, replaces: ROLE_REPLACES[role].group,
      });
    }
    if (unfit === list.length) gaps.push({ role, anchors: list.length, reason: `${manifest.tier} manifest has ${role} pieces, none fits any of the ${list.length} anchors` });
  };

  consider("gate", anchors.gates, gatePlacement);
  consider("lift", anchors.lifts, liftPlacement);
  consider("stairs", anchors.runs.filter((r) => r.role === "stairs"), stairPlacement);
  consider("escalator", anchors.runs.filter((r) => r.role === "escalator"), escalatorPlacement);
  consider("exit", anchors.exits, exitPlacement);
  consider("toilet", anchors.toilets, () => null); // disabled in config.ts: reported as a gap, never placed

  // Highest-ranked first; drop from the tail as soon as the budget is breached.
  candidates.sort((a, b) => a.rank - b.rank || a.anchorKey.localeCompare(b.anchorKey));
  const placed: KitPlacement[] = [];
  let cut: string | null = null;
  for (const c of candidates) {
    if (cut === null) {
      const why = breach(totalsFor([...placed, c], manifest, caps), budget);
      if (why === null) { placed.push(c); continue; }
      cut = why;
      dropped.push({ role: c.role, anchorKey: c.anchorKey, assetId: c.assetId, reason: `over budget (${why})` });
    } else {
      dropped.push({ role: c.role, anchorKey: c.anchorKey, assetId: c.assetId, reason: `ranked below a placement dropped for budget (${cut})` });
    }
  }
  for (const d of dropped) log(`kit swap: dropped ${d.role} ${d.anchorKey} (${d.assetId}): ${d.reason}`);
  return { placed, dropped, gaps, totals: totalsFor(placed, manifest, caps) };
}
