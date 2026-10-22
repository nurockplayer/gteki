/**
 * PLATEAU street context (issue #39): whole buildings around exits 1-4 from tools/gis (`gis context-glb
 * shinjuku`), drawn instead of the procedural LOD1 extrusions of the street layer when the station declares
 * them. Visual only: nothing here adds a route, a walkable surface, a collider or a camera blocker, and the
 * scene hook never lists these meshes in `walkable`, `colliders` or `cameraBlockers`.
 *
 * Frame: shinjuku-station-enu-v0, horizontal only. glTF x is east, y is up with every building's own ground
 * flattened to street z = 0, and z is -north: the scene's own ENU to three.js mapping (X = x, Y = z, Z = -y),
 * so the GLB needs no transform.
 */
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { daylight } from "./surface-materials.ts";
import omitJson from "../sources/context-omit.json" with { type: "json" };

/** The asset id station.json declares (written by tools/import-e27.ts from sources/context-manifest.json). */
export const CONTEXT_ASSET_ID = "street-context";

/** low / kind (1 draw, about 14k triangles) for phones and quality low; high / tiles:380 (6 draws, about 84k) for desktop. */
export const CONTEXT_GLB = { low: "assets/shinjuku_context_low.glb", high: "assets/shinjuku_context_high.glb" } as const;

/** Owner decision Q10 Option A (#39 comment 6324813261). Must be on every source the asset derives from. */
export const CONTEXT_ATTRIBUTION = "出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成（建物の基部を地表面の高さにそろえて表示）";

type ContextHost = {
  bundle: StationBundle;
  quality: "low" | "high";
  assetUrl?: (uri: string) => string | null;
  loadGlb?: unknown;
};

/**
 * The GLB to load for this host, or null when the street context is off. It is on only when station.json
 * declares the asset with this quality's file, every source it cites carries the verbatim credit (so the
 * Coverage dialog shows it wherever the context renders), the explorer bundles the file, and it can load
 * GLBs. Anything else leaves the procedural LOD1 street exactly as before.
 */
export function contextGlbFor(ctx: ContextHost): string | null {
  const asset = ctx.bundle.assets?.find((a) => a.id === CONTEXT_ASSET_ID);
  if (!asset) return null;
  const uri = CONTEXT_GLB[ctx.quality];
  if (asset.uri !== uri && !(asset.files ?? []).includes(uri)) return null;
  if (asset.role !== "visual" || asset.sourceIds.length === 0) return null;
  const bySource = new Map(ctx.bundle.sources.map((s) => [s.id, s]));
  if (!asset.sourceIds.every((id) => bySource.get(id)?.attribution === CONTEXT_ATTRIBUTION)) return null;
  if (typeof ctx.loadGlb !== "function" || typeof ctx.assetUrl !== "function" || ctx.assetUrl(uri) === null) return null;
  return uri;
}

/**
 * The meshes of a loaded context GLB, or null when it is not what tools/gis writes (every mesh named
 * ctx_bldg_* and tagged gteki_role context). Fail closed: a file that could be read as a floor or wall by the
 * explorer's role rules is never drawn.
 */
export function contextMeshes(gltfScene: THREE.Object3D): THREE.Mesh[] | null {
  const meshes: THREE.Mesh[] = [];
  let ok = true;
  gltfScene.traverse((o) => {
    const named = o.name.startsWith("ctx_bldg_");
    const role = typeof o.userData.gteki_role === "string" ? o.userData.gteki_role.trim().toLowerCase() : null;
    if ((o as THREE.Mesh).isMesh) {
      meshes.push(o as THREE.Mesh);
      if (!named) ok = false;
    }
    if (role !== null && role !== "context") ok = false;
    if (named && role !== "context") ok = false;
  });
  return ok && meshes.length > 0 ? meshes : null;
}

/** Pale concrete under the street layer's own sun, sky reflection and distance haze (flat colour, no textures shipped). */
export function createContextMaterial(): THREE.MeshBasicMaterial {
  const m = daylight("#d3cfc5");
  m.name = "ctx_concrete";
  return m;
}

/** A texture owned by a material dies with it; a loaded GLB's materials are disposed with everything they hold. */
export function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
  material.dispose();
}

/** Release a loaded context scene that is not (or no longer) in use: every geometry, material and texture under it. */
export function disposeContextScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const m of [mesh.material].flat()) if (m) disposeMaterial(m);
  });
}

/** How long the station waits for the context files before it draws the procedural street without them. */
export const CONTEXT_LOAD_TIMEOUT_MS = 20_000;

export type ContextLoad = { scenes: THREE.Object3D[] } | { error: unknown };

/**
 * Load every context file at once (they are independent), within `timeoutMs`. All or nothing: when any file
 * throws, or the time runs out, nothing is returned and every scene that has already loaded, or that lands
 * later, is disposed, so a failed context leaves no GPU-bound geometry behind. The context is visual only,
 * so the caller carries on with the procedural street on `error`.
 */
