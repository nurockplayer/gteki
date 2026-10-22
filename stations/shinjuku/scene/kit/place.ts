/**
 * Turns Shinjuku anchors into kit instances (asset id + transform) and enforces the per-scene budget.
 *
 * Pure: it reads a manifest and anchors, and returns placements, drops and gaps. It never touches a scene.
 * Conventions come from asset-contract §1: a `linear` piece has its entry edge at z = 0 and runs along
 * local -Z; a `wall` piece has the wall plane at z = 0 and projects into the room along +Z; every piece
 * stands on y = 0. Sockets are read from the manifest.
 */
import {
  FLOOR_LIFT_M, KIT_GEOMETRY_BYTES_PER_TRIANGLE, ROLE_RANK, ROLE_REPLACES, ROLE_SELECTORS, RUN_FIT, WALL_CLEARANCE_M, type TierCaps,
} from "./config.ts";
import { selectAssets, socketOf } from "./manifest.ts";
import type {
  ExitTopAnchor, GateRowAnchor, KitAnchors, KitAsset, KitBudget, KitDrop, KitGap, KitManifest, KitPlacement, KitRole, KitTotals, LiftAnchor, RunAnchor, ToiletAnchor,
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

export function runPlacement(a: RunAnchor, asset: KitAsset): Pick<KitPlacement, "position" | "yaw"> | null {
  const rise = num(asset.params.rise);
  const width = num(asset.params.width) ?? (num(asset.params.step_width) !== null ? num(asset.params.step_width)! : null);
  const length = num(asset.params.length);
  if (rise === null || width === null || length === null) return null;
  const dz = a.hi.z - a.lo.z;
  const L = Math.hypot(a.hi.x - a.lo.x, a.hi.y - a.lo.y);
  if (Math.abs(rise - dz) > RUN_FIT.riseM || Math.abs(width - a.width) > RUN_FIT.widthM || Math.abs(length - L) > RUN_FIT.lengthM) return null;
  const f = flow3(a.dir);
  return { position: [a.lo.x, a.lo.z + FLOOR_LIFT_M, -a.lo.y], yaw: yawFacing({ x: -f.x, z: -f.z }) };
}

export function toiletPlacement(a: ToiletAnchor, asset: KitAsset): Pick<KitPlacement, "position" | "yaw"> | null {
  const w = a.wall;
  if (!w) return null;
  const width = Math.max(asset.boundsMax[0] - asset.boundsMin[0], 0);
  if (width + 0.2 > w.length) return null;
  const s = Math.max(width / 2 + 0.1, Math.min(w.length - width / 2 - 0.1, w.s));
  const p = { x: w.point.x + w.u.x * (s - w.s), y: w.point.y + w.u.y * (s - w.s) };
  const n = flow3(w.normal);
  const recess = Math.max(0, -asset.boundsMin[2]);
  return { position: [p.x + n.x * (recess + WALL_CLEARANCE_M), a.point.z + FLOOR_LIFT_M, -p.y + n.z * (recess + WALL_CLEARANCE_M)], yaw: yawFacing(n) };
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

  const consider = <A extends { key: string; floorId: string }>(role: KitRole, list: A[], place: (a: A, asset: KitAsset) => Pick<KitPlacement, "position" | "yaw"> | null) => {
    if (!list.length) return;
    if (!placeable.has(role)) {
      gaps.push({ role, anchors: list.length, reason: "the build does not record this role's placeholder geometry yet; placing a piece would double it" });
      return;
    }
    const pool = selectAssets(manifest, ROLE_SELECTORS[role]);
    if (!pool.length) {
      gaps.push({ role, anchors: list.length, reason: `no ${role} piece in the ${manifest.tier} manifest fits Shinjuku (a gap for Lane E)` });
      return;
    }
    let unfit = 0;
    for (const a of list) {
      let chosen: { asset: KitAsset; t: Pick<KitPlacement, "position" | "yaw"> } | null = null;
      for (const asset of pool) {
        const t = place(a, asset);
        if (t) { chosen = { asset, t }; break; }
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
  consider("stairs", anchors.runs.filter((r) => r.role === "stairs"), runPlacement);
  consider("escalator", anchors.runs.filter((r) => r.role === "escalator"), runPlacement);
  consider("toilet", anchors.toilets, toiletPlacement);
  consider("exit", anchors.exits, exitPlacement);

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
