// Kit batch 3 (#94): generic Lane E frames around the existing fitted sign faces. Visual only:
// nothing here enters walkable, colliders or the graph. A failed asset leaves signs.ts's original boxes.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
import { KIT_ENV_INTENSITY, type KitManifest, pieceUri, tileGroups, tileSize } from "./kit.ts";
import type { SignLayout } from "./signs.ts";
type ThreeNS = typeof THREE_NS;

export interface NineSlice {
  end_m: number;
  span_unit_m: number;
  outer_h_m: number;
  depth_m: number;
  bar_m: number;
  opening_h_m: number;
  face_plane_m: number;
  rod_inset_m: number;
  rod_unit_m: number;
  min_width_m: number;
  max_width_m: number;
  nominal_width_m: number;
  centre_z_m: number;
  hanger_base_above_centre_m: number;
  rod_base_above_centre_m: number;
}

export const FRAME_USE = "sign_frame";
/** build_signage.py FLUSH_GAP, with 1 mm for rounded ENU heights. */
export const FLUSH_GAP_M = 0.021;
export const FRAME_PARTS = ["end_L", "end_R", "span", "hanger", "rod", "rod_canopy"] as const;
export type FramePart = typeof FRAME_PARTS[number];
export interface PartPlacement {
  part: FramePart;
  x: number;
  y: number;
  sx: number;
  sy: number;
}
export interface SignFramePlacement {
  sign: SignLayout;
  widthM: number;
  /** Requested outer width, before clamping to the kit's supported range. */
  requestedWidthM: number;
  parts: PartPlacement[];
}

/** Pure nine-slice recipe. W is the OUTER width: add the two 3 cm side bars to contain the fitted face.
 * Low ceilings squash only the frame's height, preserving the sign's existing position and face size. */
export function signFramePlacements(signs: readonly SignLayout[], spec: NineSlice, omitRods = false): SignFramePlacement[] {
  return signs.map((sign) => {
    const requestedWidthM = sign.widthM + 2 * spec.bar_m;
    const widthM = Math.max(spec.min_width_m, Math.min(spec.max_width_m, requestedWidthM));
    const parts: PartPlacement[] = [
      { part: "end_L", x: -widthM / 2 + spec.end_m, y: 0, sx: 1, sy: sign.scale },
      { part: "end_R", x: widthM / 2 - spec.end_m, y: 0, sx: 1, sy: sign.scale },
      { part: "span", x: 0, y: 0, sx: (widthM - 2 * spec.end_m) / spec.span_unit_m, sy: sign.scale },
    ];
    const top = spec.outer_h_m / 2 * sign.scale;
    const gap = (sign.ceilingZ ?? sign.position.z + top) - sign.position.z - top;
    if (!omitRods && gap > FLUSH_GAP_M) {
      const collar = spec.rod_base_above_centre_m - spec.hanger_base_above_centre_m;
      // In a very short gap there is room only for a rod, not the fixed-height collar.
      const hanger = gap >= collar;
      const base = top + (hanger ? collar : 0);
      for (const x of [-1, 1].map((side) => side * (widthM / 2 - spec.rod_inset_m))) {
        if (hanger) parts.push({ part: "hanger", x, y: top, sx: 1, sy: 1 });
        parts.push({ part: "rod", x, y: base, sx: 1, sy: Math.max(0, gap - (hanger ? collar : 0)) / spec.rod_unit_m });
        // The canopy's pivot is its TOP: it stays on the ceiling and is never stretched with the rod.
        parts.push({ part: "rod_canopy", x, y: top + gap, sx: 1, sy: 1 });
      }
    }
    return { sign, widthM, requestedWidthM, parts };
  });
}

interface PartAsset {
  part: FramePart;
  geometry: THREE_NS.BufferGeometry;
  material: THREE_NS.Material;
  matrix: THREE_NS.Matrix4;
}

/** GLTFLoader may split a multi-material VIS_ node into child meshes. Keep their transform relative
 * to that named pivot, discarding the library's nominal placement (2.54 m above its floor). */
function frameParts(THREE: ThreeNS, gltf: GLTF): PartAsset[] {
  gltf.scene.updateMatrixWorld(true);
  const parts: PartAsset[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE_NS.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let pivot: THREE_NS.Object3D | null = null;
    let part: FramePart | undefined;
    for (let p: THREE_NS.Object3D | null = mesh; p; p = p.parent) {
      if (/^COL_|colonly$|^SOCKET_/.test(p.name)) return;
      const found = FRAME_PARTS.find((name) => p!.name === `VIS_${name}`);
      if (found) { pivot = p; part = found; }
    }
    if (pivot && part) parts.push({ part, geometry: mesh.geometry, material: mesh.material,
      matrix: new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(mesh.matrixWorld) });
  });
  return parts;
}

export interface SignFrameStats {
  frames: number;
  tiles: number;
  drawCallsAllTiles: number;
  trianglesAllTiles: number;
  trianglesWorstTile: number;
}
export interface LoadedSignKit {
  /** Defined only after the complete frame asset has loaded; enables recessed faces in signs.ts. */
  facePlaneM?: number;
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
    signs: readonly SignLayout[]): { group: THREE_NS.Group; placements: SignFramePlacement[]; stats: SignFrameStats };
  dispose(): void;
}

