/**
 * Types for the optional Lane E kit swap (Issue #94). Nothing here is imported by the default scene
 * path: with the flag off the station is built exactly as before.
 */
import type * as THREE from "three";
import type { Layout, Plan, XY, XYZ } from "../layout.ts";
import type { FareProtection } from "../fare-fence.ts";
import type { StationBundle } from "@gteki/schema";

/** Build tier of the kit library: `assets/library` (full) or `assets/library/mobile`. */
export type KitTier = "full" | "mobile";

export type KitPlacementClass = "linear" | "wall" | "free" | "ceiling";

export interface KitSocket {
  name: string;
  /** glTF coordinates, metres, in the asset's own frame. */
  position: [number, number, number];
  yawDeg: number;
  width?: number;
  height?: number;
}

export interface KitTexturePlan {
  res: number;
  maps: string[];
}

/** One asset of a `gteki-asset/0.1` manifest, as the Shinjuku adapter needs it. */
export interface KitAsset {
  id: string;
  family: string;
  /** Path relative to the manifest, exactly as the manifest states it. Never composed by hand. */
  file: string;
  bytes: number;
  triangles: number;
  materials: string[];
  textures: Record<string, KitTexturePlan>;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  placement: KitPlacementClass;
  params: Record<string, unknown>;
  sockets: KitSocket[];
  tags: string[];
}

export interface KitManifest {
  contract: string;
  tier: KitTier;
  /** The manifest's `license` string, carried through verbatim for credit wiring. Never interpreted. */
  license: string;
  assets: KitAsset[];
  byId: Map<string, KitAsset>;
}

/** What Shinjuku may ask the kit for. Each role has one selector (config.ts). */
export type KitRole = "gate" | "lift" | "stairs" | "escalator" | "toilet" | "exit";

export interface GateRowAnchor {
  role: "gate";
  /** Graph edge id of the verified gate row. */
  key: string;
  center: XYZ;
  /** Unit passenger-flow direction, ENU. */
  dir: XY;
  width: number;
  floorId: string;
}

export interface LiftAnchor {
  role: "lift";
  /** Index of the portal in build order; stable for a given dataset. */
  key: string;
  nodeIds: string[];
  /** Point on the existing wall the portal is mounted on (ENU) and the floor height there. */
  wallPoint: XY;
  z: number;
  /** Unit vector along the wall. */
  u: XY;
  /** Unit vector from the wall into the walkable room. */
  normal: XY;
  floorId: string;
}

export interface RunAnchor {
  role: "stairs" | "escalator";
  key: string;
  lo: XYZ;
  hi: XYZ;
  width: number;
  /** Unit direction lo to hi in plan, ENU. */
  dir: XY;
  floorId: string;
}

export interface ToiletAnchor {
  role: "toilet";
  /** GSI facility id from plan.json. */
  key: string;
  /** F001 male, F002 female, F003 unisex (GSI indoor spec, H30.3). */
  code: string;
  /**
   * The facility point: a representative point of the room, not a door or an equipment position. The dataset has
   * no door source, so a toilet entrance piece has nowhere honest to go: toilets are a reported gap (config.ts).
   */
  point: XYZ;
  floorId: string;
}

export interface ExitTopAnchor {
  role: "exit";
  key: string;
  /** Top of the exit run at street level (ENU), and the generic canopy rectangle already drawn there. */
  top: XY;
  center: XY;
  u: XY;
  halfWidth: number;
  halfLength: number;
  z: number;
  floorId: string;
}

export type KitAnchor = GateRowAnchor | LiftAnchor | RunAnchor | ToiletAnchor | ExitTopAnchor;

export interface KitAnchors {
  gates: GateRowAnchor[];
  lifts: LiftAnchor[];
  runs: RunAnchor[];
  toilets: ToiletAnchor[];
  exits: ExitTopAnchor[];
}

/** A kit instance: which asset, and where. `matrix` maps asset space to the renderer frame (Y up). */
export interface KitPlacement {
  role: KitRole;
  anchorKey: string;
  assetId: string;
  /** Lower number = more screen time on the main routes = dropped last. */
  rank: number;
  floorId: string;
  position: [number, number, number];
  /** Yaw about +Y in radians (renderer frame). */
  yaw: number;
  /** What the placement replaces, when it replaces a placeholder drawn today. */
  replaces: PlaceholderGroup | null;
}

export type PlaceholderGroup = "gate-machines" | "lift-portals" | "stair-nosing";

/** Budget caps for one scene (director ruling, Issue #94). */
export interface KitBudget {
  maxDraws: number;
  maxTriangles: number;
  maxGeometryBytes: number;
  maxGpuTextureBytes: number;
}

export interface KitTotals {
  draws: number;
  triangles: number;
  geometryBytes: number;
  gpuTextureBytes: number;
}

export interface KitDrop {
  role: KitRole;
  anchorKey: string;
  assetId: string;
  reason: string;
}

export interface KitGap {
  role: KitRole;
  anchors: number;
  reason: string;
}

export interface KitSwapReport {
  tier: KitTier;
  /** Manifest licence string, verbatim. The swap makes no licence claim of its own. */
  license: string;
  placed: KitPlacement[];
  dropped: KitDrop[];
  /** Roles that had anchors but no usable piece or no placeholder hook: the Lane E gap list in code. */
  gaps: KitGap[];
  totals: KitTotals;
  budget: KitBudget;
  tinted: string[];
  /** What the scene really got, counted from the merged meshes (the totals above come from the manifest). */
  measured: KitTotals;
  /** Placeholder triangles hidden, per group. */
  hidden: Partial<Record<PlaceholderGroup, number>>;
}

/** Supplies a fresh object tree for an asset. A bundle loader clones the asset root; tests build stubs. */
export interface KitAssetProvider {
  instantiate(asset: KitAsset): THREE.Object3D | null;
}

/** Everything `KitSwap.apply` may read. It may only add kit meshes and hide placeholder triangles. */
export interface KitApplyContext {
  THREE: typeof THREE;
  bundle: StationBundle;
  plan: Plan;
  layout: Layout;
  protection: FareProtection;
  liftAnchors: LiftAnchor[];
  root: THREE.Group;
  /** Records which triangles of which merged placeholder mesh belong to which anchor. */
  ledger: PlaceholderLedgerView;
  levelGroups: Map<string, THREE.Group>;
  /** The build's disposal registry: anything the swap creates is released with the station. */
  track: <T extends { dispose(): void }>(x: T) => T;
}

/** The part of the placeholder ledger a swap needs. */
export interface PlaceholderLedgerView {
  /** Hide (remove) every triangle recorded for these anchor keys of this group. Returns triangles removed. */
  hide(group: PlaceholderGroup, anchorKeys: ReadonlySet<string>): number;
  /** Same, in two steps: nothing changes until `commit()`, so several groups can be prepared before any is hidden. */
  prepareHide(group: PlaceholderGroup, anchorKeys: ReadonlySet<string>): { removed: number; commit(): void };
  /** Anchor keys that have recorded placeholder geometry in this group. */
  keys(group: PlaceholderGroup): string[];
}

export interface KitSwap {
  /** Returns null when the swap failed: the error is logged, the placeholders are intact and nothing was added. */
  apply(ctx: KitApplyContext): KitSwapReport | null;
}
