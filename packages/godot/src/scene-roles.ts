/**
 * Prepares a built `StationScene` for the Godot snapshot: every mesh gets an explicit `userData.gteki_role`
 * (written to glTF `extras.gteki_role` by GLTFExporter), taken from the scene's own `walkable` / `colliders` /
 * `cameraBlockers` lists, which are the only collision truth the web walker uses. Godot never infers it.
 *
 * - Every mesh that is not drawn in the source (invisible itself, under an invisible ancestor, or with only invisible
 *   materials) is flagged `gteki_hidden`, whether or not it is listed; the Godot loader never draws flagged meshes.
 * - A mesh listed in a list gets that list's role (its own role when it is already one of that list's
 *   vocabulary, e.g. "stairs_ramps", else "walkable" / "collider" / "camera_blocker").
 * - Listed meshes the scene keeps outside `root` (Ikebukuro's raycast tiles) are attached to a proxy group.
 *   Listed meshes that are not drawn (hidden object or invisible material) are flagged `gteki_collision_only`.
 * - A visual mesh whose role says walkable/collider/camera but that no list contains is a drawing of something
 *   the scene replaced with its own collision (Ikebukuro's GLB floor vs. its tiles): it becomes "visual" and
 *   keeps the original in `gteki_source_role`, so it never collides twice.
 * - Every other mesh keeps its role (inherited, as the web's `roleOf`), or "visual" when it has none.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { roleOf, type StationScene } from "@gteki/scene-api";

// Same vocabulary as @gteki/scene-api (WALKABLE_ROLES / COLLIDER_ROLES / CAMERA_ROLES / SEE_THROUGH_ROLES, which it
// does not export) and addons/gteki/gteki_assets.gd; scene-roles.test.ts fails if any of the three drift.
export const WALKABLE_ROLES: readonly string[] = ["floor", "stairs_ramps", "walkable", "ramp", "stairs"];
export const COLLIDER_ROLES: readonly string[] = ["wall", "walls", "barriers", "barrier", "transport", "collider"];
export const CAMERA_ROLES: readonly string[] = ["camera_blocker"];
export const SEE_THROUGH_ROLES: readonly string[] = ["sign", "signs", "signage"];

export type Category = "walkable" | "collider" | "camera_blocker";
const VOCAB: Record<Category, readonly string[]> = { walkable: WALKABLE_ROLES, collider: COLLIDER_ROLES, camera_blocker: CAMERA_ROLES };

export function categoryOf(role: string): Category | "see_through" | null {
  for (const category of Object.keys(VOCAB) as Category[]) if (VOCAB[category].includes(role)) return category;
  return SEE_THROUGH_ROLES.includes(role) ? "see_through" : null;
}

export interface RoleSummary {
  meshes: number;
  triangles: number;
  /** Mesh count per exported `gteki_role`. */
  byRole: Record<string, number>;
  /** Mesh count per Godot behaviour; what the Godot loader must reproduce. */
  walkable: number;
  collider: number;
  camera_blocker: number;
  see_through: number;
  collisionOnly: number;
  /** Meshes whose source was not drawn (hidden object or ancestor, or invisible material), listed or not. */
  hidden: number;
  /** Drawn meshes replaced by scene collision (exported as "visual"). */
  replacedByCollision: number;
  warnings: string[];
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function triangles(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  return Math.floor((g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3);
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isDrawn(mesh: THREE.Mesh): boolean {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!o.visible) return false;
  return materialsOf(mesh).some((m) => m.visible);
}

function isUnder(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === root) return true;
  return false;
}

