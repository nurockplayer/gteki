import * as THREE from "three";

/**
 * Neutral daylight backdrop for underground stations once the walker reaches street level.
 *
 * Without it, climbing any exit ends in a black void with the station's tunnels floating below. This
 * adds only a sky, a hazy daylight fog and a plain pavement plane just under the walker's feet: no
 * buildings, no roads, no claim about what is really up there (surface context belongs to source-backed
 * data, see issue #39). The plane is visual only (never walkable or a collider) and is drawn only while
 * the walker stands at street level, so it never hides the walker inside a stairwell.
 */
export const STREET = {
  /** Walkers lower than this under the street floor's render elevation are never "outdoors" (deep open stairwells). */
  maxBelowStreet: 2.5,
  /** Open sky is looked for this far above the walker's head (m). */
  skyClearance: 40,
  /** Footing counts as level when its face normal is within ~10° of up (and it is not a stair). */
  levelNormalY: 0.985,
  /** Also level within this of an exit's street-level node (m, horizontal / vertical): stairs end there. */
  topRadius: 2.5,
  topRise: 0.3,
  /** On a stair, only the exit top itself (the last tread, at the node's height) counts (m). */
  topTread: 0.08,
  /** On level floor, an exit top this far away (m, horizontal) still sets the street height. */
  topFloorRadius: 40,
  /** The plane sits this far under the walker's feet, so stair-top slabs and closures draw over it. */
  planeDrop: 0.15,
  planeRadius: 700,
  haze: new THREE.Color(0xb9c4cc),
  fogNear: 18,
  fogFar: 240,
} as const;

/**
 * Outdoors = the station has a street floor, the walker is near its height, and nothing (ceiling, slab,
 * canopy) is overhead. Street height varies across a station (Ikebukuro's exits top out between ~31 and
 * ~33 m TP), so open sky, not a fixed height, decides.
 */
export function isOutdoors(walkerY: number, streetY: number | null, coveredOverhead: boolean): boolean {
  return streetY !== null && !coveredOverhead && walkerY >= streetY - STREET.maxBelowStreet;
}

/**
 * Whether the walker stands on level street footing (where the pavement may show) rather than on a stair.
 * Decided from what is under their feet, never from history, so it is right on arrival and on every
 * landing: a stair/ramp surface or a tilted face (> ~10°) is not level; invisible crack bridges (thin
 * strips over seams, often on stairs) keep the previous answer, and so does a missed ground ray.
 */
export function footingLevel(role: string | null | undefined, normalY: number | null, previous: boolean): boolean {
  const r = (role ?? "").toLowerCase();
  if (normalY === null || r.startsWith("walk_bridge")) return previous;
  return !/stair|ramp|escalator/.test(r) && normalY > STREET.levelNormalY;
}

/**
 * Street pavement may show only at street height: at an exit's street-level node (exit stairs often end in
 * no modelled street floor, the walker arrives on the last tread), or on level floor at the height of a
 * nearby exit top. Open intermediate landings lower down never qualify.
 */
export function atStreetTop(pos: THREE.Vector3, tops: readonly THREE.Vector3[], onLevelFloor = false): boolean {
  const r = onLevelFloor ? STREET.topFloorRadius : STREET.topRadius;
  const rise = onLevelFloor ? STREET.topRise : STREET.topTread;
  return tops.some((t) => (pos.x - t.x) ** 2 + (pos.z - t.z) ** 2 < r * r && Math.abs(pos.y - t.y) < rise);
}

/** The gteki role of a hit mesh: the nearest tag on it or an ancestor, else its own name. */
export function roleOf(o: THREE.Object3D | null): string | null {
  for (let x = o; x; x = x.parent) if (typeof x.userData.gteki_role === "string") return x.userData.gteki_role;
  return o?.name || null;
}

/** Name of the station group that carries its own surface context (roads, pavement): see docs/core/contract.md. */
export const STREET_CONTEXT_NAME = "street-context";

/** Visible in the render sense: the object and every ancestor have `visible` set. */
function visibleInHierarchy(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/**
 * Finds a station scene's own street context once, at attach: the `street-context` group, plus any mesh
 * tagged `gteki_role: "context"` that is not already inside one. Returns the objects to watch for visibility;
 * empty when the station draws no ground of its own.
 */
export function collectStreetContext(root: THREE.Object3D | null): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  if (!root) return found;
  const named = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if (o.name === STREET_CONTEXT_NAME) {
      named.add(o);
      found.push(o);
    }
  });
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || o.userData.gteki_role !== "context") return;
    for (let x: THREE.Object3D | null = o; x; x = x.parent) if (named.has(x)) return;
    found.push(o);
  });
  return found;
}

/**
 * The core pavement plane yields wherever the station draws its own ground: true while any of the station's
 * street-context objects (see collectStreetContext) is visible. The plane sits just under the walker's feet
 * and, being transparent, would otherwise hide real road surfaces a few cm below it. Cheap enough per frame:
 * a handful of cached objects, each checked up its (shallow) parent chain; no scene traversal.
 */
