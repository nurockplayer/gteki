/**
 * Digests for #72: prove a load-cost change leaves every collision, wall, floor, fence, camera-blocker
 * and restricted-area buffer byte-identical, and every visual triangle identical as a set per material.
 * The fixture began at fe8d3b6; #49 added render-only shells and #342 added identity signage.
 * Regenerate only on purpose: pnpm exec tsx stations/shinjuku/test/helpers/scene-digest-fixture.ts
 */
import { createHash } from "node:crypto";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { buildStation, type BuildOptions } from "../../scene/build.ts";
import { buildLayout, type Layout, type Plan } from "../../scene/layout.ts";
import { protectFareAndAccess, type FareProtection } from "../../scene/fare-fence.ts";
import { buildScene } from "../../gteki/scene.ts";

const sha = (...parts: (string | Uint8Array)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};
const bytes = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/** Millimetre-normalised JSON hash of a plain structure (Maps become entry lists). Order preserved. */
export function plainHash(value: unknown, round = true): string {
  return sha(JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Map) return [...v];
    return round && typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
  }));
}
/** Exact (unrounded) JSON hash: fences and walls must not drift by even one ulp. */
export const exactHash = (value: unknown) => plainHash(value, false);

/** Every byte a raycaster or collision query can see in a mesh, plus its placement. */
export function geometryBytesHash(mesh: THREE.Object3D): string {
  const m = mesh as THREE.Mesh;
  const h = createHash("sha256");
  h.update(JSON.stringify([m.name, m.position, m.quaternion, m.scale, m.visible, m.userData?.gteki_role ?? null, (m.material as THREE.Material).side]));
  const g = m.geometry;
  for (const [name, a] of [["index", g.index], ...Object.entries(g.attributes)] as const) {
    if (!a) continue;
    h.update(JSON.stringify([name, a.itemSize, a.normalized, a.array.constructor.name]));
    h.update(bytes(a.array));
  }
  return h.digest("hex");
}

type Digest = {
  walkable: string[];
  colliders: string[];
  cameraBlockers: string[];
  /** Positions in `colliders` of each camera blocker (identity, not just bytes). */
  cameraBlockerIsCollider: boolean[];
  walls: string;
  spawnPoints: string;
  visual: Record<string, { triangles: number; hash: string }>;
  /** Meshes whose identity matters to other code: gteki_role holders, lift-portal carriers, and the names
   * gteki/scene.ts and the explorer key on. Batch names are deliberately absent (they were renamed in #72). */
  semantic: string[];
};

const materialSignature = (m: THREE.Material | THREE.Material[]): string => {
  if (Array.isArray(m)) return m.map(materialSignature).join("+");
  const s = m as THREE.MeshStandardMaterial & { emissive?: THREE.Color };
  return JSON.stringify([s.type, s.name, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.opacity, s.transparent, s.side, s.visible, s.roughness, s.metalness, s.depthWrite, s.depthTest, s.colorWrite, !!s.map, !!s.bumpMap, s.polygonOffset]);
};

const f32 = (n: number) => Math.fround(n);
/** One triangle, canonicalised to start at its smallest vertex (winding preserved). */
function triangleKeys(mesh: THREE.Mesh, into: string[]) {
  const g = mesh.geometry;
  if (!g.attributes.position) return; // the viewer probe draws nothing
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const index = g.index;
  const count = index ? index.count : pos.count;
  const instanced = mesh as unknown as THREE.InstancedMesh;
  const matrices: THREE.Matrix4[] = [];
  mesh.updateWorldMatrix(true, false);
  if (instanced.isInstancedMesh) {
    for (let i = 0; i < instanced.count; i++) {
      const im = new THREE.Matrix4();
      instanced.getMatrixAt(i, im);
      matrices.push(im.premultiply(mesh.matrixWorld));
    }
  } else matrices.push(mesh.matrixWorld);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const mw of matrices) {
    const identity = mw.equals(new THREE.Matrix4());
    nm.getNormalMatrix(mw);
    const vertex = (i: number) => {
      v.fromBufferAttribute(pos, i);
      if (!identity) v.applyMatrix4(mw);
      let s = `${f32(v.x)},${f32(v.y)},${f32(v.z)}`;
      if (nor) {
        n.fromBufferAttribute(nor, i);
        if (!identity) n.applyMatrix3(nm).normalize();
        s += `/${f32(n.x)},${f32(n.y)},${f32(n.z)}`;
      }
      if (uv) s += `/${uv.getX(i)},${uv.getY(i)}`;
      return s;
    };
    for (let t = 0; t < count; t += 3) {
      const tri = [0, 1, 2].map((k) => vertex(index ? index.getX(t + k) : t + k));
      const lo = tri.indexOf([...tri].sort()[0]!);
      into.push([tri[lo], tri[(lo + 1) % 3], tri[(lo + 2) % 3]].join("|"));
    }
  }
}

/** Per (material, visibility, render order) digest of the set of drawn triangles. Batch names and
 * how triangles are grouped into meshes do not matter; the triangles themselves do. */
