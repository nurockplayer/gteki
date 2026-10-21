/** Each shard retains every approach/fps/speed/walker case for its endpoint groups. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { buildScene } from "../gteki/scene.ts";
import type { Plan } from "../scene/layout.ts";
import type { StationScene } from "@gteki/scene-api";
import { replayEnds } from "./fare-replay-audit.ts";
import { derivedRestrictedAccess } from "../scene/fare-fence.ts";
import { replayMatrix } from "./fare-replay-worker.ts";
export function replayShard(index: number, count: number) {
 const { bundle } = loadShinjukuBundle(), plan = planJson as Plan;
 describe(`actual walker complete matrix shard ${index + 1}/${count}`, () => {
  let built: BuiltStation, scene: StationScene;
  beforeAll(async () => {
   const context = new Proxy({}, { get: (_t, k) => k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
   vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
   built = buildStation(bundle, plan, { quality: "low" }); scene = await buildScene({ THREE, bundle, quality: "low" } as never); scene.root.updateMatrixWorld(true);
  }, 60_000);
  afterAll(() => { built?.dispose(); scene?.dispose(); vi.unstubAllGlobals(); });
  it("replays every public seed, all nine approaches, both fps, speeds and walkers", async () => {
   const ends = replayEnds(built), key = (p: { x: number; y: number; z: number }) => `${p.x},${p.y},${p.z}`;
   const groups = new Map([...new Set(ends.map(e => key(e.p)))].map((k, i) => [k, i % count]));
   const conflicts = new Set(derivedRestrictedAccess(built.layout)!.conflicts.map(c => c.spaceId));
   // Exercise source/route conflicts first so regressions fail early. No cases are removed.
   const selected = ends.filter(e => groups.get(key(e.p)) === index).sort((a, b) =>
     Number(conflicts.has(b.fence?.restrictedSpaceId ?? "")) - Number(conflicts.has(a.fence?.restrictedSpaceId ?? "")) || b.p.z - a.p.z);
   const result = await replayMatrix(built, scene, plan, selected, index);
   expect(result.finished).toBe(result.jobs); expect(result.leaks).toEqual([]); expect(result.matrix).toHaveLength(72);
   for (const row of result.matrix) { expect(row.paths).toBeGreaterThan(0); expect(row.passed).toBe(row.paths); }
  }, 3_600_000);
 });
}
