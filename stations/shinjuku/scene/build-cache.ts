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

/** Two independent 53-bit string hashes (cyrb53 with different seeds) plus the length. Not a security
 * boundary: it only decides whether an in-memory snapshot is for the same inputs. */
function contentKey(...values: unknown[]): string {
  const text = JSON.stringify(values);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, g1 = 0x9e3779b9, g2 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    g1 = Math.imul(g1 ^ c, 1103515245) + 12345 | 0; g2 = Math.imul(g2 ^ c, 2246822519);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  g1 = Math.imul(g1 ^ (g1 >>> 16), 2246822507) ^ Math.imul(g2 ^ (g2 >>> 13), 3266489909);
  g2 = Math.imul(g2 ^ (g2 >>> 16), 2246822507) ^ Math.imul(g1 ^ (g1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}${(g2 >>> 0).toString(16)}${(g1 >>> 0).toString(16)}`;
}

let entry: { key: string; snapshot: { layout: Layout; protection: FareProtection } } | null = null;

export function clearLayoutCache() {
  entry = null;
}

export function prepareLayout(bundle: StationBundle, plan: Plan, options: PrepareOptions = {}): PreparedLayout {
  const key = options.reuse ? contentKey(bundle, plan) : "";
  if (entry && options.reuse && entry.key === key) {
    const copy = structuredClone(entry.snapshot);
    adoptRestrictedAccess(copy.layout, plan, bundle);
    return { ...copy, cached: true };
  }
  const layout = buildLayout(bundle, plan);
  const protection = protectFareAndAccess(layout, plan, bundle, { verifyGeneratedInput: options.verifyGeneratedInput });
  if (options.reuse) entry = { key, snapshot: structuredClone({ layout, protection }) };
  return { layout, protection, cached: false };
}
