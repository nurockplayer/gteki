/**
 * Three.js scene for Toei Oedo Shinjuku (E27), built from the renderer-neutral layout.
 * Frame: ENU (x east, y north, z up) → Three (X = x, Y = z, Z = -y).
 */
import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import { createRouter } from "@gteki/navigation";
import { centroid, pointInRings, soffitHeight, STREET_PAD, WalkWorld, type Layout, type Plan, type Run, type Soffit, type WallSeg, type XY, type XYZ } from "./layout.ts";
import { ceilingTexture, signTexture, tactileTexture, tileTextures, wallTexture, SIGN_ROW_HEIGHT, type SignIcon } from "./textures.ts";
import { prepareLayout } from "./build-cache.ts";
import { gateMachines, accessSigns, ACCESS_WORDING } from "./fare-fence.ts";
import surfaceJson from "../data/surface.json";
import bakedSurface from "../data/surface-baked.ts";
import { buildSurface, surfaceWalls, trimSurfaceCeilingFixtures, type SurfaceData } from "./surface.ts";
import { withSurfaceMemo } from "./surface-layout.ts";
import { surfaceSeed } from "./surface-bake.ts";

export const OEDO_MAGENTA = "#b6007a"; // public line colour of the Oedo Line

const v3 = (p: XYZ) => new THREE.Vector3(p.x, p.z, -p.y);

export interface BuiltStation {
  root: THREE.Group;
  layout: Layout;
  world: WalkWorld;
  /** Extra collision walls created by props (gate machines, platform doors). */
  propWalls: WallSeg[];
  escalators: { run: Run; steps: THREE.InstancedMesh; speed: number }[];
  signs: THREE.Object3D[];
  levelGroups: Map<string, THREE.Group>;
  update(dt: number, t: number): void;
  /** W2: ENU camera position controls render-only street visibility. */
  setViewer?(pos: XYZ): void;
  /** QA readout of the decorative train cycle per platform track. */
  trainStatus(): { tt: number; present: boolean; doorsOpen: boolean }[];
  dispose(): void;
}

export interface BuildOptions {
  quality: "low" | "high";
  /** Reuse the built layout and fences across builds of equal bundle and plan (the shared explorer's
   * reopen). Output is byte-identical; see build-cache.ts. */
  reuseLayout?: boolean;
  /** Default true, and buildScene keeps it true: the restricted-area input fingerprint (~90 ms cold) is the only
   * load-time guard against a stale generated fence table, because the root test suite does not run in CI yet
   * (pending root CI). false is for tests that exercise the unchecked path. */
  verifyRestrictedInput?: boolean;
  /** false derives the street layer's polygons instead of reading data/surface-baked.ts. Default true; the
   * baked table is used only if it was made from exactly this surface, bundle and plan (surface-bake.ts). */
  useBakedSurface?: boolean;
}

// ---------------------------------------------------------------- helpers
function shapeFromRings(rings: XY[][]): THREE.Shape {
  const shape = new THREE.Shape(rings[0]!.map((p) => new THREE.Vector2(p.x, p.y)));
  for (let i = 1; i < rings.length; i++) shape.holes.push(new THREE.Path(rings[i]!.map((p) => new THREE.Vector2(p.x, p.y))));
  return shape;
}

/** Horizontal polygon at height z, world-planar UVs scaled by `uvScale` metres per texture repeat. */
export function slabGeometry(rings: XY[][], z: number, uvScale: number, facingDown = false): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeFromRings(rings));
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, x / uvScale, y / uvScale);
    pos.setXYZ(i, x, z, -y);
  }
  if (facingDown) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** The renderer uses the same affine roof that the head-clearance checks inspect. */
export function soffitGeometry(s: Soffit): THREE.BufferGeometry {
  const g = slabGeometry(s.rings, s.z, 2.4, true);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setY(i, soffitHeight(s, { x: pos.getX(i), y: -pos.getZ(i) }));
  g.computeVertexNormals();
  return g;
}

/** Vertical quad strip for a wall segment, UV u = metres/2.4, v = height/3.2. */
function wallQuad(a: XY, b: XY, z0: number, z1: number, uOff = 0): THREE.BufferGeometry {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x, z0, -a.y, b.x, z0, -b.y, b.x, z1, -b.y, a.x, z1, -a.y], 3));
  const vTop = (z1 - z0) / 3.2;
  g.setAttribute("uv", new THREE.Float32BufferAttribute([uOff / 2.4, 0, (uOff + L) / 2.4, 0, (uOff + L) / 2.4, vTop, uOff / 2.4, vTop], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function enclosureWallGeometry(w: WallSeg): THREE.BufferGeometry {
  const g = wallQuad(w.a, w.b, w.zMin, w.zMax, w.a.x + w.a.y);
  if (!w.profile) return g;
  const p = g.attributes.position!, uv = g.attributes.uv!;
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, length = Math.hypot(dx, dy);
  const sign = (Math.abs(dx) > Math.abs(dy) ? dx : dy) >= 0 ? 1 : -1;
  const along = (q: XY) => (q.x * dx + q.y * dy) / length * sign / 2.4;
  const heights = [w.profile.bottomA, w.profile.bottomB, w.profile.topB, w.profile.topA];
  for (let i = 0; i < 4; i++) {
    p.setY(i, heights[i]!);
    uv.setX(i, along(i === 0 || i === 3 ? w.a : w.b));
    uv.setY(i, (heights[i]! - (w.surfaceBase ? i === 0 || i === 3 ? w.surfaceBase.a : w.surfaceBase.b : 0)) / 3.2);
  }
  g.computeVertexNormals();
  return g;
}

function runPanel(w: WallSeg, r: Run): WallSeg {
  const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, l2 = dx * dx + dy * dy;
  const zAt = (p: XY) => r.a.z + (r.b.z - r.a.z) * ((p.x - r.a.x) * dx + (p.y - r.a.y) * dy) / l2;
  const a = zAt(w.a), b = zAt(w.b);
  return { ...w, surfaceBase: { a, b }, profile: { bottomA: a - 0.12, bottomB: b - 0.12, topA: a + 0.9, topB: b + 0.9 } };
}

/** Collision keeps short conservative height bands; rendering can join collinear panels. */
export function coalesceWallPanels(walls: WallSeg[]): WallSeg[] {
  const out: WallSeg[] = [];
  for (const w of walls) {
    const p = out.at(-1), a = p?.profile, b = w.profile;
    if (p && a && b && p.finish === w.finish && p.kind === w.kind && p.surfaceBase && w.surfaceBase &&
      Math.hypot(p.b.x - w.a.x, p.b.y - w.a.y) < 1e-6) {
      const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, ex = w.b.x - w.a.x, ey = w.b.y - w.a.y;
      const l = Math.hypot(dx, dy), m = Math.hypot(ex, ey);
      const joins = (a0: number, a1: number, b0: number, b1: number) =>
        Math.abs(a1 - b0) < 1e-6 && Math.abs((a1 - a0) * m - (b1 - b0) * l) < 1e-5;
      if (l > 1e-6 && m > 1e-6 && dx * ex + dy * ey > 0 && Math.abs(dx * ey - dy * ex) < 1e-6 * l * m &&
        joins(a.bottomA, a.bottomB, b.bottomA, b.bottomB) && joins(a.topA, a.topB, b.topA, b.topB) &&
        joins(p.surfaceBase.a, p.surfaceBase.b, w.surfaceBase.a, w.surfaceBase.b)) {
        out[out.length - 1] = { ...p, b: w.b, zMin: Math.min(p.zMin, w.zMin), zMax: Math.max(p.zMax, w.zMax),
          profile: { ...a, bottomB: b.bottomB, topB: b.topB }, surfaceBase: { a: p.surfaceBase.a, b: w.surfaceBase.b } };
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

/** Union coplanar cladding in render space; the same conservative collision bands remain.
 * Prefer source partitions, then pitched shaft finishes, then flat landing sleeves.
 */
export function cladWallGeometry(walls: WallSeg[]): THREE.BufferGeometry | null {
  type Plane = { u: XY; offset: number; polygons: polygonClipping.Polygon[] };
  const planes = new Map<string, Plane>(), geometries: THREE.BufferGeometry[] = [];
  const priority = (w: WallSeg) => !w.finish ? 0 : w.surfaceBase && Math.abs(w.surfaceBase.a - w.surfaceBase.b) > 1e-5 ? 1 : 2;
  for (const w of coalesceWallPanels(walls).sort((a, b) => priority(a) - priority(b))) {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const sign = (Math.abs(dx) > Math.abs(dy) ? dx : dy) >= 0 ? 1 : -1;
    const u = { x: dx / length * sign, y: dy / length * sign };
    const offset = -w.a.x * u.y + w.a.y * u.x;
    const key = `${u.x.toFixed(5)},${u.y.toFixed(5)},${offset.toFixed(4)}`;
    const plane = planes.get(key) ?? { u, offset, polygons: [] };
    planes.set(key, plane);
    const s0 = w.a.x * plane.u.x + w.a.y * plane.u.y, s1 = w.b.x * plane.u.x + w.b.y * plane.u.y;
    const p = w.profile ?? { bottomA: w.zMin, bottomB: w.zMin, topA: w.zMax, topB: w.zMax };
    const polygon: polygonClipping.Polygon = [[[s0, p.bottomA], [s1, p.bottomB], [s1, p.topB], [s0, p.topA], [s0, p.bottomA]]];
    const visible = plane.polygons.length ? polygonClipping.difference(polygon, ...plane.polygons) : [polygon];
    plane.polygons.push(polygon);
    for (const rings of visible) {
      const geo = new THREE.ShapeGeometry(shapeFromRings(rings.map((r) => r.map(([x, y]) => ({ x: x!, y: y! })))));
      const position = geo.attributes.position!, uv = geo.attributes.uv!;
      for (let i = 0; i < position.count; i++) {
        const s = position.getX(i), z = position.getY(i), t = (s - s0) / (s1 - s0);
        const datum = w.surfaceBase ? w.surfaceBase.a + (w.surfaceBase.b - w.surfaceBase.a) * t : w.zMin;
        position.setXYZ(i, plane.u.x * s - plane.u.y * plane.offset, z, -(plane.u.y * s + plane.u.x * plane.offset));
        uv.setXY(i, s / 2.4, (z - datum) / 3.2);
      }
      geo.computeVertexNormals();
      geometries.push(geo);
    }
  }
  return merged(geometries);
}

function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  for (const g of geos) {
    if (!g.index) g.setIndex([...Array(g.attributes.position!.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  }
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return m;
}

/** Replaced/merged meshes no longer own GPU resources, but a disposal registry
 * would still keep their CPU arrays alive. Retain only geometries in the final
 * tree; their arrays remain available for rendering, raycasts and context restore.
 */
export function disposeRetiredGeometries(root: THREE.Object3D, resources: { dispose(): void }[]) {
  const live = new Set<THREE.BufferGeometry>();
  root.traverse((o) => { if (o instanceof THREE.Mesh) live.add(o.geometry); });
  for (let i = resources.length - 1; i >= 0; i--) {
    const resource = resources[i]!;
    if (resource instanceof THREE.BufferGeometry && !live.has(resource)) {
      resource.dispose();
      resources.splice(i, 1);
    }
  }
}

/** Explicit back faces keep the colour and GTAO normal/depth passes in agreement.
 * GTAO overrides materials with a front-sided normal material, so material-only
 * DoubleSide walls leave the inside of a shaft absent from its depth buffer.
 */
function addWallBackFaces(root: THREE.Group, material: THREE.Material, track: <T extends { dispose(): void }>(x: T) => T) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material !== material) return;
    const front = o.geometry;
    const back = front.clone();
    const index = back.index!, normal = back.attributes.normal!;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    o.geometry = track(merged([front, back])!);
    o.userData.twoSidedWall = true;
  });
}

/** Thin, long level meshes have very loose default bounding spheres. A second box
 * check avoids submitting whole underground levels when the camera faces away from them.
 */
function installTightCulling(root: THREE.Group) {
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), worldBox = new THREE.Box3();
  const uses = new Map<THREE.BufferGeometry, number>();
  root.traverse((o) => { if (o instanceof THREE.Mesh) uses.set(o.geometry, (uses.get(o.geometry) ?? 0) + 1); });
  const candidates: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && uses.get(o.geometry) === 1 && !o.children.length) candidates.push(o);
  });
  for (const o of candidates) {
    const geometry = o.geometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!.clone().expandByScalar(0.02);
    // A zero instance count skips the draw entirely; a zero geometry draw range still
    // submits an empty WebGL draw in Three.js. One identity instance preserves the mesh.
    const batch = new THREE.InstancedMesh(geometry, o.material, 1);
    batch.setMatrixAt(0, new THREE.Matrix4());
    batch.name = o.name;
    batch.userData = { ...o.userData, tightCulling: true };
    batch.position.copy(o.position);
    batch.quaternion.copy(o.quaternion);
    batch.scale.copy(o.scale);
    batch.visible = o.visible;
    batch.castShadow = o.castShadow;
    batch.receiveShadow = o.receiveShadow;
    batch.renderOrder = o.renderOrder;
    batch.computeBoundingSphere();
    batch.onBeforeRender = (_renderer, _scene, camera) => {
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      worldBox.copy(bounds).applyMatrix4(batch.matrixWorld);
      batch.count = frustum.intersectsBox(worldBox) ? 1 : 0;
    };
    o.parent!.add(batch);
    o.removeFromParent();
  }
}

