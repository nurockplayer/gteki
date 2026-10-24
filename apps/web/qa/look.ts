/// <reference types="vite/client" />
// DEV-ONLY look harness (Issue #94 Part B): Lane E kit layouts rendered through the game's real explorer
// pipeline (renderer, default lighting, post-fx chain) at the exact Blender reference camera.
// Served by `pnpm dev` at /qa/look.html; never part of `pnpm build` (index.html is its only input).
// Everything is read from URL params. With none, the output is the game's current look (AgX, environment
// light, emitter-only bloom: step 2 of #94); every param below overrides one part of it, and `old=1` restores
// the look before step 2 (ACES, no environment light, hemisphere 1.1, bloom threshold 1.0). See PARAMS.
//
//   /qa/look.html?layout=vertical_demo                      (camera hero, full tier, the game's look)
//   /qa/look.html?layout=concourse_demo&camera=gates_closed&tier=mobile
//   /qa/look.html?layout=vertical_demo&old=1                (the look before step 2)
//   /qa/look.html?layout=vertical_demo&env=room:0.6&exp=blender&shadows=1&sun=blender&sunI=3&hemi=0.3&bg=world
//
// PARAMS (all unset = the game's own value)
//   layout=vertical_demo|concourse_demo   camera=<name in layout.cameras>   tier=full|mobile
//   quality=low|high      force the explorer quality tier (patches matchMedia/screen before construction)
//   old=1                 preset: tm=aces exp=0 env=0 hemi=1.1 bloomT=1 bloomS=0.32 contrast=1.08 sat=1.06 vig=0.32 (each still overridable)
//   env=room[:n]|n|0      environment light intensity n (default 1 if given bare); 0 removes scene.environment
//                         (on the low tier this scales the SH probe that stands in for it, unless envVia=envMap)
//   envVia=envMap|probe   low tier only: A/B the PMREM environment (the old phone path) against the SH probe
//   tm=agx|aces|neutral   tone mapping (aces resets exposure to 1 unless exp is given)
//   exp=<EV>|blender      exposure = 2^EV (replaces the explorer's); "blender" = the layout's own exposure (-0.2 / -0.35)
//   shadows=1             the explorer's own sun shadow (shadows.ts policy + followShadow frustum), focused on the camera's
//                         look_at point as if the walker stood there; one explorer update runs before the first render
//   shadowFloor=<y>       floor height (three Y) for the caster rule, which only lets geometry starting below floor + CAST_HEADROOM_M
//                         cast (default 0, the layouts' ground; look_at is not a floor height)
//   shadowR=<n>           shadow blur radius in PCF texels (default SHADOW_RADIUS);  shadowH=<m> frustum half-extent (default SHADOW_HALF_EXTENT_M)
//   sun=blender           sun travels along Blender's vertical_hero direction;  sunI=<n> sun intensity
//   hemi=<n>              hemisphere intensity override
//   bg=world|<hex>        background (and fog colour) = Blender world colour for the layout, or a hex
//   fog=0                 remove the explorer's fog
//   ground=0|1            Blender studio ground plane (default: on for vertical_demo, i.e. mode "studio")
//   ao=0|1                GTAO blend off/on (high quality only)
//   aoMap=0               strip the baked aoMaps (kit GLB occlusionTexture, UV1) for A/B
//   aoMapI=<n>            baked aoMap intensity (replaces the per-tier scale: game = x0.6 on high, x1 on low; authored strength is 1)
//   refl=0 grade=0 bloom=0  disable floor reflections / grade+vignette / bloom (high quality only)
//   bloomT=<n> bloomS=<n> contrast=<n> sat=<n> vig=<n>   bloom threshold / strength, grade contrast / saturation / vignette (high quality only)
//   loop=0                render on demand only (default: rAF re-render of the static scene each frame)
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Explorer } from "../src/explorer/explorer.ts";
import { applyBakedAo, type BakedAoCounts } from "../src/explorer/bakedAo.ts";
import verticalDemo from "../../../tools/blender/showcase/vertical_demo.json";
import concourseDemo from "../../../tools/blender/showcase/concourse_demo.json";

