/** Runs in a separate --expose-gc process: the returned scene must not keep assembleScene's scope alive.
 * Every closure defined in that scope shares one context, so a probe hung on the build context survives
 * exactly as long as any of them do, including the layout copy and the built station they would hold (#72).
 * The cache snapshot is dropped first on purpose: releaseCaches holds it, not the scene. Held here: only
 * the returned scene. */
import * as THREE from "three";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import { assembleScene, releaseShinjukuCaches } from "../../gteki/scene.ts";

const context = new Proxy({}, { get: (_t, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
Object.assign(globalThis, { document: { createElement: () => ({ width: 1, height: 1, getContext: () => context }) } });
const { bundle } = loadShinjukuBundle();
const gc = (globalThis as typeof globalThis & { gc(): void }).gc;

const { scene, probeRef } = await (async () => {
  const probe = {};
  const scene = assembleScene({ THREE, bundle, quality: "low", enuToRenderer: ({ x, y, z }: { x: number; y: number; z: number }) => [x, z, -y], probe } as never);
  releaseShinjukuCaches();
  return { scene, probeRef: new WeakRef(probe) };
})();
await new Promise<void>((resolve) => setImmediate(resolve));
gc();
const sceneScopeCollected = probeRef.deref() === undefined;
scene.dispose();
console.log(JSON.stringify({ sceneScopeCollected }));