export function visualDigest(root: THREE.Object3D): Digest["visual"] {
  const groups = new Map<string, string[]>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData?.gteki_role === "walkable" || mesh.userData?.gteki_role === "collider") return;
    // Invisible proxies (walk/wall/ceiling) are digested byte-for-byte elsewhere.
    if ((mesh.material as THREE.Material).visible === false) return;
    const key = `${materialSignature(mesh.material)}#visible=${mesh.visible}#order=${mesh.renderOrder}#instanced=${(mesh as THREE.InstancedMesh).isInstancedMesh ? ((mesh as THREE.InstancedMesh).count > 1) : false}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    triangleKeys(mesh, list);
  });
  const out: Digest["visual"] = {};
  for (const [key, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort();
    out[key] = { triangles: list.length, hash: sha(list.join("\n")) };
  }
  return out;
}

const SEMANTIC_NAME = /^(sign-faces:|sign-cases$|Restricted area$|No entry$|surface-ground$|surface-stone$)/;
export function semanticDigest(root: THREE.Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = (m.userData?.gteki_role as string | undefined) ?? "", portals = m.userData?.portals;
    const named = SEMANTIC_NAME.test(m.name);
    if (!role && !portals && !named) return;
    const g = m.geometry, tris = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
    out.push([role, named ? m.name : "", portals ? `portals:${exactHash(portals)}` : "", materialSignature(m.material), tris].join("|"));
  });
  return out.sort();
}

export function sceneDigest(scene: StationScene): Digest {
  const colliders = scene.colliders ?? [];
  return {
    walkable: scene.walkable.map(geometryBytesHash),
    colliders: colliders.map(geometryBytesHash),
    cameraBlockers: (scene.cameraBlockers ?? []).map(geometryBytesHash),
    cameraBlockerIsCollider: (scene.cameraBlockers ?? []).map((o) => colliders.includes(o)),
    walls: exactHash(scene.walls),
    spawnPoints: exactHash(scene.spawnPoints),
    visual: visualDigest(scene.root),
    semantic: semanticDigest(scene.root),
  };
}

export type ProtectDigest = { layoutAfterProtect: string; protection: string; fences: string; gates: string; removedAccess: string; restrictedConflicts: string; cacheHit: boolean };
export function protectionDigest(layout: Layout, p: FareProtection): ProtectDigest {
  return {
    layoutAfterProtect: exactHash(layout),
    protection: exactHash(p),
    fences: exactHash(p.fences),
    gates: exactHash(p.gates),
    removedAccess: exactHash(p.removedAccess),
    restrictedConflicts: exactHash(p.restrictedConflicts),
    cacheHit: p.restrictionCacheHit,
  };
}

/** Digest of what `buildStation` hands the lane app and tests: collision world inputs after the build. */
export type StationDigest = { layoutAfterBuild: string; propWalls: string; levelWalls: string; escalators: string };
export function stationDigest(built: ReturnType<typeof buildStation>): StationDigest {
  return {
    layoutAfterBuild: exactHash(built.layout),
    propWalls: exactHash(built.propWalls),
    levelWalls: exactHash(built.layout.levels.map((l) => l.walls)),
    escalators: exactHash(built.escalators.map((e) => e.run)),
  };
}

export type FullDigest = { protect: ProtectDigest; station: StationDigest; scene: Record<"low" | "high", Digest> };

/** Stub the canvas the texture code draws on (geometry only), run `fn`, restore. When `fn` returns a promise
 * (buildScene is async while the kit swap is on, which is the default) the stub stays until it settles. */
export function withCanvasStub<T>(fn: () => T): T {
  const context = new Proxy({}, { get: (_t, key) => key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined });
  const g = globalThis as { document?: unknown };
  const before = g.document;
  g.document = { createElement: () => ({ width: 1, height: 1, getContext: () => context }) };
  const restore = () => { g.document = before; };
  let out: T;
  try { out = fn(); } catch (err) { restore(); throw err; }
  if (out instanceof Promise) return out.finally(restore) as unknown as T;
  restore();
  return out;
}

export function protectOnly(bundle: StationBundle, plan: Plan, options?: Parameters<typeof protectFareAndAccess>[3]) {
  const layout = buildLayout(bundle, plan);
  const protection = protectFareAndAccess(layout, plan, bundle, options);
  return protectionDigest(layout, protection);
}

export async function fullDigest(bundle: StationBundle, plan: Plan, opts: { stationOptions?: Partial<BuildOptions & Record<string, unknown>> } = {}): Promise<FullDigest> {
  const protect = protectOnly(bundle, plan);
  const station = withCanvasStub(() => {
    const built = buildStation(bundle, plan, { quality: "low", ...opts.stationOptions } as BuildOptions);
    const d = stationDigest(built);
    built.dispose();
    return d;
  });
  const scenes = {} as Record<"low" | "high", Digest>;
  for (const quality of ["low", "high"] as const) {
    const scene = await withCanvasStub(() => buildScene({ THREE, bundle, quality } as never)) as StationScene;
    scenes[quality] = sceneDigest(scene);
    scene.dispose();
  }
  return { protect, station, scene: scenes };
}
