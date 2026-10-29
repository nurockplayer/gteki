// Street-level context layer (issue #39): PLATEAU surface buildings around the exits, built by tools/gis
// (`gis context-glb`), visual only. Truth stays in gteki/*.json; nothing here adds a route, a walkable surface
// or a collider. Uses ctx.THREE so it shares the explorer's three instance.
import type * as THREE_NS from "three";

type ThreeNS = typeof THREE_NS;

/** The context GLB for a quality level. Both files are listed on the `street-context` asset in station.json. */
export const CONTEXT_GLB = { low: "assets/ikebukuro_context_low.glb", high: "assets/ikebukuro_context_high.glb" } as const;

/**
 * Where the camera must be (renderer y, metres TP) for the context to show, relative to the street floor's
 * render elevation (`streetY`, 32.5 m for Ikebukuro).
 *
 * - below: the highest camera seen walking B1 is about 31.4 m (head at a 29.05 m floor, held under a 31.7 m
 *   ceiling by the follow camera's ceiling blockers), 1.1 m under `streetY`. A walker on the street (or at
 *   the top of an exit stair, 31.3 m at the lowest exit) has the camera at ~32 m or higher in the default
 *   follow pose. So the camera must be within 1 m of the street height.
 * - above: the follow camera sits at most 9 m (max zoom) above the head, ~10 m up at `streetY`; the overview
 *   camera (Explorer.frameAll) sits near 300 m, so 25 m above the street keeps every walking pose and
 *   excludes overview by a wide margin.
 * - the overview orbit can be zoomed down to any height, so `contextVisibleAt` also needs the scene fog:
 *   the explorer removes it in overview (OverviewLook) and the street backdrop always has one while walking.
 */
export const CONTEXT_GATE = { below: 1, above: 25 } as const;

/**
 * Whether the context should be shown for this camera. `streetY` null (no street floor) never shows it.
 * `fogged` is whether the scene has fog this frame (false in overview).
 */
export function contextVisibleAt(cameraY: number, streetY: number | null, fogged = true): boolean {
  if (streetY === null || !fogged || !Number.isFinite(cameraY)) return false;
  return cameraY >= streetY - CONTEXT_GATE.below && cameraY <= streetY + CONTEXT_GATE.above;
}

/** The street floor's render elevation, as the explorer reads it: the highest non-intermediate ordinal-0 floor. */
export function streetRenderY(floors: readonly { ordinal: number | null; intermediate: boolean; renderElevationM: number }[]): number | null {
  const streets = floors.filter((f) => f.ordinal === 0 && !f.intermediate);
  return streets.length ? Math.max(...streets.map((f) => f.renderElevationM)) : null;
}

/**
 * Pale concrete, unlit by the scene's rig: the station's lights are a faint hemisphere (baked B1 lighting),
 * so a Lambert material would read near-black outside. The shading is a fixed sun and sky term in the
 * shader, so adding the context changes no light count and recompiles nothing else. Its look comes from the
 * explorer's street fog and haze (this material takes fog). Falls back to a flat colour if a shader chunk the
 * patch anchors on is missing in a future three.
 */
export function createContextMaterial(THREE: ThreeNS): THREE_NS.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0xb9b5ad, side: THREE.DoubleSide });
  mat.name = "ctx_concrete";
  mat.onBeforeCompile = (shader) => {
    const v = shader.vertexShader, f = shader.fragmentShader;
    if (!(v.includes("#include <common>") && v.includes("#include <begin_vertex>") && f.includes("#include <common>") && f.includes("#include <opaque_fragment>"))) return;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCtxN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCtxN = normalize( mat3( modelMatrix ) * normal );");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCtxN;")
      .replace(
        "#include <opaque_fragment>",
        [
          "vec3 ctxN = normalize( vCtxN );",
          "if ( ! gl_FrontFacing ) ctxN = - ctxN;",
          "vec3 ctxSun = normalize( vec3( 0.45, 0.75, 0.4 ) );",
          "outgoingLight *= 0.55 + 0.28 * max( dot( ctxN, ctxSun ), 0.0 ) + 0.17 * ( 0.5 + 0.5 * ctxN.y );",
          "#include <opaque_fragment>",
        ].join("\n"),
      );
  };
  mat.customProgramCacheKey = () => "gteki-ctx-concrete";
  return mat;
}

/**
 * Dress a loaded context GLB: the shared daylight material on every mesh, nothing else changed (names, roles
 * and geometry stay as the GIS tool wrote them). Returns the meshes.
 */
export function dressContext(gltfScene: THREE_NS.Object3D, material: THREE_NS.Material): THREE_NS.Mesh[] {
  const meshes: THREE_NS.Mesh[] = [];
  gltfScene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) return;
    m.material = material;
    m.castShadow = false;
    m.receiveShadow = false;
    meshes.push(m);
  });
  return meshes;
}

/**
 * Hook the camera of each frame onto an object that is drawn every frame anyway (no extra draw call), and
 * report its height and whether the scene had fog. The hook reads the camera before the frame it is used in,
 * so a gate decision lags the camera by one frame. Returns a disposer that restores the object's own hook.
 */
