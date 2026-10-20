// Ikebukuro station scene (gteki.scene/0.1): PLATEAU B1 passages dressed for an L2 look.
// Truth stays in gteki/*.json; this file is presentation only and never adds routes.
// Uses ctx.THREE so it shares the explorer's three instance.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMaterials } from "./materials.ts";
import { buildSigns, type SignSpec } from "./signs.ts";
import { buildCrowd, type Lane } from "./crowd.ts";
import { createAmbience } from "./ambience.ts";
import crowdLanes from "./crowd_lanes.json";
import signage from "./signage.json";
import walkBridges from "./walk_bridges.json";
import graph from "../gteki/graph.json";
import litMeta from "../gteki/assets/ikebukuro_b1_lit.meta.json";

import type { SceneContext, SpawnPoint, StationScene } from "@gteki/scene-api";

type ThreeNS = typeof THREE_NS;

const GLB = "assets/ikebukuro_b1_lit.glb";
const GLB_FALLBACK = "assets/ikebukuro_b1.glb";
const LIGHTMAP = { high: "assets/ikebukuro_b1_lightmap.webp", low: "assets/ikebukuro_b1_lightmap_2k.webp" };

/** Art-direction trim on top of the physically decoded bake (fixture emission is bright; ~0.12 matches a ~600 lx concourse look). */
const LIGHTMAP_GAIN = 0.09;

/** Spawn suggestions: graph node + heading along the passage (compass degrees). */
const SPAWNS: { nodeId: string; headingDeg: number; label: string }[] = [
  { nodeId: "c_mid", headingDeg: 100, label: "中央通路 Central Passage" },
  { nodeId: "c_e2", headingDeg: 100, label: "東口方面 toward East exits" },
  { nodeId: "sp_e", headingDeg: 92, label: "南通路 South Passage (east)" },
  { nodeId: "n_h", headingDeg: 95, label: "北通路 North Passage (east)" },
  { nodeId: "w_c", headingDeg: 340, label: "西口地下広場 West Exit hall" },
  { nodeId: "sw_h", headingDeg: 110, label: "西口（南）地下広場 West Exit (South) hall" },
];

function splitPortals(THREE: ThreeNS, mesh: THREE_NS.Mesh) {
  // Horizontal openings above 31 m TP are the tops of exit stairs (street daylight);
  // everything else is an opening into space the open data does not model.
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = src.getAttribute("position") as THREE_NS.BufferAttribute;
  const sky: number[] = [];
  const beyond: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    n.subVectors(c, b).cross(ab.subVectors(a, b)).normalize();
    const cy = (a.y + b.y + c.y) / 3;
    const target = Math.abs(n.y) > 0.9 && cy > 31 ? sky : beyond;
    target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const make = (arr: number[], band: boolean) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    if (band) g.setAttribute("band", new THREE.Float32BufferAttribute(openingBands(arr), 2));
    g.computeVertexNormals();
    return g;
  };
  return { sky: make(sky, false), beyond: make(beyond, true) };
}

/** Door triangles in world space, minus every door panel (connected by shared vertices) a route segment
 * crosses at walking height. */
