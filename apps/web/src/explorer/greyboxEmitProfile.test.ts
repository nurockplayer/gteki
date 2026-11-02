import { it, expect } from "vitest";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import * as THREE from "three";
import { emitGreybox, unmodelledRunsByEdge } from "./greybox.ts";

it("profiles 15 km of synthetic corridors", () => {
  const base = createSyntheticBundle();
  const nodes = [] as typeof base.nodes, edges = [] as typeof base.edges;
  for (let i = 0; i < 150; i++) {
    const floor = base.floors[i % base.floors.length]!;
    for (let end = 0; end < 2; end++) nodes.push({ ...base.nodes[0]!, id: `p${i}-${end}`, floorId: floor.id, position: { x: end * 100, y: i * 5, z: floor.renderElevationM } });
    edges.push(syntheticEdge(`e${i}`, `p${i}-0`, `p${i}-1`, { attributes: { sceneGap: true } }));
  }
  const bundle = { ...base, nodes, edges }, floor = () => false, scene = { colliderNear: () => false, wallHit: () => null };
  const runs = unmodelledRunsByEdge(bundle, () => true, floor);
  // One warm-up build (JIT, first allocations; its scene is the one checked below), then the median of three: a
  // single run on a shared CI runner swings by tens of ms. The 120 ms budget itself stays. Only the three timings
  // are kept, so their scenes do not pile up as garbage for the later builds.
  const result = emitGreybox(bundle, runs, floor, scene, "high");
  const buildMs = [0, 1, 2].map(() => emitGreybox(bundle, runs, floor, scene, "high").stats.buildMs).sort((a, b) => a - b);
  console.info(`greybox emit profile: buildMs ${buildMs.map((ms) => ms.toFixed(1)).join(" / ")} (median ${buildMs[1]!.toFixed(1)}, budget 120)`);
  expect(result.stats.lengthM).toBeCloseTo(15000);
  expect(buildMs[1]).toBeLessThanOrEqual(120);
  // 52 per corridor, plus the two end walls the walkable model closes at each dead end (no scene floor beyond).
  expect(result.stats.triangles).toBe(8400);
  expect(result.openings).toHaveLength(0);
  const bounds = new THREE.Box3().setFromObject(result.root);
  expect(bounds.min.x).toBeCloseTo(-0.6);
  expect(bounds.max.x).toBeCloseTo(100);
});
