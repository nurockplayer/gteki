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
 * be hidden. `undefined` means the role adds geometry that is not drawn today (toilets). A role whose
 * placeholder is drawn but not recorded cannot be placed: the kit would double the geometry.
 */
export const ROLE_REPLACES: Record<KitRole, { group: PlaceholderGroup | null; hooked: boolean }> = {
  gate: { group: "gate-machines", hooked: true },
  lift: { group: "lift-portals", hooked: true },
  stairs: { group: null, hooked: false },
  escalator: { group: null, hooked: false },
  exit: { group: null, hooked: false },
  toilet: { group: null, hooked: true },
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Selectors choose a manifest asset for a role from its family, tags and params, never from a hard-coded
 * id or path. A role with no matching asset is a gap for Lane E and its anchors keep their placeholders.
 */
export const ROLE_SELECTORS: Record<KitRole, (a: KitAsset) => boolean> = {
  // One verified gate row = one aisle flanked by two machines. A multi-aisle array would draw aisles the
  // dataset does not have, so only single-aisle arrays qualify (none in kit 0.1.0).
  gate: (a) => a.family === "gate" && num(a.params.aisles) === 1,
  lift: (a) => a.family === "vertical" && a.placement === "wall" && /lift/.test(a.id),
  // Fixed-geometry stairs and escalators do not fit Shinjuku's runs; only a parametric piece that states
  // the rise, width and length it was built for can (matched per run in place.ts).
  stairs: (a) => a.family === "vertical" && /stairs/.test(a.id) && num(a.params.rise) !== null,
  escalator: (a) => a.family === "vertical" && /escalator/.test(a.id) && num(a.params.rise) !== null,
  toilet: (a) => a.tags.some((t) => /(^|[:_ -])toilet$/.test(t)) || a.family === "toilet",
  exit: (a) => a.tags.some((t) => /(^|[:_ -])(canopy|exit)$/.test(t)) || a.family === "canopy",
};

/** Per-run fit tolerances for parametric stair and escalator pieces. */
export const RUN_FIT = { riseM: 0.1, widthM: 0.15, lengthM: 0.25 } as const;

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
