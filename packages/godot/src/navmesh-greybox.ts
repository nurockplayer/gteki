/** Headless inputs for the explorer's procedural greybox. */
import * as THREE from "three";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import type { StationBundle } from "@gteki/schema";
import type { StationScene, WallSegment } from "@gteki/scene-api";
import { buildGreybox, splitWallsAtOpenings, type Box } from "../../../apps/web/src/explorer/greybox.ts";
import { greyboxSceneProbes, insideGreyboxOpening } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { hitNormal } from "../../../apps/web/src/explorer/bodyCollision.ts";
import { sceneProbe, type SceneProbe } from "./route-clip-audit.ts";

export function makeGreybox(bundle: StationBundle, scene: StationScene, privateBuild: boolean) {
  sceneProbe(scene);
  const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
  const walls = (scene.walls ?? []).map(wallToRenderer), sceneTests = greyboxSceneProbes(targets.collider, walls);
  const floor = floorProbe(new THREE.Raycaster(), targets.ground, true), floorCache = new Map<string, boolean>();
  const hasFloor = (p: { x:number; y:number; z:number }) => {
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`; let value = floorCache.get(key);
    if (value === undefined) { value = floor(p); floorCache.set(key, value); }
    return value;
  };
  const router = createRouter(bundle, { allowUnverified: privateBuild });
  const grey = buildGreybox(bundle, e => router.isTraversable(e, DEFAULT_PROFILE), hasFloor, sceneTests, "low", true);
  grey.root.updateMatrixWorld(true);
  // Explorer exempts every wall-like scene collider hit inside an opening.
  const portals = new Map<THREE.Object3D, Box[]>();
  for (const collider of targets.collider) portals.set(collider, grey.openings);
  const originalCollider = new Set(targets.collider);
  const split = splitWallsAtOpenings([...walls, ...grey.wallSegments], grey.openings);
  const enuWalls: WallSegment[] = split.map(w => ({ a:{x:w.ax,y:-w.az}, b:{x:w.bx,y:-w.bz}, zMin:w.yMin, zMax:w.yMax }));
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(grey.navFloors ?? [],3));
  const floorMesh = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ side:THREE.DoubleSide }));
  floorMesh.userData.greybox = true;
  floorMesh.updateMatrixWorld(true);
  prepareRayTrees([floorMesh, ...grey.colliders]);
  const probe: SceneProbe = { ground:[...targets.ground, floorMesh], collider:[...targets.collider, ...grey.colliders], walls:enuWalls,
    ignoreColliderHit: (hit, direction) => !!hit.face && originalCollider.has(hit.object) && !hit.object.userData.greybox && grey.openings.some(box => insideGreyboxOpening(hit.point, box) && Math.abs(hitNormal(hit, direction).y) <= 0.5) };
  return { grey, probe, portals, walls:enuWalls, targets };
}
