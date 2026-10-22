// Lane E kit pieces placed as instances (issue #94). Presentation only: kit pieces carry no colliders here,
// `walkable` and `colliders` stay the PLATEAU sets plus the access-fence collider, and nothing below reads or
// writes the walk graph. Every placement is derived from data the station already has (never a new position):
//
//   access-fence label stretches (scene/access_fences.json `marks`) -> gteki_barrier_rail_2400_solid modules
//
// Files: scene/kit/kit.json lists the pieces; pipeline/sync_kit.py copies them from assets/library/ (desktop
// glb/ for the high tier, mobile/glb/ for the low tier) into gteki/kit/{high,low}/, where the explorer serves them.
// A piece that cannot be loaded is skipped with a console warning and its stretch keeps the procedural label board.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
type ThreeNS = typeof THREE_NS;

export interface KitManifest {
  schema?: string;
  kit_version?: string;
  credit?: string;
  dirs: { high: string; low: string };
  pieces: Record<string, { use: string; pitch_m: number; note?: string }>;
}

/** An access-fence label stretch: ends in ENU x, y (m) and the floor height z (m). */
export interface Mark {
  a: number[];
  b: number[];
  z: number;
}

/** One instance of a kit piece, in ENU metres. `dir` is the horizontal unit vector the piece's +X follows. */
export interface Placement {
  /** Index of the mark (scene/access_fences.json `marks[]`) this module dresses. */
  mark: number;
  x: number;
  y: number;
  z: number;
  dir: [number, number];
  /** Stretch along the run: the module's pitch becomes `sx * pitch_m` (kept within [0.56, 1.12]). */
  sx: number;
}

export const FENCE_RAIL_USE = "access_fence_rail";
/** Stretches shorter than this keep the procedural label board: a 2.4 m module squeezed below ~0.75 would
 * squash its posts. (Of the 80 stretches today, the ones under 1.8 m are the short gaps between columns.) */
export const MIN_RAIL_M = 1.8;
/** A module is stretched at most this much along its run, so a long stretch gets more modules, not fat ones. */
export const MAX_STRETCH = 1.12;
/** Spatial tile (m) the instances are grouped in: three.js culls an InstancedMesh as a whole, so one mesh
 * for the whole station would always draw every rail in the station. Each tile costs one draw per mesh of the
 * piece, so the phone tier (one mesh per piece, draws are the scarce budget) uses larger tiles than desktop. */
export const KIT_TILE_M = { high: 16, low: 32 } as const;
export const tileSize = (low: boolean) => (low ? KIT_TILE_M.low : KIT_TILE_M.high);
/** Half the rail's thickness (m, bounds z = +-0.07): the label board sits just off each rail face. */
export const RAIL_FACE_OFFSET = 0.075;
/** Visible label height (m) on a rail: the 1.1 m rail minus a 5 cm toe gap and a 5 cm cap. */
export const RAIL_LABEL_H = 1.0;
/** Environment light on kit materials. The scene has no dynamic lights, so a kit material lights from its envMap only. */
export const KIT_ENV_INTENSITY = 1.0;

/** Pure: the rail modules along each label stretch, chained from `a` to `b`. */
export function railPlacements(marks: readonly Mark[], pitchM: number): Placement[] {
  const out: Placement[] = [];
  marks.forEach((m, mark) => {
    const dx = m.b[0]! - m.a[0]!, dy = m.b[1]! - m.a[1]!;
    const len = Math.hypot(dx, dy);
    if (len < MIN_RAIL_M) return;
    const n = Math.max(1, Math.ceil(len / (pitchM * MAX_STRETCH)));
    const step = len / n;
    const u: [number, number] = [dx / len, dy / len];
    for (let k = 0; k < n; k++) {
      const t = step * (k + 0.5);
      out.push({ mark, x: m.a[0]! + u[0] * t, y: m.a[1]! + u[1] * t, z: m.z, dir: u, sx: step / pitchM });
    }
  });
  return out;
}

/** The folder under gteki/ a tier reads its GLBs from (desktop: full library; phone: mobile library). */
export const tierDir = (kit: Pick<KitManifest, "dirs">, low: boolean) => (low ? kit.dirs.low : kit.dirs.high);
export const pieceUri = (kit: Pick<KitManifest, "dirs">, id: string, low: boolean) => `${tierDir(kit, low)}/${id}.glb`;

