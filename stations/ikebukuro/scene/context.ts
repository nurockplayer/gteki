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