/** The optional phone setting removes the entire suspension (rods, collars and canopies), keeping all frames.
 * scene.ts turns it on for phones. Never throws on an unusable piece. */
export async function loadSignKit(THREE: ThreeNS, host: Pick<SceneContext, "assetUrl" | "loadGlb">,
  kit: KitManifest, low: boolean, options: { omitPhoneRods?: boolean } = {}): Promise<LoadedSignKit> {
  const entry = Object.entries(kit.pieces).find(([, p]) => p.use === FRAME_USE && p.nine_slice);
  const spec = entry?.[1].nine_slice;
  let gltf: GLTF | undefined;
  let parts: PartAsset[] = [];
  if (entry && spec) {
    const uri = pieceUri(kit, entry[0], low);
    try {
      if (host.assetUrl(uri) === null) throw new Error(`${uri} is not in the station folder`);
      gltf = await host.loadGlb(uri);
      parts = frameParts(THREE, gltf);
      if (FRAME_PARTS.some((name) => !parts.some((p) => p.part === name))) throw new Error(`${uri} has an incomplete nine-slice frame`);
    } catch (err) {
      parts = [];
      console.warn(`[ikebukuro] kit: sign frame: ${err instanceof Error ? err.message : String(err)}; keeping the original sign boxes`);
    }
  }
  const owned: { dispose(): void }[] = [];
  return {
    facePlaneM: parts.length ? spec!.face_plane_m : undefined,
    build(THREE, env, toRenderer, signs) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_signs";
      group.userData = { gteki_role: "kit_sign_frame" };
      const placements = parts.length ? signFramePlacements(signs, spec!, low && options.omitPhoneRods) : [];
      for (const p of placements) {
        if (p.requestedWidthM !== p.widthM) console.warn(`[ikebukuro] kit: ${p.sign.id}: sign frame width ${p.requestedWidthM} m outside ${spec!.min_width_m}-${spec!.max_width_m} m; clamped to ${p.widthM} m`);
      }
      const stats: SignFrameStats = { frames: placements.length, tiles: 0, drawCallsAllTiles: 0, trianglesAllTiles: 0, trianglesWorstTile: 0 };
      const world = placements.map((p) => {
        const f = toRenderer(p.sign.facing.x, p.sign.facing.y, 0).sub(toRenderer(0, 0, 0));
        return { centre: toRenderer(p.sign.position.x, p.sign.position.y, p.sign.position.z), yaw: Math.atan2(f.x, f.z), p };
      });
      const lit = new Map<THREE_NS.Material, THREE_NS.Material>();
      const litOf = (src: THREE_NS.Material) => {
        let m = lit.get(src);
        if (!m) {
          m = src.clone();
          const std = m as THREE_NS.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) { std.envMap = env; std.envMapIntensity = KIT_ENV_INTENSITY; }
          lit.set(src, m);
          owned.push(m);
        }
        return m;
      };
      const base = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0), offset = new THREE.Vector3(), scale = new THREE.Vector3();
      const tiles = tileGroups(world.map((w) => ({ x: w.centre.x, z: w.centre.z })), tileSize(low));
      for (const [key, idx] of [...tiles].sort(([a], [b]) => a < b ? -1 : 1)) {
        stats.tiles++;
        let tileTris = 0;
        for (const part of parts) {
          const instances = idx.flatMap((wi) => world[wi]!.p.parts.filter((p) => p.part === part.part).map((p) => ({ wi, p })));
          if (!instances.length) continue;
          const im = new THREE.InstancedMesh(part.geometry, litOf(part.material), instances.length);
          owned.push(im); // instance buffers need their own dispose(), separately from geometry/material
          im.name = `kit_sign_frame:${part.part}:${key}`;
          im.userData = { gteki_role: "kit_sign_frame" };
          instances.forEach(({ wi, p }, i) => {
            const w = world[wi]!;
            q.setFromAxisAngle(up, w.yaw);
            base.compose(w.centre, q, scale.set(1, 1, 1));
            local.compose(offset.set(p.x, p.y, 0), new THREE.Quaternion(), scale.set(p.sx, p.sy, 1));
            im.setMatrixAt(i, base.multiply(local).multiply(part.matrix));
          });
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          group.add(im);
          stats.drawCallsAllTiles++;
          tileTris += (part.geometry.index?.count ?? part.geometry.getAttribute("position").count) / 3 * instances.length;
        }
        stats.trianglesAllTiles += tileTris;
        stats.trianglesWorstTile = Math.max(stats.trianglesWorstTile, tileTris);
      }
      return { group, placements, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      owned.length = 0;
      const resources = new Set<{ dispose(): void }>();
      gltf?.scene.traverse((o) => {
        const mesh = o as THREE_NS.Mesh;
        if (!mesh.isMesh) return;
        resources.add(mesh.geometry);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          resources.add(mat);
          for (const value of Object.values(mat)) if ((value as THREE_NS.Texture | null)?.isTexture) resources.add(value as THREE_NS.Texture);
        }
      });
      for (const r of resources) r.dispose();
      gltf = undefined;
    },
  };
}