/** Pure: instance indices grouped by spatial tile of the module centre (renderer x, z). */
export function tileGroups(centres: readonly { x: number; z: number }[], tileM: number): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  centres.forEach((c, i) => {
    const key = `${Math.floor(c.x / tileM)}:${Math.floor(c.z / tileM)}`;
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  return groups;
}

interface Part {
  geometry: THREE_NS.BufferGeometry;
  material: THREE_NS.Material;
  /** Mesh transform relative to the asset root. */
  matrix: THREE_NS.Matrix4;
}

/** The visible meshes of a kit asset (not the COL_*-colonly collision nodes), with their local transform. */
export function visibleParts(THREE: ThreeNS, gltf: GLTF): Part[] {
  gltf.scene.updateMatrixWorld(true);
  const root = gltf.scene.children[0] ?? gltf.scene;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: Part[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    for (let p: THREE_NS.Object3D | null = m; p; p = p.parent) if (/^COL_|colonly$|^SOCKET_/.test(p.name)) return;
    parts.push({ geometry: m.geometry, material: m.material, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  return parts;
}

export interface KitStats {
  modules: number;
  tiles: number;
  /** One draw per part per tile (worst case: every tile in view). */
  drawCallsAllTiles: number;
  trianglesAllTiles: number;
  /** Triangles of the single most populated tile, i.e. a bound on what one view of the rails can cost per tile. */
  trianglesWorstTile: number;
}

export interface LoadedKit {
  /** Marks whose procedural label board sits on a kit rail (empty when the piece did not load). */
  railed: ReadonlySet<number>;
  placements: readonly Placement[];
  /** Build the instanced rails. `env` lights them (the scene's own PMREM environment). */
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: KitStats };
  dispose(): void;
}

type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

/** Loads the pieces the manifest names for this tier. Never throws: a piece that cannot be used is skipped. */
export async function loadKit(THREE: ThreeNS, host: Host, kit: KitManifest, marks: readonly Mark[], low: boolean): Promise<LoadedKit> {
  const rail = Object.entries(kit.pieces).find(([, p]) => p.use === FENCE_RAIL_USE);
  let gltf: GLTF | null = null;
  let parts: Part[] = [];
  let placements: Placement[] = [];
  if (rail) {
    const [id, spec] = rail;
    const uri = pieceUri(kit, id, low);
    try {
      if (host.assetUrl(uri) === null) throw new Error(`${uri} is not in the station folder`);
      gltf = await host.loadGlb(uri);
      parts = visibleParts(THREE, gltf);
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      placements = railPlacements(marks, spec.pitch_m);
    } catch (err) {
      console.warn(`[ikebukuro] kit: ${id}: ${err instanceof Error ? err.message : String(err)}; keeping the procedural fence label`);
      gltf = null;
      parts = [];
      placements = [];
    }
  }
  const railed = new Set(placements.map((p) => p.mark));
  const owned: { dispose(): void }[] = [];
  return {
    railed,
    placements,
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit_fence_rails";
      group.userData = { gteki_role: "kit_fence_rail" };
      const stats: KitStats = { modules: placements.length, tiles: 0, drawCallsAllTiles: 0, trianglesAllTiles: 0, trianglesWorstTile: 0 };
      if (!placements.length) return { group, stats };
      const origin = toRenderer(0, 0, 0);
      const world = placements.map((p) => {
        const centre = toRenderer(p.x, p.y, p.z);
        const d = toRenderer(p.dir[0], p.dir[1], 0).sub(origin); // renderer-frame run direction
        const yaw = Math.atan2(-d.z, d.x); // rotation about +Y that takes local +X onto d
        return { centre, yaw, sx: p.sx };
      });
      const groups = tileGroups(world.map((w) => ({ x: w.centre.x, z: w.centre.z })), tileSize(low));
      const lit = new Map<THREE_NS.Material, THREE_NS.Material>();
      const litOf = (src: THREE_NS.Material) => {
        let m = lit.get(src);
        if (!m) {
          m = src.clone();
          const std = m as THREE_NS.MeshStandardMaterial;
          if (std.isMeshStandardMaterial) {
            std.envMap = env;
            std.envMapIntensity = KIT_ENV_INTENSITY;
          }
          lit.set(src, m);
          owned.push(m);
        }
        return m;
      };
      const base = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const triOf = (g: THREE_NS.BufferGeometry) => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      let worst = 0;
      for (const [key, idx] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
        stats.tiles++;
        let tileTris = 0;
        for (const part of parts) {
          const im = new THREE.InstancedMesh(part.geometry, litOf(part.material), idx.length);
          im.name = `kit_fence_rail:${key}`;
          im.userData = { gteki_role: "kit_fence_rail" };
          idx.forEach((wi, i) => {
            const w = world[wi]!;
            q.setFromAxisAngle(up, w.yaw);
            s.set(w.sx, 1, 1);
            base.compose(w.centre, q, s).multiply(part.matrix);
            im.setMatrixAt(i, base);
          });
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          group.add(im);
          stats.drawCallsAllTiles++;
          tileTris += triOf(part.geometry) * idx.length;
        }
        stats.trianglesAllTiles += tileTris;
        worst = Math.max(worst, tileTris);
      }
      stats.trianglesWorstTile = worst;
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      gltf?.scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE_NS.MeshStandardMaterial;
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) t?.dispose();
        mat.dispose();
      });
    },
  };
}
