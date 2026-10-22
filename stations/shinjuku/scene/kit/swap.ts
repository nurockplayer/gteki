/**
 * The swap step. Called once from `buildStation`, after every placeholder exists and before the static
 * finishes are merged, and only when a `KitSwap` was passed in (the flag is on and the kit loaded).
 *
 * It adds kit meshes and hides the placeholder triangles of the anchors it took over. It never touches
 * colliders, walls, floors, camera blockers or fences: those are built from the layout, which it only reads.
 */
import { collectKitAnchors } from "./anchors.ts";
import { batchKitPlacements } from "./batch.ts";
import { KIT_BUDGET, ROLE_REPLACES, type TierCaps, type TintSlot } from "./config.ts";
import { planKitPlacements } from "./place.ts";
import type { KitApplyContext, KitAssetProvider, KitBudget, KitManifest, KitRole, KitSwap, KitSwapReport, PlaceholderGroup } from "./types.ts";

export interface KitSwapOptions {
  manifest: KitManifest;
  provider: KitAssetProvider;
  caps: TierCaps;
  tint: readonly TintSlot[];
  budget?: KitBudget;
  /** Defaults to the roles whose placeholder the build records. Tests may narrow or widen it. */
  placeable?: ReadonlySet<KitRole>;
  log?: (message: string) => void;
}

export function createKitSwap(opts: KitSwapOptions): KitSwap {
  const budget = opts.budget ?? KIT_BUDGET;
  const log = opts.log ?? ((m: string) => console.info(m));
  return {
    apply(ctx: KitApplyContext): KitSwapReport {
      const anchors = collectKitAnchors({ layout: ctx.layout, protection: ctx.protection, plan: ctx.plan, bundle: ctx.bundle, lifts: ctx.liftAnchors });
      const plan = planKitPlacements({ anchors, manifest: opts.manifest, budget, caps: opts.caps, ...(opts.placeable ? { placeable: opts.placeable } : {}), log });
      const batch = batchKitPlacements({ placed: plan.placed, manifest: opts.manifest, provider: opts.provider, tint: opts.tint, track: ctx.track });

      // A placement whose asset could not be built keeps its placeholder; every drawn one hides its own.
      const missing = new Set(batch.missing);
      const drawn = plan.placed.filter((p) => !missing.has(p.assetId));
      const hideKeys = new Map<PlaceholderGroup, Set<string>>();
      for (const p of drawn) {
        if (!p.replaces) continue;
        const set = hideKeys.get(p.replaces) ?? new Set<string>();
        set.add(p.anchorKey);
        hideKeys.set(p.replaces, set);
      }
      const hidden: KitSwapReport["hidden"] = {};
      for (const [group, keys] of hideKeys) hidden[group] = ctx.ledger.hide(group, keys);
      if (batch.meshes.length) ctx.root.add(batch.group);

      const dropped = [...plan.dropped, ...batch.missing.map((assetId) => ({ role: plan.placed.find((p) => p.assetId === assetId)!.role, anchorKey: "*", assetId, reason: "asset missing from the loaded kit bundle; placeholders kept" }))];
      const report: KitSwapReport = {
        tier: opts.manifest.tier,
        license: opts.manifest.license,
        placed: drawn,
        dropped,
        gaps: plan.gaps,
        totals: plan.totals,
        budget,
        tinted: batch.tinted,
        hidden,
        measured: { draws: batch.meshes.length, triangles: batch.triangles, geometryBytes: batch.geometryBytes, gpuTextureBytes: plan.totals.gpuTextureBytes },
      };
      ctx.root.userData.kitSwap = report;
      const byRole = (r: KitRole) => drawn.filter((p) => p.role === r).length;
      log(`kit swap (${report.tier}): placed ${(Object.keys(ROLE_REPLACES) as KitRole[]).map((r) => `${r} ${byRole(r)}`).join(", ")}; ${batch.meshes.length} draws, ${Math.round(batch.triangles)} triangles; ${plan.dropped.length} dropped, ${plan.gaps.length} gaps`);
      for (const g of plan.gaps) log(`kit swap gap: ${g.role} x${g.anchors}: ${g.reason}`);
      return report;
    },
  };
}
