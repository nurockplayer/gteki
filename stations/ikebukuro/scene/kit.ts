// Lane E kit pieces placed as instances (issue #94). Presentation only: kit pieces carry no colliders here,
// `walkable` and `colliders` stay the PLATEAU sets plus the access-fence collider, and nothing below reads or
// writes the walk graph (the gate placement only READS node positions and edge geometry, to anchor an array).
//
//   access-fence label stretches (scene/access_fences.json `marks`)  -> gteki_barrier_rail_2400_solid modules
//   the three JR gate nodes (node position + verified arriving edge) -> one gteki_gate_array_2 each, REPRESENTATIVE
//
// The gate arrays are NOT a survey. The data fixes only where each gate node is and which way its verified edge
// arrives; the aisle count (2: the smallest generic array), the orientation (aisles along that edge) and the lateral
// offset (the first aisle's centre on the node) are guesses. So every placement carries
// 「代表性擺設，通道數與方向未驗證」 / "representative placement; aisle count and orientation unverified"
// (GATE_ARRAY_LABEL), and a manifest entry that does not carry that label exactly gets no array at all.
//
// Files: scene/kit/kit.json lists the pieces; pipeline/sync_kit.py copies them from assets/library/ (desktop
// glb/ for the high tier, mobile/glb/ for the low tier) into gteki/kit/{high,low}/, where the explorer serves them.
// A piece that cannot be loaded is skipped with a console warning (a rail stretch keeps the procedural label board;
// a gate node simply shows no array).
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SceneContext } from "@gteki/scene-api";
type ThreeNS = typeof THREE_NS;

export interface KitPiece {
  use: string;
  /** Rail pieces: module length along the run (m). */
  pitch_m?: number;
  note?: string;
  /** Gate-array pieces: the graph nodes that get one array each. */
  nodes?: string[];
  /** Gate-array pieces: local x of the aisle whose centre is put on the node (the piece is centred on x = 0). */
  aisle_centre_x_m?: number;
  /** Gate-array pieces: depth of the piece along its run (local -Z), m. The node sits at mid-depth. */
  depth_m?: number;
  /** Gate-array pieces: lift above the node's floor height (m), against z-fighting with the piece's floor plate. */
  lift_m?: number;
  /** Gate-array pieces: the truthfulness label; must equal GATE_ARRAY_LABEL. */
  representative?: { ja: string; en: string };
}

