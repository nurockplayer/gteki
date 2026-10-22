// Finish packs: kit texture sets (Lane E, style.md section 3) that replace a role's procedural canvas texture.
// A pack is data: scene/finishes.json maps a role to a folder under gteki/assets/ and a repeat in metres.
// With no entry for a role, materials.ts keeps its procedural texture, so an empty manifest changes nothing.
// Textures are loaded through ctx.loadTexture, which only resolves files inside the station folder.
import type * as THREE_NS from "three";
import type { SceneContext } from "@gteki/scene-api";
type ThreeNS = typeof THREE_NS;

/** Roles a pack can replace. `shopfront` drives both `windows` and `doors`; `wall` and `barriers` also take a colour. */
export const FINISH_ROLES = ["floor", "ceiling", "stairs_ramps", "shopfront", "wall", "barriers"] as const;
export type FinishRole = (typeof FINISH_ROLES)[number];

/** File names inside the pack folder. `orm` (R occlusion, G roughness, B metal) is read as a roughness map: three uses its G channel. */
export interface FinishMaps {
  albedo?: string;
  normal?: string;
  roughness?: string;
  orm?: string;
}

export interface FinishPackSpec {
  /** Folder under stations/ikebukuro/gteki/ (what ctx.assetUrl sees), e.g. "assets/finishes/floor". */
  dir: string;
  /** Texture repeat in metres: one number for a square repeat, or [u, v]. UV0 is metric (1 unit = 1 m). */
  repeat_m: number | [number, number];
  maps?: FinishMaps;
  /** Per-map overrides for the low tier (a smaller variant). Maps not listed fall back to `maps`. */
  low?: FinishMaps;
  /** Tint, "#rrggbb". For `wall` and `barriers` without an albedo this is the new base colour. */
  color?: string;
  /** Repo path the sync script copies from (assets/library/...). Not read at runtime. */
  source?: string;
}

export interface FinishManifest {
  schema?: string;
  packs: Partial<Record<FinishRole, FinishPackSpec>>;
}

export interface FinishPack {
  map: THREE_NS.Texture | null;
  normalMap: THREE_NS.Texture | null;
  roughnessMap: THREE_NS.Texture | null;
  /** Packed 0xrrggbb from spec.color, or null when the pack gives none. */
  color: number | null;
}
export type FinishPacks = Partial<Record<FinishRole, FinishPack>>;

export interface LoadedFinishes {
  packs: FinishPacks;
  dispose(): void;
}

/** Style bible section 8: textures are at most 1k on the low tier. A larger loaded image drops the pack. */
export const MAX_LOW_PX = 1024;

type Host = Pick<SceneContext, "assetUrl" | "loadTexture">;

function parseColor(c: string | undefined): number | null {
  if (c === undefined) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  return m ? parseInt(m[1]!, 16) : null;
}

function repeatOf(r: FinishPackSpec["repeat_m"]): [number, number] | null {
  const v = typeof r === "number" ? [r, r] : Array.isArray(r) && r.length === 2 ? r : null;
  return v && v.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) ? [v[0]!, v[1]!] : null;
}

const canonical = (dir: string, file: string) =>
  [dir, file].every((s) => s !== "" && !s.startsWith("/") && !s.split("/").some((p) => p === ".." || p === "." || p === "")) ? `${dir}/${file}` : null;

async function loadPack(THREE: ThreeNS, host: Host, spec: FinishPackSpec, low: boolean): Promise<FinishPack | null> {
  const repeat = repeatOf(spec.repeat_m);
  if (!repeat) throw new Error("repeat_m must be a positive number or [u, v]");
  const maps = { ...spec.maps, ...(low ? spec.low : {}) };
  const color = parseColor(spec.color);
  if (spec.color !== undefined && color === null) throw new Error(`color ${spec.color} is not #rrggbb`);
  const rough = maps.roughness ?? maps.orm;
  // Relief is skipped on the low tier (the shader relief is a no-op there), so the normal map is not even fetched.
  const wanted: [keyof FinishPack, string | undefined, boolean][] = [
    ["map", maps.albedo, true],
    ["normalMap", low ? undefined : maps.normal, false],
    ["roughnessMap", rough, false],
  ];
  if (!wanted[0]![1] && color === null) throw new Error("a pack needs an albedo map or a colour");
  const loaded: THREE_NS.Texture[] = [];
  try {
    const out: FinishPack = { map: null, normalMap: null, roughnessMap: null, color };
    await Promise.all(
      wanted.map(async ([slot, file, srgb]) => {
        if (!file) return;
        const uri = canonical(spec.dir, file);
        if (!uri || host.assetUrl(uri) === null) throw new Error(`${file} is not in the station folder`);
        const t = await host.loadTexture(uri, { colorSpace: srgb ? "srgb" : "linear", flipY: true });
        loaded.push(t);
        const img = t.image as { width?: number; height?: number } | undefined;
        if (low && img && ((img.width ?? 0) > MAX_LOW_PX || (img.height ?? 0) > MAX_LOW_PX))
          throw new Error(`${file} is ${img.width}x${img.height}; the low tier allows ${MAX_LOW_PX}`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / repeat[0], 1 / repeat[1]);
        t.anisotropy = 8;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        (out as unknown as Record<string, THREE_NS.Texture>)[slot] = t;
      }),
    );
    return out;
  } catch (err) {
    for (const t of loaded) t.dispose();
    throw err;
  }
}

/**
 * Loads every pack in the manifest. A pack that cannot be used (file missing from the station folder, load
 * error, bad repeat, over-size on the low tier) is skipped with a console warning, so the role keeps its
 * procedural texture; the scene never fails because of a pack.
 */
export async function loadFinishPacks(THREE: ThreeNS, host: Host, manifest: FinishManifest, low: boolean): Promise<LoadedFinishes> {
  const packs: FinishPacks = {};
  const entries = (Object.entries(manifest.packs ?? {}) as [string, FinishPackSpec][]).filter(([role]) => {
    const ok = (FINISH_ROLES as readonly string[]).includes(role);
    if (!ok) console.warn(`[ikebukuro] finishes: unknown role ${role} ignored`);
    return ok;
  });
  await Promise.all(
    entries.map(async ([role, spec]) => {
      try {
        const pack = await loadPack(THREE, host, spec, low);
        if (pack) packs[role as FinishRole] = pack;
      } catch (err) {
        console.warn(`[ikebukuro] finishes: ${role}: ${err instanceof Error ? err.message : String(err)}; using the procedural texture`);
      }
    }),
  );
  return {
    packs,
    dispose() {
      for (const p of Object.values(packs)) for (const t of [p.map, p.normalMap, p.roughnessMap]) t?.dispose();
    },
  };
}
