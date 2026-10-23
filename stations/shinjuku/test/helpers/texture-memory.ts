/**
 * Texture-memory estimate for a built Shinjuku scene (#72 follow-up). Walks every mesh material of the scene
 * root, collects each texture object once (same object shared by several materials counts once), and estimates
 * its GPU footprint as width x height x bytes-per-pixel, x 4/3 when mipmaps are generated or sampled.
 *
 * Categories are inferred from how a texture is used, because the generators create anonymous CanvasTextures:
 *  - "signage":   anything on a mesh with userData.gteki_role === "sign" (scene/textures.ts sign plates and the
 *                 build.ts sign atlas pages "sign-faces:*"), plus the street-shop "surface-signs" atlas (surface.ts).
 *  - "facade":    the "surface-facade-*" meshes (scene/surface-materials.ts facadeTexture).
 *  - "paving":    the "surface-ground", "surface-asphalt" and "surface-street-*" meshes (pavingTexture).
 *  - "sky":       a "surface-sky" mesh (skyMaterial has no texture today, so this is empty).
 *  - "lighting":  textures bound as aoMap/lightMap (the build.ts light pool atlas).
 *  - "kit":       meshes whose name starts with "kit-" (reserved; no kit textures today).
 *  - "finish":    the remaining MeshStandardMaterial map/bump/roughness sets from scene/textures.ts
 *                 (floor tiles, wall cladding, ceiling, tactile strips).
 *  - "other":     anything the rules above do not recognise; the entry lists its size, slots and mesh names.
 *
 * This module measures only; it sets no budget. Thresholds belong to the lead reviewing the report.
 */
import type * as THREE from "three";

export const TEXTURE_CATEGORIES = ["signage", "facade", "paving", "sky", "lighting", "kit", "finish", "other"] as const;
export type TextureCategory = (typeof TEXTURE_CATEGORIES)[number];

export interface TextureEntry {
  category: TextureCategory;
  /** Width x height in pixels. */
  width: number;
  height: number;
  /** Estimated GPU bytes, mip chain included (x 4/3) when it is generated or sampled. */
  bytes: number;
  /** Material slots the texture is bound to (map, bumpMap, ...). */
  slots: string[];
  /** Names of the meshes (or their gteki_role) that use it, sorted. */
  meshes: string[];
  /** Human-readable label for the "other" list and for debugging. */
  label: string;
}

export interface TextureBudget {
  totalBytes: number;
  totalMib: number;
  textureCount: number;
  byCategory: { category: TextureCategory; textures: number; mib: number }[];
  entries: TextureEntry[];
  /** Unrecognised textures, listed by label (empty when every texture was classified). */
  other: TextureEntry[];
}

interface Usage {
  meshName: string;
  role: string;
  materialType: string;
  slot: string;
}

/** Components per pixel for three's pixel formats (numeric fallbacks keep this working across minor versions). */
const FORMAT_COMPONENTS: Record<number, number> = {
  1023: 4, // RGBAFormat
  1022: 3, // RGBFormat
  1030: 2, // RGFormat
  1028: 1, // RedFormat
  1021: 1, // AlphaFormat
  1025: 1, // DepthFormat
  1026: 2, // DepthStencilFormat
};
/** Bytes per component for three's data types. */
const TYPE_BYTES: Record<number, number> = {
  1009: 1, // UnsignedByteType
  1010: 1, // ByteType
  1016: 2, // HalfFloatType
  1013: 2, // UnsignedShortType
  1011: 2, // ShortType
  1015: 4, // FloatType
  1014: 4, // UnsignedIntType
  1012: 4, // IntType
};

const instance = <T extends object>(x: unknown): T => x as T;

function textureSize(texture: THREE.Texture): { width: number; height: number } {
  const image = texture.image as { width?: number; height?: number; data?: { width?: number; height?: number } } | undefined;
  return { width: image?.width ?? image?.data?.width ?? 0, height: image?.height ?? image?.data?.height ?? 0 };
}