/** Preserve bump detail, but avoid normalizing a zero derivative/perturbed normal.
 * Edge-on MSAA fragments can have a collapsed derivative frame. A NaN there
 * contaminates the bloom pyramid and turns the complete high-quality frame black.
 */
export function guardBumpNormals(material: THREE.MeshStandardMaterial) {
  const chunk = THREE.ShaderChunk.bumpmap_pars_fragment
    .replace("vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );", `vec3 sigmaX = dFdx( surf_pos.xyz );
      vec3 sigmaY = dFdy( surf_pos.xyz );
      if ( !( dot( sigmaX, sigmaX ) > 1e-20 ) || !( dot( sigmaY, sigmaY ) > 1e-20 ) ) return surf_norm;
      vec3 vSigmaX = normalize( sigmaX );`)
    .replace("vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );", "vec3 vSigmaY = normalize( sigmaY );")
    .replace("return normalize( abs( fDet ) * surf_norm - vGrad );", `vec3 perturbed = abs( fDet ) * surf_norm - vGrad;
      return dot( perturbed, perturbed ) > 1e-20 ? normalize( perturbed ) : surf_norm;`);
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <bumpmap_pars_fragment>", chunk);
  };
  material.customProgramCacheKey = () => "shinjuku-finite-bump-v1";
}

