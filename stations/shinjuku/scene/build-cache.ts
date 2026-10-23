/**
 * Reopen cache for the renderer-neutral part of a Shinjuku build (#72): `buildLayout` and
 * `protectFareAndAccess`. Keyed by the content of the bundle and plan, so reopening the station through
 * the shared explorer (`openStation` again, same parsed bundle or an equal one) skips both.
 *
 * The cache holds a pristine snapshot taken right after `protectFareAndAccess`. `buildStation` mutates
 * the layout afterwards (it appends elevator and landing walls to `levels[].walls`), so every build,
 * hit or miss, works on its own structural copy and the snapshot never changes. A copy is plain data
 * plus one Map, which `structuredClone` reproduces exactly (shared references included, e.g. the
 * `gates` that `layout.gates` and the protection both point at); test/scene-digest.test.ts asserts the
 * outputs are byte-identical to an uncached build.
 *
 * Only the latest content is kept: Shinjuku has one bundle, and a changed bundle replaces the entry.
 */
import type { StationBundle } from "@gteki/schema";
import { buildLayout, type Layout, type Plan } from "./layout.ts";
import { contentKey } from "./content-key.ts";
import { adoptRestrictedAccess, protectFareAndAccess, type FareProtection } from "./fare-fence.ts";

export interface PreparedLayout {
  layout: Layout;
  protection: FareProtection;
  /** True when the snapshot was reused (no buildLayout, no fence derivation). */
  cached: boolean;
}
export interface PrepareOptions {
  /** Reuse and fill the per-content snapshot. Off by default so tests that mutate inputs stay isolated. */
  reuse?: boolean;
  /** Passed to protectFareAndAccess; see its doc. Default true. */
  verifyGeneratedInput?: boolean;
}

/** `verified`: the snapshot's fences were confirmed against the generated table's input key. An unverified
 * snapshot (built with verifyGeneratedInput:false) never serves a verified request. */
let entry: { key: string; verified: boolean; snapshot: { layout: Layout; protection: FareProtection } } | null = null;

export function clearLayoutCache() {
  entry = null;
}

export function prepareLayout(bundle: StationBundle, plan: Plan, options: PrepareOptions = {}): PreparedLayout {
  const key = options.reuse ? contentKey(bundle, plan) : "";
  const verify = options.verifyGeneratedInput !== false;
  if (entry && options.reuse && entry.key === key && (entry.verified || !verify)) {
    const copy = structuredClone(entry.snapshot);
    adoptRestrictedAccess(copy.layout, plan, bundle);
    return { ...copy, cached: true };
  }
  const layout = buildLayout(bundle, plan);
  const protection = protectFareAndAccess(layout, plan, bundle, { verifyGeneratedInput: options.verifyGeneratedInput });
  if (options.reuse) entry = { key, verified: verify, snapshot: structuredClone({ layout, protection }) };
  return { layout, protection, cached: false };
}
