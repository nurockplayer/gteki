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
import graph from "../gteki/graph.json";
import litMeta from "../gteki/assets/ikebukuro_b1_lit.meta.json";

type ThreeNS = typeof THREE_NS;

/** Local mirror of @gteki/scene-api 0.1 (type-only); swap to the package import once core is on main. */
export interface SceneContext {
  THREE: ThreeNS;
  bundle?: unknown;
  enuToRenderer(p: { x: number; y: number; z: number }): [number, number, number];
  assetUrl(uri: string): string | null;
  loadGlb(uri: string): Promise<GLTF>;
  loadTexture(uri: string, opts?: { colorSpace?: "srgb" | "linear"; flipY?: boolean }): Promise<THREE_NS.Texture>;
  quality: "low" | "high";
  renderer: THREE_NS.WebGLRenderer;
  /** Proposed optional 0.1 addition: host-owned audio, unlocked by a user gesture. */
  audio?: { context: AudioContext; destination: AudioNode };
}
export interface SpawnPoint { x: number; y: number; z: number; headingDeg: number; nodeId?: string; label?: string }
export interface StationScene {
  root: THREE_NS.Object3D;
  walkable: THREE_NS.Object3D[];
  colliders?: THREE_NS.Object3D[];
  spawnPoints?: SpawnPoint[];
  environment?: { lighting?: "default" | "scene"; background?: number; fog?: { color: number; near: number; far: number }; exposure?: number };
  update?(dtSeconds: number, elapsedSeconds: number): void;
  dispose(): void;
}

const GLB = "assets/ikebukuro_b1_lit.glb";
const GLB_FALLBACK = "assets/ikebukuro_b1.glb";
const LIGHTMAP = { high: "assets/ikebukuro_b1_lightmap.webp", low: "assets/ikebukuro_b1_lightmap_2k.webp" };

/** Art-direction trim on top of the physically decoded bake (fixture emission is bright; ~0.12 matches a ~600 lx concourse look). */
const LIGHTMAP_GAIN = 0.09;

/** Spawn suggestions: graph node + heading along the passage (compass degrees). */
const SPAWNS: { nodeId: string; headingDeg: number; label: string }[] = [
  { nodeId: "c_mid", headingDeg: 100, label: "中央通路 Central Passage" },
  { nodeId: "c_e2", headingDeg: 100, label: "東口方面 toward East exits" },
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
  const make = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    // v follows TP height (B1 floor ~26 m to ceiling ~31 m) for the haze gradient.
    const uv: number[] = [];
    for (let i = 1; i < arr.length; i += 3) uv.push(0.5, Math.min(1, Math.max(0, (arr[i] - 26.5) / 4.5)));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return { sky: make(sky), beyond: make(beyond) };
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
    m.matrixAutoUpdate = false;
  });
  root.add(gltf.scene, ...extra);

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
    m.envMapIntensity = role === "floor" ? 0.35 : role === "ceiling" ? 0.05 : 0.2;
  }

  const signs = buildSigns(THREE, (signage as { signs: SignSpec[] }).signs, toRenderer, ctx.renderer.capabilities.getMaxAnisotropy());
  root.add(signs.group);

  const crowd = buildCrowd(THREE, (graph as { edges: Parameters<typeof buildCrowd>[1] }).edges, toRenderer, low ? 40 : 100, env, (crowdLanes as { lanes: Record<string, Lane> }).lanes);
  root.add(crowd.group);

  const ambience = ctx.audio ? createAmbience(ctx.audio.context, ctx.audio.destination) : null;

  const nodes = new Map((graph as { nodes: { id: string; position: { x: number; y: number; z: number | null } }[] }).nodes.map((n) => [n.id, n]));
  const spawnPoints: SpawnPoint[] = [];
  for (const s of SPAWNS) {
    const p = nodes.get(s.nodeId)?.position;
    if (p && p.z !== null) spawnPoints.push({ x: p.x, y: p.y, z: p.z, headingDeg: s.headingDeg, nodeId: s.nodeId, label: s.label });
  }

  return {
    root,
    walkable,
    colliders,
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
    },
  };
}