function boxAlong(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.BoxGeometry(w, h, L);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  if (Math.abs(d.clone().normalize().y) > 0.999) m.lookAt(a, b, new THREE.Vector3(1, 0, 0));
  g.applyMatrix4(m);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function cylAlong(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// ---------------------------------------------------------------- main
export function buildStation(bundle: StationBundle, plan: Plan, opts: BuildOptions): BuiltStation {
  // `let`, not `const`: both are cleared before returning (see the end of this function).
  let { layout, protection } = prepareLayout(bundle, plan, { reuse: opts.reuseLayout, verifyGeneratedInput: opts.verifyRestrictedInput });
  const root = new THREE.Group();
  root.name = "shinjuku-e27";
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const aniso = opts.quality === "high" ? 8 : 4;

  // ---- materials
  const concourseTiles = tileTextures({ base: "#817c71", grout: "#56534d", n: 4, seed: 11, speckle: 0.13 });
  const paidTiles = tileTextures({ base: "#76776f", grout: "#4c4f49", n: 4, seed: 23, speckle: 0.12 });
  const platformTiles = tileTextures({ base: "#777b7a", grout: "#484d4c", n: 4, seed: 37, speckle: 0.13 });
  const wallMaps = wallTexture(OEDO_MAGENTA), ceilingMaps = ceilingTexture();
  for (const texture of Object.values(wallMaps)) texture.wrapT = THREE.ClampToEdgeWrapping;
  for (const t of [concourseTiles, paidTiles, platformTiles, wallMaps, ceilingMaps]) for (const tex of Object.values(t)) (tex.anisotropy = aniso), track(tex);
  const mat = {
    floor: track(new THREE.MeshStandardMaterial({ ...concourseTiles, bumpScale: 0.012, roughness: 0.72, metalness: 0.0, envMapIntensity: 0.9 })),
    floorPaid: track(new THREE.MeshStandardMaterial({ ...paidTiles, bumpScale: 0.012, roughness: 0.68, metalness: 0.0, envMapIntensity: 0.9 })),
    floorPlatform: track(new THREE.MeshStandardMaterial({ ...platformTiles, bumpScale: 0.016, roughness: 0.82, metalness: 0.0 })),
    wall: track(new THREE.MeshStandardMaterial({ ...wallMaps, color: "#d3cec4", bumpScale: 0.003, roughness: 0.76, metalness: 0.03 })),
    wallRoom: track(new THREE.MeshStandardMaterial({ color: "#d8d5ce", roughness: 0.7, side: THREE.DoubleSide })),
    ceiling: track(new THREE.MeshStandardMaterial({ ...ceilingMaps, color: "#c0c2bd", bumpScale: 0.008, roughness: 0.96, side: THREE.DoubleSide })),
    light: track(new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#fff6e8", emissiveIntensity: 3.2, roughness: 0.4 })),
    lightHousing: track(new THREE.MeshStandardMaterial({ color: "#9a9ea2", roughness: 0.35, metalness: 0.6 })),
    tactile: track(new THREE.MeshStandardMaterial({ map: track(tactileTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })),
    steel: track(new THREE.MeshStandardMaterial({ color: "#aab2b5", roughness: 0.58, metalness: 0.6, envMapIntensity: 0.22, side: THREE.DoubleSide })),
    darkSteel: track(new THREE.MeshStandardMaterial({ color: "#3b3f44", roughness: 0.45, metalness: 0.6 })),
    rubber: track(new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.55 })),
    // Tinted reflective glass without a transmission scene pass (also coherent on low quality).
    glass: track(new THREE.MeshStandardMaterial({ color: "#b4ccd1", roughness: 0.32, metalness: 0.08, envMapIntensity: 0.18, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true })),
    stair: track(new THREE.MeshStandardMaterial({ color: "#8d887d", roughness: 0.76 })),
    nosing: track(new THREE.MeshStandardMaterial({ color: "#303532", roughness: 0.7 })),
    escStep: track(new THREE.MeshStandardMaterial({ color: "#6d7177", roughness: 0.4, metalness: 0.7 })),
    escStepEdge: track(new THREE.MeshStandardMaterial({ color: "#f2c21b", roughness: 0.5 })),
    gateBody: track(new THREE.MeshStandardMaterial({ color: "#e9ebec", roughness: 0.35, metalness: 0.15 })),
    gateTop: track(new THREE.MeshStandardMaterial({ color: "#303634", roughness: 0.58, metalness: 0.15, envMapIntensity: 0.3 })),
    gateIc: track(new THREE.MeshStandardMaterial({ color: "#1a507e", emissive: "#3983b0", emissiveIntensity: 0.18, roughness: 0.45 })),
    gateOk: track(new THREE.MeshStandardMaterial({ color: "#247c53", emissive: "#4bcb86", emissiveIntensity: 0.16, roughness: 0.45 })),
    flap: track(new THREE.MeshStandardMaterial({ color: "#e64060", roughness: 0.4, transparent: true, opacity: 0.85 })),
    psd: track(new THREE.MeshStandardMaterial({ color: "#d4d8dc", roughness: 0.3, metalness: 0.5 })),
    trackBed: track(new THREE.MeshStandardMaterial({ color: "#2a2826", roughness: 0.95 })),
    rail: track(new THREE.MeshStandardMaterial({ color: "#8d8f92", roughness: 0.3, metalness: 0.9 })),
    accent: track(new THREE.MeshStandardMaterial({ color: OEDO_MAGENTA, roughness: 0.4, emissive: OEDO_MAGENTA, emissiveIntensity: 0.15 })),
    portal: track(new THREE.MeshBasicMaterial({ color: "#7fd3ff", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })),
    sidewalk: track(new THREE.MeshStandardMaterial({ color: "#a39e96", roughness: 0.9 })),
    tunnel: track(new THREE.MeshStandardMaterial({ color: "#3a3b3d", roughness: 0.95, side: THREE.DoubleSide })),
    psdLeaf: track(new THREE.MeshStandardMaterial({ color: "#c9d6dd", roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85 })),
    trainBody: track(new THREE.MeshStandardMaterial({ color: "#d9dcde", roughness: 0.3, metalness: 0.75 })),
    trainWindow: track(new THREE.MeshStandardMaterial({ color: "#1c232a", roughness: 0.08, metalness: 0.2, emissive: "#fff2d6", emissiveIntensity: 0.35 })),
    trainDoor: track(new THREE.MeshStandardMaterial({ color: "#b8bdc1", roughness: 0.25, metalness: 0.8 })),
  };
  for (const m of [mat.floor, mat.floorPaid, mat.floorPlatform, mat.wall, mat.ceiling]) guardBumpNormals(m);
  for (const m of [mat.floor, mat.floorPaid, mat.floorPlatform]) {
    m.map!.repeat.set(1, 1);
  }

  const levelGroups = new Map<string, THREE.Group>();
  const propWalls: WallSeg[] = [];
  const trainBatches: { cars: THREE.Group[]; meshes: THREE.InstancedMesh[] }[] = [];
  const platformTracks: {
    at: (s: number, off: number) => XY;
    tangentAt: (s: number) => XY;
    z: number;
    trackOff: number;
    stopS: number;
    dirSign: number;
    cars: THREE.Group[];
    leafMesh: THREE.InstancedMesh;
    leaves: { s: number; dir: number }[];
    phase: number;
    far: number;
  }[] = [];

  const fasciaGeos: THREE.BufferGeometry[] = [];
  // ---- per level: slabs, ceilings, walls, railings, lights
  for (const lv of layout.levels) {
    const g = new THREE.Group();
    g.name = `level-${lv.label}`;
    levelGroups.set(lv.floorId, g);
    root.add(g);
    const isPlatform = lv.label === "B6";

    const floorFree: THREE.BufferGeometry[] = [];
    const floorPaid: THREE.BufferGeometry[] = [];
    for (const s of lv.slabs) (s.fare === "paid" ? floorPaid : floorFree).push(slabGeometry(s.rings, s.z, 2.4));
    for (const [geos, m] of [
      [floorFree, isPlatform ? mat.floorPlatform : mat.floor],
      [floorPaid, isPlatform ? mat.floorPlatform : mat.floorPaid],
    ] as const) {
      const geo = merged(geos);
      if (!geo) continue;
      const mesh = new THREE.Mesh(track(geo), m);
      mesh.receiveShadow = true;
      mesh.name = "walkable";
      g.add(mesh);
    }
    const ceil = merged([...lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 2.4, true)), ...layout.soffits.filter((s) => s.floorId === lv.floorId && !(s.spaceId.startsWith("elevator-cap:") && s.z > -0.5)).map(soffitGeometry)]);
    if (ceil) g.add(new THREE.Mesh(track(ceil), mat.ceiling));
    const hood = merged(layout.soffits.filter((s) => s.floorId === lv.floorId && s.spaceId.startsWith("elevator-cap:") && s.z > -0.5).map(soffitGeometry));
    if (hood) {
      const mesh = new THREE.InstancedMesh(track(hood), mat.ceiling, 1);
      mesh.name = "elevator-interior-hood";
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.computeBoundingSphere();
      const cameraPosition = new THREE.Vector3();
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        root.worldToLocal(camera.getWorldPosition(cameraPosition));
        mesh.count = cameraPosition.y < -0.5 ? 1 : 0;
      };
      g.add(mesh);
    }

    // walls (u continuous along each segment)
    for (const w of lv.walls.filter((w) => w.finish === "fascia")) fasciaGeos.push(enclosureWallGeometry(w));
    // public-facing "room" walls use the station cladding as well; plain material only for very short jogs
    const wg = cladWallGeometry(lv.walls.filter((w) => w.kind !== "trackside" && w.finish !== "fascia"));
    if (wg) {
      const m = new THREE.Mesh(track(wg), mat.wall);
      m.receiveShadow = true;
      g.add(m);
    }

    // railings (glass + steel top rail)
    const glassGeos: THREE.BufferGeometry[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    for (const r of lv.railings) {
      glassGeos.push(wallQuad(r.a, r.b, r.z + 0.08, r.z + 1.05));
      railGeos.push(boxAlong(v3({ ...r.a, z: r.z + 1.08 }), v3({ ...r.b, z: r.z + 1.08 }), 0.06, 0.05));
    }
    const gg = merged(glassGeos);
    if (gg) g.add(new THREE.Mesh(track(gg), mat.glass));
    const rg = merged(railGeos);
    if (rg) g.add(new THREE.Mesh(track(rg), mat.steel));

    // platform: platform doors along trackside walls + track bed beyond
    if (isPlatform) buildPlatformEdge(lv.walls.filter((w) => w.kind === "trackside"), lv.z, g);
  }
  // Fascia joins the existing stair-concrete batch below; shaft cladding is merged with the
  // source walls per level. No extra wall material draw is needed for the new enclosure.

  // ---- underground fixtures, kept in a separate helper for the surface lane's hook
  buildUndergroundLighting(bundle, layout, levelGroups, root, track);
  buildElevatorPortals(bundle, layout, root, mat, track);

  // ---- existing surface ceiling lights (street scene is owned by W2)
  {
    const lightGeos: THREE.BufferGeometry[] = [];
    const housingGeos: THREE.BufferGeometry[] = [];
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    for (const e of bundle.edges) {
      if (e.mode !== "walk" && e.mode !== "gate" && e.mode !== "ramp") continue;
      const A = nodeById.get(e.from)!;
      const B = nodeById.get(e.to)!;
      if ((layout.nodeZ.get(A.id) ?? 0) < -0.5) continue;
      if (A.floorId !== B.floorId || A.inOut === "outside") continue;
      const lv = layout.levels.find((l) => l.floorId === A.floorId) ?? layout.levels.find((l) => Math.abs(l.z - (layout.nodeZ.get(A.id) ?? 0)) < 0.5);
      if (!lv) continue;
      const L = Math.hypot(B.position.x - A.position.x, B.position.y - A.position.y);
      if (L < 2.5) continue;
      const z = lv.ceilingZ - 0.03;
      const shrink = 0.6 / L;
      const a = { x: A.position.x + (B.position.x - A.position.x) * shrink, y: A.position.y + (B.position.y - A.position.y) * shrink, z };
      const b = { x: B.position.x - (B.position.x - A.position.x) * shrink, y: B.position.y - (B.position.y - A.position.y) * shrink, z };
      lightGeos.push(boxAlong(v3(a), v3(b), 0.14, 0.03));
      housingGeos.push(boxAlong(v3({ ...a, z: z + 0.015 }), v3({ ...b, z: z + 0.015 }), 0.22, 0.03));
    }
    const lg = merged(lightGeos);
    if (lg) root.add(new THREE.Mesh(track(lg), mat.light));
    const hg = merged(housingGeos);
    if (hg) root.add(new THREE.Mesh(track(hg), mat.lightHousing));
  }

  // ---- landing pads
  {
    const pg = merged([...layout.pads.map((p) => slabGeometry(p.rings, p.z + 0.002, 2.4)), ...layout.linkStrips.filter((s) => s.z < -0.5).map((s) => slabGeometry(s.rings, s.z - 0.006, 2.4))]);
    if (pg) {
      const m = new THREE.Mesh(track(pg), mat.floor);
      m.name = "walkable";
      root.add(m);
    }
  }

  // ---- tactile paving
  {
    const tg: THREE.BufferGeometry[] = [];
    for (const t of layout.tactile) {
      for (let i = 1; i < t.pts.length; i++) {
        const a = t.pts[i - 1]!;
        const b = t.pts[i]!;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 0.05) continue;
        const dx = (b.x - a.x) / L;
        const dy = (b.y - a.y) / L;
        const nx = -dy * 0.15;
        const ny = dx * 0.15;
        const z = a.z + 0.006;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute([a.x + nx, z, -(a.y + ny), b.x + nx, z, -(b.y + ny), b.x - nx, z, -(b.y - ny), a.x - nx, z, -(a.y - ny)], 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L / 0.3, 0, L / 0.3, 1, 0, 1], 2));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        geo.setIndex([0, 2, 1, 0, 3, 2]);
        tg.push(geo);
      }
    }
    const geo = merged(tg);
    if (geo) {
      (mat.tactile.map as THREE.Texture).rotation = Math.PI / 2;
      root.add(new THREE.Mesh(track(geo), mat.tactile));
    }
  }

  // ---- stairs & escalators
  const escalators: BuiltStation["escalators"] = [];
  {
    const stairGeos: THREE.BufferGeometry[] = [...fasciaGeos];
    const nosingGeos: THREE.BufferGeometry[] = [];
    const sideGeos: THREE.BufferGeometry[] = [];
    const balustradeGeos: THREE.BufferGeometry[] = [];
    const handGeos: THREE.BufferGeometry[] = [];
    const rubberGeos: THREE.BufferGeometry[] = [];
    const steelGeos: THREE.BufferGeometry[] = [];
    const greenGeos: THREE.BufferGeometry[] = [];
    const redGeos: THREE.BufferGeometry[] = [];
    for (const r of layout.runs) {
      const lo = r.a.z <= r.b.z ? r.a : r.b;
      const hi = r.a.z <= r.b.z ? r.b : r.a;
      const dz = hi.z - lo.z;
      const dx = hi.x - lo.x;
      const dy = hi.y - lo.y;
      const L = Math.hypot(dx, dy) || 1;
      const u = { x: dx / L, y: dy / L };
      const n = { x: -u.y, y: u.x };
      const hw = r.width / 2;
      // rotation about Three Y so local +X maps to the run direction: (x, z, -y) ⇒ θ = atan2(u.y, u.x)
      const yaw = Math.atan2(u.y, u.x);
      if (r.mode === "stairs") {
        if (dz < 0.05) {
          // flat stair link (landing) — draw as floor strip
          stairGeos.push(boxAlong(v3({ ...lo, z: lo.z - 0.05 }), v3({ ...hi, z: hi.z - 0.05 }), r.width, 0.1));
        } else {
          const steps = Math.max(2, Math.round(dz / 0.165));
          const rise = dz / steps;
          const run = L / steps;
          for (let i = 0; i < steps; i++) {
            const cx = lo.x + u.x * run * (i + 0.5);
            const cy = lo.y + u.y * run * (i + 0.5);
            const top = lo.z + rise * (i + 1);
            const box = new THREE.BoxGeometry(run + 0.02, rise + 0.18, r.width);
            box.rotateY(yaw);
            box.translate(cx, top - (rise + 0.18) / 2, -cy);
            stairGeos.push(box);
            const ex = lo.x + u.x * run * i;
            const ey = lo.y + u.y * run * i;
            const nose = new THREE.BoxGeometry(0.075, 0.014, r.width - 0.06);
            nose.rotateY(yaw);
            nose.translate(ex + u.x * 0.03, top + 0.006, -(ey + u.y * 0.03));
            nosingGeos.push(nose);
          }
        }
      } else {
        // escalator truss + balustrades
        const truss = boxAlong(v3({ ...lo, z: lo.z - 0.55 }), v3({ ...hi, z: hi.z - 0.55 }), r.width + 0.3, 0.9);
        steelGeos.push(truss);
        // animated steps
        const L3 = Math.hypot(L, dz);
        const stepLen = 0.4;
        const count = Math.ceil(L3 / stepLen);
        const stepGeo = track(new THREE.BoxGeometry(stepLen * 0.96, 0.06, r.width - 0.1));
        const steps = new THREE.InstancedMesh(stepGeo, mat.escStep, count);
        steps.name = `escalator-steps:${r.edgeId}`;
        steps.userData = { lo, hi, yaw, count, L3, stepLen };
        root.add(steps);
        escalators.push({ run: r, steps, speed: 0.5 * (r.travel === 0 ? 0 : (r.a.z <= r.b.z ? 1 : -1) * r.travel) });
        // entry/exit indicators: green arrow where you board, red bar where you must not
        const board = r.travel >= 0 ? r.a : r.b;
        const alight = r.travel >= 0 ? r.b : r.a;
        for (const [p, ok] of [
          [board, true],
          [alight, false],
        ] as const) {
          const lamp = new THREE.BoxGeometry(0.16, 0.1, 0.02);
          const into = p === lo ? -1 : 1;
          const at = v3({ x: p.x + u.x * 0.65 * into + n.x * (hw + 0.07), y: p.y + u.y * 0.65 * into + n.y * (hw + 0.07), z: p.z + 0.9 });
          lamp.rotateY(yaw + Math.PI / 2).translate(at.x, at.y, at.z);
          (ok ? greenGeos : redGeos).push(lamp);
        }
      }
    }
    // Draw exactly the retained collision pieces: a cross-link opens both the visible
    // balustrade and its collider, including the handrail and escalator skirt.
    const runsById = new Map(layout.runs.map((r) => [r.edgeId, r]));
    for (const w of layout.runWalls) {
      const r = runsById.get(w.runEdgeId!)!;
      const d = { x: r.b.x - r.a.x, y: r.b.y - r.a.y };
      const l2 = d.x * d.x + d.y * d.y;
      const zAt = (p: XY) => r.a.z + (r.b.z - r.a.z) * ((p.x - r.a.x) * d.x + (p.y - r.a.y) * d.y) / l2;
      const za = zAt(w.a), zb = zAt(w.b);
      const panel = runPanel(w, r);
      if (r.mode === "stairs") {
        panel.profile!.bottomA = za + 0.15;
        panel.profile!.bottomB = zb + 0.15;
      }
      (r.mode === "stairs" ? sideGeos : balustradeGeos).push(enclosureWallGeometry(panel));
      const a = v3({ ...w.a, z: za + 0.96 }), b = v3({ ...w.b, z: zb + 0.96 });
      if (r.mode === "stairs") {
        handGeos.push(cylAlong(a, b, 0.026));
        // Dark side stringer and small stainless brackets stay on the retained side wall.
        nosingGeos.push(enclosureWallGeometry({ ...w, profile: { bottomA: za - 0.12, bottomB: zb - 0.12, topA: za + 0.15, topB: zb + 0.15 } }));
        const mid = a.clone().add(b).multiplyScalar(0.5);
        handGeos.push(cylAlong(mid.clone().add(new THREE.Vector3(0, -0.16, 0)), mid, 0.015, 6));
      } else {
        rubberGeos.push(boxAlong(a, b, 0.09, 0.07));
        steelGeos.push(enclosureWallGeometry({ ...w, profile: { bottomA: za - 0.12, bottomB: zb - 0.12, topA: za + 0.22, topB: zb + 0.22 } }));
        steelGeos.push(boxAlong(v3({ ...w.a, z: za + 0.88 }), v3({ ...w.b, z: zb + 0.88 }), 0.025, 0.025));
      }
    }
    const add = (geos: THREE.BufferGeometry[], m: THREE.Material, name?: string) => {
      const geo = merged(geos);
      if (!geo) return;
      const mesh = new THREE.Mesh(track(geo), m);
      if (name) mesh.name = name;
      root.add(mesh);
    };
    add(stairGeos, mat.stair, "walkable");
    add(nosingGeos, mat.nosing);
    add(sideGeos, mat.wall);
    add(balustradeGeos, mat.glass);
    add(handGeos, mat.steel);
    add(rubberGeos, mat.rubber);
    add(steelGeos, mat.steel);
    add(greenGeos, mat.gateOk);
    add(redGeos, mat.flap);
  }

  // ---- ticket gates (machines across the corridor; count/width is a visual simplification)
  {
    const bodyGeos: THREE.BufferGeometry[] = [];
    const topGeos: THREE.BufferGeometry[] = [];
    const icGeos: THREE.BufferGeometry[] = [];
    const okGeos: THREE.BufferGeometry[] = [];
    for (const gl of protection.gates) {
      const yaw = Math.atan2(gl.dir.y, gl.dir.x);
      for (const c of gateMachines(gl)) {
        const body = new THREE.BoxGeometry(1.5, 0.95, 0.2);
        body.rotateY(yaw);
        body.translate(c.x, gl.center.z + 0.475, -c.y);
        bodyGeos.push(body);
        const top = new THREE.BoxGeometry(1.52, 0.04, 0.22);
        top.rotateY(yaw);
        top.translate(c.x, gl.center.z + 0.97, -c.y);
        topGeos.push(top);
        for (const end of [-1, 1]) {
          const ic = new THREE.BoxGeometry(0.16, 0.012, 0.16);
          ic.rotateY(yaw);
          ic.translate(c.x + gl.dir.x * 0.55 * end, gl.center.z + 0.995, -(c.y + gl.dir.y * 0.55 * end));
          (end > 0 ? icGeos : okGeos).push(ic);
        }
        propWalls.push({ a: { x: c.x - gl.dir.x * 0.75, y: c.y - gl.dir.y * 0.75 }, b: { x: c.x + gl.dir.x * 0.75, y: c.y + gl.dir.y * 0.75 }, zMin: gl.center.z - 0.1, zMax: gl.center.z + 1.0, side: 1, kind: "wall", bodyMin: gl.center.z - 0.5 });
      }
    }
    for (const [geos, m] of [
      [bodyGeos, mat.gateBody],
      [topGeos, mat.gateTop],
      [icGeos, mat.gateIc],
      [okGeos, mat.gateOk],
    ] as const) {
      const geo = merged(geos);
      if (geo) root.add(new THREE.Mesh(track(geo), m));
    }
  }

  // ---- source fare borders and unverified procedural access fill
  {
    const steel: THREE.BufferGeometry[] = [], base: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [];
    // Joined fence runs hide the rail end faces. Keep the four visible sides;
    // short curved collision pieces do not need separate closed glass boxes.
    const rail = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) => {
      const geometry = boxAlong(a, b, w, h);
      geometry.setIndex(Array.from(geometry.index!.array).slice(0, 24));
      geometry.clearGroups();
      return geometry;
    };
    const postCells = new Map<string, THREE.Vector3[]>(), spacing = .45;
    const addPost = (p: THREE.Vector3) => {
      const x = Math.floor(p.x / spacing), y = Math.floor(p.z / spacing), z = Math.round(p.y * 100);
      for (let i = x - 1; i <= x + 1; i++) for (let j = y - 1; j <= y + 1; j++)
        if ((postCells.get(`${z},${i},${j}`) ?? []).some(q => q.distanceToSquared(p) < spacing * spacing)) return;
      const key = `${z},${x},${y}`, cell = postCells.get(key) ?? [];
      cell.push(p); postCells.set(key, cell);
      const post = new THREE.BoxGeometry(.044, 1.15, .044);
      post.translate(p.x, p.y + .575, p.z);
      steel.push(post);
    };
    for (const f of protection.fences) {
      const z = f.zMin + 0.05, a = v3({ ...f.a, z }), b = v3({ ...f.b, z });
      base.push(rail(a.clone().add(new THREE.Vector3(0, .08, 0)), b.clone().add(new THREE.Vector3(0, .08, 0)), .12, .16));
      panels.push(wallQuad(f.a, f.b, z + .15, z + 1.11));
      steel.push(rail(a.clone().add(new THREE.Vector3(0, 1.13, 0)), b.clone().add(new THREE.Vector3(0, 1.13, 0)), .045, .045));
      const count = Math.max(1, Math.ceil(a.distanceTo(b) / 1.4));
      for (let i = 0; i <= count; i++) addPost(a.clone().lerp(b, i / count));
      propWalls.push(f);
    }
    postCells.clear();
    for (const [geos, material] of [[steel, mat.steel], [base, mat.darkSteel], [panels, mat.glass]] as const) {
      const geo = merged(geos);
      if (geo) { const mesh = new THREE.Mesh(track(geo), material); mesh.name = "fare/access fence"; root.add(mesh); }
    }
    // Classify each closed side from source restrictions; generic fill makes no access claim.
    const signs = accessSigns(protection, plan);
    for (const classification of ["restricted", "closed"] as const) {
      const selected = signs.filter(s => s.classification === classification);
      if (!selected.length) continue;
      const wording = ACCESS_WORDING[classification];
      const tex = signTexture([{ icon: "none", ...wording, tone: "warn" }], 1024);
      track(tex.texture);
      const material = track(new THREE.MeshBasicMaterial({ map: tex.texture, side: THREE.FrontSide, transparent: true }));
      const signGeos: THREE.BufferGeometry[] = [];
      for (const { fence, z } of selected) {
        const width = Math.min(1.25, Math.hypot(fence.b.x - fence.a.x, fence.b.y - fence.a.y) - .05);
        const geo = new THREE.PlaneGeometry(width, width / tex.aspect);
        geo.translate(0, 0, .035);
        const mesh = new THREE.Mesh(geo, material);
        const mid = { x: (fence.a.x + fence.b.x) / 2, y: (fence.a.y + fence.b.y) / 2 };
        mesh.position.copy(v3({ ...mid, z: z + .82 }));
        mesh.lookAt(v3({ x: mid.x + fence.b.y - fence.a.y, y: mid.y - fence.b.x + fence.a.x, z: z + .82 }));
        mesh.updateMatrix();
        geo.applyMatrix4(mesh.matrix);
        signGeos.push(geo);
        const back = new THREE.PlaneGeometry(width, width / tex.aspect);
        back.rotateY(Math.PI);
        back.translate(0, 0, -.035);
        back.applyMatrix4(mesh.matrix);
        signGeos.push(back);
      }
      const geo = merged(signGeos);
      if (geo) { const mesh = new THREE.Mesh(track(geo), material); mesh.name = wording.en; root.add(mesh); }
    }
    // Keep closed-off generic fill visible behind its fence, without exporting walkable ground.
    const closedFloors = merged(protection.removedAccess.map(area => slabGeometry(area.rings, area.z, 2)));
    if (closedFloors) { const mesh = new THREE.Mesh(track(closedFloors), mat.floor); mesh.name = "unverified floor behind barrier (render only)"; root.add(mesh); }
  }

  // ---- coverage portals at dataset dead-ends (honest boundary)
  {
    const degree = new Map<string, number>();
    for (const e of bundle.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const portalTex = signTexture([{ icon: "nomap", ja: "この先 データ未収録", en: "Not mapped beyond this point", tone: "warn" }], 1024);
    track(portalTex.texture);
    const signMat = track(new THREE.MeshBasicMaterial({ map: portalTex.texture, side: THREE.DoubleSide, transparent: true }));
    for (const node of bundle.nodes) {
      if (degree.get(node.id) !== 1 || node.inOut !== "inside") continue;
      if (node.kind !== "junction" && node.kind !== "exit") continue;
      const e = bundle.edges.find((x) => x.from === node.id || x.to === node.id)!;
      const other = nodeById.get(e.from === node.id ? e.to : e.from)!;
      const d = { x: node.position.x - other.position.x, y: node.position.y - other.position.y };
      const L = Math.hypot(d.x, d.y) || 1;
      const u = { x: d.x / L, y: d.y / L };
      const z = layout.nodeZ.get(node.id) ?? 0;
      const c = { x: node.position.x + u.x * 1.2, y: node.position.y + u.y * 1.2 };
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(3.2, 2.6)), mat.portal);
      plane.position.copy(v3({ ...c, z: z + 1.3 }));
      plane.lookAt(v3({ x: c.x - u.x, y: c.y - u.y, z: z + 1.3 }));
      root.add(plane);
      const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(1.6, 1.6 / portalTex.aspect)), signMat);
      sign.position.copy(v3({ ...c, z: z + 2.0 }));
      sign.lookAt(v3({ x: c.x - u.x, y: c.y - u.y, z: z + 2.0 }));
      root.add(sign);
      propWalls.push({ a: { x: c.x + -u.y * 1.6, y: c.y + u.x * 1.6 }, b: { x: c.x - -u.y * 1.6, y: c.y - u.x * 1.6 }, zMin: z - 0.2, zMax: z + 2.6, side: 1, kind: "wall", bodyMin: z - 0.5 });
    }
  }

  // ---- street level around surface exits (minimal, non-authoritative)
  {
    const geos: THREE.BufferGeometry[] = [];
    for (const sp of layout.streetPads) {
      const c = sp.rings[0]!;
      const pad = new THREE.BoxGeometry(STREET_PAD, 0.2, STREET_PAD);
      pad.translate((c[0]!.x + c[2]!.x) / 2, sp.z - 0.1 - 0.01, -(c[0]!.y + c[2]!.y) / 2);
      geos.push(pad);
    }
    const geo = merged(geos);
    if (geo) {
      const m = new THREE.Mesh(track(geo), mat.sidewalk);
      m.name = "walkable";
      root.add(m);
    }
  }

  // ---- wayfinding signs from the verified graph
  const signs = buildSigns(bundle, layout, root, track);
  addWallBackFaces(root, mat.wall, track);
  bakeFloorLightPools(layout, root, [mat.floor, mat.floorPaid, mat.floorPlatform], track);
  // Batch names say what is inside. The steel batch is the stair handrails and brackets, escalator trusses and
  // skirts, fare/access fence rails and posts, lift-portal door finishes and level trim: ~50k triangles in all,
  // of which the portals are only ~650 (#72). The batch used to inherit the name "elevator-portal:finish".
  mergeRootFinishes(root, [[mat.steel, "static-steel-finishes"], [mat.glass, "static-glass-finishes"]], track, true);
  mergeRootFinishes(root, [[mat.darkSteel, "static-dark-steel-finishes"], [mat.gateOk, "static-gate-ok-finishes"], [mat.accent, "static-accent-finishes"]], track);
  installTightCulling(root);

  // ---- collision world
  const world = new WalkWorld(layout);
  world.addWalls(propWalls);

  // ---- platform edge helper
  function buildPlatformEdge(walls: WallSeg[], z: number, g: THREE.Group) {
    // Group trackside walls into platform edges by outward (track-facing) normal.
    type Grp = { out: XY; walls: WallSeg[]; len: number };
    const groups: Grp[] = [];
    for (const w of walls) {
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < 0.3) continue;
      const out = { x: ((w.b.y - w.a.y) / L) * w.side, y: (-(w.b.x - w.a.x) / L) * w.side };
      const grp = groups.find((q) => q.out.x * out.x + q.out.y * out.y > 0.7);
      if (grp) (grp.walls.push(w), (grp.len += L));
      else groups.push({ out, walls: [w], len: L });
    }
    const EXT = 200;
    groups
      .filter((grp) => grp.len > 20)
      .forEach((grp, gi) => {
        // The platform edge is curved: follow it with a smoothed polyline instead of a straight fit.
        const u0 = { x: -grp.out.y, y: grp.out.x };
        const o = grp.walls[0]!.a;
        const pts = grp.walls
          .flatMap((w) => [w.a, w.b])
          .map((p) => ({ p, s: (p.x - o.x) * u0.x + (p.y - o.y) * u0.y }))
          .sort((a, b) => a.s - b.s);
        const s0 = pts[0]!.s;
        const s1 = pts[pts.length - 1]!.s;
        const edge: XY[] = [];
        for (let si = s0; ; si += 4) {
          const ss = Math.min(si, s1);
          let ax = 0;
          let ay = 0;
          let n = 0;
          for (const q of pts)
            if (Math.abs(q.s - ss) < 3) (ax += q.p.x), (ay += q.p.y), n++;
          if (n) edge.push({ x: ax / n, y: ay / n });
          if (ss >= s1) break;
        }
        if (edge.length < 2) return;
        const dirAt = (a: XY, b: XY) => {
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
        };
        const t0 = dirAt(edge[0]!, edge[1]!);
        const tn = dirAt(edge[edge.length - 2]!, edge[edge.length - 1]!);
        const line = [{ x: edge[0]!.x - t0.x * EXT, y: edge[0]!.y - t0.y * EXT }, ...edge, { x: edge[edge.length - 1]!.x + tn.x * EXT, y: edge[edge.length - 1]!.y + tn.y * EXT }];
        const cum = [0];
        for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y));
        const total = cum[cum.length - 1]!;
        const platA = cum[1]!;
        const platB = cum[cum.length - 2]!;
        const sgn = (() => {
          const t = dirAt(line[0]!, line[1]!);
          return t.y * grp.out.x - t.x * grp.out.y > 0 ? 1 : -1;
        })();
        /** tangent at arc-length s (extrapolates beyond the ends) */
        const tangentAt = (s: number): XY => {
          let i = 1;
          while (i < line.length - 1 && cum[i]! < s) i++;
          return dirAt(line[i - 1]!, line[i]!);
        };
        /** point at arc-length s, offset `off` metres toward the track */
        const at = (s: number, off: number): XY => {
          let i = 1;
          while (i < line.length - 1 && cum[i]! < s) i++;
          const a = line[i - 1]!;
          const t = dirAt(a, line[i]!);
          const d = s - cum[i - 1]!;
          return { x: a.x + t.x * d + t.y * sgn * off, y: a.y + t.y * d - t.x * sgn * off };
        };
        const add = (geo: THREE.BufferGeometry | null, m: THREE.Material) => {
          if (!geo) return;
          g.add(new THREE.Mesh(track(geo), m));
        };
        const trackOff = 1.6;
        const bed: THREE.BufferGeometry[] = [];
        const rails: THREE.BufferGeometry[] = [];
        const tunnel: THREE.BufferGeometry[] = [];
        const lamps: THREE.BufferGeometry[] = [];
        const P = (xy: XY, zz: number) => v3({ ...xy, z: zz });
        for (let i = 1; i < line.length; i++) {
          const sa = cum[i - 1]!;
          const sb = cum[i]!;
          // overlap slightly so segment joints at kinks stay closed
          const ea = Math.max(0, sa - 0.15);
          const eb = Math.min(total, sb + 0.15);
          bed.push(boxAlong(P(at(ea, trackOff), z - 1.2), P(at(eb, trackOff), z - 1.2), 3.4, 0.1));
          for (const off of [trackOff - 0.72, trackOff + 0.72]) rails.push(boxAlong(P(at(ea, off), z - 1.08), P(at(eb, off), z - 1.08), 0.07, 0.14));
          // linear-motor reaction plate between the rails (small-profile linear-motor metro)
          rails.push(boxAlong(P(at(ea, trackOff), z - 1.11), P(at(eb, trackOff), z - 1.11), 0.32, 0.03));
          tunnel.push(wallQuad(at(sa, trackOff + 1.75), at(sb, trackOff + 1.75), z - 1.25, z + 3.9));
          tunnel.push(slabGeometry([[at(sa, 0), at(sb, 0), at(sb, trackOff + 1.8), at(sa, trackOff + 1.8)]], z + 3.9, 4, true));
          // beyond the platform the near side is tunnel wall too
          if (i === 1 || i === line.length - 1) tunnel.push(wallQuad(at(sa, 0.02), at(sb, 0.02), z - 1.25, z + 3.9));
        }
        for (let s = 0; s < total; s += 0.9) bed.push(boxAlong(P(at(s, trackOff - 1.1), z - 1.13), P(at(s, trackOff + 1.1), z - 1.13), 0.22, 0.05));
        for (let s = 6; s < total; s += 12) {
          if (s > platA - 2 && s < platB + 2) continue;
          const p = at(s, trackOff + 1.7);
          const b = new THREE.BoxGeometry(0.3, 0.12, 0.1);
          b.translate(p.x, z + 2.6, -p.y);
          lamps.push(b);
        }
        add(merged(bed), mat.trackBed);
        add(merged(rails), mat.rail);
        add(merged(tunnel), mat.tunnel);
        add(merged(lamps), mat.light);

        // Platform screen doors: 5.6 m modules (fixed panel + bi-parting leaves). Generic simplified design.
        const panels: THREE.BufferGeometry[] = [];
        const caps: THREE.BufferGeometry[] = [];
        const leaves: { s: number; dir: number }[] = [];
        const module = 5.6;
        const doorW = 2.4;
        for (let s = platA + 0.3; s + module <= platB + 0.01; s += module) {
          const p1 = s + module - doorW;
          panels.push(boxAlong(P(at(s, 0.06), z + 0.65), P(at(p1, 0.06), z + 0.65), 0.16, 1.3));
          caps.push(boxAlong(P(at(s, 0.06), z + 1.31), P(at(p1, 0.06), z + 1.31), 0.2, 0.04));
          leaves.push({ s: p1 + doorW * 0.25, dir: -1 }, { s: p1 + doorW * 0.75, dir: 1 });
          propWalls.push({ a: at(s, 0.02), b: at(s + module, 0.02), zMin: z - 0.1, zMax: z + 1.35, side: 1, kind: "wall", bodyMin: z - 0.5 });
        }
        add(merged(panels), mat.psd);
        add(merged(caps), mat.accent);
        const leafMesh = new THREE.InstancedMesh(track(new THREE.BoxGeometry(doorW / 2 - 0.04, 1.2, 0.06)), mat.psdLeaf, Math.max(1, leaves.length));
        leafMesh.count = leaves.length;
        g.add(leafMesh);

        // Train: 8 small-profile cars (generic original design; line-colour accent only).
        const cars = buildTrain(8);
        for (const c of cars) g.add(c);
        platformTracks.push({ at, tangentAt, z, trackOff, stopS: (platA + platB) / 2, dirSign: gi % 2 === 0 ? 1 : -1, cars, leafMesh, leaves, phase: gi * 55, far: EXT + 60 });
      });
  }

  function buildTrain(n: number) {
    const train: THREE.Group[] = [];
    const carLen = 16.3;
    const shape = new THREE.Shape();
    const w = 2.48;
    const h = 3.05;
    const r = 0.45;
    shape.moveTo(-w / 2, 0.25);
    shape.lineTo(w / 2, 0.25);
    shape.lineTo(w / 2, h - r);
    shape.quadraticCurveTo(w / 2, h, w / 2 - r, h);
    shape.lineTo(-w / 2 + r, h);
    shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
    shape.closePath();
    const body = track(new THREE.ExtrudeGeometry(shape, { depth: carLen, bevelEnabled: false, curveSegments: 6 }));
    body.translate(0, 0, -carLen / 2);
    const windowBand = track(new THREE.BoxGeometry(w + 0.02, 0.85, carLen - 1.2));
    windowBand.translate(0, 1.75, 0);
    const stripe = track(new THREE.BoxGeometry(w + 0.03, 0.12, carLen - 0.4));
    stripe.translate(0, 1.18, 0);
    const doorGeo = track(merged([-5.2, 0, 5.2].map((z) => new THREE.BoxGeometry(w + 0.025, 1.85, 1.3).translate(0, 1.18, z)))!);
    const skirt = track(new THREE.BoxGeometry(w - 0.1, 0.45, carLen - 0.6));
    skirt.translate(0, 0.2, 0);
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      car.visible = false;
      train.push(car);
    }
    // Cars retain their independent curved-track transforms; repeated finishes share draws.
    const trainFrustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
    const carBounds = new THREE.Sphere(new THREE.Vector3(), 8.6);
    const meshes = [[body, mat.trainBody], [windowBand, mat.trainWindow], [stripe, mat.accent], [skirt, mat.darkSteel], [doorGeo, mat.trainDoor]].map(([geo, material]) => {
      const mesh = new THREE.InstancedMesh(geo as THREE.BufferGeometry, material as THREE.Material, n);
      mesh.name = "train-cars:instanced-finish";
      mesh.visible = false;
      // A whole eight-car bounding sphere can intersect an upstairs camera even when
      // all cars lie outside it. Cull that empty batch in both colour and GTAO passes.
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        trainFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        carBounds.radius = 8.6 * root.matrixWorld.getMaxScaleOnAxis();
        mesh.count = train.some((car) => {
          carBounds.center.copy(car.position).y += 1.6;
          carBounds.center.applyMatrix4(root.matrixWorld);
          return trainFrustum.intersectsSphere(carBounds);
        }) ? n : 0;
      };
      root.add(mesh);
      return mesh;
    });
    trainBatches.push({ cars: train, meshes });
    return train;
  }
  // ---- animation
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const tmpP = new THREE.Vector3();
  const tmpE = new THREE.Euler();
  /** Train cycle (s): 0–14 arrive (decelerate), 14–40 dwell (doors 16–37), 40–54 depart, 54–110 empty. */
  const CYCLE = 110;
  let trainClock = 0;
  /** QA: phase of each platform's train cycle (s) and whether a train is in. */
  const trainStatus = () => platformTracks.map((tr) => {
    const tt = (trainClock + tr.phase) % CYCLE;
    return { tt: Math.round(tt), present: trainS(tt, tr) !== null, doorsOpen: tt > 16 && tt < 37 };
  });
  function trainS(tt: number, tr: (typeof platformTracks)[number]) {
    if (tt < 14) return tr.stopS - tr.dirSign * tr.far * (1 - tt / 14) ** 2; // decelerate in
    if (tt < 40) return tr.stopS;
    if (tt < 54) return tr.stopS + tr.dirSign * tr.far * ((tt - 40) / 14) ** 2; // accelerate out
    return null;
  }
  function update(_dt: number, t: number) {
    trainClock = t;
    for (const tr of platformTracks) {
      const tt = (t + tr.phase) % CYCLE;
      const s = trainS(tt, tr);
      const n = tr.cars.length;
      tr.cars.forEach((car, i) => {
        car.visible = s !== null;
        if (s === null) return;
        const sc = s + (i - (n - 1) / 2) * 16.6;
        const p = tr.at(sc, tr.trackOff);
        const tg = tr.tangentAt(sc);
        car.position.set(p.x, tr.z - 1.1, -p.y);
        car.rotation.y = Math.atan2(tg.x, -tg.y);
      });
      const open = tt > 16 && tt < 37 ? Math.min(1, (tt - 16) / 2, (37 - tt) / 2) : 0;
      tr.leaves.forEach((lf, i) => {
        const ls = lf.s + lf.dir * open * 1.1;
        const p = tr.at(ls, 0.17);
        const tg = tr.tangentAt(ls);
        tmpP.set(p.x, tr.z + 0.62, -p.y);
        tmpQ.setFromEuler(tmpE.set(0, Math.atan2(tg.y, tg.x), 0));
        tmpM.compose(tmpP, tmpQ, tmpS);
        tr.leafMesh.setMatrixAt(i, tmpM);
      });
      tr.leafMesh.instanceMatrix.needsUpdate = true;
    }
    for (const { cars, meshes } of trainBatches) {
      for (const mesh of meshes) {
        mesh.visible = cars[0]!.visible;
        if (!mesh.visible) continue;
        mesh.count = cars.length;
        for (const [i, car] of cars.entries()) {
          car.updateMatrix();
          mesh.setMatrixAt(i, car.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
    for (const esc of escalators) {
      const { lo, hi, yaw, count, L3, stepLen } = esc.steps.userData as { lo: XYZ; hi: XYZ; yaw: number; count: number; L3: number; stepLen: number };
      const pitch = Math.atan2(hi.z - lo.z, Math.hypot(hi.x - lo.x, hi.y - lo.y));
      tmpQ.setFromEuler(new THREE.Euler(0, yaw, pitch, "YXZ"));
      const phase = (((t * esc.speed) % stepLen) + stepLen) % stepLen;
      for (let i = 0; i < count; i++) {
        let s = i * stepLen + phase;
        if (s > L3) s -= L3;
        const f = s / L3;
        tmpP.set(lo.x + (hi.x - lo.x) * f, lo.z + (hi.z - lo.z) * f - 0.03, -(lo.y + (hi.y - lo.y) * f));
        tmpM.compose(tmpP, tmpQ, tmpS);
        esc.steps.setMatrixAt(i, tmpM);
      }
      esc.steps.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0);

  // W2 surface hook: context adds obstacles only; existing pads remain the walk limit.
  // The street layer and its walls ask for the same polygon derivations; compute each once (see surface-layout.ts).
  const seed = opts.useBakedSurface === false ? null : surfaceSeed(bakedSurface, surfaceJson as SurfaceData, layout, bundle, plan);
  const { surface, surfaceBarriers } = withSurfaceMemo(() => ({
    surface: buildSurface(surfaceJson as SurfaceData, layout, { ...opts, bundle }),
    surfaceBarriers: surfaceWalls(layout, bundle, surfaceJson as SurfaceData),
  }), seed);
  surface.root.userData.bakedSurface = seed !== null; // observable by tests: was the baked table used?
  root.add(surface.root);
  propWalls.push(...surfaceBarriers);
  world.addWalls(surfaceBarriers);
  trimSurfaceCeilingFixtures(root, [mat.light, mat.lightHousing]); // remove only floating street ceiling strips
  for (const child of root.children) if (child instanceof THREE.Mesh && child.material === mat.sidewalk) child.visible = false; // replace uncut legacy pad boxes
  for (const lv of layout.levels.filter((l) => Math.abs(l.z) < 0.1)) for (const child of levelGroups.get(lv.floorId)?.children ?? []) if (child instanceof THREE.Mesh && (child.name === "walkable" || child.material === mat.ceiling)) child.visible = false; // cut street ground and original canopies replace generic top-level caps
  track(surface);
  disposeRetiredGeometries(root, disposables);

  const built: BuiltStation = {
    root,
    layout,
    world,
    propWalls,
    escalators,
    signs,
    levelGroups,
    update(dt, t) { update(dt, t); surface.update(dt, t); },
    setViewer: surface.setViewer,
    trainStatus,
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose(); // frees instance buffers
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    },
  };
  // The closures above (update, dispose, onBeforeRender hooks) share this function's scope for as long as
  // the scene lives, and they never read the layout or the fare protection again. Without this, a running
  // scene kept ~9 MB of build-time polygons reachable through them (#72). `built.layout` still holds it
  // for callers that want it (the lane app, tests); the shared explorer's scene drops `built`.
  layout = undefined as never;
  protection = undefined as never;
  return built;
}

/** Merge static trim; instanced train finishes, gate leaves and fixtures stay independent. */
function mergeRootFinishes(root: THREE.Group, materials: [THREE.Material, string][], track: <T extends { dispose(): void }>(x: T) => T, includeLevelTrim = false) {
  root.updateMatrixWorld(true);
  for (const [material, name] of materials) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.material === material &&
        (includeLevelTrim || o.parent === root)) meshes.push(o);
    });
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
    const mesh = new THREE.Mesh(track(merged(geos)!), material);
    const portal = meshes.find((m) => m.name === "elevator-portal:finish");
    mesh.name = name;
    if (portal) mesh.userData = portal.userData; // the lift portals' metadata rides on the batch that holds them
    for (const m of meshes) m.removeFromParent();
    root.add(mesh);
  }
}