export function tagSceneRoles(scene: StationScene): RoleSummary {
  const warnings: string[] = [];
  const categories = new Map<THREE.Mesh, Category>();
  const rank: Category[] = ["walkable", "collider", "camera_blocker"];
  const lists: [Category, THREE.Object3D[]][] = [["walkable", scene.walkable], ["collider", scene.colliders ?? []], ["camera_blocker", scene.cameraBlockers ?? []]];
  let conflicts = 0;
  for (const [category, objects] of lists) {
    for (const object of objects) {
      object.traverse((o) => {
        if (!isMesh(o)) return;
        const prior = categories.get(o);
        if (prior !== undefined && prior !== category) conflicts += 1;
        // walkable beats collider beats camera_blocker if a scene lists one mesh twice.
        if (prior === undefined || rank.indexOf(category) < rank.indexOf(prior)) categories.set(o, category);
      });
    }
  }
  if (conflicts > 0) warnings.push(`${conflicts} mesh(es) were listed under more than one of walkable/colliders/cameraBlockers; the first of that order won`);

  // Listed meshes the scene holds outside root (raycast tiles) join the snapshot under one proxy group.
  const proxies = new THREE.Group();
  proxies.name = "gteki_collision_proxies";
  for (const mesh of categories.keys()) if (!isUnder(mesh, scene.root)) proxies.attach(mesh);
  if (proxies.children.length > 0) scene.root.add(proxies);

  const summary: RoleSummary = { meshes: 0, triangles: 0, byRole: {}, walkable: 0, collider: 0, camera_blocker: 0, see_through: 0, collisionOnly: 0, hidden: 0, replacedByCollision: 0, warnings };
  const visit = (object: THREE.Object3D, inherited: string | null) => {
    const own = roleOf(object);
    const role = own ?? inherited;
    if (isMesh(object)) {
      const category = categories.get(object);
      // Visibility is a property of the source mesh, whatever lists it is in: GLTFExporter (onlyVisible: false) would
      // otherwise draw scene helpers (access-fence collider, solid doors, portal and walk-bridge meshes) that the
      // scene keeps invisible and collides through tiles instead. The loader hides every flagged mesh.
      if (!isDrawn(object)) {
        object.userData.gteki_hidden = true;
        summary.hidden += 1;
      }
      let effective: string;
      if (category !== undefined) {
        effective = role !== null && VOCAB[category].includes(role) ? role : category;
        if (effective !== role && role !== null) object.userData.gteki_source_role = role;
        if (!isDrawn(object)) {
          object.userData.gteki_collision_only = true;
          summary.collisionOnly += 1;
        }
      } else if (role !== null && ["walkable", "collider", "camera_blocker"].includes(categoryOf(role) ?? "")) {
        effective = "visual";
        object.userData.gteki_source_role = role;
        summary.replacedByCollision += 1;
      } else {
        effective = role ?? "visual";
      }
      object.userData.gteki_role = effective;
      summary.meshes += 1;
      summary.triangles += triangles(object);
      summary.byRole[effective] = (summary.byRole[effective] ?? 0) + 1;
      const behaviour = categoryOf(effective);
      if (behaviour !== null) summary[behaviour] += 1;
    }
    for (const child of object.children) visit(child, role);
  };
  visit(scene.root, null);
  return summary;
}

/** Roles that mark purely ambient, per-frame-animated content that a static snapshot must not freeze. */
export const AMBIENT_ROLES: readonly string[] = ["ambient_crowd"];

/**
 * Removes what a static snapshot cannot represent: SkinnedMesh (GLTFExporter has no animation here) and objects
 * whose role is ambient (the crowd, which only has meaning while `update()` moves it). Returns what was removed.
 */
export function dropDynamicObjects(root: THREE.Object3D): string[] {
  const dropped: THREE.Object3D[] = [];
  root.traverse((o) => {
    const role = o.userData?.gteki_role;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || (typeof role === "string" && AMBIENT_ROLES.includes(role))) dropped.push(o);
  });
  for (const o of dropped) o.removeFromParent();
  return dropped.map((o) => o.name || o.type);
}

/**
 * Replaces each InstancedMesh with one ordinary Mesh whose geometry is every instance baked at its current
 * matrix (Godot 4.7 cannot import EXT_mesh_gpu_instancing). Per-instance colours are not carried over.
 * Returns how many were baked.
 */