function solidDoors(THREE: ThreeNS, mesh: THREE_NS.Mesh, routes: [THREE_NS.Vector3, THREE_NS.Vector3][]): THREE_NS.BufferGeometry {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const src = g.attributes.position!;
  const v = new THREE.Vector3();
  const arr: number[] = [];
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
    arr.push(v.x, v.y, v.z);
  }
  if (g !== mesh.geometry) g.dispose();
  const tris = arr.length / 9;
  const parent = Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${arr[o]!.toFixed(2)},${arr[o + 1]!.toFixed(2)},${arr[o + 2]!.toFixed(2)}`;
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, t);
      else parent[find(t)] = find(prev);
    }
  }
  // 2D (x, z) segment intersection, inclusive.
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
    const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(den) < 1e-9) return false;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  const open = new Set<number>();
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    if (open.has(r)) continue;
    const o = t * 9;
    const ylo = Math.min(arr[o + 1]!, arr[o + 4]!, arr[o + 7]!);
    const yhi = Math.max(arr[o + 1]!, arr[o + 4]!, arr[o + 7]!);
    for (const [a, b] of routes) {
      const y = (a.y + b.y) / 2;
      if (y + 1.8 < ylo || y + 0.1 > yhi) continue; // the triangle spans no body height on this segment
      if ([0, 1, 2].some((k) => {
        const p = o + k * 3, q = o + ((k + 1) % 3) * 3;
        return cross(a.x, a.z, b.x, b.z, arr[p]!, arr[p + 2]!, arr[q]!, arr[q + 2]!);
      })) {
        open.add(r);
        break;
      }
    }
  }
  const out: number[] = [];
  for (let t = 0; t < tris; t++) if (!open.has(find(t))) out.push(...arr.slice(t * 9, t * 9 + 9));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return geo;
}

/** Raycast-only copies of `meshes` in world space, bucketed into TILE m squares (by triangle centroid)
 * per face side, so a ray only scans the tiles its bounding spheres say it can reach. */
const TILE = 8;
function raycastTiles(THREE: ThreeNS, meshes: THREE_NS.Object3D[]): THREE_NS.Mesh<THREE_NS.BufferGeometry, THREE_NS.MeshBasicMaterial>[] {
  const sides = new Map<number, THREE_NS.MeshBasicMaterial>();
  const buckets = new Map<string, { side: number; pos: number[] }>();
  const v = new THREE.Vector3();
  for (const o of meshes) {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) continue;
    m.updateWorldMatrix(true, false);
    const mat = m.material as THREE_NS.Material | THREE_NS.Material[];
    const side = Array.isArray(mat) ? THREE.DoubleSide : mat.side;
    const g = m.geometry;
    const src = g.attributes.position!;
    const idx = g.index;
    const n = idx ? idx.count : src.count;
    const tri: number[] = new Array(9);
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(src, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
        tri[k * 3] = v.x; tri[k * 3 + 1] = v.y; tri[k * 3 + 2] = v.z;
      }
      const key = `${side}:${Math.floor((tri[0]! + tri[3]! + tri[6]!) / 3 / TILE)}:${Math.floor((tri[2]! + tri[5]! + tri[8]!) / 3 / TILE)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { side, pos: [] }));
      b.pos.push(...tri);
    }
  }
  const out: THREE_NS.Mesh<THREE_NS.BufferGeometry, THREE_NS.MeshBasicMaterial>[] = [];
  for (const [, b] of [...buckets].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))) {
    let mat = sides.get(b.side);
    if (!mat) sides.set(b.side, (mat = new THREE.MeshBasicMaterial({ side: b.side as THREE_NS.Side })));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const t = new THREE.Mesh(geo, mat);
    t.visible = false;
    t.matrixAutoUpdate = false;
    t.updateMatrixWorld(true);
    out.push(t);
  }
  return out;
}

/** Per-vertex (bottom, top) height of the opening each triangle belongs to (connected by shared vertices). */
function openingBands(arr: number[]): number[] {
  const tris = arr.length / 9;
  const parent = Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      const key = `${arr[o]!.toFixed(2)},${arr[o + 1]!.toFixed(2)},${arr[o + 2]!.toFixed(2)}`;
      const prev = owner.get(key);
      if (prev === undefined) owner.set(key, t);
      else parent[find(t)] = find(prev);
    }
  }
  const lo = new Map<number, number>(), hi = new Map<number, number>();
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    for (let k = 0; k < 3; k++) {
      const y = arr[t * 9 + k * 3 + 1]!;
      lo.set(r, Math.min(lo.get(r) ?? Infinity, y));
      hi.set(r, Math.max(hi.get(r) ?? -Infinity, y));
    }
  }
  const out: number[] = [];
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    for (let k = 0; k < 3; k++) out.push(lo.get(r)!, hi.get(r)!);
  }
  return out;
}

/** Small studio-like environment for reflections, built with ctx.THREE (no example imports). */
function makeEnvironment(THREE: ThreeNS, renderer: THREE_NS.WebGLRenderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x2a2722);
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(6) });
  const strip = new THREE.BoxGeometry(0.6, 0.05, 6);
  for (let i = -3; i <= 3; i++) {
    const m = new THREE.Mesh(strip, panel);
    m.position.set(i * 2.2, 3, 0);
    env.add(m);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x6b655c }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.6;
  env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02);
  strip.dispose();
  panel.dispose();
  floor.geometry.dispose();
  (floor.material as THREE_NS.Material).dispose();
  pmrem.dispose();
  return target; // caller disposes the render target (texture.dispose() alone leaks it)
}

