/**
 * Digests of a built station. Five hashes, each over a different part of what a viewer or the explorer gets:
 *
 * - `geometryDigest`: exactly what test/helpers/retained-geometry.ts hashes for meshes (name, transform,
 *   visibility, every attribute/index byte, instance matrices and counts, in traversal order), so its value for a
 *   flag-off build is comparable with that helper's committed hash.
 * - `appearanceDigest`: material kind, colours, texture presence, blending flags and render order per mesh.
 * - `nodesDigest`: EVERY Object3D, meshes or not (groups, lights, cameras, empties): type, name, transform,
 *   visibility, layers, culling, render order, shadow flags, userData, and each light's colour, intensity,
 *   range and direction.
 * - `texturesDigest`: every texture on every material: size, wrap, repeat/offset/rotation, colour space, flip,
 *   filters, anisotropy, mipmaps, and the pixel bytes of data textures.
 * - `listsDigest` (separate function): what the explorer reads from the scene object itself, namely walls,
 *   walkable, colliders, cameraBlockers, spawn points and environment.
 */
import { createHash, type Hash } from "node:crypto";
import * as THREE from "three";

export interface StationDigest {
  geometryDigest: string;
  appearanceDigest: string;
  nodesDigest: string;
  texturesDigest: string;
  meshes: number;
  bytes: number;
}

const TEXTURE_SLOTS = ["map", "aoMap", "bumpMap", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "lightMap", "envMap", "displacementMap"] as const;