export async function loadContextScenes(loadGlb: (uri: string) => Promise<{ scene: THREE.Object3D }>, uris: readonly string[], timeoutMs = CONTEXT_LOAD_TIMEOUT_MS): Promise<ContextLoad> {
  const pending = uris.map((uri) => Promise.resolve().then(() => loadGlb(uri)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  const first = await Promise.race([Promise.allSettled(pending), timeout]);
  clearTimeout(timer);
  if (first === "timeout") {
    for (const p of pending) p.then((g) => disposeContextScene(g.scene), () => undefined);
    return { error: new Error(`street context did not load within ${timeoutMs} ms`) };
  }
  const loaded = first.flatMap((r) => (r.status === "fulfilled" ? [r.value.scene] : []));
  const failed = first.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    loaded.forEach(disposeContextScene);
    return { error: failed.reason };
  }
  return { scenes: loaded };
}

/** Which file a uri names. */
export const contextVariant = (uri: string): "low" | "high" => (uri === CONTEXT_GLB.high ? "high" : "low");

/** `bbox`: [minX, minY, minZ, maxX, maxY, maxZ] of the vertices the range's triangles use (the fingerprint of the building it names). */
interface OmitRange { mesh: string; triStart: number; triCount: number; bbox: [number, number, number, number, number, number] }
export const CONTEXT_OMIT = omitJson as unknown as {
  glbTriangles: Record<"low" | "high", number>;
  omit: { gmlId: string; where: string; overlapM2: Record<string, number>; ranges: Record<"low" | "high", OmitRange> }[];
};

/** Float32 positions are exact in the stored boxes up to their rounding (1e-4 m); a looser tolerance still tells buildings apart. */
const BOX_TOLERANCE_M = 1e-3;

/** True when the vertices used by the range's triangles span exactly the recorded bounding box. */
function rangeMatchesBox(g: THREE.BufferGeometry, r: OmitRange): boolean {
  const index = g.index!.array, pos = g.attributes.position!;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = r.triStart * 3; k < (r.triStart + r.triCount) * 3; k++) {
    const v = index[k]!;
    if (v >= pos.count) return false;
    for (let a = 0; a < 3; a++) {
      const x = pos.getComponent(v, a);
      if (x < box[a]!) box[a] = x;
      if (x > box[a + 3]!) box[a + 3] = x;
    }
  }
  return Array.isArray(r.bbox) && r.bbox.length === 6 && box.every((x, i) => Math.abs(x - r.bbox[i]!) <= BOX_TOLERANCE_M);
}

/**
 * Prepare a loaded, accepted context for drawing: drop the triangles of the buildings listed in
 * sources/context-omit.json (visual omission by triangle range; their exit openings lie inside the PLATEAU
 * footprint), and store each index as Uint16 where the mesh has under 65,536 vertices. Returns false, touching
 * nothing, when the file is not the one the list was written for (triangle total, a range that does not fit,
 * or a range whose triangles no longer span the bounding box recorded for its building, as after a reordering
 * of the features): the caller then draws the procedural street instead of a context whose omissions would be wrong.
 */
export function prepareContext(gltfScene: THREE.Object3D, variant: "low" | "high"): boolean {
  const meshes = contextMeshes(gltfScene);
  if (!meshes) return false;
  const total = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0);
  if (total !== CONTEXT_OMIT.glbTriangles[variant]) return false;
  const cut = new Map<THREE.Mesh, OmitRange[]>();
  for (const { ranges } of CONTEXT_OMIT.omit) {
    const r = ranges[variant];
    const mesh = meshes.find((m) => m.name === r.mesh);
    if (!mesh || !mesh.geometry.index || r.triStart < 0 || r.triCount <= 0 || (r.triStart + r.triCount) * 3 > mesh.geometry.index!.count) return false;
    if (!rangeMatchesBox(mesh.geometry, r)) return false;
    (cut.get(mesh) ?? cut.set(mesh, []).get(mesh)!).push(r);
  }
  for (const mesh of meshes) {
    const g = mesh.geometry, old = g.index!.array;
    const ranges = (cut.get(mesh) ?? []).sort((a, b) => a.triStart - b.triStart);
    const kept = new Uint32Array(old.length - ranges.reduce((n, r) => n + r.triCount * 3, 0));
    let at = 0, from = 0;
    for (const r of ranges) {
      kept.set(old.subarray(from, r.triStart * 3), at); at += r.triStart * 3 - from;
      from = (r.triStart + r.triCount) * 3;
    }
    kept.set(old.subarray(from), at);
    g.setIndex(new THREE.BufferAttribute(g.attributes.position!.count < 65_536 ? Uint16Array.from(kept) : kept, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return true;
}