/**
 * Original lift door finishes mounted on existing full-height collision walls. Nearby source
 * nodes can describe opposite ends of the same lift landing, so they share a portal. This is
 * a visual affordance for the existing interaction, not a claim about measured equipment.
 */
function buildElevatorPortals(
  bundle: StationBundle, layout: Layout, root: THREE.Group,
  mat: { wall: THREE.Material; steel: THREE.Material; darkSteel: THREE.Material; gateOk: THREE.Material; accent: THREE.Material },
  track: <T extends { dispose(): void }>(x: T) => T,
) {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const portals: { nodeIds: string[]; center: XYZ; a: XY; b: XY }[] = [];
  const nodes = bundle.nodes.filter((n) => n.kind === "elevator" && (layout.nodeZ.get(n.id) ?? 0) < -0.5);
  const groups: (typeof nodes)[] = [];
  for (const n of nodes) {
    const z = layout.nodeZ.get(n.id)!;
    const group = groups.find(([a]) => Math.abs(layout.nodeZ.get(a!.id)! - z) < 0.1 && Math.hypot(a!.position.x - n.position.x, a!.position.y - n.position.y) < 1.9);
    if (group) group.push(n); else groups.push([n]);
  }
  for (const group of groups) {
    const z = layout.nodeZ.get(group[0]!.id)!;
    const cabNode = group.find((n) => bundle.edges.filter((e) => e.from === n.id || e.to === n.id).every((e) => e.mode === "elevator"));
    const c = cabNode?.position ?? { x: group.reduce((s, n) => s + n.position.x, 0) / group.length, y: group.reduce((s, n) => s + n.position.y, 0) / group.length };
    const lv = layout.levels.reduce((a, b) => Math.abs(a.z - z) < Math.abs(b.z - z) ? a : b);
    // Prefer the wall beyond an approaching walk edge. Lift-only source nodes have no
    // walk direction; north is a stable decorative orientation, never route information.
    let approach: XY = { x: 0, y: 1 };
    const hasCabNode = !!cabNode;
    const incident = hasCabNode ? undefined : bundle.edges.find((e) => e.mode !== "elevator" && group.some((n) => n.id === e.from || n.id === e.to));
    if (incident) {
      const other = bundle.nodes.find((n) => n.id === (group.some((n) => n.id === incident.from) ? incident.to : incident.from))!;
      const d = { x: c.x - other.position.x, y: c.y - other.position.y }, length = Math.hypot(d.x, d.y);
      if (length > 0.1) approach = { x: d.x / length, y: d.y / length };
    }
    const candidates = lv.walls.flatMap((w) => {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, length = Math.hypot(dx, dy);
      if (w.finish === "fascia" || w.zMin > z + 0.02 || w.zMax < z + 2.5 || length < 1.95) return [];
      const t = Math.max(0.98 / length, Math.min(1 - 0.98 / length, ((c.x - w.a.x) * dx + (c.y - w.a.y) * dy) / (length * length)));
      const p = { x: w.a.x + dx * t, y: w.a.y + dy * t };
      const distance = Math.hypot(p.x - c.x, p.y - c.y);
      if (distance > 5.5 || distance < 0.4) return [];
      const toward = ((p.x - c.x) * approach.x + (p.y - c.y) * approach.y) / distance;
      return [{ w, p, distance, score: distance + (1 - toward) * 2.3, u: { x: dx / length, y: dy / length } }];
    }).sort((a, b) => a.score - b.score);
    let selected = candidates[0];
    // A cab-only node sits inside a tiny CAD equipment footprint. Give that generic lift
    // surround a legible front wall in the added landing sleeve, if all graph sweeps allow it.
    // The same wall is inserted in layout, so the lane and shared explorer both collide with it.
    if (hasCabNode) {
      const u = { x: -approach.y, y: approach.x };
      const p = { x: c.x + approach.x * 2.65 + u.x * 0.65, y: c.y + approach.y * 2.65 + u.y * 0.65 };
      const w: WallSeg = { a: { x: p.x - u.x * 1.03, y: p.y - u.y * 1.03 }, b: { x: p.x + u.x * 1.03, y: p.y + u.y * 1.03 }, zMin: z - 0.05, zMax: lv.ceilingZ, kind: "elevator", side: 1 };
      const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
      const blocked = bundle.edges.some((e) => {
        const a = nodeById.get(e.from)!, b = nodeById.get(e.to)!;
        const za = layout.nodeZ.get(a.id)!, zb = layout.nodeZ.get(b.id)!;
        const points = e.geometry?.length ? e.geometry : [a.position, b.position];
        const lengths = points.slice(1).map((q, i) => Math.hypot(q.x - points[i]!.x, q.y - points[i]!.y));
        const total = lengths.reduce((s, v) => s + v, 0);
        let acc = 0;
        return points.slice(1).some((q, i) => {
          const a = points[i]!, length = lengths[i]!, count = Math.max(1, Math.ceil(Math.hypot(length, zb - za) / 0.2));
          const start = acc; acc += length;
          for (let k = 0; k <= count; k++) {
            const t = k / count, height = za + (zb - za) * (total ? (start + length * t) / total : t);
            if (height + 1.8 < w.zMin || height + 0.2 > w.zMax) continue;
            const x = a.x + (q.x - a.x) * t, y = a.y + (q.y - a.y) * t;
            const along = Math.max(-1.03, Math.min(1.03, (x - p.x) * u.x + (y - p.y) * u.y));
            if (Math.hypot(x - p.x - u.x * along, y - p.y - u.y * along) < 0.65) return true;
          }
          return false;
        });
      });
      const onLanding = [w.a, p, w.b].every((q) => [...lv.slabs, ...layout.pads].some((s) => Math.abs(s.z - z) < 0.1 && pointInRings(q, s.rings)));
      if (!blocked && onLanding && w.zMax >= z + 2.6) {
        lv.walls.push(w);
        const group = root.children.find((g) => g.name === `level-${lv.label}`)!;
        const target = group.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.material === mat.wall);
        const geo = wallQuad(w.a, w.b, w.zMin, w.zMax);
        if (target) target.geometry = track(merged([target.geometry.clone(), geo])!);
        else group.add(new THREE.Mesh(track(geo), mat.wall));
        selected = { w, p, u, score: 0, distance: 2.65 };
      }
    }
    if (!selected) continue;
    const { w, p, u } = selected;
    const sign = (c.x - p.x) * -u.y + (c.y - p.y) * u.x > 0 ? 1 : -1;
    const normal = { x: -u.y * sign, y: u.x * sign };
    const yaw = Math.atan2(u.y, u.x);
    const box = (x: number, height: number, width: number, h: number, depth: number, m: THREE.Material, inset = 0.025) => {
      const g = new THREE.BoxGeometry(width, h, depth).rotateY(yaw);
      g.translate(p.x + u.x * x + normal.x * inset, z + height, -(p.y + u.y * x + normal.y * inset));
      const list = buckets.get(m) ?? [];
      list.push(g);
      buckets.set(m, list);
    };
    // Recess, paired door leaves, narrow joints, brushed surround, sill and call plate.
    box(0, 1.14, 1.52, 2.28, 0.025, mat.darkSteel, 0.014);
    for (const s of [-1, 1]) {
      box(s * 0.355, 1.09, 0.694, 2.14, 0.018, mat.steel);
      box(s * 0.775, 1.14, 0.09, 2.28, 0.035, mat.steel);
      box(s * 0.68, 1.1, 0.009, 2.1, 0.02, mat.darkSteel, 0.039);
    }
    box(0, 2.3, 1.64, 0.1, 0.04, mat.steel);
    box(0, 0.025, 1.62, 0.05, 0.055, mat.darkSteel);
    box(0.91, 1.08, 0.13, 0.34, 0.035, mat.steel);
    box(0.91, 1.13, 0.055, 0.055, 0.045, mat.darkSteel);
    box(0.91, 1.03, 0.045, 0.045, 0.05, mat.gateOk);
    box(0, 2.43, 0.4, 0.12, 0.035, mat.darkSteel);
    // Abstract two-bar status indicator: no invented floor number/direction/status claim.
    for (const x of [-0.045, 0.045]) box(x, 2.43, 0.022, 0.05, 0.045, mat.gateOk);
    box(0, 2.58, 1.64, 0.045, 0.025, mat.accent);
    portals.push({ nodeIds: group.map((n) => n.id), center: { ...p, z }, a: w.a, b: w.b });
  }
  for (const [material, geos] of buckets) {
    const mesh = new THREE.Mesh(track(merged(geos)!), material);
    mesh.name = "elevator-portal:finish";
    mesh.userData.portals = portals;
    root.add(mesh);
  }
}

