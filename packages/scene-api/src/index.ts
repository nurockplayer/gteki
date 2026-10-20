/**
 * Station scene hook — the only renderer-specific seam between a station lane and the shared
 * Web explorer. A station may ship `stations/<id>/gteki/scene.ts` exporting `buildScene`.
 *
 * Rules:
 * - Scene geometry is visual/physical approximation. It never adds routes: the explorer routes
 *   only on the station graph. Walkable meshes constrain free walking; they don't imply legal access.
 * - Use `ctx.THREE` instead of importing "three" so the scene shares the explorer's instance.
 * - Everything a scene returns is in the renderer frame (Y-up; enuToRenderer = (x, z, -y)),
 *   except `walls` and `spawnPoints`, which are station ENU for engine neutrality.
 */
import type * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { StationBundle } from "@gteki/schema";

export const SCENE_API_VERSION = "gteki.scene/0.1" as const;

/** Vertical wall in station ENU metres; blocks the walker between zMin and zMax. */
export interface WallSegment {
  a: { x: number; y: number };
  b: { x: number; y: number };
  zMin: number;
  zMax: number;
}

/** Suggested places to start free walking (ENU). Never a claim about the user's real position. */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** Compass heading, degrees clockwise from north. */
  headingDeg: number;
  nodeId?: string;
  label?: string;
}

export interface StationScene {
  root: THREE.Object3D;
  /** Surfaces the walker can stand on (raycast from above). Empty = no free walking. */
  walkable: THREE.Object3D[];
  /** Meshes blocking horizontal movement. */
  colliders?: THREE.Object3D[];
  walls?: WallSegment[];
  spawnPoints?: SpawnPoint[];
  /** Fog/background/lighting preferences; the explorer applies sane defaults otherwise. */
  environment?: { background?: number; fog?: { color: number; near: number; far: number }; exposure?: number };
  /** Per-frame hook (animated signage, ambient props). */
  update?(dtSeconds: number, elapsedSeconds: number): void;
  dispose(): void;
}

export interface SceneContext {
  THREE: typeof THREE;
  bundle: StationBundle;
  enuToRenderer(p: { x: number; y: number; z: number }): [number, number, number];
  /** Resolve a path relative to stations/<id>/gteki/ to a loadable URL (bundled by the explorer). */
  assetUrl(uri: string): string | null;
  /** Load a GLB from the station folder via the explorer's GLTFLoader (Draco/Meshopt/KTX2 ready). */
  loadGlb(uri: string): Promise<GLTF>;
  /**
   * Load a texture from the station folder (e.g. a baked lightmap). Color textures get sRGB;
   * pass { colorSpace: "linear" } for data maps. GLB loading keeps every UV set (uv, uv1 …)
   * and never merges geometries, so lightmaps on TEXCOORD_1 work via material.lightMap.
   */
  loadTexture(uri: string, opts?: { colorSpace?: "srgb" | "linear"; flipY?: boolean }): Promise<THREE.Texture>;
  quality: "low" | "high";
  renderer: THREE.WebGLRenderer;
}

export type BuildScene = (ctx: SceneContext) => StationScene | Promise<StationScene>;

export interface StationSceneModule {
  buildScene: BuildScene;
}

const WALKABLE_ROLES = new Set(["floor", "stairs_ramps", "walkable", "ramp", "stairs"]);
const COLLIDER_ROLES = new Set(["wall", "walls", "barriers", "barrier", "transport", "collider"]);

/** glTF extras arrive as userData; also accept "<role>" or "<role>_<n>" object names. */
export function roleOf(object: THREE.Object3D): string | null {
  const extra = object.userData?.gteki_role;
  if (typeof extra === "string") return extra;
  const name = object.name.toLowerCase();
  for (const role of [...WALKABLE_ROLES, ...COLLIDER_ROLES]) if (name === role || name.startsWith(`${role}_`) || name.startsWith(`${role}.`)) return role;
  return null;
}

/**
 * Classify a GLB scene by `gteki_role`: floor/stairs_ramps → walkable, wall/barriers → colliders.
 * Collider-only meshes are hidden unless `showColliders`. Children inherit their parent's role.
 */
export function sceneFromGlbRoles(root: THREE.Object3D, opts: { showColliders?: boolean } = {}): { walkable: THREE.Object3D[]; colliders: THREE.Object3D[] } {
  const walkable: THREE.Object3D[] = [];
  const colliders: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D, inherited: string | null) => {
    const role = roleOf(object) ?? inherited;
    const isMesh = (object as THREE.Mesh).isMesh === true;
    if (isMesh && role !== null) {
      if (WALKABLE_ROLES.has(role)) walkable.push(object);
      else if (COLLIDER_ROLES.has(role)) {
        colliders.push(object);
        if (role === "collider" && !opts.showColliders) object.visible = false;
      }
    }
    for (const child of object.children) visit(child, role);
  };
  visit(root, null);
  return { walkable, colliders };
}