export function bakeInstancedMeshes(root: THREE.Object3D): number {
  const instanced: THREE.InstancedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
  const matrix = new THREE.Matrix4();
  for (const source of instanced) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, matrix);
      parts.push(source.geometry.clone().applyMatrix4(matrix));
    }
    const baked = new THREE.Mesh(parts.length > 0 ? mergeGeometries(parts, false) : new THREE.BufferGeometry(), source.material);
    for (const part of parts) part.dispose();
    baked.name = source.name;
    baked.userData = { ...source.userData };
    baked.visible = source.visible;
    baked.position.copy(source.position);
    baked.quaternion.copy(source.quaternion);
    baked.scale.copy(source.scale);
    source.parent?.add(baked);
    source.removeFromParent();
  }
  return instanced.length;
}

/** What the exporter records about a scene's baked lightmap, for the Godot side to re-apply it. */
export interface LightmapInfo {
  /** Station-relative URI the scene loaded the lightmap from (recorded by the export's `loadTexture` shim). */
  uri: string;
  /** three `lightMap.channel`: 1 is TEXCOORD_1, which glTF keeps and Godot imports as UV2. */
  channel: number;
  color_space: string;
  flip_y: boolean;
  /** three `lightMapIntensity`, exactly as the scene set it (Ikebukuro: scale × π × LIGHTMAP_GAIN). */
  light_map_intensity: number;
  /** Meshes with at least one lightmapped material slot, flagged `gteki_lightmap_surfaces`. */
  meshes: number;
  surfaces: number;
}

/**
 * three keeps a baked lightmap on the material (`MeshStandardMaterial.lightMap`): glTF carries none of it, so the
 * snapshot would silently lose the lighting. Record what `buildScene` actually did instead of inferring it from a
 * role or a mesh name: every material slot with a `lightMap` gets its surface index in
 * `userData.gteki_lightmap_surfaces` (exported as extras), and the texture is described once for the sidecar.
 * Throws rather than guess when the slots disagree (two textures, two intensities) or the texture's origin is
 * unknown, because a wrong lightmap is worse than a loud failure.
 */
export function tagLightmaps(root: THREE.Object3D): LightmapInfo | null {
  const textures = new Set<THREE.Texture>();
  const intensities = new Set<number>();
  let meshes = 0;
  let surfaces = 0;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const materials = materialsOf(object);
    const lit: number[] = [];
    materials.forEach((material, index) => {
      const map = (material as THREE.MeshStandardMaterial).lightMap ?? null;
      if (map === null) return;
      lit.push(index);
      textures.add(map);
      intensities.add(Number((material as THREE.MeshStandardMaterial).lightMapIntensity));
    });
    if (lit.length === 0) return;
    object.userData.gteki_lightmap_surfaces = lit;
    meshes += 1;
    surfaces += lit.length;
  });
  if (meshes === 0) return null;
  if (textures.size !== 1) throw new Error(`Scene carries ${textures.size} distinct lightmap textures; the snapshot supports exactly one (unrecorded, not guessed)`);
  if (intensities.size !== 1) throw new Error(`Lightmapped materials disagree on lightMapIntensity (${[...intensities].join(", ")}); the snapshot records one value (not guessed)`);
  const texture = [...textures][0]!;
  const uri = texture.userData?.gteki_uri;
  if (typeof uri !== "string" || uri.length === 0) throw new Error("Lightmap texture has no recorded source URI (ctx.loadTexture must record it)");
  return {
    uri,
    channel: texture.channel,
    color_space: texture.colorSpace,
    flip_y: texture.flipY,
    light_map_intensity: [...intensities][0]!,
    meshes,
    surfaces,
  };
}

/** Detaches every texture from every material (their canvas/lightmap content is placeholder under Node). */
export function stripTextures(root: THREE.Object3D): number {
  const seen = new Set<THREE.Material>();
  let stripped = 0;
  root.traverse((o) => {
    if (!isMesh(o)) return;
    for (const material of materialsOf(o)) {
      if (seen.has(material)) continue;
      seen.add(material);
      const slots = material as unknown as Record<string, unknown>;
      for (const key of Object.keys(slots)) {
        if ((slots[key] as THREE.Texture | null)?.isTexture === true) {
          slots[key] = null;
          stripped += 1;
        }
      }
    }
  });
  return stripped;
}
