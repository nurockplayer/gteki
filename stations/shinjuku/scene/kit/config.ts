/**
 * Decisions for Shinjuku's use of the Lane E kit (Issue #94). Everything that is a ruling or a
 * judgement call lives here, so the placement code stays mechanical.
 */
import type { KitAsset, KitBudget, KitRole, KitTier, PlaceholderGroup } from "./types.ts";

/**
 * The code-level switch. OFF until the asset library is cleared for release. A QA run can still opt in
 * with `?kit=1` (see `kitSwapRequested`); a build without the kit bundle in the station folder simply
 * keeps the placeholders.
 */
export const KIT_SWAP_DEFAULT = false;

/**
 * Station-relative locations (under stations/shinjuku/gteki/) of the derived kit files. The bundle is
 * `tools/blender/bundle_kit.py bundle` output; the per-file layout mirrors the library, so an asset's
 * path is `<KIT_ASSET_ROOT>/<tier>/<file from the manifest>`. See docs/stations/shinjuku/kit-swap.md.
 */
export const KIT_ASSET_ROOT = "assets/kit";
export const kitBundleUri = (tier: KitTier) => `${KIT_ASSET_ROOT}/${tier}.glb`;
export const kitFileUri = (tier: KitTier, file: string) => `${KIT_ASSET_ROOT}/${tier}/${file}`;

/**
 * Director's ruling for Shinjuku, per scene, measured on the shipped (meshopt + KTX2) variant:
 * at most +30 draws, +60k triangles, +3 MB geometry, 8 MB GPU textures. Decimal megabytes, the stricter reading.
 */
export const KIT_BUDGET: KitBudget = {
  maxDraws: 30,
  maxTriangles: 60_000,
  maxGeometryBytes: 3_000_000,
  maxGpuTextureBytes: 8_000_000,
};

/** Merged kit geometry is position + normal + uv (32 B) per vertex plus a 16-bit index; ~2 vertices per triangle. */
export const KIT_GEOMETRY_BYTES_PER_TRIANGLE = 70;

export interface TierCaps {
  /** True once the explorer's loader decodes KTX2 (it does not today: `SceneContext.loadGlb` is meshopt only). */
  ktx2: boolean;
}

/**
 * Quality tier to library tier. The mobile tier is used on both qualities until the loader decodes KTX2:
 * the full tier's 1024 px JPEG maps would be uploaded as RGBA8 and exceed the 8 MB texture budget on
 * their own. `override` comes from the opt-in query (`?kit=full`) and from tests.
 */
export function kitTierFor(quality: "low" | "high", caps: TierCaps, override?: KitTier): KitTier {
  if (override) return override;
  return quality === "high" && caps.ktx2 ? "full" : "mobile";
}

/** Parse the opt-in. `?kit=1|on|mobile|full` enables; anything else, or no query at all, leaves it off. */
export function kitSwapRequested(search: string | undefined): { enabled: boolean; tier?: KitTier } {
  if (!search) return { enabled: KIT_SWAP_DEFAULT };
  const value = new URLSearchParams(search).get("kit");
  if (value === "mobile" || value === "full") return { enabled: true, tier: value };
  if (value === "1" || value === "on" || value === "true") return { enabled: true };
  if (value === "0" || value === "off" || value === "false") return { enabled: false };
  return { enabled: KIT_SWAP_DEFAULT };
}

/**
 * Lower is more screen time on the main routes (docs/stations/shinjuku/kit-swap.md, measured from the router:
 * an exit-to-platform walk spends about 26% of its time on escalators, 17% on stairs, one gate crossing per
 * route, lifts on about half of them and on every step-free one). Over budget, the highest numbers are dropped first.
 */
export const ROLE_RANK: Record<KitRole, number> = {
  escalator: 1,
  stairs: 2,
  gate: 3,
  exit: 4,
  lift: 5,
  toilet: 6,
};

/**
 * Which placeholder group a role replaces, and whether build.ts records that group so its triangles can
 * be hidden. `group: null` means the role adds geometry that is not drawn today (escalator comb plates and newels). A role whose
 * placeholder is drawn but not recorded cannot be placed: the kit would double the geometry.
 */