/**
 * A small procedural occlusion atlas gives the existing ambient/IBL light a fixture-shaped
 * falloff. It changes no topology, adds no passes or lights, and preserves the floor maps.
 */
function bakeFloorLightPools(
  layout: Layout, root: THREE.Group, materials: THREE.MeshStandardMaterial[],
  track: <T extends { dispose(): void }>(x: T) => T,
) {
  const levels = layout.levels;
  const cell = 512, cols = 3, rows = Math.ceil(levels.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!;
  const { min, max } = layout.bounds;
  const dx = max.x - min.x + 8, dy = max.y - min.y + 8;
  const uv = (p: XY) => ({ x: (p.x - min.x + 4) / dx, y: (p.y - min.y + 4) / dy });
  const pools: XYZ[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith("linear-light:")) return;
    pools.push(...o.userData.floorPools);
  });
  for (const [i, lv] of levels.entries()) {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, cell, cell); ctx.clip();
    ctx.fillStyle = lv.z >= -0.5 ? "#ffffff" : "#696969";
    ctx.fillRect(ox, oy, cell, cell);
    for (const p of [...pools, ...layout.gates.map((g) => g.center)]) {
      if (Math.abs(p.z - lv.z) > 2.4) continue;
      const point = uv(p);
      // Metric ellipse compensates for the atlas aspect ratio. Soft pools overlap along
      // linear fixture runs, with a deliberately darker passage between their ends.
      ctx.save();
      ctx.translate(ox + point.x * cell, oy + (1 - point.y) * cell);
      ctx.scale(cell / dx, cell / dy);
      const gradient = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 3.6);
      gradient.addColorStop(0, "rgba(255,255,255,0.92)");
      gradient.addColorStop(0.35, "rgba(245,245,245,0.7)");
      gradient.addColorStop(1, "rgba(225,225,225,0)");
      ctx.fillStyle = gradient; ctx.fillRect(-3.6, -3.6, 7.2, 7.2); ctx.restore();
    }
    ctx.restore();
  }
  const atlas = track(new THREE.CanvasTexture(canvas));
  atlas.channel = 1; atlas.anisotropy = 4;
  for (const m of materials) { m.aoMap = atlas; m.aoMapIntensity = 1; }
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !materials.includes(o.material as THREE.MeshStandardMaterial)) return;
    const p = o.geometry.attributes.position!;
    const coords = new Float32Array(p.count * 2);
    for (let j = 0; j < p.count; j++) {
      const z = p.getY(j);
      let i = 0;
      for (let k = 1; k < levels.length; k++) if (Math.abs(levels[k]!.z - z) < Math.abs(levels[i]!.z - z)) i = k;
      const point = uv({ x: p.getX(j), y: -p.getZ(j) });
      coords[j * 2] = ((i % cols) + Math.max(0.002, Math.min(0.998, point.x))) / cols;
      coords[j * 2 + 1] = (rows - 1 - Math.floor(i / cols) + Math.max(0.002, Math.min(0.998, point.y))) / rows;
    }
    o.geometry.setAttribute("uv1", new THREE.BufferAttribute(coords, 2));
  });
}

