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

it("keeps the low-tier underground fixtures instanced after both runtime cuts", () => {
  const { bundle } = loadShinjukuBundle();
  const station = withCanvasStub(() => assembleScene({ THREE, bundle, quality: "low" } as never));
  const portals: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const { root } = station;
  const lights = root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
  const originalCount = lights.count;
  const originalGeometry = lights.geometry;
  const originalMatrices = lights.instanceMatrix.array.slice();
  const originalColors = lights.instanceColor!.array.slice();
  const floorPools = lights.userData.floorPools;
  const walkable = station.walkable ?? [], colliders = station.colliders ?? [], cameraBlockers = station.cameraBlockers ?? [];
  const walls = (station.walls ?? []).map(wallToRenderer);
  root.updateMatrixWorld(true);
  const originalTargets = explorerTargets(walkable, colliders, cameraBlockers);
  prepareRayTrees(originalTargets.camera);
  const hasFloor = floorProbe(new THREE.Raycaster(), originalTargets.ground, true);
  const router = createRouter(bundle);
  const traversable = (edge: typeof bundle.edges[number]) => router.isTraversable(edge, DEFAULT_PROFILE);
  const greybox = buildGreybox(bundle, traversable, hasFloor, greyboxSceneProbes(originalTargets.collider, walls), "low");
  cutPortals(root, greybox.openings, portals, new Set(originalTargets.ground));
  const live = buildLiveScene({ root, bundle, traversable, hasFloor, greybox, openings: greybox.openings, originalTargets, walkable, colliders, cameraBlockers, walls, tier: "low", recipe: null, portalInstances: portals.instances });
  try {
    const meshes: THREE.Mesh[] = [];
    lights.traverseVisible(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    const matrix = new THREE.Matrix4();
    let surviving = 0;
    for (const mesh of meshes) {
      if (mesh instanceof THREE.InstancedMesh) {
        for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); if (matrix.determinant() !== 0) surviving++; }
      } else if (mesh.geometry.getAttribute("position").count > 0) surviving++;
    }
    console.info("#743 counts", { originalCount, surviving, objects: meshes.length, copies: meshes.length - 1, changed: meshes.filter(m => m.geometry !== originalGeometry).map(m => m.geometry.getAttribute("position").count) });
    expect(meshes.length).toBeLessThanOrEqual(4);
    expect(meshes.every(mesh => mesh instanceof THREE.InstancedMesh)).toBe(true);
    expect(surviving).toBe(originalCount);
    const perMaterial = new Map<THREE.Material, number>();
    for (const mesh of meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      perMaterial.set(material, (perMaterial.get(material) ?? 0) + 1);
    }
    expect([...perMaterial.values()]).toEqual([1]);
    expect(lights.geometry).toBe(originalGeometry);
    expect(lights.instanceMatrix.array).toEqual(originalMatrices);
    expect(lights.instanceColor!.array).toEqual(originalColors);
    expect(lights.userData.floorPools).toBe(floorPools);
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
