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
import { planKitPlacements, totalsFor } from "./place.ts";
import type { KitApplyContext, KitAssetProvider, KitBudget, KitDrop, KitManifest, KitRole, KitSwap, KitSwapReport, PlaceholderGroup } from "./types.ts";

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
    apply(ctx: KitApplyContext): KitSwapReport | null {
      let added: KitApplyContext["root"] | null = null;
      let group: KitApplyContext["root"] | null = null;
      try {
        const anchors = collectKitAnchors({ layout: ctx.layout, protection: ctx.protection, plan: ctx.plan, bundle: ctx.bundle, lifts: ctx.liftAnchors });
        const plan = planKitPlacements({ anchors, manifest: opts.manifest, budget, caps: opts.caps, ...(opts.placeable ? { placeable: opts.placeable } : {}), log });
        const batch = batchKitPlacements({ placed: plan.placed, manifest: opts.manifest, provider: opts.provider, tint: opts.tint, track: ctx.track });
        group = batch.group;

        // A placement hides its placeholder only when all of its drawable batches merged successfully.
        const drawn = plan.placed.filter((p) => batch.drawn.has(p));
        const missing = new Set(batch.missing);
        const undrawn: KitDrop[] = plan.placed.filter((p) => !batch.drawn.has(p)).map((p) => ({
          role: p.role, anchorKey: p.anchorKey, assetId: p.assetId,
          reason: missing.has(p.assetId) ? "asset missing from the loaded kit bundle; placeholder kept" : "asset has no drawable visual mesh; placeholder kept",
        }));
        const hideKeys = new Map<PlaceholderGroup, Set<string>>();
        for (const p of drawn) {
          if (!p.replaces) continue;
          const set = hideKeys.get(p.replaces) ?? new Set<string>();
          set.add(p.anchorKey);
          hideKeys.set(p.replaces, set);
        }

        // Everything that can fail has run. Prepare every hide first (no mutation), add the kit, then commit.
        const prepared = [...hideKeys].map(([g, keys]) => [g, ctx.ledger.prepareHide(g, keys)] as const);
        if (batch.meshes.length) { ctx.root.add(batch.group); added = ctx.root; }
        const hidden: KitSwapReport["hidden"] = {};
        for (const [g, p] of prepared) { p.commit(); hidden[g] = p.removed; }

        const dropped = [...plan.dropped, ...undrawn];
        const report: KitSwapReport = {
          tier: opts.manifest.tier,
          license: opts.manifest.license,
          placed: drawn,
          dropped,
          gaps: plan.gaps,
          totals: totalsFor(drawn, opts.manifest, opts.caps),
          budget,
          tinted: batch.tinted,
          hidden,
          measured: { draws: batch.meshes.length, triangles: batch.triangles, geometryBytes: batch.geometryBytes, gpuTextureBytes: totalsFor(drawn, opts.manifest, opts.caps).gpuTextureBytes },
        };
        ctx.root.userData.kitSwap = report;
        const byRole = (r: KitRole) => drawn.filter((p) => p.role === r).length;
        log(`kit swap (${report.tier}): placed ${(Object.keys(ROLE_REPLACES) as KitRole[]).map((r) => `${r} ${byRole(r)}`).join(", ")}; ${batch.meshes.length} draws, ${Math.round(batch.triangles)} triangles; ${dropped.length} dropped, ${plan.gaps.length} gaps`);
        for (const g of plan.gaps) log(`kit swap gap: ${g.role} x${g.anchors}: ${g.reason}`);
        for (const d of undrawn) log(`kit swap: kept placeholder for ${d.role} ${d.anchorKey} (${d.assetId}): ${d.reason}`);
        return report;
      } catch (err) {
        if (added && group) group.removeFromParent();
        delete ctx.root.userData.kitSwap;
        log(`kit swap off: ${err instanceof Error ? err.message : String(err)}; placeholders stay`);
        return null;
      }
    },
  };
}
