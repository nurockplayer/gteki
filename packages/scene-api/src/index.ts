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

/**
 * The explorer's walker body, part of the 0.1 contract so scenes can author walls/colliders against it.
 * Changing any value is a contract change (station leads are consulted first).
 * - A wall blocks when its band overlaps the body: zMin ≤ feet + bodyTopM and zMax ≥ feet + bodyBottomM.
 * - Ground may rise ≤ stepUpM or drop ≤ stepDownM per step; otherwise the move is refused.
 */
export const WALKER_BODY = { radiusM: 0.3, bodyBottomM: 0.2, bodyTopM: 1.7, eyeM: 1.62, stepUpM: 0.45, stepDownM: 0.9 } as const;

/** Vertical wall in station ENU metres; blocks the walker between zMin and zMax (see WALKER_BODY). */
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
  /**
   * Meshes that stop only the follow camera (ceilings, slab undersides, soffits), so it never rises
   * through a ceiling. They add to walkable and colliders for the camera, never replace them, and never
   * block walking or count as ground.
   */
  cameraBlockers?: THREE.Object3D[];
  walls?: WallSegment[];
  spawnPoints?: SpawnPoint[];
  /** Fog/background/lighting preferences; the explorer applies sane defaults otherwise. */
  environment?: {
    background?: number;
    fog?: { color: number; near: number; far: number };
    exposure?: number;
    /**
     * "default" (or omitted): the explorer adds its hemisphere + sun. "scene": the explorer adds no scene
     * lights (use for baked lightmaps / underground stations); the scene owns lighting and the explorer
     * lights only its own avatar with a per-material environment map.
     */
    lighting?: "default" | "scene";
  };
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
  /**
   * Load a GLB from the station folder via the explorer's GLTFLoader (Meshopt supported; Draco/KTX2
   * not configured yet). External buffers/images must resolve inside the station folder.
   */
  loadGlb(uri: string): Promise<GLTF>;
  /**
   * Load a texture from the station folder (e.g. a baked lightmap). Color textures get sRGB;
   * pass { colorSpace: "linear" } for data maps. GLB loading keeps every UV set (uv, uv1 …)
   * and never merges geometries, so lightmaps on TEXCOORD_1 work via material.lightMap.
   */
  loadTexture(uri: string, opts?: { colorSpace?: "srgb" | "linear"; flipY?: boolean }): Promise<THREE.Texture>;
  quality: "low" | "high";
  renderer: THREE.WebGLRenderer;
  /**
   * Optional host-owned audio. The explorer creates the context (resumed on the first user gesture)
   * and a master gain with a mute toggle; connect station sound to `destination`, never to
   * `context.destination`. Absent (e.g. no WebAudio) = stay silent.
   */
  audio?: { context: AudioContext; destination: AudioNode };
}

export type BuildScene = (ctx: SceneContext) => StationScene | Promise<StationScene>;

export interface StationSceneModule {
  buildScene: BuildScene;
}

const WALKABLE_ROLES = new Set(["floor", "stairs_ramps", "walkable", "ramp", "stairs"]);
const COLLIDER_ROLES = new Set(["wall", "walls", "barriers", "barrier", "transport", "collider"]);
/** Camera-only: hidden like "collider" unless showColliders. Opt-in by role or name, never inferred from "ceiling". */
const CAMERA_ROLES = new Set(["camera_blocker"]);
/**
 * Visual-only meshes the follow camera may see through (hanging signs). They never block the walker or the
 * camera; the explorer fades them where they come between the camera and the avatar or within its near
 * distance. A mesh that is also walkable or a collider is never faded.
 */
const SEE_THROUGH_ROLES = new Set(["sign", "signs", "signage"]);

/**
 * glTF extras arrive as userData; also accept "<role>" or "<role>_<n>" object names. A role is trimmed and
 * lowercased, and an empty one counts as absent (same normalisation as the Godot loader).
 */
