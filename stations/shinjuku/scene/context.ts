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
import type * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { daylight } from "./surface-materials.ts";

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