interface CameraDef { pos: number[]; look_at: number[]; lens?: number }
interface ItemDef { glb: string; pos?: number[]; yaw?: number; close_flaps?: boolean }
interface LayoutDef { mode: string; exposure?: number; ground?: boolean; items: ItemDef[]; cameras: Record<string, CameraDef> }

const LAYOUTS: Record<string, { def: LayoutDef; defaultCamera: string }> = {
  vertical_demo: { def: verticalDemo as unknown as LayoutDef, defaultCamera: "hero" },
  concourse_demo: { def: concourseDemo as unknown as LayoutDef, defaultCamera: "gates_closed" },
};

// Vite turns these into dev URLs (/@fs/... outside the app root) without any config change.
const GLB_URLS = {
  full: import.meta.glob("../../../assets/library/glb/*.glb", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>,
  mobile: import.meta.glob("../../../assets/library/mobile/glb/*.glb", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>,
};

/** Blender's vertical_hero sun: direction the light travels, in three axes (render_preview.py add_studio_lights). */
const BLENDER_SUN_TRAVEL = new THREE.Vector3(-0.5308, -0.6330, -0.5635);
const BLENDER_WORLD = {
  studio: { rgb: [0.55, 0.58, 0.62], strength: 0.9 },
  interior: { rgb: [0.02, 0.022, 0.025], strength: 1.0 },
};

const q = new URLSearchParams(location.search);
const num = (k: string): number | null => { const v = q.get(k); if (v === null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const flag = (k: string): boolean | null => { const v = q.get(k); return v === null ? null : !(v === "0" || v === "false" || v === "off"); };

function fail(e: unknown): never {
  const el = document.getElementById("err")!;
  el.hidden = false;
  el.textContent = String((e as Error)?.stack ?? e);
  throw e;
}

// ---- quality override (the Explorer decides in its constructor from matchMedia + screen) ------------------
const forcedQuality = q.get("quality");
if (forcedQuality === "low" || forcedQuality === "high") {
  const realMatch = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => (query.includes("pointer: coarse") ? ({ ...realMatch(query), matches: forcedQuality === "low" } as MediaQueryList) : realMatch(query))) as typeof window.matchMedia;
  const side = forcedQuality === "low" ? 600 : 1200;
  for (const k of ["width", "height"] as const) Object.defineProperty(window.screen, k, { configurable: true, get: () => side });
}

const layoutName = q.get("layout") ?? "vertical_demo";
const entry = LAYOUTS[layoutName];
if (!entry) fail(new Error(`unknown layout "${layoutName}" (vertical_demo | concourse_demo)`));
const layout = entry!.def;
const cameraName = q.get("camera") ?? entry!.defaultCamera;
const cam = layout.cameras[cameraName];
if (!cam) fail(new Error(`layout ${layoutName} has no camera "${cameraName}" (${Object.keys(layout.cameras).join(", ")})`));
const tier = q.get("tier") === "mobile" ? "mobile" : "full";
const studio = layout.mode === "studio";

const host = document.getElementById("host")!;
const ex: any = new Explorer(host);
const renderer: THREE.WebGLRenderer = ex.renderer;
const scene: THREE.Scene = ex.scene;
const camera: THREE.PerspectiveCamera = ex.camera;
const gl = renderer.getContext();

// ---- hold the explorer still -------------------------------------------------------------------------
// The explorer's own loop (step + render) is stopped: step() would run the follow camera, street probe, camera
// cut and avatar motion. Nothing here needs them, and a still scene renders identically every frame.
renderer.setAnimationLoop(null);
ex.setMode("walk");            // the in-game third-person look (overview would swap materials via OverviewLook)
ex.avatar.visible = false;
ex.pos.set(0, -1000, 0);       // walker far away: nothing can be cut or probed near the kit
ex.placeCamera = () => {};     // belt and braces if the loop is ever restarted
ex.setupComposer();            // normally built in loadStation; builds the high-quality PostFx chain (null on low)

const kit = new THREE.Group();
kit.name = "look-kit";
ex.world.add(kit);

// ---- Blender camera -------------------------------------------------------------------------------
function applyCamera(): void {
  const size = renderer.getSize(new THREE.Vector2());
  const aspect = size.x / Math.max(1, size.y);
  camera.aspect = aspect;
  camera.near = 0.05;
  camera.position.set(cam!.pos[0]!, cam!.pos[2]!, -cam!.pos[1]!);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam!.look_at[0]!, cam!.look_at[2]!, -cam!.look_at[1]!);
  // Blender sensor fit AUTO: 36 mm spans the longer image side.
  const longFov = 2 * Math.atan(18 / (cam!.lens ?? 24));
  camera.fov = THREE.MathUtils.radToDeg(aspect >= 1 ? 2 * Math.atan(Math.tan(longFov / 2) / aspect) : longFov);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// ---- kit loading --------------------------------------------------------------------------------------
const assetId = (item: ItemDef): string => item.glb.split("/").pop()!.replace(/\.glb$/, "");

let bakedAo: BakedAoCounts = { materials: 0, scaled: 0, disabled: 0, textureBytes: 0 };

async function loadKit(): Promise<void> {
  const table = GLB_URLS[tier];
  const key = (id: string) => Object.keys(table).find((k) => k.endsWith(`/${id}.glb`));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ids = [...new Set(layout.items.map(assetId))];
  const loaded = new Map<string, THREE.Object3D>();
  await Promise.all(ids.map(async (id) => {
    const k = key(id);
    if (!k) throw new Error(`no ${tier} GLB for ${id}`);
    const url = await table[k]!();
    loaded.set(id, (await loader.loadAsync(url)).scene);
  }));
  for (const item of layout.items) {
    const obj = loaded.get(assetId(item))!.clone(true);
    // Blender (x, y, z) -> three (x, z, -y); yaw about Blender Z -> three Y, same sign (render_preview.py import_items).
    const [x = 0, y = 0, z = 0] = item.pos ?? [0, 0, 0];
    obj.position.set(x, z, -y);
    obj.rotation.set(0, THREE.MathUtils.degToRad(item.yaw ?? 0), 0);
    obj.traverse((n) => { if (n.name.includes("-colonly")) n.visible = false; });
    if (item.close_flaps) closeFlaps(obj);
    kit.add(obj);
  }
  kit.updateMatrixWorld(true);
  // Baked AO (kit GLBs carry an occlusionTexture on UV1): the explorer's own per-tier policy, as at station attach.
  if (flag("aoMap") === false) {
    kit.traverse((n) => { const m = (n as THREE.Mesh).material; for (const x of Array.isArray(m) ? m : m ? [m] : []) { const a = x as THREE.MeshStandardMaterial; if (a.aoMap) { a.aoMap = null; a.needsUpdate = true; } } });
    applied.aoMap = 0;
  }
  const aoI = num("aoMapI");
  if (aoI !== null) applied.aoMapI = aoI;
  bakedAo = applyBakedAo(kit, ex.quality, aoI ?? undefined);
}

/** render_preview.py _close_flaps: VIS_flap_<aisle>_<side> turns about the hinge's up axis (Blender Z = three Y). */
function closeFlaps(root: THREE.Object3D): void {
  let yaw: Record<string, number> | undefined;
  root.traverse((n) => { const p = n.userData?.gteki?.params?.flap_close_yaw_deg; if (p && !yaw) yaw = p; });
  if (!yaw) return;
  root.traverse((n) => {
    const m = /^VIS_flap_\d+_([A-Za-z]+)$/.exec(n.name); // GLTFLoader names primitives <node>_<i>: rotate the node only
    const deg = m ? yaw![m[1]!] : undefined;
    if (deg !== undefined) n.rotation.y += THREE.MathUtils.degToRad(Number(deg));
  });
}

function addGround(): void {
  const on = flag("ground") ?? studio;
  if (!on) return;
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.32, 0.33, 0.34, THREE.LinearSRGBColorSpace), roughness: 0.8 }),
  );
  g.name = "look-ground";
  g.position.y = -0.001;
  ex.world.add(g);
}