export function roleOf(object: THREE.Object3D): string | null {
  const extra = object.userData?.gteki_role;
  if (typeof extra === "string" && extra.trim() !== "") return extra.trim().toLowerCase();
  // GLTFLoader sanitises node names ("floor.001" → "floor001") and keeps the authored one in userData.name.
  const authored = typeof object.userData?.name === "string" ? (object.userData.name as string) : null;
  for (const raw of authored === null ? [object.name] : [authored, object.name]) {
    const name = raw.toLowerCase();
    for (const role of [...WALKABLE_ROLES, ...COLLIDER_ROLES, ...CAMERA_ROLES, ...SEE_THROUGH_ROLES]) if (name === role || name.startsWith(`${role}_`) || name.startsWith(`${role}.`)) return role;
  }
  return null;
}

/**
 * Hide a mesh's own geometry. A leaf is simply made invisible; a mesh with meshes below it (which may carry
 * their own visible role, e.g. a sign under a ceiling slab) keeps its subtree drawn and gets invisible copies
 * of its materials instead. Ray tests ignore visibility either way.
 */
function hideOwnGeometry(mesh: THREE.Mesh): void {
  let meshBelow = false;
  for (const child of mesh.children) child.traverse((o) => { if ((o as THREE.Mesh).isMesh === true) meshBelow = true; });
  if (!meshBelow) {
    mesh.visible = false;
    return;
  }
  const hidden = (material: THREE.Material) => {
    const copy = material.clone();
    copy.visible = false;
    return copy;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(hidden) : hidden(mesh.material);
}

/**
 * Classify a GLB scene by `gteki_role`: floor/stairs_ramps → walkable, wall/barriers → colliders,
 * camera_blocker → cameraBlockers (hidden, camera only).
 * Collider-only meshes are hidden unless `showColliders`. Children inherit their parent's role.
 * `assetRole` is the manifest's asset-wide role: in a "collision"/"visual+collision" asset every mesh
 * without its own walkable/collider role still collides, and a "collision" asset is never drawn
 * (the same rule as the Godot loader).
 */
export function sceneFromGlbRoles(root: THREE.Object3D, opts: { showColliders?: boolean; assetRole?: "visual" | "collision" | "visual+collision" } = {}): { walkable: THREE.Object3D[]; colliders: THREE.Object3D[]; cameraBlockers: THREE.Object3D[] } {
  const walkable: THREE.Object3D[] = [];
  const colliders: THREE.Object3D[] = [];
  const cameraBlockers: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D, inherited: string | null) => {
    const role = roleOf(object) ?? inherited;
    const isMesh = (object as THREE.Mesh).isMesh === true;
    if (isMesh && role !== null) {
      if (WALKABLE_ROLES.has(role)) walkable.push(object);
      else if (COLLIDER_ROLES.has(role)) {
        colliders.push(object);
        if (role === "collider" && !opts.showColliders) hideOwnGeometry(object as THREE.Mesh);
      } else if (CAMERA_ROLES.has(role)) {
        cameraBlockers.push(object);
        if (!opts.showColliders) hideOwnGeometry(object as THREE.Mesh);
      }
    }
    for (const child of object.children) visit(child, role);
  };
  visit(root, null);
  if (opts.assetRole && opts.assetRole !== "visual") {
    const tagged = new Set<THREE.Object3D>([...walkable, ...colliders, ...cameraBlockers]);
    root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh !== true) return;
      if (!tagged.has(object)) colliders.push(object);
      if (opts.assetRole === "collision" && !opts.showColliders) object.visible = false;
    });
  }
  return { walkable, colliders, cameraBlockers };
}

/**
 * Meshes under `root` whose own or inherited role is a see-through role (see SEE_THROUGH_ROLES). Works on any
 * scene root, including scene modules that tag a whole group (e.g. merged signage) with `gteki_role: "sign"`.
 */
export function seeThroughMeshes(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D, inherited: string | null) => {
    const role = roleOf(object) ?? inherited;
    if ((object as THREE.Mesh).isMesh === true && role !== null && SEE_THROUGH_ROLES.has(role)) found.push(object);
    for (const child of object.children) visit(child, role);
  };
  visit(root, null);
  return found;
}
