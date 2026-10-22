/** Runs in a separate --expose-gc process: WeakRefs must cross an event-loop turn
 * before collection. Keep the station alive while testing its retired geometry. */
import { createHash } from "node:crypto";
import * as THREE from "three";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import plan from "../../data/plan.json";
import { buildStation } from "../../scene/build.ts";
import type { Plan } from "../../scene/layout.ts";

const context = new Proxy({}, { get: (_t, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
Object.assign(globalThis, { document: { createElement: () => ({ width: 1, height: 1, getContext: () => context }) } });
const { bundle } = loadShinjukuBundle();
const gc = (globalThis as typeof globalThis & { gc(): void }).gc;
const retired = new Set<WeakRef<THREE.BufferGeometry>>();
const original = THREE.BufferGeometry.prototype.dispose;
THREE.BufferGeometry.prototype.dispose = function () {
  retired.add(new WeakRef(this));
  original.call(this);
};

const station = buildStation(bundle, plan as Plan, { quality: "high" });
THREE.BufferGeometry.prototype.dispose = original;
const live = new Set<THREE.BufferGeometry>();
const hash = createHash("sha256");
let bytes = 0;
station.root.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  live.add(o.geometry);
  // Hash every final attribute/index byte and placement, including instances.
  // Baseline captured on 5d43dc3 before changing any resource ownership.
  hash.update(JSON.stringify([o.name, o.position, o.quaternion, o.scale, o.visible]));
  for (const [name, a] of [["index", o.geometry.index], ...Object.entries(o.geometry.attributes)] as const) {
    if (!a) continue;
    hash.update(JSON.stringify([name, a.itemSize, a.normalized]));
    hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    bytes += a.array.byteLength;
  }
  if (o instanceof THREE.InstancedMesh) {
    hash.update(JSON.stringify(o.count));
    hash.update(Buffer.from(o.instanceMatrix.array.buffer));
  }
});
const geometryHash = hash.digest("hex");
// Keep only weak references to sources. A build-time map accidentally captured
// by update/dispose otherwise retains thousands of disposed attribute arrays.
await new Promise<void>((resolve) => setImmediate(resolve));
gc();
const retained: number[] = [];
for (const ref of retired) {
  const g = ref.deref();
  if (g && !live.has(g)) retained.push(g.id);
}
station.update(1 / 60, 1);
station.setViewer?.({ x: 0, y: 0, z: 1 });
station.dispose();
// The lane's quality selection reloads the page. Also exercise a fresh low
// build after high disposal, as the explorer does when reopening a station.
const low = buildStation(bundle, plan as Plan, { quality: "low" });
low.update(1 / 60, 1);
low.dispose();
console.log(JSON.stringify({ retired: retired.size, retained: retained.length, live: live.size, bytes, geometryHash }));