export function trackCamera(probe: THREE_NS.Object3D): { read(): { y: number; fogged: boolean } | null; dispose(): void } {
  let seen: { y: number; fogged: boolean } | null = null;
  const previous = probe.onBeforeRender;
  probe.onBeforeRender = function (this: THREE_NS.Object3D, renderer, scene, camera, geometry, material, group) {
    seen = { y: camera.matrixWorld.elements[13]!, fogged: scene.fog != null };
    previous.call(this, renderer, scene, camera, geometry, material, group);
  };
  return {
    read: () => seen,
    dispose() {
      probe.onBeforeRender = previous;
    },
  };
}

/**
 * How far from a street node (m, horizontal) a building triangle can still matter to the follow camera: the
 * longest boom (9 m over the head, ~9.3 m with the clearance) plus the few metres a walker can stray from the
 * node on the exit's top landing. Buildings further out cannot be between the walker and the camera.
 */
export const BLOCKER_REACH_M = 20;

/** Where `mesh.layers` puts a blocker that is switched off: no ray the explorer casts (layer 0) tests it. */
const OFF_LAYER = 1;

export interface ContextBlockers {
  /**
   * The StationScene.cameraBlockers entries: one mesh per street node, never in the scene graph, empty until
   * `fill`. The explorer reads cameraBlockers once when buildScene resolves, then builds its camera targets and
   * ray trees from that list, so the meshes must exist then and are filled in place later.
   */
  meshes: THREE_NS.Mesh[];
  /** Fill from the loaded context: the `ctx_bldg_*` triangles within reach of each node. Roads are never used. Returns the triangle count. */
  fill(contextScene: THREE_NS.Object3D): number;
  /** Switch the blockers on (street level) or off (underground, overview): off, no camera ray tests them at all. */
  setActive(on: boolean): void;
  /** Triangles the blockers currently hold. */
  triangles(): number;
  /** Free the geometry and empty the blockers; `fill` does nothing afterwards. */
  dispose(): void;
}

/**
 * Camera-only blockers for the street context's buildings (the follow camera must not end up inside one; the
 * context material is double-sided). Not walkable, not colliders: only meant for `StationScene.cameraBlockers`.
 *
 * The geometry is a spatial subset of the building triangles, one small mesh per street node (`centers`, renderer
 * space), because the explorer ray-tests a mesh against its bounding sphere and box first and builds its triangle
 * tree only at load: a mesh filled later is scanned triangle by triangle, so many small tight meshes keep a ray
 * from scanning the whole district (the high variant has ~120k building triangles; each node's share is a few
 * hundred). The meshes hold world-space positions and stay outside the scene graph, so the overview framing, the
 * label occluders and the sign cut never see them.
 */
export function createContextBlockers(THREE: ThreeNS, centers: readonly THREE_NS.Vector3[], reach: number = BLOCKER_REACH_M): ContextBlockers {
  // One degenerate triangle far below the world: ray-testable (a mesh without positions is not), never hit,
  // rejected by the bounding box on the first test.
  const empty = new THREE.BufferGeometry();
  empty.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9).fill(-1e6), 3));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  material.name = "ctx_blocker";
  const meshes = centers.map((_, i) => {
    const m = new THREE.Mesh(empty, material);
    m.name = `ctx_blocker_${i}`;
    m.userData.gteki_role = "camera_blocker";
    m.userData.gteki_source = "plateau";
    m.visible = false;
    m.frustumCulled = false;
    m.layers.set(OFF_LAYER);
    return m;
  });
  let disposed = false;
  let held = 0;
  const own = new Set<THREE_NS.BufferGeometry>();

  const release = () => {
    for (const g of own) g.dispose();
    own.clear();
    for (const m of meshes) m.geometry = empty;
    held = 0;
  };

  return {
    meshes,
    fill(contextScene) {
      if (disposed) return 0;
      release();
      contextScene.updateMatrixWorld(true);
      const buckets: number[][] = centers.map(() => []);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const r2 = reach * reach;
      contextScene.traverse((o) => {
        const mesh = o as THREE_NS.Mesh;
        if (!mesh.isMesh || !/^ctx_bldg_/.test(mesh.name)) return;
        const pos = mesh.geometry.getAttribute("position");
        const index = mesh.geometry.getIndex();
        const count = Math.floor((index ? index.count : pos.count) / 3);
        const vertex = (t: number, k: number, out: THREE_NS.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(mesh.matrixWorld);
        for (let t = 0; t < count; t++) {
          vertex(t, 0, a); vertex(t, 1, b); vertex(t, 2, c);
          const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x);
          const z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
          for (let i = 0; i < centers.length; i++) {
            const { x, z } = centers[i]!;
            // Distance from the node to the triangle's horizontal bounding box.
            const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
            if (dx * dx + dz * dz <= r2) buckets[i]!.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          }
        }
      });
      buckets.forEach((verts, i) => {
        if (verts.length === 0) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        own.add(g);
        meshes[i]!.geometry = g;
        held += verts.length / 9;
      });
      return held;
    },
    setActive(on) {
      for (const m of meshes) m.layers.set(on && !disposed ? 0 : OFF_LAYER);
    },
    triangles: () => held,
    dispose() {
      disposed = true;
      release();
      for (const m of meshes) m.layers.set(OFF_LAYER);
      empty.dispose();
      material.dispose();
    },
  };
}