/** Bytes for one texture: pixels x components x bytes-per-component, x 4/3 when a mip chain is generated/sampled. */
export function textureBytes(texture: THREE.Texture): number {
  const compressed = instance<{ isCompressedTexture?: boolean; mipmaps?: { data?: { byteLength?: number } }[] }>(texture);
  if (compressed.isCompressedTexture) {
    return (compressed.mipmaps ?? []).reduce((sum, m) => sum + (m.data?.byteLength ?? 0), 0);
  }
  const { width, height } = textureSize(texture);
  const components = FORMAT_COMPONENTS[texture.format] ?? 4;
  const bytesPerComponent = TYPE_BYTES[texture.type] ?? 1;
  const pixels = width * height;
  // Mip chain stored when it is generated, or when the sampler can pick a mip level (four mip filters in three).
  const mipmaps = texture.generateMipmaps !== false || [1004, 1005, 1007, 1008].includes(texture.minFilter as number);
  return pixels * components * bytesPerComponent * (mipmaps ? 4 / 3 : 1);
}

function categorize(usages: Usage[], width: number, height: number): TextureCategory {
  const names = usages.map((u) => u.meshName);
  const roles = usages.map((u) => u.role);
  const slots = usages.map((u) => u.slot);
  const mesh = (test: (name: string) => boolean) => names.some(test);
  // Sign plates are one row high (SIGN_ROW_HEIGHT = 128 in scene/textures.ts); some are unnamed.
  if (height === 128 || roles.includes("sign") || mesh((n) => n.startsWith("sign-faces:") || n === "surface-signs")) return "signage";
  if (mesh((n) => n.startsWith("surface-facade"))) return "facade";
  if (mesh((n) => n === "surface-ground" || n === "surface-asphalt" || n.startsWith("surface-street"))) return "paving";
  if (mesh((n) => n === "surface-sky" || n === "sky")) return "sky";
  if (slots.some((s) => s === "aoMap" || s === "lightMap")) return "lighting";
  if (mesh((n) => n.startsWith("kit-"))) return "kit";
  if (usages.some((u) => u.materialType === "MeshStandardMaterial" && (u.slot === "map" || u.slot === "bumpMap" || u.slot === "roughnessMap"))) return "finish";
  return "other";
}

/** Every texture reachable from a mesh material, each object once, with its estimated GPU bytes. */
export function collectTextures(root: THREE.Object3D): TextureEntry[] {
  const usage = new Map<THREE.Texture, Usage[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const name = mesh.name || "";
    const role = String(mesh.userData?.gteki_role ?? "");
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const record = material as unknown as Record<string, unknown> & { type: string };
      for (const [slot, value] of Object.entries(record)) {
        const texture = value as THREE.Texture;
        if (!texture || typeof texture !== "object" || !instance<{ isTexture?: boolean }>(texture).isTexture) continue;
        const list = usage.get(texture) ?? [];
        list.push({ meshName: name, role, materialType: record.type, slot });
        usage.set(texture, list);
      }
    }
  });
  return [...usage].map(([texture, usages]) => {
    const { width, height } = textureSize(texture);
    const slots = [...new Set(usages.map((u) => u.slot))].sort();
    const meshes = [...new Set(usages.map((u) => u.meshName || `role=${u.role}`))].sort();
    const category = categorize(usages, width, height);
    return {
      category,
      width,
      height,
      bytes: textureBytes(texture),
      slots,
      meshes,
      label: `${width}x${height} [${slots.join(",")}] on ${meshes.slice(0, 3).join("; ") || "?"}`,
    };
  });
}

/** Per-category MiB and texture counts, plus the grand total. */
export function textureBudget(root: THREE.Object3D): TextureBudget {
  const entries = collectTextures(root);
  const byCategory = TEXTURE_CATEGORIES.map((category) => {
    const list = entries.filter((e) => e.category === category);
    return { category, textures: list.length, mib: list.reduce((sum, e) => sum + e.bytes, 0) / 1024 / 1024 };
  });
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return {
    totalBytes,
    totalMib: totalBytes / 1024 / 1024,
    textureCount: entries.length,
    byCategory,
    entries,
    other: entries.filter((e) => e.category === "other"),
  };
}