export function stationDrawsGround(contexts: readonly THREE.Object3D[]): boolean {
  return contexts.some(visibleInHierarchy);
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // on the far plane
  }`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith, uHorizon;
  uniform float uOpacity;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
    col = mix(col, uHorizon * 0.92, 1.0 - smoothstep(-0.2, 0.0, h));
    gl_FragColor = vec4(col, uOpacity);
    // Direct-to-screen rendering (low quality, no composer) needs tone mapping and sRGB here; with the
    // composer three makes these no-ops for the HDR target and OutputPass does them.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function pavementTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  let s = 1234567;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 4 × 4 slabs of 300 mm over a 1.2 m tile; per-slab tone, fine speckle, thin joints.
  const n = 4, t = size / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = 150 + (rnd() * 10 - 5);
      g.fillStyle = `rgb(${v},${v - 1},${v - 4})`;
      g.fillRect(i * t, j * t, t, t);
    }
  for (let k = 0; k < 5000; k++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
    g.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
  }
  g.fillStyle = "rgba(60,60,60,0.28)";
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * t - 1, 0, 2, size);
    g.fillRect(0, i * t - 1, size, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class StreetBackdrop {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly ground: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly fog = new THREE.Fog(0x000000, 1, 2);
  private saved: { fog: THREE.Scene["fog"] } | null = null;
  private blend = 0;
  private groundBlend = 0;
  private contexts: THREE.Object3D[] = [];

  constructor() {
    this.group.name = "street-backdrop";
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { uZenith: { value: new THREE.Color(0x6f95bd) }, uHorizon: { value: STREET.haze.clone() }, uOpacity: { value: 1 } },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    // No canvas outside a browser (unit tests): the plane is then plain grey.
    const map = typeof document === "undefined" ? null : pavementTexture();
    const r = STREET.planeRadius;
    map?.repeat.set((2 * r) / 1.2, (2 * r) / 1.2);
    // Linear values around 0.2 match the lightmapped stone of stair tops; MeshBasic ignores lights, so the
    // look is the same with baked or default lighting.
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map, color: new THREE.Color(0.62, 0.62, 0.62), transparent: true, depthWrite: true }),
    );
    this.ground.name = "street-backdrop-ground";
    this.ground.userData.gteki_role = "backdrop";
    this.group.add(this.sky, this.ground);
    this.group.visible = false;
  }

  /**
   * Point the backdrop at the loaded station scene (or null on unload): the street context it draws is looked
   * up once here, and its visibility alone decides whether the pavement plane shows (see stationDrawsGround).
   */
  attach(root: THREE.Object3D | null): void {
    this.contexts = collectStreetContext(root);
  }

  get active(): boolean {
    return this.saved !== null;
  }

  /** The sky's current opacity (0 while hidden), for automated checks. */
  get opacity(): number {
    return this.group.visible ? this.blend : 0;
  }

  /**
   * Per frame, outside overview (see isOutdoors). The station's own walking fog is blended toward
   * daylight haze, and restored exactly once the walker is back under cover. `teleport` jumps
   * straight to the target instead of easing, so a walker placed underground never sees daylight.
   */
  update(scene: THREE.Scene, camera: THREE.Camera, walker: THREE.Vector3, outdoors: boolean, dt: number, level = true, teleport = false): void {
    this.blend = teleport ? (outdoors ? 1 : 0) : THREE.MathUtils.damp(this.blend, outdoors ? 1 : 0, 4, dt);
    if (this.blend < 0.002) {
      this.restore(scene);
      return;
    }
    if (!this.saved) this.saved = { fog: scene.fog };
    const base = this.saved.fog;
    const b = this.blend;
    const fogColor = base ? (base as THREE.Fog).color.clone().lerp(STREET.haze, b) : STREET.haze.clone();
    const near = base instanceof THREE.Fog ? THREE.MathUtils.lerp(base.near, STREET.fogNear, b) : STREET.fogNear;
    const far = base instanceof THREE.Fog ? THREE.MathUtils.lerp(base.far, STREET.fogFar, b) : STREET.fogFar;
    this.fog.color.copy(fogColor);
    this.fog.near = near;
    this.fog.far = far;
    scene.fog = this.fog;
    this.group.visible = true;
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uOpacity!.value = b;
    // The plane follows the walker's feet and shows only on level ground: on a stair (or at the lip of a
    // stairwell) it would cut across the flight below, so there the stair geometry stays visible.
    // It also yields entirely wherever the station draws its own street (real road surfaces can sit below it).
    const up = outdoors && level && !stationDrawsGround(this.contexts);
    // Fades in on arrival; clears at once when footing stops being level, so it never covers a stair going down.
    this.groundBlend = up ? (teleport ? 1 : THREE.MathUtils.damp(this.groundBlend, 1, 8, dt)) : 0;
    this.ground.visible = this.groundBlend > 0.01;
    // Follow the camera in whole tiles so the pavement pattern stays put in the world.
    const snap = (v: number) => Math.round(v / 1.2) * 1.2;
    const y = up ? walker.y - STREET.planeDrop : this.ground.position.y;
    this.ground.position.set(snap(camera.position.x), y, snap(camera.position.z));
    this.ground.material.opacity = b * this.groundBlend;
  }

  /** Put the station's own fog back and hide the backdrop (overview, station switch, going underground). */
  restore(scene: THREE.Scene): void {
    if (this.saved) {
      scene.fog = this.saved.fog;
      this.saved = null;
    }
    this.blend = 0;
    this.groundBlend = 0;
    this.group.visible = false;
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.map?.dispose();
    this.ground.material.dispose();
  }
}
