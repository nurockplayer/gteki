/**
 * Prepares a built `StationScene` for the Godot snapshot: every mesh gets an explicit `userData.gteki_role`
 * (written to glTF `extras.gteki_role` by GLTFExporter), taken from the scene's own `walkable` / `colliders` /
 * `cameraBlockers` lists, which are the only collision truth the web walker uses. Godot never infers it.
 *
 * - Every mesh that is not drawn in the source (invisible itself, under an invisible ancestor, or with only invisible
 *   materials) is flagged `gteki_hidden`, whether or not it is listed; the Godot loader never draws flagged meshes.
 *   A multi-material mesh with only some materials visible keeps its drawn groups and gets its invisible groups as a
 *   hidden sibling mesh, so neither the drawn geometry nor the collision triangles are lost.
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

/**
 * True when the GLB can carry the mesh. GLTFExporter skips geometry with no position data, so a draw-nothing helper
 * (Shinjuku's viewer probe, which only reports the rendering camera) reaches neither snapshot nor Godot; counting it
 * in the sidecar would make the two disagree.
 */
function drawable(mesh: THREE.Mesh): boolean {
  const position = (mesh.geometry as THREE.BufferGeometry | undefined)?.getAttribute("position");
  return position !== undefined && position.count > 0;
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

/** Every mesh under `roots`, each once, without following parents (list members may live outside `root`). */
function meshesUnder(roots: readonly THREE.Object3D[]): THREE.Mesh[] {
  const found = new Set<THREE.Mesh>();
  for (const root of roots) root.traverse((o) => { if (isMesh(o)) found.add(o); });
  return [...found];
}

/** One `geometry.groups` entry (three's `GeometryGroup`; `materialIndex` is optional there). */
type GeometryRange = { start: number; count: number; materialIndex?: number };

/** The stored (encoded) value of a component, without `getComponent`'s normalized-integer decoding. */
function encodedComponent(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number, component: number): number {
  const interleaved = attribute as THREE.InterleavedBufferAttribute;
  if (interleaved.isInterleavedBufferAttribute) return interleaved.data.array[vertex * interleaved.data.stride + interleaved.offset + component]!;
  return (attribute as THREE.BufferAttribute).array[vertex * attribute.itemSize + component]!;
}

/**
 * Copies the index ranges of `ranges` into a new geometry, renumbering vertices and remapping each range's
 * materialIndex through `materialIndex`. The source geometry is left untouched. Morph targets are not carried
 * (the snapshot is static; every animated object is dropped or baked before this runs).
 */
function extractGroups(
  geometry: THREE.BufferGeometry,
  ranges: readonly GeometryRange[],
  materialIndex: (index: number) => number,
): THREE.BufferGeometry {
  const source = geometry.index;
  const remap = new Map<number, number>();
  const data = Object.entries(geometry.attributes).map(([name, attribute]) => ({ name, attribute, values: [] as number[] }));
  const out = new THREE.BufferGeometry();
  const indices: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  for (const range of ranges) {
    const start = indices.length;
    for (let k = 0; k < range.count; k++) {
      const vertex = source ? source.getX(range.start + k) : range.start + k;
      let mapped = remap.get(vertex);
      if (mapped === undefined) {
        mapped = remap.size;
        remap.set(vertex, mapped);
        for (const entry of data) for (let c = 0; c < entry.attribute.itemSize; c++) entry.values.push(encodedComponent(entry.attribute, vertex, c));
      }
      indices.push(mapped);
    }
    groups.push({ start, count: indices.length - start, materialIndex: materialIndex(range.materialIndex ?? 0) });
  }
  for (const { name, attribute, values } of data) {
    // Keep the source's component type (Uint8 colours, Int16 UVs), item size and normalized flag, and copy the raw
    // encoded values. `getComponent` decodes normalized integers to floats; writing those into the same array type
    // truncates (128 → 0.502 → 0, i.e. black) and even a decode/encode round trip maps Int16 -32768 to -32767.
    // Interleaved buffers expose their backing array, so they are de-interleaved into the same type.
    const flat = attribute.array as ArrayLike<number>;
    const ArrayType = (flat.constructor ?? Float32Array) as new (n: number | ArrayLike<number>) => THREE.TypedArray;
    out.setAttribute(name, new THREE.BufferAttribute(new ArrayType(values), attribute.itemSize, attribute.normalized));
  }
  out.setIndex(indices);
  for (const group of groups) out.addGroup(group.start, group.count, group.materialIndex);
  return out;
}

/**
 * A multi-material mesh with only some materials visible would draw its invisible groups in Godot (three skips them
 * per group; glTF has no per-primitive visibility). The invisible groups move to a hidden sibling mesh with the same
 * transform and role, so the drawn part stays on the original and collision keeps every triangle. The original mesh
 * keeps its identity for the scene's own lists. Returns null when the mesh is all-visible or all-invisible.
 */
function splitInvisibleGroups(mesh: THREE.Mesh): THREE.Mesh | null {
  if (!Array.isArray(mesh.material)) return null;
  const materials = mesh.material;
  const visible = (index: number) => materials[index]?.visible === true;
  const groups = mesh.geometry.groups;
  if (groups.length === 0 || materials.every((m) => m.visible) || !materials.some((m) => m.visible)) return null;
  const drawn = groups.filter((g) => visible(g.materialIndex ?? 0));
  const hidden = groups.filter((g) => !visible(g.materialIndex ?? 0));
  if (drawn.length === 0 || hidden.length === 0) return null;
  // Each part keeps only the material slots its groups use, in first-use order.
  const slots = (list: readonly GeometryRange[]) => {
    const map = new Map<number, number>();
    for (const group of list) {
      const index = group.materialIndex ?? 0;
      if (!map.has(index)) map.set(index, map.size);
    }
    return map;
  };
  const drawnSlots = slots(drawn);
  const hiddenSlots = slots(hidden);
  const original = mesh.geometry;
  const sibling = new THREE.Mesh(
    extractGroups(original, hidden, (index) => hiddenSlots.get(index)!),
    [...hiddenSlots.keys()].map((index) => materials[index]!),
  );
  sibling.name = `${mesh.name || "mesh"}_hidden_materials`;
  sibling.userData = { ...mesh.userData };
  sibling.matrixAutoUpdate = mesh.matrixAutoUpdate;
  if (mesh.matrixAutoUpdate) {
    sibling.position.copy(mesh.position);
    sibling.quaternion.copy(mesh.quaternion);
    sibling.scale.copy(mesh.scale);
  } else {
    sibling.matrix.copy(mesh.matrix);
  }
  mesh.geometry = extractGroups(original, drawn, (index) => drawnSlots.get(index)!);
  mesh.material = [...drawnSlots.keys()].map((index) => materials[index]!);
  mesh.parent?.add(sibling);
  return sibling;
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

  // A multi-material mesh with only some materials visible keeps its drawn groups and moves the invisible ones to a
  // hidden sibling (see splitInvisibleGroups); the sibling inherits the original's list category.
  const splitSiblings = new Map<THREE.Mesh, THREE.Mesh>();
  for (const mesh of meshesUnder([scene.root, ...categories.keys()])) {
    const sibling = splitInvisibleGroups(mesh);
    if (sibling === null) continue;
    splitSiblings.set(mesh, sibling);
    const category = categories.get(mesh);
    if (category !== undefined) categories.set(sibling, category);
  }
  if (splitSiblings.size > 0) {
    warnings.push(`${splitSiblings.size} multi-material mesh(es) have only some materials visible: their invisible groups are exported as hidden sibling meshes (gteki_hidden), so Godot draws exactly the groups three draws`);
  }

  // Visibility is read before any re-parenting: attaching a listed mesh to the proxy group would otherwise replace
  // its original ancestor chain, and a mesh that was under an invisible parent outside root would look drawn.
  const drawnBefore = new WeakMap<THREE.Mesh, boolean>();
  for (const mesh of meshesUnder([scene.root, ...categories.keys()])) drawnBefore.set(mesh, isDrawn(mesh));
  const drawnNow = (mesh: THREE.Mesh) => drawnBefore.get(mesh) ?? isDrawn(mesh);

  // Listed meshes the scene holds outside root (raycast tiles) join the snapshot under one proxy group.
  const proxies = new THREE.Group();
  proxies.name = "gteki_collision_proxies";
  for (const mesh of categories.keys()) {
    if (isUnder(mesh, scene.root)) continue;
    proxies.attach(mesh);
    const sibling = splitSiblings.get(mesh);
    if (sibling !== undefined) proxies.attach(sibling);
  }
  if (proxies.children.length > 0) scene.root.add(proxies);

  const summary: RoleSummary = { meshes: 0, triangles: 0, byRole: {}, walkable: 0, collider: 0, camera_blocker: 0, see_through: 0, collisionOnly: 0, hidden: 0, replacedByCollision: 0, warnings };
  const undrawable: string[] = [];
  const visit = (object: THREE.Object3D, inherited: string | null) => {
    const own = roleOf(object);
    const role = own ?? inherited;
    if (isMesh(object) && !drawable(object)) {
      // Counted by the scene but never by the snapshot: keep it out of every count so the sidecar describes the GLB.
      undrawable.push(object.name || "(unnamed mesh)");
    } else if (isMesh(object)) {
      const category = categories.get(object);
      // Visibility is a property of the source mesh, whatever lists it is in: GLTFExporter (onlyVisible: false) would
      // otherwise draw scene helpers (access-fence collider, solid doors, portal and walk-bridge meshes) that the
      // scene keeps invisible and collides through tiles instead. The loader hides every flagged mesh.
      if (!drawnNow(object)) {
        object.userData.gteki_hidden = true;
        summary.hidden += 1;
      }
      let effective: string;
      if (category !== undefined) {
        effective = role !== null && VOCAB[category].includes(role) ? role : category;
        if (effective !== role && role !== null) object.userData.gteki_source_role = role;
        if (!drawnNow(object)) {
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
  if (undrawable.length > 0) {
    warnings.push(`${undrawable.length} mesh(es) have no drawable geometry and cannot reach the GLB, so they are left out of the counts: ${undrawable.join(", ")}`);
  }
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

/** One shared kit AO atlas, as recorded from the scene (the exporter adds the file hash when it writes the sidecar). */
export interface AoAtlasSource {
  /** Station-relative URI the kit loaded the atlas from (recorded by the export's `loadTexture` shim). */
  uri: string;
  /** three `aoMap.channel`: 1 is TEXCOORD_1, which glTF keeps and Godot imports as UV2. */
  channel: number;
  /** three `aoMap.colorSpace`; `NoColorSpace` is the empty string (linear data). */
  color_space: string;
  flip_y: boolean;
  /** Meshes with at least one surface bound to this kind's atlas. */
  meshes: number;
  /** Material slots bound to this kind's atlas. */
  surfaces: number;
}

/** One sidecar `ao_atlas_bindings` entry: the scene's record plus the station file's SHA-256. */
export interface AoAtlasBinding extends AoAtlasSource {
  /** SHA-256 of the station file at `uri`; computed by the exporter, because this module never touches the filesystem. */
  sha256: string;
}

/** What this module records about the kit's shared AO atlases; the exporter adds the hashes for the sidecar. */
export interface AoAtlasInfo {
  /** Atlas kind (e.g. "nosing") → source; empty when the scene uses no kit AO atlas. */
  bindings: Record<string, AoAtlasSource>;
  /** `aoMap`s that are not kit atlases; they are stripped with every other texture, never guessed. */
  warnings: string[];
}

/**
 * The kit ships ambient occlusion as shared atlases, one per kind (Lane E #391): the web loader puts the PNG on
 * `material.aoMap` with `channel = 1` (TEXCOORD_1), `colorSpace = NoColorSpace` and `flipY = false`, and marks the
 * texture `userData.gteki_uri` / `userData.gteki_atlas_kind`. glTF carries neither the AO map nor its UV-set choice,
 * so record what `buildScene` did, as `tagLightmaps` does for the bake: every atlas slot gets its surface index →
 * kind in `userData.gteki_ao_atlas_surfaces` (a glTF extras object, so its keys are strings), and each kind is
 * described once in the returned bindings (the exporter adds the sidecar `ao_atlas_bindings` hashes). Throws rather
 * than guess when a kind has two URIs, an atlas has no recorded source URI, or it samples a channel other than 1.
 *
 * AO maps that are not kit atlases (no `gteki_atlas_kind`) are only a warning: every texture is stripped from the
 * snapshot, so they cannot be re-applied and are not an exporter error.
 */
export function tagAoAtlases(root: THREE.Object3D): AoAtlasInfo {
  const atlases = new Map<string, AoAtlasSource>();
  const warnings: string[] = [];
  let nonAtlas = 0;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const surfaces: Record<string, string> = {};
    materialsOf(object).forEach((material, index) => {
      const map = (material as THREE.MeshStandardMaterial).aoMap ?? null;
      if (map === null) return;
      const kind = map.userData?.gteki_atlas_kind;
      const uri = map.userData?.gteki_uri;
      if (typeof kind !== "string" || kind.length === 0) {
        nonAtlas += 1;
        return;
      }
      if (typeof uri !== "string" || uri.length === 0) throw new Error(`AO atlas for kind "${kind}" has no recorded source URI (ctx.loadTexture must record it)`);
      if (map.channel !== 1) throw new Error(`AO atlas for kind "${kind}" uses channel ${map.channel}; only channel 1 (TEXCOORD_1 → UV2) can be applied`);
      const known = atlases.get(kind);
      if (known === undefined) atlases.set(kind, { uri, channel: map.channel, color_space: map.colorSpace, flip_y: map.flipY, meshes: 0, surfaces: 0 });
      else if (known.uri !== uri) throw new Error(`AO atlas kind "${kind}" maps to two URIs (${known.uri}, ${uri}); the snapshot records one per kind (not guessed)`);
      surfaces[String(index)] = kind;
    });
    const kinds = new Set(Object.values(surfaces));
    if (kinds.size === 0) return;
    object.userData.gteki_ao_atlas_surfaces = surfaces;
    for (const kind of kinds) atlases.get(kind)!.meshes += 1;
    for (const kind of Object.values(surfaces)) atlases.get(kind)!.surfaces += 1;
  });
  if (nonAtlas > 0) warnings.push(`${nonAtlas} aoMap slot(s) are not kit atlases (no userData.gteki_atlas_kind); every texture is stripped from the snapshot, so they are not re-applied`);
  return { bindings: Object.fromEntries(atlases), warnings };
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