export const ROLE_REPLACES: Record<KitRole, { group: PlaceholderGroup | null; hooked: boolean }> = {
  gate: { group: "gate-machines", hooked: true },
  lift: { group: "lift-portals", hooked: true },
  // Stairs: the kit piece is nosing strips only, which replace the per-step nosing boxes (tagged per run in build.ts).
  stairs: { group: "stair-nosing", hooked: true },
  // Escalators: comb plates and newels only. The placeholder draws neither (truss, steps, balustrade panels and
  // lamps stay), so there is nothing to hide; the piece is additive and its parts must never include the balustrade.
  escalator: { group: null, hooked: true },
  exit: { group: null, hooked: false },
  toilet: { group: null, hooked: false },
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `parts` values this adapter accepts per dressing generator (PR #143: escalator balustrade|handrail|newel|comb, stair nosing|handrail|skirt). */
export const STAIR_PARTS = ["nosing"] as const;
export const ESCALATOR_PARTS = ["comb", "newel"] as const;
const partsAre = (a: KitAsset, want: readonly string[]) => {
  const p = a.params.parts;
  return Array.isArray(p) && p.length === want.length && want.every((w) => p.includes(w));
};

/**
 * Selectors choose a manifest asset for a role from its family, tags and params, never from a hard-coded
 * id or path. A role with no matching asset is a gap for Lane E and its anchors keep their placeholders.
 */
export type ActiveRole = Exclude<KitRole, "toilet">;
export const ROLE_SELECTORS: Record<ActiveRole, (a: KitAsset) => boolean> = {
  // One verified gate row = one aisle flanked by two machines. A multi-aisle array would draw aisles the
  // dataset does not have, so only single-aisle arrays qualify (none in kit 0.1.0).
  gate: (a) => a.family === "gate" && num(a.params.aisles) === 1,
  lift: (a) => a.family === "vertical" && a.placement === "wall" && /lift/.test(a.id),
  // Dressing pieces (Lane E D2, PR #143) fitted to a run through params. Only the parts Shinjuku has no placeholder
  // for are accepted: nosing for stairs; comb plates and newels for escalators. A piece that also carries the
  // balustrade, handrail or skirts would double geometry that stays, so it is never selected.
  stairs: (a) => a.family === "dressing" && a.tags.includes("stair") && partsAre(a, STAIR_PARTS) && num(a.params.step_count) !== null,
  escalator: (a) => a.family === "dressing" && a.tags.includes("escalator") && partsAre(a, ESCALATOR_PARTS) && num(a.params.rise_mm) !== null,
  exit: (a) => a.tags.some((t) => /(^|[:_ -])(canopy|exit)$/.test(t)) || a.family === "canopy",
};

/**
 * Roles that are never placed, whatever the manifest offers. Toilets: the three GSI facility points (F001 to F003)
 * are representative points of a room, not doors, and the dataset has no door source, so any entrance piece would
 * be invented placement. They stay a reported gap until a door source exists.
 */
export const ROLE_DISABLED: Partial<Record<KitRole, string>> = {
  toilet: "toilet facility points are room representatives, not doors; no placement until a door source exists",
};

/** Per-run fit tolerances for parametric stair and escalator pieces (the catalog quantises well inside these). */
export const RUN_FIT = { riseM: 0.1, widthM: 0.15, lengthM: 0.25 } as const;

/** build.ts draws the escalator steps `run.width - 0.1` wide; the dressing's `width_mm` is the step width. */
export const ESCALATOR_STEP_INSET_M = 0.1;
/**
 * Comb-to-comb horizontal run of an `escalator_dressing` piece = `run_mm` + 2 * flat_steps * 0.4 m. `run_mm` already
 * holds the eased transitions (`dressing.py` sets the straight incline to `run_mm` - one 0.8 m transition run, and
 * `vertical._escalator_path` adds two half-length eases), so no transition is added on top. Given `angle_deg` instead,
 * the run is rise / tan(angle) + one transition run.
 */
export const ESCALATOR_STEP_DEPTH_M = 0.4;
export const ESCALATOR_TRANSITION_M = 0.8;
export const ESCALATOR_FLAT_STEPS = 2;

/** Clear width of a single-aisle gate array the kit may build (Lane E: wide_w settable 1.00 to 1.04 m). */
export const GATE_CLEAR_RANGE_M = [1.0, 1.04] as const;

/** Lift portal: the door plane (`SOCKET_end`) is put on the existing wall plane, plus this lift against z-fighting. */
export const WALL_CLEARANCE_M = 0.004;
/** Floor-mounted pieces sit this far above the floor so their base plates never z-fight the canvas floor. */
export const FLOOR_LIFT_M = 0.003;

/** Material slots tinted at runtime. Matched on `extras.gteki_name`, falling back to the material name. */
export interface TintSlot {
  match: RegExp;
  colour: string;
}

/** Linear-light albedo of the tint base finish is ~0.89; this restores the line colour's hex (asset-contract, finishes). */
export const TINT_BASE_COMPENSATION = 1.12;

export function tintSlots(lineColour: string): TintSlot[] {
  return [{ match: /line_accent/i, colour: lineColour }];
}
