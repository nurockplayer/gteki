// Street-level context layer (issue #39): PLATEAU surface buildings around the exits, built by tools/gis
// (`gis context-glb`), visual only. Truth stays in gteki/*.json; nothing here adds a route, a walkable surface
// or a collider. Uses ctx.THREE so it shares the explorer's three instance.
import type * as THREE_NS from "three";
import type { StationBundle } from "@gteki/schema";
import { stairwellWells } from "../../../apps/web/src/explorer/stairwellCut.ts";

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

/** Facade brightness at pavement level, and the height above it where the shading ends. */
const CONTEXT_GROUND_SHADE = 0.68;
const CONTEXT_GROUND_SHADE_M = 12;
/** The road surface: dark enough to read as asphalt against the pale facades. */
export const CONTEXT_ROAD_COLOR = 0x62635f;

/**
 * Pale concrete, unlit by the scene's rig: the station's lights are a faint hemisphere (baked B1 lighting),
 * so a Lambert material would read near-black outside. The shading is a fixed sun and sky term in the
 * shader, so adding the context changes no light count and recompiles nothing else. Its look comes from the
 * explorer's street fog and haze (this material takes fog). Falls back to a flat colour if a shader chunk the
 * patch anchors on is missing in a future three.
 */
export function createContextMaterial(THREE: ThreeNS, options: { color?: number; streetY?: number | null; facade?: boolean } = {}): THREE_NS.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: options.color ?? 0xb9b5ad, side: THREE.DoubleSide });
  // Facades darken toward the pavement, so the walls around an exit are not one flat pale surface (#858 item 4).
  const streetY = options.streetY ?? null;
  const facade = options.facade === true && streetY !== null;
  const groundShade = streetY === null ? "" : `outgoingLight *= mix( ${CONTEXT_GROUND_SHADE.toFixed(2)}, 1.0, smoothstep( ${streetY.toFixed(2)}, ${(streetY + CONTEXT_GROUND_SHADE_M).toFixed(2)}, vCtxY ) );`;
  mat.name = "ctx_concrete";
  mat.onBeforeCompile = (shader) => {
    const v = shader.vertexShader, f = shader.fragmentShader;
    if (!(v.includes("#include <common>") && v.includes("#include <begin_vertex>") && f.includes("#include <common>") && f.includes("#include <opaque_fragment>"))) return;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCtxN;\nvarying float vCtxY;${facade ? "\nvarying vec3 vCtxPos;" : ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvCtxY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;\nvCtxN = normalize( mat3( modelMatrix ) * normal );${facade ? "\nvCtxPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;" : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCtxN;\nvarying float vCtxY;${facade ? `
varying vec3 vCtxPos;
float ctxEdge( float edge, float value ) {
  #if __VERSION__ >= 300 || defined( GL_OES_standard_derivatives )
    float w = max( fwidth( value ), 0.0001 );
    return smoothstep( edge - w, edge + w, value );
  #else
    return step( edge, value );
  #endif
}` : ""}`)
      .replace(
        "#include <opaque_fragment>",
        [
          "vec3 ctxN = normalize( vCtxN );",
          "if ( ! gl_FrontFacing ) ctxN = - ctxN;",
          "vec3 ctxSun = normalize( vec3( 0.45, 0.75, 0.4 ) );",
          "outgoingLight *= 0.55 + 0.28 * max( dot( ctxN, ctxSun ), 0.0 ) + 0.17 * ( 0.5 + 0.5 * ctxN.y );",
          ...(groundShade ? [groundShade] : []),
          ...(facade ? [`
float ctxHeight = vCtxPos.y - ${streetY!.toFixed(2)};
float ctxFloor = mod( ctxHeight - 4.0, 3.6 );
float ctxAlong = abs( ctxN.x ) > abs( ctxN.z ) ? vCtxPos.z : vCtxPos.x;
float ctxMullion = abs( mod( ctxAlong + 0.9, 1.8 ) - 0.9 );
float ctxWindow = ( ctxEdge( 1.1, ctxFloor ) - ctxEdge( 2.5, ctxFloor ) ) * ctxEdge( 0.075, ctxMullion );
float ctxSlab = 1.0 - ctxEdge( 0.06, min( ctxFloor, 3.6 - ctxFloor ) );
float ctxWall = 1.0 - step( 0.5, abs( ctxN.y ) );
float ctxGround = ctxEdge( 0.0, ctxHeight ) * ( 1.0 - ctxEdge( 4.0, ctxHeight ) );
float ctxUpper = ctxEdge( 4.0, ctxHeight );
outgoingLight *= mix( vec3( 1.0 ), vec3( 0.87 ), ctxWall * ctxGround );
float ctxPilaster = 1.0 - ctxEdge( 0.2, abs( mod( ctxAlong + 3.6, 7.2 ) - 3.6 ) );
float ctxStore = ( ctxEdge( 0.4, ctxHeight ) - ctxEdge( 2.6, ctxHeight ) ) * ctxEdge( 0.06, ctxMullion ) * ( 1.0 - ctxPilaster );
float ctxFascia = ( ctxEdge( 2.8, ctxHeight ) - ctxEdge( 3.4, ctxHeight ) ) * ( 1.0 - ctxPilaster );
float ctxPlinth = ctxEdge( 0.0, ctxHeight ) - ctxEdge( 0.25, ctxHeight );
outgoingLight *= mix( vec3( 1.0 ), vec3( 0.59, 0.62, 0.66 ), ctxWall * ctxStore );
outgoingLight *= mix( vec3( 1.0 ), vec3( 0.80, 0.78, 0.75 ), ctxWall * ctxFascia );
outgoingLight *= 1.0 - 0.30 * ctxWall * ctxPlinth;
outgoingLight *= mix( vec3( 1.0 ), vec3( 0.58, 0.60, 0.64 ), ctxWall * ctxUpper * ctxWindow );
outgoingLight *= 1.0 - 0.15 * ctxWall * ctxUpper * ctxSlab;`] : []),
          "#include <opaque_fragment>",
        ].join("\n"),
      );
  };
  mat.customProgramCacheKey = () => `gteki-ctx-concrete:${streetY}:${options.facade === true}`;
  return mat;
}

/**
 * Dress a loaded context GLB: the shared daylight material on every mesh, nothing else changed (names, roles
 * and geometry stay as the GIS tool wrote them). Returns the meshes.
 */
export function dressContext(gltfScene: THREE_NS.Object3D, material: THREE_NS.Material, roadMaterial: THREE_NS.Material = material): THREE_NS.Mesh[] {
  const meshes: THREE_NS.Mesh[] = [];
  gltfScene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (!m.isMesh) return;
    m.material = /^ctx_road_/.test(m.name) ? roadMaterial : material;
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

/** Keep visual context out of the station's street-exit stair footprints, down to the lower floor. */
export function cutContextStairOpenings(THREE: ThreeNS, root: THREE_NS.Object3D, bundle: StationBundle): number {
  const streetFloors = new Set(bundle.floors.filter(f => f.ordinal === 0 && !f.intermediate).map(f => f.id));
  const exits = new Set(bundle.nodes.filter(n => n.kind === "exit" && streetFloors.has(n.floorId)).map(n => n.id));
  const openings = stairwellWells(bundle, e => !e.closed && (exits.has(e.from) || exits.has(e.to))).flatMap(well => well.rects.map(rect => {
    const along = (p: THREE_NS.Vector3) => (p.x - rect.center.x) * rect.along.x + (p.z - rect.center.z) * rect.along.z;
    const across = (p: THREE_NS.Vector3) => (p.x - rect.center.x) * rect.across.x + (p.z - rect.center.z) * rect.across.z;
    return {
    bounds: { along: rect.halfLength, across: rect.halfWidth, lowerY: well.lowerY, upperY: well.upperY },
    planes: [
      (p: THREE_NS.Vector3) => along(p) + rect.halfLength,
      (p: THREE_NS.Vector3) => rect.halfLength - along(p),
      (p: THREE_NS.Vector3) => p.y - well.lowerY,
      (p: THREE_NS.Vector3) => well.upperY - p.y,
      (p: THREE_NS.Vector3) => across(p) + rect.halfWidth,
      (p: THREE_NS.Vector3) => rect.halfWidth - across(p),
    ],
    intersectsBounds: (polygon: Polygon) => {
      const coords = polygon.map(vertex => ({ u: along(vertex.point), v: across(vertex.point), y: vertex.point.y }));
      return Math.min(...coords.map(p => p.u)) <= rect.halfLength && Math.max(...coords.map(p => p.u)) >= -rect.halfLength
        && Math.min(...coords.map(p => p.v)) <= rect.halfWidth && Math.max(...coords.map(p => p.v)) >= -rect.halfWidth
        && Math.min(...coords.map(p => p.y)) <= well.upperY && Math.max(...coords.map(p => p.y)) >= well.lowerY;
    },
  }; }));
  root.updateMatrixWorld(true);
  type Vertex = { point: THREE_NS.Vector3; attrs: number[][] };
  type Polygon = Vertex[];
  const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
    point: a.point.clone().lerp(b.point, t),
    attrs: a.attrs.map((values, i) => values.map((value, c) => value + (b.attrs[i]![c]! - value) * t)),
  });
  const clipSide = (polygon: Polygon, signed: (p: THREE_NS.Vector3) => number, side: 1 | -1): Polygon => {
    const result: Polygon = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length]!;
      const b = polygon[i]!;
      const da = signed(a.point) * side, db = signed(b.point) * side;
      const aInside = da >= -1e-8, bInside = db >= -1e-8;
      if (aInside !== bInside) result.push(interpolate(a, b, da / (da - db)));
      if (bInside) result.push(b);
    }
    return result;
  };
  const subtractOpening = (polygon: Polygon, planes: ((p: THREE_NS.Vector3) => number)[]): Polygon[] => {
    let inside: Polygon[] = [polygon];
    const outside: Polygon[] = [];
    for (const plane of planes) {
      const next: Polygon[] = [];
      for (const part of inside) {
        const out = clipSide(part, plane, -1);
        if (out.length >= 3) outside.push(out);
        const inn = clipSide(part, plane, 1);
        if (inn.length >= 3) next.push(inn);
      }
      inside = next;
      if (!inside.length) break;
    }
    return outside;
  };
  let cutTriangles = 0;
  root.traverse(o => {
    const mesh = o as THREE_NS.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry, index = geometry.index;
    const attributes = Object.entries(geometry.attributes);
    const output = new Map(attributes.map(([name]) => [name, [] as number[]]));
    const groups: { start: number; count: number; materialIndex: number }[] = [];
    let vertexCount = 0;
    let meshCutTriangles = 0;
    const readVertex = (vertexIndex: number): Vertex => ({
      point: new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), vertexIndex).applyMatrix4(mesh.matrixWorld),
      attrs: attributes.map(([, attr]) => Array.from({ length: attr.itemSize }, (_, component) => {
        switch (component) {
          case 0: return attr.getX(vertexIndex);
          case 1: return attr.getY(vertexIndex);
          case 2: return attr.getZ(vertexIndex);
          case 3: return attr.getW(vertexIndex);
          default: return 0;
        }
      })),
    });
    const count = index?.count ?? geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 3) {
      const sourceIndices = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
      const source = sourceIndices.map(readVertex);
      let parts: Polygon[] = [source];
      for (const opening of openings) {
        parts = parts.flatMap(part => opening.intersectsBounds(part) ? subtractOpening(part, opening.planes) : [part]);
        if (!parts.length) break;
      }
      const unchanged = parts.length === 1 && parts[0]!.length === 3 && parts[0]!.every((v, k) => v === source[k]);
      if (!unchanged) meshCutTriangles++;
      const materialIndex = geometry.groups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
      let added = 0;
      for (const part of parts) {
        for (let k = 1; k + 1 < part.length; k++) {
          for (const vertex of [part[0]!, part[k]!, part[k + 1]!]) {
            vertex.attrs.forEach((values, attrIndex) => output.get(attributes[attrIndex]![0])!.push(...values));
            added++;
          }
        }
      }
      if (added) {
        const previous = groups.at(-1);
        if (previous?.materialIndex === materialIndex && previous.start + previous.count === vertexCount) previous.count += added;
        else groups.push({ start: vertexCount, count: added, materialIndex });
        vertexCount += added;
      }
    }
    if (!meshCutTriangles) return;
    cutTriangles += meshCutTriangles;
    const clipped = geometry.clone();
    clipped.setIndex(null);
    for (const [name, attr] of attributes) {
      const values = output.get(name)!;
      // Attribute getters already decode normalized/interleaved source values.
      const replacement = new THREE.BufferAttribute(new Float32Array(values), attr.itemSize, false);
      replacement.name = attr.name;
      replacement.setUsage(THREE.StaticDrawUsage);
      clipped.setAttribute(name, replacement);
    }
    clipped.clearGroups();
    for (const group of groups) clipped.addGroup(group.start, group.count, group.materialIndex);
    mesh.geometry = clipped;
  });
  return cutTriangles;
}