export async function buildScene(ctx: SceneContext): Promise<StationScene> {
  const THREE = ctx.THREE;
  const low = ctx.quality === "low";
  const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(...ctx.enuToRenderer({ x, y, z }));
  const mats = createMaterials(THREE, low);
  const root = new THREE.Group();
  root.name = "ikebukuro";

  let gltf: GLTF;
  let baked = true;
  try {
    gltf = await ctx.loadGlb(GLB);
  } catch {
    gltf = await ctx.loadGlb(GLB_FALLBACK);
    baked = false;
  }
  gltf.scene.updateMatrixWorld(true);
  const walkable: THREE_NS.Object3D[] = [];
  const colliders: THREE_NS.Object3D[] = [];
  const extra: THREE_NS.Mesh[] = [];
  const routeSegments = (graph as { edges: { verification: string; geometry: { x: number; y: number; z: number }[] }[] }).edges
    .filter((e) => e.verification === "verified")
    .flatMap((e) => e.geometry.slice(1).map((b, i): [THREE_NS.Vector3, THREE_NS.Vector3] => [toRenderer(e.geometry[i]!.x, e.geometry[i]!.y, e.geometry[i]!.z), toRenderer(b.x, b.y, b.z)]));
  gltf.scene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) return;
    const role = (m.userData.gteki_role as string) ?? m.name;
    if (role === "portals") {
      const { sky, beyond } = splitPortals(THREE, m);
      const beyondMesh = new THREE.Mesh(beyond, mats.byRole.portal_beyond);
      beyondMesh.userData.gteki_role = "portal_beyond";
      // Nothing past these openings is modelled: block walker and camera there.
      colliders.push(beyondMesh);
      extra.push(new THREE.Mesh(sky, mats.byRole.portal_sky), beyondMesh);
      m.visible = false;
      return;
    }
    const mat = mats.byRole[role];
    if (mat) m.material = mat;
    if (role === "floor" || role === "stairs_ramps") walkable.push(m);
    // Ceilings too: walker side-rays (0.45/1.25 m) never reach them, but they keep the follow camera inside.
    if (role === "wall" || role === "barriers" || role === "transport" || role === "ceiling") colliders.push(m);
    if (role === "doors" || role === "windows") {
      // Shopfront doors and glazing open onto unmodelled rooms and must be solid. A panel a verified
      // route passes through, such as an exit's doors, stays open.
      const solid = new THREE.Mesh(solidDoors(THREE, m, routeSegments), mats.byRole.portal_beyond);
      solid.visible = false;
      solid.userData.gteki_role = `${role}_solid`;
      colliders.push(solid);
      extra.push(solid);
    }
    m.matrixAutoUpdate = false;
  });
  root.add(gltf.scene, ...extra);

  // Invisible strips over hairline cracks between PLATEAU floor polygons (pipeline/build_walkfix.py):
  // without them a ground ray landing in a sliver finds nothing and the walker stalls mid-floor.
  let bridges: THREE_NS.Mesh<THREE_NS.BufferGeometry, THREE_NS.MeshBasicMaterial> | null = null;
  const quads = (walkBridges as { quads: number[][][] }).quads;
  if (quads.length) {
    const pos = new Float32Array(quads.length * 12);
    const idx: number[] = [];
    quads.forEach((q, i) => {
      q.forEach(([x, y, z], k) => pos.set(ctx.enuToRenderer({ x: x!, y: y!, z: z! }), i * 12 + k * 3));
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    bridges = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); // winding varies per crack
    bridges.name = "walk_bridges";
    bridges.userData.gteki_role = "walk_bridges";
    bridges.visible = false;
    bridges.updateMatrixWorld(true);
    bridges.matrixAutoUpdate = false;
    root.add(bridges);
    walkable.push(bridges);
  }

  // Lightmap (baked by pipeline/blender_bake_lighting.py, TEXCOORD_1). Falls back to a hemisphere rig.
  let lightmap: THREE_NS.Texture | null = null;
  if (baked) {
    try {
      // WebP (from the bake PNG) stores (L / scale)^(1/2.2); sRGB decode approximates the 2.2 gamma. Cycles bakes
      // "diffuse light" (outgoing = albedo * L) while three computes irradiance * albedo / PI.
      const meta = litMeta as { encoding: { scale: number } };
      lightmap = await ctx.loadTexture(LIGHTMAP[ctx.quality], { colorSpace: "srgb", flipY: false });
      lightmap.channel = 1;
      mats.setLightmap(lightmap, meta.encoding.scale * Math.PI * LIGHTMAP_GAIN);
    } catch {
      lightmap = null;
    }
  }
  root.add(new THREE.HemisphereLight(0xfff4e6, 0x5a544b, lightmap ? 0.06 : 1.35));

  // Reflections for the glossy floor and stainless details.
  const envTarget = makeEnvironment(THREE, ctx.renderer);
  const env = envTarget.texture;
  // Every baked material gets its own envMap so an explorer-level scene.environment never double-lights it.
  for (const role of ["floor", "barriers", "transport", "wall", "stairs_ramps", "ceiling", "floor_elements"]) {
    const m = mats.byRole[role] as THREE_NS.MeshStandardMaterial;
    m.envMap = env;
    // Brushed-steel escalators need visible reflections: the baked lightmap only lights the diffuse part.
    m.envMapIntensity = role === "floor" ? 0.35 : role === "ceiling" ? 0.05 : role === "transport" ? 0.9 : 0.2;
  }

  // Low quality paints signs at ~160 px/m instead of 300: a quarter of the texture memory, still legible at phone size.
  const signs = buildSigns(THREE, (signage as { signs: SignSpec[] }).signs, toRenderer, ctx.renderer.capabilities.getMaxAnisotropy(), low ? 0.54 : 1);
  root.add(signs.group);

  const crowd = buildCrowd(THREE, (graph as { edges: Parameters<typeof buildCrowd>[1] }).edges, toRenderer, low ? 56 : 150, env, (crowdLanes as { lanes: Record<string, Lane> }).lanes);
  root.add(crowd.group);

  const ambience = ctx.audio ? createAmbience(ctx.audio.context, ctx.audio.destination) : null;

  const nodes = new Map((graph as { nodes: { id: string; position: { x: number; y: number; z: number | null } }[] }).nodes.map((n) => [n.id, n]));
  const spawnPoints: SpawnPoint[] = [];
  for (const s of SPAWNS) {
    const p = nodes.get(s.nodeId)?.position;
    if (p && p.z !== null) spawnPoints.push({ x: p.x, y: p.y, z: p.z, headingDeg: s.headingDeg, nodeId: s.nodeId, label: s.label });
  }

  // The explorer raycasts walkable and colliders several times a frame. Whole-station meshes cost a
  // full triangle scan per ray; ~8 m tiles let three.js skip every tile out of a short ray's reach.
  const walkTiles = raycastTiles(THREE, walkable), colliderTiles = raycastTiles(THREE, colliders);
  const rayTiles = [...walkTiles, ...colliderTiles];
  return {
    root,
    walkable: walkTiles,
    colliders: colliderTiles,
    spawnPoints,
    environment: { lighting: lightmap ? "scene" : "default", background: 0x0e0d0b, fog: { color: 0x1b1915, near: 25, far: low ? 120 : 180 }, exposure: 1.0 },
    update: (dt, elapsed) => {
      crowd.update(dt, elapsed);
      ambience?.update({ nearby: crowd.nearby(), openness: 0.8 });
    },
    dispose() {
      ambience?.dispose();
      crowd.dispose();
      mats.dispose();
      signs.dispose();
      envTarget.dispose();
      lightmap?.dispose();
      gltf.scene.traverse((o) => (o as THREE_NS.Mesh).geometry?.dispose());
      for (const e of extra) e.geometry.dispose();
      bridges?.geometry.dispose();
      bridges?.material.dispose();
      for (const t of rayTiles) t.geometry.dispose();
      for (const m of new Set(rayTiles.map((t) => t.material))) m.dispose();
    },
  };
}