/** Deterministic JSON of arbitrary userData: sorted keys, typed arrays summarised by hash, three objects by name. */
function stable(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "fn";
  if (typeof value !== "object") return String(value);
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}:${createHash("sha256").update(Buffer.from(value.buffer, value.byteOffset, value.byteLength)).digest("hex")}`;
  if (seen.has(value) || depth > 8) return "circular-or-deep";
  seen.add(value);
  if (value instanceof THREE.Object3D) return `object3d:${value.type}:${value.name}`;
  if (value instanceof THREE.BufferGeometry) return `geometry:${value.type}`;
  if (value instanceof THREE.Texture) return `texture:${value.name}`;
  if (value instanceof THREE.Material) return `material:${value.type}:${value.name}`;
  if (Array.isArray(value)) return value.map((v) => stable(v, depth + 1, seen));
  if (value instanceof Map) return [...value].map(([k, v]) => [stable(k, depth + 1, seen), stable(v, depth + 1, seen)]);
  if (value instanceof Set) return [...value].map((v) => stable(v, depth + 1, seen));
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k], depth + 1, seen)]));
}

const hashBytes = (h: Hash, a: ArrayBufferView) => h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));

function hashGeometry(h: Hash, g: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const [name, a] of [["index", g.index], ...Object.entries(g.attributes)] as const) {
    if (!a) continue;
    h.update(JSON.stringify([name, a.itemSize, a.normalized]));
    hashBytes(h, a.array);
    bytes += a.array.byteLength;
  }
  return bytes;
}

function hashTexture(h: Hash, slot: string, t: THREE.Texture) {
  const img = t.image as { width?: number; height?: number; data?: ArrayBufferView } | null | undefined;
  h.update(JSON.stringify([
    slot, t.name, t.wrapS, t.wrapT, t.repeat.toArray(), t.offset.toArray(), t.center.toArray(), t.rotation, t.colorSpace, t.flipY,
    t.minFilter, t.magFilter, t.anisotropy, t.generateMipmaps, t.premultiplyAlpha, t.channel, t.format, t.type, img?.width ?? null, img?.height ?? null,
  ]));
  if (img?.data && ArrayBuffer.isView(img.data)) hashBytes(h, img.data);
}

function hashMaterialExtras(h: Hash, m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  h.update(JSON.stringify([
    m.name, m.type, m.alphaTest, m.depthTest, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.toneMapped, m.vertexColors, s.fog,
    s.envMapIntensity ?? null, s.aoMapIntensity ?? null, s.bumpScale ?? null, s.normalScale?.toArray?.() ?? null, s.flatShading ?? null, s.lightMapIntensity ?? null,
    stable(m.userData),
  ]));
}

/** `skip` prunes whole subtrees (the scene hook's walk proxies and probe, the kit group). Traversal order is `Object3D.traverse`'s. */
export function digestStation(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): StationDigest {
  const geometry = createHash("sha256");
  const appearance = createHash("sha256");
  const nodes = createHash("sha256");
  const textures = createHash("sha256");
  let meshes = 0;
  let bytes = 0;
  const visit = (o: THREE.Object3D) => {
    if (skip(o)) return;
    node(o);
    if (o instanceof THREE.Mesh) mesh(o);
    for (const c of o.children) visit(c);
  };
  const node = (o: THREE.Object3D) => {
    nodes.update(JSON.stringify([
      o.type, o.name, o.position, o.quaternion, o.scale, o.visible, o.layers.mask, o.frustumCulled, o.renderOrder, o.castShadow, o.receiveShadow,
      o.matrixAutoUpdate, o.children.length, stable(o.userData),
    ]));
    const l = o as THREE.Light & { distance?: number; decay?: number; angle?: number; penumbra?: number; groundColor?: THREE.Color; target?: THREE.Object3D };
    if (l.isLight) {
      nodes.update(JSON.stringify([
        l.color?.getHexString?.() ?? null, l.intensity, l.distance ?? null, l.decay ?? null, l.angle ?? null, l.penumbra ?? null,
        l.groundColor?.getHexString?.() ?? null, l.target?.position?.toArray?.() ?? null,
      ]));
    }
    const cam = o as THREE.PerspectiveCamera;
    if (cam.isCamera) nodes.update(JSON.stringify([cam.fov ?? null, cam.near ?? null, cam.far ?? null, cam.zoom ?? null]));
  };
  const mesh = (o: THREE.Mesh) => {
    meshes++;
    geometry.update(JSON.stringify([o.name, o.position, o.quaternion, o.scale, o.visible]));
    bytes += hashGeometry(geometry, o.geometry);
    if (o instanceof THREE.InstancedMesh) {
      geometry.update(JSON.stringify(o.count));
      geometry.update(Buffer.from(o.instanceMatrix.array.buffer));
    }
    for (const m of [o.material].flat() as THREE.Material[]) {
      const s = m as THREE.MeshStandardMaterial;
      appearance.update(JSON.stringify([
        o.name, m.type, m.visible, m.transparent, m.opacity, m.side, m.depthWrite,
        s.color?.getHexString?.() ?? null, s.emissive?.getHexString?.() ?? null, s.emissiveIntensity ?? null,
        s.roughness ?? null, s.metalness ?? null, !!s.map, !!s.aoMap, !!s.bumpMap, !!s.emissiveMap, o.renderOrder,
      ]));
      hashMaterialExtras(textures, m);
      for (const slot of TEXTURE_SLOTS) {
        const t = (m as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
        if (t && t.isTexture) hashTexture(textures, slot, t);
      }
    }
  };
  visit(root);
  return {
    geometryDigest: geometry.digest("hex"),
    appearanceDigest: appearance.digest("hex"),
    nodesDigest: nodes.digest("hex"),
    texturesDigest: textures.digest("hex"),
    meshes,
    bytes,
  };
}

/** The lists and values the explorer reads off a `StationScene` besides its root. */
export function digestSceneLists(scene: {
  walkable: THREE.Object3D[];
  colliders?: THREE.Object3D[];
  cameraBlockers?: THREE.Object3D[];
  walls?: unknown;
  spawnPoints?: unknown;
  environment?: unknown;
}): { listsDigest: string; counts: Record<string, number> } {
  const h = createHash("sha256");
  const counts: Record<string, number> = {};
  const lists: [string, THREE.Object3D[]][] = [["walkable", scene.walkable], ["colliders", scene.colliders ?? []], ["cameraBlockers", scene.cameraBlockers ?? []]];
  for (const [name, list] of lists) {
    counts[name] = list.length;
    h.update(`${name}:${list.length}`);
    for (const o of list) {
      o.updateWorldMatrix(true, false);
      h.update(JSON.stringify([o.type, o.name, o.visible, o.matrixWorld.elements, stable(o.userData)]));
      const m = o as THREE.Mesh;
      if (m.isMesh) hashGeometry(h, m.geometry);
      if (o instanceof THREE.InstancedMesh) hashBytes(h, o.instanceMatrix.array);
    }
  }
  h.update(JSON.stringify([stable(scene.walls), stable(scene.spawnPoints), stable(scene.environment)]));
  counts.walls = Array.isArray(scene.walls) ? scene.walls.length : 0;
  return { listsDigest: h.digest("hex"), counts };
}