export interface KitManifest {
  schema?: string;
  kit_version?: string;
  credit?: string;
  dirs: { high: string; low: string };
  pieces: Record<string, KitPiece>;
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

/** The only wording under which a gate array may be shown (director decision, issue #3, 2026-10-22). */
export const GATE_ARRAY_LABEL = {
  ja: "代表性擺設，通道數與方向未驗證",
  en: "representative placement; aisle count and orientation unverified",
} as const;
export const GATE_ARRAY_USE = "gate_array_representative";

/** The part of the station graph the gate placement reads (ENU metres). Nothing here is ever written. */
export interface KitGraph {
  nodes: { id: string; position: { x: number; y: number; z: number } }[];
  edges: { id: string; from: string; to: string; verification: string; geometry: { x: number; y: number; z: number }[] }[];
}

/** Where a gate node stands, and the horizontal unit vector (ENU) its verified edge travels along as it arrives. */
export interface GateSite {
  node: string;
  edge: string;
  x: number;
  y: number;
  z: number;
  dir: [number, number];
}

/** One representative gate array: a site, the anchor numbers of its piece, and the label it cannot be shown without. */
export interface GatePlacement extends GateSite {
  piece: string;
  aisleCentreX: number;
  depth: number;
  lift: number;
  label: { ja: string; en: string };
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

/**
 * Pure. Orientation rule (a guess, not a survey): each node's site is its single verified edge taken at the node, with
 * `dir` the direction of travel along that edge's LAST segment as it arrives (an edge that starts at the node is read
 * backwards: edges are walkable both ways). With several verified edges the lowest id wins. A node with no verified
 * edge, or one missing from the graph, gets no array.
 */
export function gateSites(graph: KitGraph, ids: readonly string[]): GateSite[] {
  const out: GateSite[] = [];
  for (const id of ids) {
    const node = graph.nodes.find((n) => n.id === id);
    const edge = graph.edges.filter((e) => e.verification === "verified" && (e.from === id || e.to === id)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!node || !edge || edge.geometry.length < 2) continue;
    const g = edge.geometry;
    const [a, b] = edge.to === id ? [g[g.length - 2]!, g[g.length - 1]!] : [g[1]!, g[0]!];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    out.push({ node: id, edge: edge.id, x: node.position.x, y: node.position.y, z: node.position.z, dir: [(b.x - a.x) / len, (b.y - a.y) / len] });
  }
  return out;
}

/**
 * Pure. The representative gate arrays of one piece: empty unless the piece carries GATE_ARRAY_LABEL exactly (the array
 * cannot be shown without it) and names its anchor. Every placement carries the label. Anchoring: the piece's local -Z
 * (its aisles) runs along `dir`, and the centre of its first aisle, at mid-depth, stands on the node, so the verified
 * edge runs down an aisle and its last metres never cross a cabinet.
 */
export function gatePlacements(id: string, piece: KitPiece, graph: KitGraph): GatePlacement[] {
  const l = piece.representative;
  if (piece.use !== GATE_ARRAY_USE || !l || l.ja !== GATE_ARRAY_LABEL.ja || l.en !== GATE_ARRAY_LABEL.en) return [];
  if (typeof piece.aisle_centre_x_m !== "number" || typeof piece.depth_m !== "number" || !piece.nodes?.length) return [];
  return gateSites(graph, piece.nodes).map((s) => ({
    ...s,
    piece: id,
    aisleCentreX: piece.aisle_centre_x_m!,
    depth: piece.depth_m!,
    lift: piece.lift_m ?? 0,
    label: { ja: GATE_ARRAY_LABEL.ja, en: GATE_ARRAY_LABEL.en },
  }));
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

/**
 * Pure: bakes every part's transform into its vertices and merges the parts that share a material, so a piece costs one
 * draw per material (the phone piece has one palette material: one draw however many gates stand). The gate flaps are
 * merged in their rest (closed) pose, so they no longer animate; nothing here animates them. Attributes kept: position,
 * normal, uv, uv1 (only those every part of a material has). A mirrored part (negative determinant) has its winding flipped.
 */
export function mergeByMaterial(THREE: ThreeNS, parts: readonly Part[]): { geometry: THREE_NS.BufferGeometry; material: THREE_NS.Material }[] {
  const byMat = new Map<THREE_NS.Material, Part[]>();
  for (const p of parts) byMat.set(p.material, [...(byMat.get(p.material) ?? []), p]);
  const out: { geometry: THREE_NS.BufferGeometry; material: THREE_NS.Material }[] = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [material, list] of byMat) {
    if (!list.every((p) => p.geometry.getAttribute("position"))) continue;
    const has = (name: string) => list.every((p) => p.geometry.getAttribute(name));
    const [hasN, hasUv, hasUv1] = [has("normal"), has("uv"), has("uv1")];
    const verts = list.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0);
    const idxCount = list.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute("position").count), 0);
    const pos = new Float32Array(verts * 3), nor = hasN ? new Float32Array(verts * 3) : null;
    const uv = hasUv ? new Float32Array(verts * 2) : null, uv1 = hasUv1 ? new Float32Array(verts * 2) : null;
    const index = new Uint32Array(idxCount);
    let vo = 0, io = 0;
    for (const p of list) {
      const g = p.geometry;
      const P = g.getAttribute("position");
      nm.getNormalMatrix(p.matrix);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.matrix);
        pos.set([v.x, v.y, v.z], (vo + i) * 3);
        if (nor) {
          v.fromBufferAttribute(g.getAttribute("normal"), i).applyMatrix3(nm).normalize();
          nor.set([v.x, v.y, v.z], (vo + i) * 3);
        }
        if (uv) uv.set([g.getAttribute("uv").getX(i), g.getAttribute("uv").getY(i)], (vo + i) * 2);
        if (uv1) uv1.set([g.getAttribute("uv1").getX(i), g.getAttribute("uv1").getY(i)], (vo + i) * 2);
      }
      const flip = p.matrix.determinant() < 0;
      const n = g.index ? g.index.count : P.count;
      for (let t = 0; t < n; t += 3) {
        const at = (k: number) => vo + (g.index ? g.index.getX(t + k) : t + k);
        const [a, b, c] = [at(0), at(1), at(2)];
        index[io++] = a;
        index[io++] = flip ? c : b;
        index[io++] = flip ? b : c;
      }
      vo += P.count;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (nor) geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    if (uv) geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (uv1) geometry.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    out.push({ geometry, material });
  }
  return out;
}

