// Ikebukuro station scene (gteki.scene/0.1): PLATEAU B1 passages dressed for an L2 look.
// Truth stays in gteki/*.json; this file is presentation only and never adds routes.
// Uses ctx.THREE so it shares the explorer's three instance.
import type * as THREE_NS from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMaterials } from "./materials.ts";
import { buildSigns, type SignSpec } from "./signs.ts";
import signage from "./signage.json";
import graph from "../gteki/graph.json";

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
}
export interface SpawnPoint { x: number; y: number; z: number; headingDeg: number; nodeId?: string; label?: string }
export interface StationScene {
  root: THREE_NS.Object3D;
  walkable: THREE_NS.Object3D[];
  colliders?: THREE_NS.Object3D[];
  spawnPoints?: SpawnPoint[];
  environment?: { background?: number; fog?: { color: number; near: number; far: number }; exposure?: number };
  update?(dtSeconds: number, elapsedSeconds: number): void;
  dispose(): void;
}

const GLB = "assets/ikebukuro_b1_lit.glb";
const GLB_FALLBACK = "assets/ikebukuro_b1.glb";
const LIGHTMAP = "assets/ikebukuro_b1_lightmap.png";
const LIGHTMAP_META = "assets/ikebukuro_b1_lit.meta.json";

/** Art-direction trim on top of the physically decoded bake. */
const LIGHTMAP_GAIN = 1.0;

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
  const tex = pmrem.fromScene(env, 0.02).texture;
  strip.dispose();
  panel.dispose();
  floor.geometry.dispose();
  (floor.material as THREE_NS.Material).dispose();
  pmrem.dispose();
  return tex;
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
      extra.push(new THREE.Mesh(sky, mats.byRole.portal_sky), new THREE.Mesh(beyond, mats.byRole.portal_beyond));
      m.visible = false;
      return;
    }
    const mat = mats.byRole[role];
    if (mat) m.material = mat;
    if (role === "floor" || role === "stairs_ramps") walkable.push(m);
    if (role === "wall" || role === "barriers" || role === "transport") colliders.push(m);
    m.matrixAutoUpdate = false;
  });
  root.add(gltf.scene, ...extra);

  // Lightmap (baked by pipeline/blender_bake_lighting.py, TEXCOORD_1). Falls back to a hemisphere rig.
  let lightmap: THREE_NS.Texture | null = null;
  const metaUrl = ctx.assetUrl(LIGHTMAP_META);
  if (baked && metaUrl) {
    try {
      // PNG stores (L / scale)^(1/2.2); sRGB decode approximates the 2.2 gamma. Cycles bakes
      // "diffuse light" (outgoing = albedo * L) while three computes irradiance * albedo / PI.
      const meta = (await (await fetch(metaUrl)).json()) as { encoding: { scale: number } };
      lightmap = await ctx.loadTexture(LIGHTMAP, { colorSpace: "srgb", flipY: false });
      lightmap.channel = 1;
      mats.setLightmap(lightmap, meta.encoding.scale * Math.PI * LIGHTMAP_GAIN);
    } catch {
      lightmap = null;
    }
  }
  root.add(new THREE.HemisphereLight(0xfff4e6, 0x5a544b, lightmap ? 0.06 : 1.35));

  // Reflections for the glossy floor and stainless details.
  const env = makeEnvironment(THREE, ctx.renderer);
  // Every baked material gets its own envMap so an explorer-level scene.environment never double-lights it.
  for (const role of ["floor", "barriers", "transport", "wall", "stairs_ramps", "ceiling", "floor_elements"]) {
    const m = mats.byRole[role] as THREE_NS.MeshStandardMaterial;
    m.envMap = env;
    m.envMapIntensity = role === "floor" ? 0.35 : role === "ceiling" ? 0.05 : 0.2;
  }

  const signs = buildSigns(THREE, (signage as { signs: SignSpec[] }).signs, toRenderer, ctx.renderer.capabilities.getMaxAnisotropy());
  root.add(signs.group);

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
    environment: { background: 0x0e0d0b, fog: { color: 0x1b1915, near: 25, far: low ? 120 : 180 }, exposure: 1.0 },
    dispose() {
      mats.dispose();
      signs.dispose();
      env.dispose();
      lightmap?.dispose();
      gltf.scene.traverse((o) => (o as THREE_NS.Mesh).geometry?.dispose());
      for (const e of extra) e.geometry.dispose();
    },
  };
}
