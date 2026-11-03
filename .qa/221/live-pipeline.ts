import fs from 'node:fs';
import * as T from '../../packages/godot/node_modules/three/build/three.module.js';
import { createRouter, DEFAULT_PROFILE } from '../../packages/navigation/src/index.ts';
import { explorerTargets } from '../../apps/web/src/explorer/raycast.ts';
import { prepareRayTrees } from '../../apps/web/src/explorer/meshBvh.ts';
import { greyboxSceneProbes } from '../../apps/web/src/explorer/greyboxScene.ts';
import { wallToRenderer } from '../../apps/web/src/explorer/walker.ts';
import { floorProbe } from '../../apps/web/src/explorer/routeGaps.ts';
import { buildGreybox } from '../../apps/web/src/explorer/greybox.ts';
import { cutPortals } from '../../apps/web/src/explorer/portalCut.ts';
import { buildLiveScene } from '../../apps/web/src/explorer/liveScene.ts';
import { physicalSnapshot } from './physical.ts';

/** Explorer.loadStation 987–1045: same high-tier portal/stair cuts, no renderer or greybox visual targets. */
export function applyLivePipeline(bundle: any, scene: any) {
  fs.mkdirSync('.qa/221/live', { recursive: true });
  const walkable = scene.walkable, colliders = scene.colliders ?? [], cameraBlockers = scene.cameraBlockers ?? [];
  const originalTargets = explorerTargets(walkable, colliders, cameraBlockers);
  prepareRayTrees(originalTargets.camera);
  const walls = (scene.walls ?? []).map(wallToRenderer);
  const probes = greyboxSceneProbes(originalTargets.collider, walls);
  const floor = floorProbe(new T.Raycaster(), originalTargets.ground, true), floorCache = new Map<string, boolean>();
  const hasFloor = (p: { x: number; y: number; z: number }) => {
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
    if (!floorCache.has(key)) floorCache.set(key, floor(p));
    return floorCache.get(key)!;
  };
  const router = createRouter(bundle);
  const traversable = (edge: any) => router.isTraversable(edge, DEFAULT_PROFILE);
  const greybox = buildGreybox(bundle, traversable, hasFloor, probes, 'high');
  const resources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const portals = cutPortals(scene.root, greybox.openings, resources, new Set(originalTargets.ground));
  const live = buildLiveScene({ root: scene.root, bundle, traversable, hasFloor, greybox, openings: greybox.openings,
    originalTargets, walkable, colliders, cameraBlockers, walls, tier: 'high', recipe: null, portalInstances: resources.instances });
  scene.root.updateMatrixWorld(true);
  for (const o of live.walkable) o.updateWorldMatrix(true, false);
  prepareRayTrees(live.walkable);
  fs.writeFileSync('.qa/221/live/physical-live.json', JSON.stringify(physicalSnapshot({ ...scene,
    walkable: live.walkable, colliders: live.colliders, cameraBlockers: live.cameraBlockers, walls: live.walls }, {}), null, 2));
  fs.writeFileSync('.qa/221/live/pipeline.json', JSON.stringify({
    note: 'Live cuts, recipe=null. Runtime greybox/connectors used for app ground only; neither root is attached to scene.root.',
    portalStats: portals, stairwellStats: live.stairwellCut.stats,
  }, (_k, v) => v instanceof Map ? [...v] : v, 2));
  return live.walkable;
}
