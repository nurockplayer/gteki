import { expect, it } from "vitest";
import * as THREE from "three";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { assembleScene } from "../gteki/scene.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { greyboxSceneProbes } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { buildGreybox } from "../../../apps/web/src/explorer/greybox.ts";
import { cutPortals, disposePortalCuts, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import { buildLiveScene } from "../../../apps/web/src/explorer/liveScene.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";

it.each(["low", "high"] as const)("counts the cut SJK layer passes on %s, retaining desktop behavior", (quality) => {
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => assembleScene({ THREE, bundle, quality } as never));
  const portals: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const { root } = station;
  const walkable = station.walkable ?? [], colliders = station.colliders ?? [], cameraBlockers = station.cameraBlockers ?? [];
  const walls = (station.walls ?? []).map(wallToRenderer);
  root.updateMatrixWorld(true);
  const originalTargets = explorerTargets(walkable, colliders, cameraBlockers);
  prepareRayTrees(originalTargets.camera);
  const hasFloor = floorProbe(new THREE.Raycaster(), originalTargets.ground, true);
  const router = createRouter(bundle);
  const traversable = (edge: typeof bundle.edges[number]) => router.isTraversable(edge, DEFAULT_PROFILE);
  const greybox = buildGreybox(bundle, traversable, hasFloor, greyboxSceneProbes(originalTargets.collider, walls), quality);
  cutPortals(root, greybox.openings, portals, new Set(originalTargets.ground));
  const live = buildLiveScene({ root, bundle, traversable, hasFloor, greybox, openings: greybox.openings, originalTargets, walkable, colliders, cameraBlockers, walls, tier: quality, recipe: null, portalInstances: portals.instances });
  try {
    // A wide orthographic view contains every station layer, independent of bay visibility.
    const view = new THREE.OrthographicCamera(-10000, 10000, 10000, -10000, .1, 30000);
    view.position.set(0, 10000, 0); view.lookAt(0, 0, 0); view.updateMatrixWorld(true);
    const batches: THREE.InstancedMesh[] = [];
    root.traverseVisible(o => { if (o instanceof THREE.InstancedMesh && o.userData.tightCulling) batches.push(o); });
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.some(batch => batch.children.some(c => c.userData.portalInstanceCopy))).toBe(true);
    const counts = batches.map(batch => {
      batch.onBeforeRender(null as never, null as never, view, batch.geometry, batch.material as THREE.Material, null as never);
      const meshes: THREE.Mesh[] = [];
      batch.traverseVisible(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
      const passes = meshes.reduce((n, m) => {
        if (m instanceof THREE.InstancedMesh && m.count === 0) return n;
        if (!m.geometry.getAttribute("position")?.count) return n;
        return n + (Array.isArray(m.material) ? m.material : [m.material]).reduce((s, material) => s + (material.visible ? (material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1) : 0), 0);
      }, 0);
      return { layer: batch.name, material: (batch.material as THREE.Material).name, passes, count: batch.count, extracted: batch.children.some(c => c.userData.portalInstanceCopy) };
    });
    console.info(`#744 ${quality} layers`, JSON.stringify(counts));
    expect(counts.every(row => row.count === (quality === "low" && row.extracted ? 0 : 1))).toBe(true);
    // Every phone layer renders once, including transparent two-sided portals and their signs.
    // Desktop retains both its empty owner draws and its transparent back/front passes.
    for (const [i, batch] of batches.entries()) {
      const material = batch.material as THREE.Material;
      const materialPasses = material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1;
      expect(counts[i]!.passes, `${batch.name} ${material.name}`).toBe(quality === "low" ? 1 : (counts[i]!.extracted ? 2 : 1) * materialPasses);
    }
  } finally {
    live.stairwellCut.dispose(); disposePortalCuts(portals);
    for (const group of [greybox.root, live.connectors.root]) group.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
    });
    station.dispose();
  }
}, 600_000);