// ---- candidate look changes ---------------------------------------------------------------------------
const TONE: Record<string, THREE.ToneMapping> = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };
const sun: THREE.DirectionalLight = ex.coreLights[1];
const hemi: THREE.HemisphereLight = ex.coreLights[0];
const applied: Record<string, unknown> = {};

// `old=1` preset: the look before #94 step 2. Explicit params still win.
const OLD: Record<string, string> = { tm: "aces", exp: "0", env: "0", hemi: "1.1", bloomT: "1", bloomS: "0.32", contrast: "1.08", sat: "1.06", vig: "0.32" };
const param = (k: string): string | null => q.get(k) ?? (flag("old") === true ? OLD[k] ?? null : null);
const paramNum = (k: string): number | null => { const v = param(k); if (v === null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function applyLook(box: THREE.Box3): void {
  // Tone mapping / exposure (OutputPass reads renderer.toneMapping, so both quality paths follow it).
  const tm = param("tm");
  if (tm) {
    if (!(tm in TONE)) fail(new Error(`tm must be agx|aces|neutral, got ${tm}`));
    renderer.toneMapping = TONE[tm]!;
    if (tm !== "agx" && param("exp") === null) renderer.toneMappingExposure = 1;
    applied.tm = tm;
  }
  const expRaw = param("exp");
  if (expRaw !== null) {
    const ev = expRaw === "blender" ? (layout.exposure ?? 0) : Number(expRaw);
    if (!Number.isFinite(ev)) fail(new Error(`bad exp ${expRaw}`));
    renderer.toneMappingExposure = 2 ** ev;
    applied.exp = ev;
  }

  // Environment (image based light on top of the explorer's hemisphere + sun, exactly as a candidate would be).
  const env = param("env");
  const probe = (ex as any).envProbe as THREE.LightProbe;
  const via = param("envVia");
  if (via === "envMap" && probe.visible) {
    probe.visible = false;
    (ex as any).probeWanted = false;
    scene.environment = (ex as any).coreEnv();
    applied.envVia = via;
  }
  if (env !== null && env !== "") {
    const n = env === "off" ? 0 : env === "room" ? 1 : Number(env.replace(/^room:/, ""));
    if (!Number.isFinite(n)) fail(new Error(`bad env ${env}`));
    if (probe.visible) { probe.visible = n > 0; probe.intensity = n; scene.environmentIntensity = n; (ex as any).probeWanted = n > 0; }
    else if (n === 0) scene.environment = null;
    else {
      if (!scene.environment) { // the explorer keeps its own map for station lighting; reuse it
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      }
      scene.environmentIntensity = n;
    }
    applied.env = n;
  }

  // Lights.
  const hemiI = paramNum("hemi");
  if (hemiI !== null) { hemi.intensity = hemiI; applied.hemi = hemiI; }
  const sunI = num("sunI");
  if (sunI !== null) { sun.intensity = sunI; applied.sunI = sunI; }
  const center = box.getCenter(new THREE.Vector3());
  const toSun = q.get("sun") === "blender" ? BLENDER_SUN_TRAVEL.clone().negate().normalize() : sun.position.clone().normalize();
  if (q.get("sun") === "blender") applied.sun = "blender";

  if (q.get("sun") === "blender") {
    // The explorer's shadow fit keeps this direction (sun minus target) and moves both with its focus.
    const dist = Math.max(60, box.getSize(new THREE.Vector3()).length() * 1.5);
    sun.position.copy(center).addScaledVector(toSun, dist);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  const shadowR = num("shadowR");
  if (shadowR !== null) { sun.shadow.radius = shadowR; applied.shadowR = shadowR; }
  if (flag("shadows") === true) {
    // The explorer's real path: policy over the world (kit + studio ground), walker stood at the camera's look_at
    // (Blender (x, y, z) -> three (x, z, -y)), then its own per-frame update once. A no-op on low quality.
    const focus = new THREE.Vector3(cam!.look_at[0]!, cam!.look_at[2]!, -cam!.look_at[1]!);
    const half = num("shadowH") ?? undefined;
    const counts = ex.devShadows(ex.world, focus, half, num("shadowFloor") ?? 0);
    ex.updateShadows();
    applied.shadows = { ...counts, ...ex.sceneInfo().shadows, radius: sun.shadow.radius, normalBias: sun.shadow.normalBias, mapSize: sun.shadow.mapSize.x, sunCastShadow: sun.castShadow, shadowMapEnabled: renderer.shadowMap.enabled };
  }

  // Background / fog.
  const bg = q.get("bg");
  if (bg) {
    const w = BLENDER_WORLD[studio ? "studio" : "interior"];
    const c = bg === "world" ? new THREE.Color().setRGB(w.rgb[0]! * w.strength, w.rgb[1]! * w.strength, w.rgb[2]! * w.strength, THREE.LinearSRGBColorSpace) : new THREE.Color(`#${bg.replace(/^#/, "")}`);
    scene.background = c;
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(c);
    applied.bg = bg;
  }
  if (flag("fog") === false) { scene.fog = null; applied.fog = "off"; }

  // Post-fx passes (composer exists on high quality only).
  const composer = ex.composer;
  if (composer) {
    for (const pass of composer.passes as any[]) {
      if (pass instanceof GTAOPass) {
        const ao = flag("ao");
        // blendIntensity 0 keeps the depth/normal buffers the floor-reflection pass reads; only truly disable
        // the pass when reflections are off as well.
        if (ao === false) { pass.blendIntensity = 0; if (flag("refl") === false) pass.enabled = false; applied.ao = 0; }
      } else if (pass instanceof UnrealBloomPass) {
        const bt = paramNum("bloomT"), bs = paramNum("bloomS");
        if (bt !== null) { pass.threshold = bt; applied.bloomT = bt; }
        if (bs !== null) { pass.strength = bs; applied.bloomS = bs; }
        if (flag("bloom") === false) { pass.strength = 0; pass.enabled = false; applied.bloom = 0; }
      } else if (pass.constructor?.name === "FloorReflectionPass") {
        if (flag("refl") === false) { pass.enabled = false; applied.refl = 0; }
      } else if (pass.uniforms?.uContrast) {
        const c = paramNum("contrast"), sa = paramNum("sat"), vg = paramNum("vig");
        if (c !== null) { pass.uniforms.uContrast.value = c; applied.contrast = c; }
        if (sa !== null) { pass.uniforms.uSaturation.value = sa; applied.sat = sa; }
        if (vg !== null) { pass.uniforms.uVignette.value = vg; applied.vig = vg; }
        if (flag("grade") === false) { const u = pass.uniforms; u.uContrast.value = 1; u.uSaturation.value = 1; u.uVignette.value = 0; u.uLift.value = 0; applied.grade = 0; }
      }
    }
  }
}

// ---- rendering / measurement ----------------------------------------------------------------------
const pixel = new Uint8Array(4);
function renderOnce(): void {
  applyCamera();
  ex.render(0);
}
function renderSync(): void {
  renderOnce();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // blocks until the GPU finished the frame
}

const toneName = (t: THREE.ToneMapping) => ({ [THREE.NoToneMapping]: "none", [THREE.ACESFilmicToneMapping]: "aces", [THREE.AgXToneMapping]: "agx", [THREE.NeutralToneMapping]: "neutral" } as Record<number, string>)[t] ?? String(t);

function info() {
  // renderer.info resets on every renderer.render(); the composer renders several passes per frame, so count
  // the whole frame with autoReset off.
  const ri = renderer.info;
  const auto = ri.autoReset;
  ri.autoReset = false;
  ri.reset();
  renderOnce();
  const frame = { drawCalls: ri.render.calls, triangles: ri.render.triangles };
  ri.autoReset = auto;
  let kitMeshes = 0, kitTriangles = 0;
  kit.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    let visible = true;
    for (let o: THREE.Object3D | null = m; o; o = o.parent) if (!o.visible) { visible = false; break; }
    if (!visible) return;
    kitMeshes++;
    const g = m.geometry;
    kitTriangles += (g.index ? g.index.count : g.attributes.position!.count) / 3;
  });
  const size = renderer.getSize(new THREE.Vector2());
  return {
    layout: layoutName, camera: cameraName, tier,
    quality: ex.quality as "low" | "high",
    composer: !!ex.composer,
    passes: ex.composer ? (ex.composer.passes as any[]).map((p) => `${p.constructor?.name}${p.enabled === false ? "(off)" : ""}`) : [],
    toneMapping: toneName(renderer.toneMapping),
    exposure: renderer.toneMappingExposure,
    fov: camera.fov,
    size: [size.x, size.y], pixelRatio: renderer.getPixelRatio(),
    shadowMapEnabled: renderer.shadowMap.enabled, sunCastShadow: sun.castShadow,
    hasEnvironment: !!scene.environment || ((ex as any).envProbe as THREE.LightProbe).visible, environment: ((ex as any).envProbe as THREE.LightProbe).visible ? "probe" : scene.environment ? "envMap" : null, environmentIntensity: scene.environmentIntensity, hemi: hemi.intensity,
    post: ex.composer ? (() => { const ps = ex.composer.passes as any[]; const b = ps.find((p) => p instanceof UnrealBloomPass), g = ps.find((p) => p.uniforms?.uContrast); return { bloomThreshold: b?.threshold, bloomStrength: b?.strength, contrast: g?.uniforms.uContrast.value, saturation: g?.uniforms.uSaturation.value, vignette: g?.uniforms.uVignette.value }; })() : null,
        drawCalls: frame.drawCalls, triangles: frame.triangles,
    programs: ri.programs?.length ?? 0,
    kitMeshes, kitTriangles,
    bakedAo,
    applied,
  };
}

async function timeFrames(n: number): Promise<{ msMedian: number; msP90: number; frames: number }> {
  // Relative CPU-side wall time per frame with the GPU drained after each frame (1-px readback). Desktop GPU,
  // shared host: only compare runs against each other, never against a device budget.
  for (let i = 0; i < 3; i++) renderSync(); // warm-up: shader compile, first upload
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    renderSync();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const at = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] ?? 0;
  return { msMedian: at(0.5), msP90: at(0.9), frames: ms.length };
}

