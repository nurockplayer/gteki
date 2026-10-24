/**
 * Loading side of the swap: reads the manifest for the chosen tier and the derived kit bundle from the
 * station folder through the explorer's `ctx.loadGlb`. If anything is missing the swap is simply off and
 * the placeholders stay, so a build that does not ship the kit bundle can never half-switch.
 */
import type * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { contractName } from "./batch.ts";
import { ROLE_SELECTORS, kitBundleUri, kitFileUri, kitTierFor, tintSlots, type TierCaps } from "./config.ts";
import { loadLibraryManifest } from "./manifest.ts";
import { createKitSwap, type KitSwapOptions } from "./swap.ts";
import type { KitAsset, KitAssetProvider, KitManifest, KitSwap, KitTier } from "./types.ts";

/** Provider over a loaded kit bundle (`gteki-kit-bundle/0.1`): asset roots are the bundle root's children. */
export function bundleProvider(scene: THREE.Object3D): KitAssetProvider {
  const holder = scene.children.find((c) => c.userData?.gteki_bundle) ?? scene;
  const roots = new Map<string, THREE.Object3D>();
  for (const child of holder.children) roots.set(contractName(child), child);
  return { instantiate: (asset: KitAsset) => roots.get(asset.id)?.clone(true) ?? null };
}

/** Provider over individually loaded GLBs, keyed by asset id. */
export function mapProvider(roots: ReadonlyMap<string, THREE.Object3D>): KitAssetProvider {
  return { instantiate: (asset: KitAsset) => roots.get(asset.id)?.clone(true) ?? null };
}

export interface PrepareOptions {
  /** `?kit=mobile|full` or a test. Otherwise the tier follows the scene quality. */
  tier?: KitTier;
  caps?: TierCaps;
  /** The runtime line colour for `line_accent` slots (Oedo magenta). Passed in so this module owns no colour. */
  lineColour: string;
  /** Inject a manifest instead of importing the library's (tests). */
  manifest?: KitManifest;
  log?: (message: string) => void;
  /** Load one GLB per asset from `asset.file` instead of the bundle (fallback while no bundle is built). */
  perFile?: boolean;
}

export async function prepareKitSwap(
  ctx: { loadGlb(uri: string): Promise<GLTF>; quality: "low" | "high" },
  opts: PrepareOptions,
): Promise<KitSwap | null> {
  const log = opts.log ?? ((m: string) => console.info(m));
  const caps = opts.caps ?? { ktx2: false };
  const tier = kitTierFor(ctx.quality, caps, opts.tier);
  try {
    const manifest = opts.manifest ?? (await loadLibraryManifest(tier));
    let provider: KitAssetProvider;
    if (opts.perFile) {
      const roots = new Map<string, THREE.Object3D>();
      // Only the ids the roles can use are fetched; their files come from the manifest.
      const wanted = manifest.assets.filter((a) => Object.values(ROLE_SELECTORS).some((sel) => sel(a)));
      await Promise.all(wanted.map(async (a) => roots.set(a.id, (await ctx.loadGlb(kitFileUri(tier, a.file))).scene)));
      provider = mapProvider(roots);
    } else {
      provider = bundleProvider((await ctx.loadGlb(kitBundleUri(tier))).scene);
    }
    const swapOptions: KitSwapOptions = { manifest, provider, caps, tint: tintSlots(opts.lineColour), log };
    return createKitSwap(swapOptions);
  } catch (err) {
    log(`kit swap off: ${err instanceof Error ? err.message : String(err)}; placeholders stay`);
    return null;
  }
}
