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
  const result = emitGreybox(bundle, runs, floor, scene, "high");
  expect(result.stats.lengthM).toBeCloseTo(15000);
  expect(result.stats.buildMs).toBeLessThanOrEqual(120);
  expect(result.stats.triangles).toBe(7800);
  expect(result.openings).toHaveLength(0);
  const bounds = new THREE.Box3().setFromObject(result.root);
  expect(bounds.min.x).toBeCloseTo(-0.6);
  expect(bounds.max.x).toBeCloseTo(100);
});