/** Instanced linear luminaires follow both the corridor axes and the roof pitch of each run. */
function buildUndergroundLighting(
  bundle: StationBundle,
  layout: Layout,
  groups: Map<string, THREE.Group>,
  root: THREE.Group,
  track: <T extends { dispose(): void }>(x: T) => T,
) {
  type Fixture = { a: XYZ; b: XYZ; ground: XYZ };
  const batches = new Map<string, Fixture[]>();
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const roofs = [...layout.levels.flatMap((lv) => lv.ceilings.map((s) => ({ ...s, floorId: lv.floorId }))), ...layout.soffits];
  const ceilingAt = (p: XYZ) => {
    let best: { z: number; floorId: string } | null = null;
    for (const s of roofs) {
      const z = soffitHeight(s, p);
      if (z < p.z + 2.5 || z > p.z + 5.2 || (best && best.z <= z) || !pointInRings(p, s.rings)) continue;
      best = { z, floorId: s.floorId };
    }
    return best;
  };
  const seen = new Set<string>();
  for (const e of bundle.edges) {
    if (e.mode === "elevator") continue;
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    const za = layout.nodeZ.get(a.id) ?? 0, zb = layout.nodeZ.get(b.id) ?? 0;
    if (Math.min(za, zb) >= -0.5) continue;
    const length = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    const count = Math.floor(length / 3.2);
    for (let i = 0; i < count; i++) {
      const t0 = (i + 0.18) / count, t1 = (i + 0.82) / count;
      const at = (t: number): XYZ => ({ x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t, z: za + (zb - za) * t });
      const p = at(t0), q = at(t1), m = at((t0 + t1) / 2);
      const rp = ceilingAt(p), rq = ceilingAt(q), rm = ceilingAt(m);
      if (!rp || !rq || !rm || Math.abs(rm.z - (rp.z + rq.z) / 2) > 0.15) continue;
      // Undirected duplicate links must not double the fixtures.
      const key = `${m.x.toFixed(1)},${m.y.toFixed(1)},${rm.z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fixtures = batches.get(rm.floorId) ?? [];
      fixtures.push({ a: { ...p, z: rp.z - 0.065 }, b: { ...q, z: rq.z - 0.065 }, ground: m });
      batches.set(rm.floorId, fixtures);
    }
  }
  const fixtures = [...batches].flatMap(([floorId, entries]) => {
    const lv = layout.levels.find((l) => l.floorId === floorId)!;
    const color = new THREE.Color(lv.label === "B1" || lv.label === "B5" ? "#fff0d3" : "#e7f4ff").multiplyScalar(1.05);
    return entries.map((entry) => ({ ...entry, color }));
  });
  if (fixtures.length) {
    const strip = new THREE.BoxGeometry(0.16, 0.035, 1);
    const casing = new THREE.BoxGeometry(0.25, 0.045, 1.04).translate(0, 0.035, 0);
    for (const [geo, color] of [[strip, new THREE.Color("#ffffff")], [casing, new THREE.Color("#454b48")]] as const) {
      const colors = new Float32Array(geo.attributes.position!.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    // One repeatable luminaire (recessed painted casing + HDR diffuser), one draw. Both
    // vertex colour and instance colour survive so levels keep their warm/cool variation.
    const box = track(mergeGeometries([strip, casing], false)!);
    strip.dispose();
    casing.dispose();
    const material = track(new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true }));
    const strips = new THREE.InstancedMesh(box, material, fixtures.length);
    strips.name = "linear-light:underground";
    strips.userData.floorPools = fixtures.map((f) => f.ground);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), center = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const [i, f] of fixtures.entries()) {
      const a = v3(f.a), b = v3(f.b), d = b.clone().sub(a);
      rotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
      center.copy(a).add(b).multiplyScalar(0.5);
      scale.set(1, 1, d.length());
      matrix.compose(center, rotation, scale);
      strips.setMatrixAt(i, matrix);
      strips.setColorAt(i, f.color);
    }
    strips.computeBoundingSphere();
    root.add(strips);
  }

  // Bounded, non-shadowing local fill: three gate clusters plus one head/hall anchor per
  // underground level. Most of the perceived illumination remains emissive fixtures + IBL.
  const anchors: XYZ[] = [];
  for (const g of layout.gates) {
    if (g.center.z >= -0.5 || anchors.some((p) => Math.abs(p.z - g.center.z) < 1 && Math.hypot(p.x - g.center.x, p.y - g.center.y) < 12)) continue;
    anchors.push(g.center);
  }
  for (const lv of layout.levels.filter((l) => l.z < -0.5)) {
    const candidates = bundle.nodes.filter((n) => n.floorId === lv.floorId && n.inOut === "inside" && n.kind !== "elevator" && Math.abs((layout.nodeZ.get(n.id) ?? 0) - lv.z) < 0.1);
    const junctions = candidates.filter((n) => bundle.edges.filter((e) => e.from === n.id || e.to === n.id).length >= 3);
    const sameLevel = anchors.filter((p) => Math.abs(p.z - lv.z) < 0.3);
    const score = (n: (typeof candidates)[number]) => sameLevel.length ? Math.min(...sameLevel.map((p) => Math.hypot(p.x - n.position.x, p.y - n.position.y))) : 0;
    const n = (junctions.length ? junctions : candidates).sort((a, b) => score(b) - score(a))[0];
    if (n) anchors.push({ ...n.position, z: lv.z });
  }
  for (const p of anchors.slice(0, 8)) {
    const roof = ceilingAt(p);
    if (!roof) continue;
    const lv = layout.levels.find((l) => l.floorId === roof.floorId)!;
    const light = new THREE.PointLight(lv.label === "B1" || lv.label === "B5" ? "#fff0dc" : "#e0efff", 3.5, 12, 2);
    light.position.copy(v3({ ...p, z: roof.z - 0.22 }));
    light.castShadow = false;
    groups.get(lv.floorId)!.add(light);
    track(light);
  }
}

/** Distance along ray (origin o, unit dir d) to segment ab, or null. */
function raySeg(o: XY, d: XY, a: XY, b: XY): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const s = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return t > 0.05 && s >= 0 && s <= 1 ? t : null;
}

// ---------------------------------------------------------------- signs
function buildSigns(bundle: StationBundle, layout: Layout, root: THREE.Group, track: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D[] {
  const router = createRouter(bundle);
  const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of bundle.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const exits = bundle.pois.filter((p) => p.category === "exit").flatMap((p) => p.connectorNodeIds);
  const platform = bundle.pois.find((p) => p.category === "platform")?.connectorNodeIds ?? [];
  const gates = bundle.pois.filter((p) => p.category === "ticket_gate").flatMap((p) => p.connectorNodeIds);
  const elevs = bundle.edges.filter((e) => e.mode === "elevator").flatMap((e) => [e.from, e.to]);

  const out: THREE.Object3D[] = [];
  const caseGeos: THREE.BufferGeometry[] = [], rodGeos: THREE.BufferGeometry[] = [];
  const placed: XYZ[] = [];
  type FaceDraft = { floorId: string; center: XYZ; facing: XY; lines: Parameters<typeof signTexture>[0] };
  const faceDrafts: FaceDraft[] = [];
  const candidates = bundle.nodes.filter((n) => (adj.get(n.id)?.length ?? 0) >= 3 && n.inOut === "inside" && n.kind !== "elevator");
  // prefer nodes with more connections
  candidates.sort((a, b) => (adj.get(b.id)!.length - adj.get(a.id)!.length) || a.id.localeCompare(b.id));
  for (const n of candidates) {
    const z = layout.nodeZ.get(n.id) ?? 0;
    const lv = layout.levels.find((l) => Math.abs(l.z - z) < 0.3);
    if (!lv) continue;
    if (placed.some((p) => Math.abs(p.z - z) < 1 && Math.hypot(p.x - n.position.x, p.y - n.position.y) < 14)) continue;
    // main corridor axis = longest incident walk edge
    const inc = bundle.edges.filter((e) => (e.from === n.id || e.to === n.id) && (e.mode === "walk" || e.mode === "gate"));
    if (!inc.length) continue;
    let axis = { x: 1, y: 0 };
    let best = -1;
    for (const e of inc) {
      const o = nodeById.get(e.from === n.id ? e.to : e.from)!.position;
      const L = Math.hypot(o.x - n.position.x, o.y - n.position.y);
      if (L > best) (best = L), (axis = { x: (o.x - n.position.x) / L, y: (o.y - n.position.y) / L });
    }
    const isPaid = inc.some((e) => e.paid === true);
    type Row = { target: string[]; icon: SignIcon; ja: string; en: string; tone: "exit" | "dark" | "line" };
    const rows: Row[] = [];
    if (exits.length) rows.push({ target: exits, icon: "exit", ja: "出口", en: "Exit", tone: "exit" });
    if (isPaid && platform.length) rows.push({ target: platform, icon: "train", ja: "大江戸線 のりば", en: "Oedo Line Platform", tone: "line" });
    if (!isPaid && gates.length) rows.push({ target: gates, icon: "gate", ja: "改札", en: "Ticket Gates", tone: "dark" });
    if (elevs.length && rows.length < 3) rows.push({ target: elevs, icon: "elevator", ja: "エレベーター", en: "Elevator", tone: "dark" });
    const dirs = rows.map((r) => {
      const res = router.route(n.id, r.target, { fare: "ticketed", stepFree: false });
      if (!res.ok) return null;
      // initial direction of the route: towards the first route node ≥ 2 m along it (a chord across
      // later turns would point the wrong way at the sign)
      let acc = 0;
      let p = n.position;
      let prev = n.position;
      for (const id of res.nodeIds.slice(1)) {
        const q = nodeById.get(id)!.position;
        acc += Math.hypot(q.x - prev.x, q.y - prev.y);
        prev = q;
        p = q;
        if (acc >= 2) break;
      }
      const d = { x: p.x - n.position.x, y: p.y - n.position.y };
      const L = Math.hypot(d.x, d.y);
      return L < 0.5 ? null : { x: d.x / L, y: d.y / L };
    });
    const valid = rows.map((r, i) => ({ r, d: dirs[i] })).filter((x) => x.d);
    if (!valid.length) continue;
    const makeFace = (facing: XY) =>
      valid.map(({ r, d }) => {
        const cross = facing.x * d!.y - facing.y * d!.x;
        const dot = facing.x * d!.x + facing.y * d!.y;
        const ang = Math.atan2(cross, dot); // + = left
        const arrow = Math.abs(ang) < 0.6 ? "up" : Math.abs(ang) > 2.5 ? "down" : ang > 0 ? (ang < 1.2 ? "upLeft" : "left") : ang > -1.2 ? "upRight" : "right";
        return { arrow: arrow as "up", icon: r.icon, ja: r.ja, en: r.en, tone: r.tone };
      });
    const group = new THREE.Group();
    group.name = `sign:${n.id}`;
    const center = { x: n.position.x, y: n.position.y, z: lv.ceilingZ - 0.55 };
    for (const facing of [axis, { x: -axis.x, y: -axis.y }]) {
      faceDrafts.push({ floorId: lv.floorId, center: { x: center.x + facing.x * 0.04, y: center.y + facing.y * 0.04, z: center.z }, facing, lines: makeFace({ x: -facing.x, y: -facing.y }) });
    }
    const box = new THREE.BoxGeometry(1.96, (1.9 / 8) * valid.length + 0.06, 0.07);
    box.rotateY(Math.atan2(axis.y, axis.x) + Math.PI / 2).translate(center.x, center.z, -center.y);
    caseGeos.push(box);
    for (const s of [-0.7, 0.7]) {
      const rod = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6);
      const off = { x: -axis.y * s, y: axis.x * s };
      rod.translate(center.x + off.x, center.z + 0.45, -(center.y + off.y));
      rodGeos.push(rod);
    }
    group.userData = { nodeId: n.id, generated: "GTEki wayfinding from verified graph (not operator signage)" };
    root.add(group);
    out.push(group);
    placed.push({ x: n.position.x, y: n.position.y, z });
  }

  // Preserve each signTexture drawing, but copy the temporary source canvases into
  // shared atlas pages so all static faces on a page share one draw call. Faces
  // are only two triangles each, so their shared bounds cost less than extra level draws.
  const atlasPages = new Map<string, { texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial; rects: { u0: number; v0: number; u1: number; v1: number }[] }[]>();
  const faceBuckets = new Map<string, THREE.BufferGeometry[]>();
  const cols = 3, cellW = 1040, margin = 8, pageCapacity = 30;
  const pageW = cols * cellW;
  const byLevel = new Map<string, FaceDraft[]>();
  byLevel.set("station", faceDrafts);
  for (const [floorId, faces] of byLevel) {
    const pages = atlasPages.get(floorId) ?? [];
    for (let pageStart = 0; pageStart < faces.length; pageStart += pageCapacity) {
      const pageFaces = faces.slice(pageStart, pageStart + pageCapacity);
      const pageRows = Math.ceil(pageFaces.length / cols);
      // Preserve full-resolution sign pixels, packing each shelf to its tallest face.
      // Most signs have fewer than three rows; fixed 400 px cells retained large empty canvases.
      const rowHeights = Array.from({ length: pageRows }, (_, row) => Math.max(...pageFaces.slice(row * cols, (row + 1) * cols).map((face) => face.lines.length * SIGN_ROW_HEIGHT + margin * 2)));
      const rowStarts = rowHeights.map((_, row) => rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0));
      const pageH = rowHeights.reduce((sum, h) => sum + h, 0);
      const canvas = document.createElement("canvas");
      canvas.width = pageW;
      canvas.height = pageH;
      const ctx = canvas.getContext("2d")!;
      const rects: { u0: number; v0: number; u1: number; v1: number }[] = [];
      const pageIndex = pages.length;
      for (const [slot, face] of pageFaces.entries()) {
        const source = signTexture(face.lines);
        const sourceCanvas = source.texture.image as HTMLCanvasElement;
        const sw = sourceCanvas.width, sh = sourceCanvas.height;
        const x = (slot % cols) * cellW + margin;
        const y = rowStarts[Math.floor(slot / cols)]! + margin;
        ctx.drawImage(sourceCanvas, x, y);
        // Extend edge texels into the gutter to keep linear filtering and mipmaps
        // from sampling the neighboring sign when a face is viewed at an angle.
        ctx.drawImage(sourceCanvas, 0, 0, 1, sh, x - margin, y, margin, sh);
        ctx.drawImage(sourceCanvas, sw - 1, 0, 1, sh, x + sw, y, margin, sh);
        ctx.drawImage(sourceCanvas, 0, 0, sw, 1, x, y - margin, sw, margin);
        ctx.drawImage(sourceCanvas, 0, sh - 1, sw, 1, x, y + sh, sw, margin);
        for (const [sx, sy, dx, dy] of [
          [0, 0, x - margin, y - margin], [sw - 1, 0, x + sw, y - margin],
          [0, sh - 1, x - margin, y + sh], [sw - 1, sh - 1, x + sw, y + sh],
        ]) ctx.drawImage(sourceCanvas, sx!, sy!, 1, 1, dx!, dy!, margin, margin);

        const rect = { u0: x / pageW, u1: (x + sw) / pageW, v0: 1 - (y + sh) / pageH, v1: 1 - y / pageH };
        rects.push(rect);
        const geometry = new THREE.PlaneGeometry(1.9, 1.9 / source.aspect);
        const uv = geometry.getAttribute("uv");
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          uv.setXY(i, rect.u0 + u * (rect.u1 - rect.u0), rect.v0 + v * (rect.v1 - rect.v0));
        }
        const plane = new THREE.Object3D();
        plane.position.copy(v3(face.center));
        plane.lookAt(v3({ x: face.center.x + face.facing.x, y: face.center.y + face.facing.y, z: face.center.z }));
        plane.updateMatrix();
        geometry.applyMatrix4(plane.matrix);
        const key = `${floorId}:${pageIndex}`;
        faceBuckets.set(key, [...(faceBuckets.get(key) ?? []), geometry]);
        source.texture.dispose();
        sourceCanvas.width = 0;
        sourceCanvas.height = 0;
      }
      const texture = track(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      const material = track(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: "#ffffff", emissiveIntensity: 0.2, roughness: 0.5 }));
      pages.push({ texture, material, rects });
    }
    atlasPages.set(floorId, pages);
  }
  for (const [floorId, pages] of atlasPages) for (const [pageIndex, page] of pages.entries()) {
    const key = `${floorId}:${pageIndex}`;
    const geo = merged(faceBuckets.get(key) ?? []);
    if (!geo) continue;
    const mesh = new THREE.Mesh(track(geo), page.material);
    mesh.name = `sign-faces:${floorId}:${pageIndex}`;
    mesh.userData.atlasRects = page.rects;
    mesh.userData.faceCount = page.rects.length;
    root.add(mesh);
  }
  for (const [geos, color, metalness] of [[caseGeos, "#2b2d30", 0.4], [rodGeos, "#888888", 0.8]] as const) {
    const geo = merged(geos);
    if (geo) { const m = new THREE.Mesh(track(geo), track(new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness }))); if (geos === caseGeos) m.name = "sign-cases"; root.add(m); }
  }
  // keep centroid helper referenced for tree-shaking clarity
  void centroid;
  return out;
}
