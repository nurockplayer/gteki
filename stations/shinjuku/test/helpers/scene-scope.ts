/** Runs in a separate --expose-gc process: the returned scene must not keep assembleScene's scope alive.
 * Every closure defined in that scope shares one context, so a probe hung on the build context survives
 * exactly as long as any of them do, including the layout copy and the built station they would hold (#72).
 * The cache snapshot is dropped first on purpose: releaseCaches holds it, not the scene. Held here: only
 * the returned scene. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import plan from "../../data/plan.json" with { type: "json" };
import type { Plan } from "../../scene/layout.ts";
import { prepareLayout } from "../../scene/build-cache.ts";
import * as THREE from "three";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import { assembleScene, releaseShinjukuCaches } from "../../gteki/scene.ts";

const context = new Proxy({}, { get: (_t, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
Object.assign(globalThis, { document: { createElement: () => ({ width: 1, height: 1, getContext: () => context }) } });
const { bundle } = loadShinjukuBundle();
const gc = (globalThis as typeof globalThis & { gc(): void }).gc;

const { scene, probeRef } = await (async () => {
  const text = gunzipSync(readFileSync(new URL("../../data/layout-baked.bin", import.meta.url))).toString("utf8");
  if (!prepareLayout(bundle, plan as Plan, { reuse: true, layoutBakeText: text }).cached)
    throw new Error("#968 must exercise the baked layout");
  const probe = {};
  const scene = assembleScene({ THREE, bundle, quality: "low", enuToRenderer: ({ x, y, z }: { x: number; y: number; z: number }) => [x, z, -y], probe } as never);
  releaseShinjukuCaches();
  return { scene, probeRef: new WeakRef(probe) };
})();
await new Promise<void>((resolve) => setImmediate(resolve));
gc();
const sceneScopeCollected = probeRef.deref() === undefined;
scene.dispose();
console.log(JSON.stringify({ sceneScopeCollected, bakedHit: true }));