export interface KitStats {
  modules: number;
  tiles: number;
  /** One draw per part per tile (worst case: every tile in view). */
  drawCallsAllTiles: number;
  trianglesAllTiles: number;
  /** Triangles of the single most populated tile, i.e. a bound on what one view of the rails can cost per tile. */
  trianglesWorstTile: number;
  /** Representative gate arrays: placed count, draws if every one is in view, triangles of all of them. */
  gateArrays: number;
  gateDrawCallsAll: number;
  gateTriangles: number;
}

export interface LoadedKit {
  /** Marks whose procedural label board sits on a kit rail (empty when the piece did not load). */
  railed: ReadonlySet<number>;
  placements: readonly Placement[];
  /** The representative gate arrays that will be built (empty when the piece did not load or lacks the label). */
  gates: readonly GatePlacement[];
  /** Build the instanced rails and gate arrays. `env` lights them (the scene's own PMREM environment). */
  build(THREE: ThreeNS, env: THREE_NS.Texture, toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3): { group: THREE_NS.Group; stats: KitStats };
  dispose(): void;
}

type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

/** Loads the pieces the manifest names for this tier. Never throws: a piece that cannot be used is skipped. */
export async function loadKit(
  THREE: ThreeNS,
  host: Host,
  kit: KitManifest,
  marks: readonly Mark[],
  low: boolean,
  graph?: KitGraph,
): Promise<LoadedKit> {
  const gltfs: GLTF[] = [];
  const owned: { dispose(): void }[] = [];
  const fetchParts = async (id: string): Promise<Part[]> => {
    const uri = pieceUri(kit, id, low);
    try {
      if (host.assetUrl(uri) === null) throw new Error(`${uri} is not in the station folder`);
      const gltf = await host.loadGlb(uri);
      gltfs.push(gltf);
      const parts = visibleParts(THREE, gltf);
      if (!parts.length) throw new Error(`${uri} has no visible mesh`);
      return parts;
    } catch (err) {
      console.warn(`[ikebukuro] kit: ${id}: ${err instanceof Error ? err.message : String(err)}; skipping`);
      return [];
    }
  };

  let parts: Part[] = [];
  let placements: Placement[] = [];
  const rail = Object.entries(kit.pieces).find(([, p]) => p.use === FENCE_RAIL_USE && typeof p.pitch_m === "number");
  // Rails are desktop only: on the phone tier the 259 modules added up to ~95k triangles a frame near the JR gates
  // (GPU slot 2026-10-23, spec 13 against main), so phones keep the procedural label boards.
  if (rail && !low) {
    parts = await fetchParts(rail[0]);
    if (parts.length) placements = railPlacements(marks, rail[1].pitch_m!);
  }

  let gates: GatePlacement[] = [];
  let gateMerged: { geometry: THREE_NS.BufferGeometry; material: THREE_NS.Material }[] = [];
  const gate = Object.entries(kit.pieces).find(([, p]) => p.use === GATE_ARRAY_USE);
  if (gate && graph) {
    const wanted = gatePlacements(gate[0], gate[1], graph);
    if (wanted.length) {
      const gateParts = await fetchParts(gate[0]);
      if (gateParts.length) {
        gateMerged = mergeByMaterial(THREE, gateParts);
        for (const m of gateMerged) owned.push(m.geometry);
        gates = gateMerged.length ? wanted : [];
      }
    }
  }

  const railed = new Set(placements.map((p) => p.mark));
  return {
    railed,
    placements,
    gates,
    build(THREE, env, toRenderer) {
      const group = new THREE.Group();
      group.name = "ikebukuro_kit";
      group.userData = { gteki_role: "kit" };
      const stats: KitStats = {
        modules: placements.length, tiles: 0, drawCallsAllTiles: 0, trianglesAllTiles: 0, trianglesWorstTile: 0,
        gateArrays: gates.length, gateDrawCallsAll: 0, gateTriangles: 0,
      };
      if (!placements.length && !gates.length) return { group, stats };
      const origin = toRenderer(0, 0, 0);
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

      if (placements.length) {
        const world = placements.map((p) => {
          const centre = toRenderer(p.x, p.y, p.z);
          const d = toRenderer(p.dir[0], p.dir[1], 0).sub(origin); // renderer-frame run direction
          const yaw = Math.atan2(-d.z, d.x); // rotation about +Y that takes local +X onto d
          return { centre, yaw, sx: p.sx };
        });
        const groups = tileGroups(world.map((w) => ({ x: w.centre.x, z: w.centre.z })), tileSize(low));
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
      }

      if (gates.length) {
        // Representative gate arrays. Phone: all in one set (one draw per material: +1 with the palette piece). Desktop:
        // 16 m tiles so a gate out of view is culled. The label travels on every object, for anything that inspects the scene.
        const note = `${GATE_ARRAY_LABEL.ja} / ${GATE_ARRAY_LABEL.en}`;
        const gg = new THREE.Group();
        gg.name = "ikebukuro_kit_gate_arrays";
        gg.userData = { gteki_role: "kit_gate_array_group", gteki_note: note, gteki_label: { ...GATE_ARRAY_LABEL }, gteki_nodes: gates.map((g) => g.node) };
        const place = gates.map((g) => {
          const centre = toRenderer(g.x, g.y, g.z + g.lift);
          const d = toRenderer(g.dir[0], g.dir[1], 0).sub(origin);
          const yaw = Math.atan2(-d.x, -d.z); // rotation about +Y that takes local -Z (the aisles) onto d
          // Piece-local shift that puts the first aisle's centre, at mid-depth, on the origin of the placement.
          const shift = new THREE.Matrix4().makeTranslation(-g.aisleCentreX, 0, g.depth / 2);
          return { centre, yaw, shift };
        });
        const sets: [string, number[]][] = low
          ? [["all", place.map((_, i) => i)]]
          : [...tileGroups(place.map((w) => ({ x: w.centre.x, z: w.centre.z })), tileSize(false))].sort(([a], [b]) => (a < b ? -1 : 1));
        for (const [key, idx] of sets) {
          for (const part of gateMerged) {
            const im = new THREE.InstancedMesh(part.geometry, litOf(part.material), idx.length);
            im.name = `kit_gate_array:${key}`;
            im.userData = { gteki_role: "kit_gate_array", gteki_note: note, gteki_label: { ...GATE_ARRAY_LABEL }, gteki_nodes: idx.map((i) => gates[i]!.node) };
            idx.forEach((wi, i) => {
              const w = place[wi]!;
              q.setFromAxisAngle(up, w.yaw);
              s.set(1, 1, 1);
              base.compose(w.centre, q, s).multiply(w.shift);
              im.setMatrixAt(i, base);
            });
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
            gg.add(im);
            stats.gateDrawCallsAll++;
            stats.gateTriangles += triOf(part.geometry) * idx.length;
          }
        }
        group.add(gg);
      }
      return { group, stats };
    },
    dispose() {
      for (const o of owned) o.dispose();
      for (const gltf of gltfs)
        gltf.scene.traverse((o) => {
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