// ---- HDR luma statistics (bloom threshold evidence) ---------------------------------------------------
/** Linear scene luma (what UnrealBloom's high-pass sees) of one frame rendered to a float target, with or without emissive. */
function lumaStats(emissive: boolean, thresholds = [1, 1.5, 2, 2.5, 3, 4, 6]) {
  const size = renderer.getSize(new THREE.Vector2());
  const w = Math.round(size.x * renderer.getPixelRatio()), h = Math.round(size.y * renderer.getPixelRatio());
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true });
  // Keyed by material: a material shared by several meshes must keep its first (real) value, not the 0 set since.
  const saved = new Map<THREE.MeshStandardMaterial, number>();
  if (!emissive) scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) { const sm = mat as THREE.MeshStandardMaterial; if (!saved.has(sm)) saved.set(sm, sm.emissiveIntensity); sm.emissiveIntensity = 0; }
  });
  applyCamera();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  const buf = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  renderer.setRenderTarget(prev);
  for (const [m, v] of saved) m.emissiveIntensity = v;
  rt.dispose();
  const lumas = new Float32Array(w * h);
  let max = 0;
  for (let i = 0; i < w * h; i++) { const l = 0.2126 * buf[i * 4]! + 0.7152 * buf[i * 4 + 1]! + 0.0722 * buf[i * 4 + 2]!; lumas[i] = l; if (l > max) max = l; }
  const sorted = lumas.slice().sort();
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const over: Record<string, number> = {};
  for (const t of thresholds) { let c = 0; for (let i = 0; i < lumas.length; i++) if (lumas[i]! > t) c++; over[`>${t}`] = +(100 * c / lumas.length).toFixed(4); }
  return { emissive, max: +max.toFixed(3), p50: +pct(0.5).toFixed(3), p99: +pct(0.99).toFixed(3), p999: +pct(0.999).toFixed(3), p9999: +pct(0.9999).toFixed(3), pctOver: over };
}

// ---- boot --------------------------------------------------------------------------------------------
const ready = (async () => {
  // The low tier's SH probe bakes asynchronously; apply the look only once it is in, so env params act on it.
  for (let i = 0; i < 100 && (ex as any).probeBake === "baking"; i++) await new Promise((r) => setTimeout(r, 50));
  await loadKit();
  addGround();
  applyLook(new THREE.Box3().setFromObject(kit));
  applyCamera();
  renderSync();
  // The explorer's own ResizeObserver (registered first) resizes renderer + composer; re-render after it.
  new ResizeObserver(() => renderOnce()).observe(host);
  if (flag("loop") !== false) {
    const tick = () => { renderOnce(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
})().catch(fail);

(window as any).__look = { ready, info, renderOnce, timeFrames, lumaStats, explorer: ex, scene, kit };
