/** Original street context. Geometry is merged per material and distance band.
 * Surface-only sun and haze are evaluated in these materials, so station lighting
 * and underground fog are untouched. Everything is explicitly render-only except
 * the exported obstacle segments, which the integration hook adds to WalkWorld.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import type { Layout, XY } from "./layout.ts";
import type { SurfaceData } from "./surface-data.ts";
import { surfaceBuildingFootprints, surfaceColumns, surfaceEntrances, surfaceGround, surfacePadWalls } from "./surface-layout.ts";
export { surfaceWalls } from "./surface-layout.ts";
export type { SurfaceData } from "./surface-data.ts";

const skyHorizon = new THREE.Color("#c8d5d9");
const sun = new THREE.Vector3(-0.65, 0.75, 0.3).normalize();
const pos = (p: XY, z: number) => new THREE.Vector3(p.x, z, -p.y);
function shape(rings: number[][][]) {
  const s = new THREE.Shape(rings[0]!.map((p) => new THREE.Vector2(p[0]!, p[1]!)));
  for (const r of rings.slice(1)) s.holes.push(new THREE.Path(r.map((p) => new THREE.Vector2(p[0]!, p[1]!))));
  return s;
}
function flat(rings: number[][][], z: number) {
  const g = new THREE.ShapeGeometry(shape(rings));
  g.rotateX(-Math.PI / 2); g.translate(0, z, 0);
  return g;
}
function quad(a: XY, b: XY, bottom: number, top: number, inset = 0) {
  const g = new THREE.BufferGeometry();
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const nx = dy / L * inset, ny = -dx / L * inset;
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x + nx, bottom, -a.y - ny, b.x + nx, bottom, -b.y - ny, b.x + nx, top, -b.y - ny, a.x + nx, top, -a.y - ny], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L, 0, L, top - bottom, 0, top - bottom], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return g;
}
function beam(a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number) {
  const d = b.clone().sub(a), g = new THREE.BoxGeometry(width, d.length(), depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function hash(s: string) { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }

/** Deterministic original paving/facades. No image or font files are fetched. */
function pavingTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = "#b6b6ad"; x.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) for (let i = 0; i < 4; i++) {
    const v = 160 + hash(`${i}:${y}`) % 22;
    x.fillStyle = `rgb(${v + 6},${v + 5},${v})`; x.fillRect(i * 64 + (y % 2 ? -32 : 0) + 1, y * 32 + 1, 62, 30);
    if (i === 0 && y % 2) x.fillRect(225, y * 32 + 1, 62, 30);
  }
  for (let i = 0; i < 3500; i++) { const h = hash(`p${i}`); x.fillStyle = h & 1 ? "#ffffff0b" : "#0000000b"; x.fillRect(h % 256, (h >>> 8) % 256, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Directional daylight is confined to surface materials instead of adding a
 * global Three light (Three WebGL has no per-group light linking). */
function daylight(color: string, map: THREE.Texture | null = null, glow = false) {
  const m = new THREE.MeshBasicMaterial({ color, map, side: THREE.DoubleSide, fog: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.surfaceSun = { value: sun }; s.uniforms.surfaceHorizon = { value: skyHorizon };
    s.vertexShader = `varying vec3 surfaceNormal; varying vec3 surfaceWorld;\n${s.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nsurfaceNormal = normalize(mat3(modelMatrix) * normal); surfaceWorld = (modelMatrix * vec4(position,1.)).xyz;");
    s.fragmentShader = `uniform vec3 surfaceSun; uniform vec3 surfaceHorizon; varying vec3 surfaceNormal; varying vec3 surfaceWorld;\n${s.fragmentShader}`.replace("#include <opaque_fragment>", `
      float illumination = ${glow ? "1.15" : "0.66 + 0.42 * max(0., dot(normalize(surfaceNormal), surfaceSun))"};
      outgoingLight *= illumination;
      float haze = smoothstep(125., 345., distance(cameraPosition.xz, surfaceWorld.xz));
      outgoingLight = mix(outgoingLight, surfaceHorizon, haze * .94);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `surface-daylight-${glow}`;
  return m;
}

export function buildSurface(surface: SurfaceData, layout: Layout, opts: { bundle: StationBundle; quality: "low" | "high" }) {
  const root = new THREE.Group(); root.name = "surface-render-only";
  root.userData.attribution = surface.attribution;
  const resources = new Set<{ dispose(): void }>();
  const track = <T extends { dispose(): void }>(r: T) => (resources.add(r), r);
  const paver = track(pavingTexture());
  const mats = {
    ground: track(daylight("#d2cdc0", paver)), stone: track(daylight("#c6c1b5")),
    steel: track(daylight("#465967")), trim: track(daylight("#8fa6af")),
    glass: track(daylight("#8fbdc6")), dark: track(daylight("#405361")),
    warm: track(daylight("#e7ce9b", null, true)), cool: track(daylight("#a6cad3", null, true)),
    accent: track(daylight("#b6007a")), roof: track(daylight("#949e9f")),
    buildings: ["#c0b9ab", "#9eaeb5", "#d0c7b7", "#adb1b0"].map((c) => track(daylight(c))),
  };
  // Glazing is visibly translucent without transmission's extra scene renders.
  mats.glass.transparent = true; mats.glass.opacity = 0.34; mats.glass.depthWrite = false;
  const batches = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; near: boolean }>();
  const add = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material, near = false) => {
    let batch = batches.get(key); if (!batch) { batch = { material, geometries: [], near }; batches.set(key, batch); } batch.geometries.push(geometry);
  };
  const ground = surfaceGround(layout, opts.bundle);
  for (const poly of ground) {
    const g = flat(poly, -0.012), uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    add("ground", g, mats.ground);
  }

  const perimeter = surfacePadWalls(layout, opts.bundle);
  for (const w of perimeter) {
    add("rail", beam(pos(w.a, 1.04), pos(w.b, 1.04), 0.07, 0.07), mats.steel);
    add("rail", beam(pos(w.a, 0.44), pos(w.b, 0.44), 0.035, 0.035), mats.steel);
    const count = Math.max(1, Math.ceil(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) / 1.35));
    for (let i = 0; i <= count; i++) {
      const p = { x: w.a.x + (w.b.x - w.a.x) * i / count, y: w.a.y + (w.b.y - w.a.y) * i / count };
      add("rail", beam(pos(p, 0), pos(p, 1.08), 0.07, 0.07), mats.steel);
    }
    // Narrow kerb exactly beneath the collision rail, never a new walk surface.
    add("kerb", beam(pos(w.a, 0.065), pos(w.b, 0.065), 0.14, 0.13), mats.stone);
  }
  const columns = surfaceColumns(layout, opts.bundle);
  for (const w of columns) add("steel", beam(pos({ x: (w.a.x + w.b.x) / 2, y: w.a.y }, 0), pos({ x: (w.a.x + w.b.x) / 2, y: w.a.y }, w.zMax), 0.14, 0.14), mats.steel);

  const entrances = surfaceEntrances(layout, opts.bundle);
  const atlas = document.createElement("canvas"); atlas.width = 2048; atlas.height = entrances.length * 384;
  const ctx = atlas.getContext("2d")!;
  entrances.forEach((e, index) => {
    const y = index * 384;
    ctx.fillStyle = "#183341"; ctx.fillRect(0, y, 2048, 384);
    ctx.fillStyle = "#b6007a"; ctx.fillRect(0, y, 18, 384);
    ctx.fillStyle = "#ffffff"; ctx.font = '600 74px sans-serif'; ctx.fillText("大江戸線 新宿駅", 60, y + 95);
    ctx.font = '48px sans-serif'; ctx.fillText("Oedo Line Shinjuku (E27)", 60, y + 163);
    ctx.font = '48px sans-serif'; ctx.fillText(e.labelJa, 60, y + 244);
    ctx.font = '36px sans-serif'; ctx.fillText(e.labelEn, 60, y + 300);
    ctx.fillStyle = "#bbccd1"; ctx.font = '28px sans-serif'; ctx.fillText("GTEki design · 地上の移動範囲は手すり内 / Explore within the rails", 60, y + 356);
    const at = (along: number, across: number, z: number) => new THREE.Vector3(e.center.x + e.u.x * along - e.u.y * across, z, -(e.center.y + e.u.y * along + e.u.x * across));
    const glassRoof = new THREE.BoxGeometry(e.halfWidth * 2 - 0.2, 0.035, e.halfLength * 2 - 0.2);
    glassRoof.rotateY(Math.atan2(e.u.x, -e.u.y)); glassRoof.translate(e.center.x, 3.56, -e.center.y);
    add("glass", glassRoof, mats.glass);
    for (const side of [-1, 1]) {
      add("steel", beam(at(-e.halfLength, side * e.halfWidth, 3.45), at(e.halfLength, side * e.halfWidth, 3.45), 0.13, 0.13), mats.steel);
      // Clerestory glazing >2.3 m: no body obstruction; side rails bound the pad.
      const a = at(-e.halfLength, side * e.halfWidth, 2.42), b = at(e.halfLength, side * e.halfWidth, 2.42);
      add("glass", quad({ x: a.x, y: -a.z }, { x: b.x, y: -b.z }, 2.42, 3.43), mats.glass);
      add("steel", beam(at(side * e.halfLength, -e.halfWidth, 3.45), at(side * e.halfLength, e.halfWidth, 3.45), 0.18, 0.18), mats.steel);
    }
    const w = e.halfWidth * 2;
    const sign = new THREE.PlaneGeometry(w, w * 384 / 2048);
    const uv = sign.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (index + 1 - uv.getY(i)) / entrances.length);
    sign.rotateY(Math.atan2(e.u.x, -e.u.y));
    const p = at(e.halfLength + 0.02, 0, 2.85); sign.translate(p.x, p.y, p.z);
    // One atlas draw for every exit sign; labels match POIs verbatim.
    add("signs", sign, null as unknown as THREE.Material);
    for (let j = 0; j < 4; j++) add("steel", beam(at(-e.halfLength + e.halfLength * 2 * j / 3, -e.halfWidth, 3.58), at(-e.halfLength + e.halfLength * 2 * j / 3, e.halfWidth, 3.58), 0.07, 0.07), mats.trim);
  });
  const signTexture = track(new THREE.CanvasTexture(atlas)); signTexture.colorSpace = THREE.SRGBColorSpace;
  const signMaterial = track(daylight("#ffffff", signTexture, true));
  if (batches.has("signs")) batches.get("signs")!.material = signMaterial;

  const buildings = surfaceBuildingFootprints(surface, layout, opts.bundle);
  for (const b of buildings) {
    const ring = b.rings[0]!, cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const h = hash(b.id), material = mats.buildings[h % mats.buildings.length]!;
    const mass = new THREE.ExtrudeGeometry(shape(b.rings), { depth: b.height, bevelEnabled: false, steps: 1 });
    mass.rotateX(-Math.PI / 2);
    add(`mass-${h % 4}`, mass, material);
    add("roof", flat(b.rings, b.height + 0.02), mats.roof);
    // Coarse distant LOD: full source mass and roof, no window geometry past
    // 185 m from any exit. Near-detail groups also cull by actual camera distance.
    const near = entrances.some((e) => Math.hypot(cx - e.center.x, cy - e.center.y) < 185);
    if (!near) continue;
    for (let i = 1; i < ring.length; i++) {
      const a = { x: ring[i - 1]![0], y: ring[i - 1]![1] }, c = { x: ring[i]![0], y: ring[i]![1] };
      const dx = c.x - a.x, dy = c.y - a.y, L = Math.hypot(dx, dy), u = { x: dx / (L || 1), y: dy / (L || 1) };
      if (L < 1) continue;
      add("parapet", quad(a, c, b.height, b.height + 0.55), mats.trim, true);
      // Window rhythm and shopfront band are invented, with no real businesses.
      add("storefront", quad(a, c, 0.45, Math.min(3.25, b.height - 0.3), 0.025), mats.dark, true);
      const cols = Math.max(1, Math.floor(L / 2.8)), rows = Math.min(44, Math.floor((b.height - 4) / 3.4));
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const s = L * (col + 0.18) / cols, t = L * (col + 0.78) / cols;
        const p = { x: a.x + u.x * s, y: a.y + u.y * s }, q = { x: a.x + u.x * t, y: a.y + u.y * t };
        const lit = hash(`${b.id}:${i}:${row}:${col}`) % 7;
        add(`windows-${lit < 2 ? "warm" : lit === 2 ? "cool" : "dark"}`, quad(p, q, 4 + row * 3.4, 6.05 + row * 3.4, 0.045), lit < 2 ? mats.warm : lit === 2 ? mats.cool : mats.dark, true);
      }
    }
  }

  const detail = new THREE.Group();
  const detailLod = new THREE.LOD();
  detailLod.position.set(-30, 0, -100); detail.position.set(30, 0, 100);
  detailLod.addLevel(detail, 0); detailLod.addLevel(new THREE.Group(), 280); root.add(detailLod);
  for (const [name, batch] of batches) {
    const gs = batch.geometries;
    if (!gs.length) continue;
    for (const g of gs) {
      if (!g.index) g.setIndex(Array.from({ length: g.attributes.position!.count }, (_, i) => i));
      for (const n of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    }
    const merged = mergeGeometries(gs, false)!;
    for (const g of gs) g.dispose();
    const mesh = new THREE.Mesh(track(merged), batch.material); mesh.name = `surface-${name}`;
    (batch.near ? detail : root).add(mesh);
  }

  const sky = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { horizon: { value: skyHorizon }, zenith: { value: new THREE.Color("#527e9b") }, sunDir: { value: sun } },
    vertexShader: "varying vec3 skyDir; void main(){ skyDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }",
    fragmentShader: "uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; varying vec3 skyDir; void main(){ if(cameraPosition.y < -1.8) discard; vec3 d=normalize(skyDir); vec3 c=mix(horizon,zenith,pow(max(d.y,0.),.55)); c+=vec3(1.,.77,.49)*pow(max(dot(d,sunDir),0.),320.)*.7; gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  });
  // Shader sky at clip-space far depth: camera far=400 never clips the dome.
  // The lower hemisphere is a soft horizon; street ground still occludes it.
  const dome = new THREE.Mesh(track(new THREE.SphereGeometry(300, 32, 16)), track(sky)); dome.name = "surface-sky"; dome.frustumCulled = false; dome.renderOrder = -1000;
  dome.onBeforeRender = (_renderer, _scene, camera) => { dome.position.copy(camera.position); dome.updateMatrixWorld(); };
  root.add(dome);
  root.userData.drawCallBudget = batches.size + 1;
  root.userData.buildingParts = buildings.length;
  let disposed = false;
  return { root, update(_dt: number, _t: number) {}, dispose() { if (disposed) return; disposed = true; for (const r of resources) r.dispose(); root.clear(); } };
}
