/** The part of Explorer.loadStation that turns the loaded scene into the one the walker meets (#676):
 * the stairwell cut, the instance retarget, the runtime greybox and connector geometry, and the final wall split.
 * The navmesh bake and audit call this too, so they see the same scene as the explorer. */
import * as THREE from "three";
import type { Edge, StationBundle } from "@gteki/schema";
import { buildConnectors } from "./greyboxConnectors.ts";
import { buildGreybox, splitWallsAtOpenings, type Box } from "./greybox.ts";
import { sceneMeshNear } from "./routeGroundQa.ts";
import type { ExplorerTargets } from "./raycast.ts";
import { cutStairwells, stairwellWells, type StairwellCut } from "./stairwellCut.ts";
import type { CutRecipe } from "./cutRecipe.ts";
import type { Segment2 } from "./walker.ts";

/** One instance a cut pulled out of an InstancedMesh; the copy stands in for its owner in every target list. */
export interface ExtractedInstance {
  owner: THREE.InstancedMesh;
  copy: THREE.Object3D;
}

export interface LiveSceneOptions {
  /** The station scene root; the stairwell cut replaces its geometry in place. */
  root: THREE.Object3D;
  bundle: StationBundle;
  traversable: (edge: Edge) => boolean;
  hasFloor: (p: { x: number; y: number; z: number }) => boolean;
  /** The runtime greybox built for this scene; its shell receives the stairwell edge band. */
  greybox: ReturnType<typeof buildGreybox>;
  /** The greybox openings, used to split the walls. */
  openings: readonly Box[];
  /** The explorer targets of the scene before any cut, as `explorerTargets` returns them. */
  originalTargets: ExplorerTargets;
  walkable: readonly THREE.Object3D[];
  colliders: readonly THREE.Object3D[];
  cameraBlockers: readonly THREE.Object3D[];
  walls: readonly Segment2[];
  tier: "high" | "low";
  /** A baked stairwell recipe for this tier; null means the live cut. */
  recipe: CutRecipe | null;
  /** Instances the portal cut pulled out of their owners (the live scene does no portal cut itself). */
  portalInstances: readonly ExtractedInstance[];
}

export interface LiveScene {
  stairwellCut: StairwellCut;
  connectors: ReturnType<typeof buildConnectors>;
  /** The cut scene's ground targets, copies included. */
  sceneGroundTargets: THREE.Object3D[];
  /** The cut scene's collider targets, copies included. */
  sceneColliderTargets: Set<THREE.Object3D>;
  /** Scene walkable + greybox + connector walkable, with instance copies in place of their owners. */
  walkable: THREE.Object3D[];
  /** Scene colliders + greybox + stairwell-cut + connector colliders, with instance copies. */
  colliders: THREE.Object3D[];
  cameraBlockers: THREE.Object3D[];
  /** Scene walls, greybox, stairwell-cut and connector wall segments, split at the openings. */
  walls: Segment2[];
}

export function buildLiveScene(options: LiveSceneOptions): LiveScene {
  const { root, bundle, traversable, hasFloor, greybox, openings, originalTargets, tier, recipe } = options;
  const { walkable, colliders, cameraBlockers } = options;
  const stairwellCut = cutStairwells(root, stairwellWells(bundle, traversable), {
    walkable: new Set(originalTargets.ground), tier, greyboxRoot: greybox.root,
    // Collision proxies may sit outside the station root: cut them with the visible slabs.
    collision: [...walkable, ...colliders, ...cameraBlockers],
    recipe,
  });
  // Instances pulled out of an InstancedMesh by either cut stand in for their owner in every target list.
  const instances = [...options.portalInstances, ...stairwellCut.resources.instances];
  const extracted = new Map<THREE.InstancedMesh, number>();
  for (const { owner } of instances) extracted.set(owner, (extracted.get(owner) ?? 0) + 1);
  const fullyHidden = new Set([...extracted].filter(([owner, count]) => count === owner.count).map(([owner]) => owner));
  const retain = (objects: readonly THREE.Object3D[]) => objects.filter(object => !fullyHidden.has(object as THREE.InstancedMesh));
  const copiesOf = (sources: readonly THREE.Object3D[]) => {
    const sourceSet = new Set(sources);
    return instances.filter(({ owner }) => sourceSet.has(owner)).map(({ copy }) => copy);
  };
  const groundCopies = copiesOf(originalTargets.ground), colliderCopies = copiesOf(originalTargets.collider);
  const blockerCopies = copiesOf([...originalTargets.blockers]);
  const sceneGroundTargets = [...new Set([...retain(originalTargets.ground), ...groundCopies])];
  const sceneColliderTargets = new Set([...retain(originalTargets.collider), ...colliderCopies]);
  const liveWalkable = [...new Set([...retain(walkable), ...groundCopies])];
  const liveColliders = [...new Set([...retain(colliders), ...colliderCopies])];
  const liveBlockers = [...new Set([...retain(cameraBlockers), ...blockerCopies])];
  liveWalkable.push(...greybox.walkable);
  liveColliders.push(...greybox.colliders, ...stairwellCut.colliders);
  const connectors = buildConnectors(bundle, traversable, { hasFloor, nearMesh: (p, radius) => sceneMeshNear([root], p, radius) }, tier);
  liveWalkable.push(...connectors.walkable);
  liveColliders.push(...connectors.colliders);
  const walls = splitWallsAtOpenings([...options.walls, ...greybox.wallSegments, ...stairwellCut.walls, ...connectors.wallSegments], openings);
  return { stairwellCut, connectors, sceneGroundTargets, sceneColliderTargets, walkable: liveWalkable, colliders: liveColliders, cameraBlockers: liveBlockers, walls };
}
