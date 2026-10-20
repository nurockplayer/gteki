import type * as THREE from "three";
import type { Avatar } from "../avatar.ts";

export interface CharacterBatch {
  /** One skinned draw containing the currently active avatars. */
  object: THREE.SkinnedMesh;
  /** Call after crowd updates; preserves the input order for stable vertex offsets. */
  sync(avatars: readonly Avatar[]): void;
  /** Prepare visibility before the render queue is built (zero visible = zero draws). */
  prepare(camera: THREE.Camera): void;
  dispose(): void;
}

type CharacterMesh = THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material>;
interface Source {
  avatar: Avatar;
  mesh: CharacterMesh;
  geometry: THREE.BufferGeometry;
  vertexOffset: number;
  indexOffset: number;
  indexCount: number;
}

function characterMesh(avatar: Avatar): CharacterMesh {
  let result: CharacterMesh | undefined;
  avatar.object.traverse(child => {
    if ((child as CharacterMesh).isSkinnedMesh) result = child as CharacterMesh;
  });
  if (!result) throw new Error("Character batch requires an avatar with a skinned mesh");
  return result;
}

/** Merge same-material procedural avatars while keeping their independent rigs. */
export function createCharacterBatch(T: typeof THREE): CharacterBatch {
  const emptyGeometry = new T.BufferGeometry();
  const placeholderMaterial = new T.MeshBasicMaterial();
  const object: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material> =
    new T.SkinnedMesh(emptyGeometry, placeholderMaterial);
  object.name = "Skinned character batch";
  object.visible = false;
  object.frustumCulled = false;
  object.castShadow = true;
  object.receiveShadow = true;

  const frustum = new T.Frustum();
  const viewProjection = new T.Matrix4();
  const worldSphere = new T.Sphere();
  const sources: Source[] = [];
  let pool: readonly Avatar[] = [];
  let ownedGeometry: THREE.BufferGeometry | undefined;
  let ownedSkeleton: THREE.Skeleton | undefined;
  let indexAttribute: THREE.BufferAttribute | undefined;
  let sourceIndices: Uint32Array | undefined;
  let disposed = false;
  let previousMask = "";
  const visibleSources: Source[] = [];
  const meshScratch: CharacterMesh[] = [];

  function releaseMerged(): void {
    ownedGeometry?.dispose();
    ownedSkeleton?.dispose();
    ownedGeometry = undefined;
    ownedSkeleton = undefined;
    indexAttribute = undefined;
    sourceIndices = undefined;
  }

  function rebuild(avatars: readonly Avatar[], meshes: CharacterMesh[]): void {
    const retained = new Set(avatars);
    for (const source of sources) if (!retained.has(source.avatar)) {
      source.mesh.visible = true;
      delete source.mesh.userData.characterBatchBoneOffset;
    }
    const previousGeometry = object.geometry;
    const previousOwnedGeometry = ownedGeometry;
    releaseMerged();
    if (previousGeometry !== previousOwnedGeometry) previousGeometry.dispose();
    sources.length = 0;
    const referenceMaterial = meshes[0]?.material;
    if (!referenceMaterial) {
      object.geometry = new T.BufferGeometry();
      object.visible = false;
      object.geometry.setDrawRange(0, 0);
      pool = [...avatars];
      previousMask = "";
      return;
    }

    let vertexCount = 0, indexCount = 0;
    const bones: THREE.Bone[] = [];
    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < avatars.length; i++) {
      const mesh = meshes[i]!;
      if (mesh.material !== referenceMaterial) throw new Error("Character batch requires one shared material");
      if (mesh.geometry.groups.length) throw new Error("Character batch requires ungrouped geometry");
      if (!mesh.geometry.index) throw new Error("Character batch requires indexed geometry");
      const start = bones.length;
      for (let b = 0; b < mesh.skeleton.bones.length; b++) {
        bones.push(mesh.skeleton.bones[b]!);
        inverses.push(mesh.skeleton.boneInverses[b]!);
      }
      sources.push({ avatar: avatars[i]!, mesh, geometry: mesh.geometry,
        vertexOffset: vertexCount, indexOffset: indexCount,
        indexCount: mesh.geometry.index.count });
      vertexCount += mesh.geometry.getAttribute("position").count;
      indexCount += mesh.geometry.index.count;
      // Store this rig's starting bone index on the source mesh for attribute rebasing.
      mesh.userData.characterBatchBoneOffset = start;
    }

    const geometry = new T.BufferGeometry();
    const attributeNames = Object.keys(meshes[0]!.geometry.attributes);
    for (const name of attributeNames) {
      const first = meshes[0]!.geometry.getAttribute(name);
      const Ctor = first.array.constructor as new (length: number) => typeof first.array;
      const merged = new Ctor(vertexCount * first.itemSize);
      let cursor = 0;
      for (const mesh of meshes) {
        const attr = mesh.geometry.getAttribute(name);
        if (!attr || attr.itemSize !== first.itemSize || attr.array.constructor !== first.array.constructor) {
          throw new Error(`Character batch attribute mismatch: ${name}`);
        }
        const values = attr.array as typeof merged;
        if (name === "skinIndex") {
          const boneOffset = Number(mesh.userData.characterBatchBoneOffset);
          for (let i = 0; i < values.length; i++) merged[cursor + i] = values[i]! + boneOffset;
        } else merged.set(values, cursor);
        cursor += values.length;
      }
      geometry.setAttribute(name, new T.BufferAttribute(merged, first.itemSize, first.normalized));
    }

    const indices = new Uint32Array(indexCount);
    let indexCursor = 0, vertexOffset = 0;
    for (const mesh of meshes) {
      const sourceIndex = mesh.geometry.index!.array;
      for (let i = 0; i < sourceIndex.length; i++) indices[indexCursor + i] = sourceIndex[i]! + vertexOffset;
      indexCursor += sourceIndex.length;
      vertexOffset += mesh.geometry.getAttribute("position").count;
    }
    indexAttribute = new T.BufferAttribute(indices, 1);
    indexAttribute.setUsage(T.DynamicDrawUsage);
    sourceIndices = indices.slice();
    geometry.setIndex(indexAttribute);
    geometry.computeBoundingSphere();
    ownedGeometry = geometry;
    ownedSkeleton = new T.Skeleton(bones, inverses);
    object.geometry = geometry;
    object.visible = true;
    object.material = referenceMaterial;
    object.bind(ownedSkeleton, new T.Matrix4());
    pool = [...avatars];
    previousMask = "";
    geometry.setDrawRange(0, 0);
    // Keep each original rig alive and updating, but let only the merged mesh render.
    for (const source of sources) source.mesh.visible = false;
  }

  function updateVisibleIndices(camera: THREE.Camera): void {
    if (!ownedGeometry || !indexAttribute) return;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    let mask = "", cursor = 0;
    const indices = indexAttribute.array as Uint32Array;
    visibleSources.length = 0;
    for (const source of sources) {
      const active = source.avatar.object.visible;
      const bound = source.mesh.boundingSphere;
      const visible = active && !!bound && frustum.intersectsSphere(worldSphere.copy(bound).applyMatrix4(source.mesh.matrixWorld));
      mask += visible ? "1" : "0";
      if (!visible) continue;
      visibleSources.push(source);
      cursor += source.indexCount;
    }
    if (mask !== previousMask) {
      previousMask = mask;
      let write = 0;
      for (const source of visibleSources) {
        const start = source.indexOffset, end = start + source.indexCount;
        for (let i = start; i < end; i++) indices[write++] = sourceIndices![i]!;
      }
      if (cursor > 0) {
        indexAttribute.clearUpdateRanges();
        indexAttribute.addUpdateRange(0, cursor);
        indexAttribute.needsUpdate = true;
      }
    }
    ownedGeometry.setDrawRange(0, cursor);
    object.visible = cursor > 0;
  }

  object.onBeforeRender = (_renderer, _scene, camera) => updateVisibleIndices(camera);

  function prepare(camera: THREE.Camera): void {
    if (disposed || !ownedGeometry) return;
    camera.updateMatrixWorld(true);
    object.updateMatrixWorld(true);
    for (const source of sources) source.avatar.object.updateMatrixWorld(true);
    updateVisibleIndices(camera);
  }

  function sync(avatars: readonly Avatar[]): void {
    if (disposed) return;
    meshScratch.length = avatars.length;
    for (let i = 0; i < avatars.length; i++) meshScratch[i] = avatars[i] === pool[i] && sources[i]
      ? sources[i]!.mesh : characterMesh(avatars[i]!);
    const meshes = meshScratch;
    const changed = avatars.length !== pool.length || avatars.some((avatar, i) =>
      avatar !== pool[i] || meshes[i] !== sources[i]?.mesh || meshes[i]!.geometry !== sources[i]?.geometry);
    if (changed) rebuild(avatars, meshes);
    // Matrix updates here ensure bones reflect placements before a renderer draw or CPU query.
    for (const source of sources) source.avatar.object.updateMatrixWorld(true);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const source of sources) {
      source.mesh.visible = true;
      delete source.mesh.userData.characterBatchBoneOffset;
    }
    sources.length = 0;
    visibleSources.length = 0;
    meshScratch.length = 0;
    const currentGeometry = object.geometry;
    const mergedGeometry = ownedGeometry;
    releaseMerged();
    if (currentGeometry !== mergedGeometry) currentGeometry.dispose();
    placeholderMaterial.dispose();
    object.removeFromParent();
    object.clear();
  }

  return { object, sync, prepare, dispose };
}
