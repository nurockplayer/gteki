/**
 * Typed adapter over the Lane E manifests (`gteki-asset/0.1`): `assets/library/manifest.json` (full) and
 * `assets/library/mobile/manifest.json` (mobile). Ids, files, sockets and params are read from the manifest;
 * nothing here guesses a path or an id.
 */
import type { KitAsset, KitManifest, KitPlacementClass, KitSocket, KitTexturePlan, KitTier } from "./types.ts";

const PLACEMENTS = new Set<string>(["linear", "wall", "free", "ceiling"]);
const SAFE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(finite);

export class KitManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(`kit manifest rejected: ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? ` (+${problems.length - 6} more)` : ""}`);
  }
}

/**
 * Validate and normalise a manifest. `tier` is what the caller believes it loaded; a mobile manifest
 * declares `"profile": "mobile"`, a full one has no `profile`. A mismatch is an error: the two tiers
 * must never be mixed up, since they differ in materials and textures.
 */
export function parseKitManifest(json: unknown, tier: KitTier): KitManifest {
  const problems: string[] = [];
  if (!isRecord(json)) throw new KitManifestError(["manifest is not an object"]);
  if (json.contract !== "gteki-asset/0.1") problems.push(`unsupported contract ${String(json.contract)}`);
  const declared: KitTier = json.profile === "mobile" ? "mobile" : "full";
  if (json.profile !== undefined && json.profile !== "mobile" && json.profile !== "full") problems.push(`unknown profile ${String(json.profile)}`);
  if (declared !== tier) problems.push(`expected the ${tier} tier but the manifest is ${declared}`);
  if (!Array.isArray(json.assets)) throw new KitManifestError([...problems, "assets is not an array"]);

  const assets: KitAsset[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of json.assets.entries()) {
    const where = `assets[${i}]`;
    if (!isRecord(raw)) { problems.push(`${where} is not an object`); continue; }
    const id = raw.id;
    if (typeof id !== "string" || !SAFE_ID.test(id)) { problems.push(`${where}.id is not a safe asset id`); continue; }
    const before = problems.length;
    if (seen.has(id)) problems.push(`duplicate asset id ${id}`);
    seen.add(id);
    if (typeof raw.file !== "string" || raw.file === "") problems.push(`${id}: file missing`);
    if (typeof raw.family !== "string") problems.push(`${id}: family missing`);
    if (!finite(raw.triangles) || raw.triangles < 0) problems.push(`${id}: triangles missing`);
    if (!finite(raw.bytes) || raw.bytes < 0) problems.push(`${id}: bytes missing`);
    if (typeof raw.placement !== "string" || !PLACEMENTS.has(raw.placement)) problems.push(`${id}: unknown placement ${String(raw.placement)}`);
    const bounds = raw.bounds_m;
    if (!isRecord(bounds) || !vec3(bounds.min) || !vec3(bounds.max)) problems.push(`${id}: bounds_m malformed`);
    const sockets: KitSocket[] = [];
    for (const s of Array.isArray(raw.sockets) ? raw.sockets : []) {
      if (!isRecord(s) || typeof s.name !== "string" || !vec3(s.position_gltf) || !finite(s.yaw_deg)) { problems.push(`${id}: malformed socket`); continue; }
      sockets.push({ name: s.name, position: s.position_gltf, yawDeg: s.yaw_deg, ...(finite(s.width) ? { width: s.width } : {}), ...(finite(s.height) ? { height: s.height } : {}) });
    }
    const textures: Record<string, KitTexturePlan> = {};
    if (isRecord(raw.textures)) {
      for (const [name, plan] of Object.entries(raw.textures)) {
        if (!isRecord(plan) || !finite(plan.res) || !Array.isArray(plan.maps)) { problems.push(`${id}: malformed texture plan ${name}`); continue; }
        textures[name] = { res: plan.res, maps: plan.maps.filter((m): m is string => typeof m === "string") };
      }
    }
    if (problems.length > before) continue;
    const b = bounds as { min: [number, number, number]; max: [number, number, number] };
    assets.push({
      id,
      family: String(raw.family),
      file: String(raw.file),
      bytes: Number(raw.bytes),
      triangles: Number(raw.triangles),
      materials: Array.isArray(raw.materials) ? raw.materials.filter((m): m is string => typeof m === "string") : [],
      textures,
      boundsMin: b.min,
      boundsMax: b.max,
      placement: raw.placement as KitPlacementClass,
      params: isRecord(raw.params) ? raw.params : {},
      sockets,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    });
  }
  if (problems.length) throw new KitManifestError(problems);
  return { contract: "gteki-asset/0.1", tier, license: typeof json.license === "string" ? json.license : "", assets, byId: new Map(assets.map((a) => [a.id, a])) };
}

/** The manifest's own socket, or null. Sockets are the only source of an asset's mating planes. */
export function socketOf(asset: KitAsset, name: string): KitSocket | null {
  return asset.sockets.find((s) => s.name === name) ?? null;
}

/** Assets that satisfy a selector, in manifest order, then by ascending triangle count (cheapest first). */
export function selectAssets(manifest: KitManifest, selector: (a: KitAsset) => boolean): KitAsset[] {
  return manifest.assets.filter(selector).sort((a, b) => a.triangles - b.triangles || a.id.localeCompare(b.id));
}

/**
 * The same asset id in the other tier, if the other manifest has it. Both tiers promise identical ids,
 * sockets and flap nodes (asset-contract §8); callers use this to confirm that before switching tier.
 */
export function counterpart(asset: KitAsset, other: KitManifest): KitAsset | null {
  return other.byId.get(asset.id) ?? null;
}

/**
 * The station's own built pieces, merged after the library's so a station manifest may restate a library id.
 * The mobile tier is the only one built for Shinjuku today (batch 2, Issue #94).
 */
function mergedTier(tier: KitTier, ...manifests: KitManifest[]): KitManifest {
  const byId = new Map<string, KitAsset>();
  for (const m of manifests) for (const a of m.assets) byId.set(a.id, a);
  return { contract: "gteki-asset/0.1", tier, license: manifests[0]?.license ?? "", assets: [...byId.values()], byId };
}

/**
 * Load a tier's manifest: the repository library, plus (mobile) the station's own built pieces from
 * `gteki/assets/kit/mobile.manifest.json`. Dynamic, so the JSON stays out of the default chunk: with the swap
 * off nothing here is fetched. The library layout (`assets/library/manifest.json`,
 * `assets/library/mobile/manifest.json`) is documented in asset-contract §6/§8.
 */
export async function loadLibraryManifest(tier: KitTier): Promise<KitManifest> {
  if (tier === "mobile") {
    const library = parseKitManifest((await import("../../../../assets/library/mobile/manifest.json", { with: { type: "json" } })).default, tier);
    const station = parseKitManifest((await import("../../gteki/assets/kit/mobile.manifest.json", { with: { type: "json" } })).default, tier);
    return mergedTier(tier, library, station);
  }
  const json = (await import("../../../../assets/library/manifest.json", { with: { type: "json" } })).default;
  return parseKitManifest(json, tier);
}
