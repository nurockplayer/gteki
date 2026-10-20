// Station-local preview harness (not the product shell): third-person walk
// through gteki/scene.ts via a gteki.scene/0.1 context, with post-processing,
// for visual iteration and capture. ?spawn=<nodeId> ?q=mobile ?ao=0 ?exp=<n>.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { parseStationFiles } from "@gteki/schema";
import { buildScene } from "../gteki/scene.ts";
import manifest from "../gteki/station.json";
import graphFile from "../gteki/graph.json";
import poiFile from "../gteki/pois.json";

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const params = new URLSearchParams(location.search);
const mobile = params.get("q") === "mobile" || matchMedia("(pointer: coarse)").matches;
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get("exp") ?? 1.0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fovFor = (aspect: number) => (aspect < 1 ? 78 : 62); // portrait phones need a taller FOV
const camera = new THREE.PerspectiveCamera(fovFor(innerWidth / innerHeight), innerWidth / innerHeight, 0.05, 600);
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const enu = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.z, -p.y);
const assetUrl = (uri: string) => (uri.includes("..") || /^[a-z]+:/i.test(uri) ? null : `/gteki/${uri}`);
// Host-owned audio (proposed ctx.audio): created suspended, resumed on the first user gesture.
const audioCtx = params.get("mute") === "1" ? null : new AudioContext();
const unlock = () => void audioCtx?.resume();
addEventListener("pointerdown", unlock, { once: true });
addEventListener("keydown", unlock, { once: true });
const parsed = parseStationFiles(manifest, graphFile, poiFile);
if (!parsed.ok) throw new Error(`station bundle invalid: ${parsed.issues.map((i) => i.code).join(", ")}`);
const station = await buildScene({
  THREE,
  bundle: parsed.bundle,
  audio: audioCtx ? { context: audioCtx, destination: audioCtx.destination } : undefined,
  renderer,
  quality: mobile ? "low" : "high",
  enuToRenderer: (p) => [p.x, p.z, -p.y],
  assetUrl,
  loadGlb: async (uri) => {
    const url = assetUrl(uri);
    const head = url && (await fetch(url, { method: "HEAD" }));
    if (!url || !head || !head.ok || !(head.headers.get("content-type") ?? "").includes("model")) throw new Error(`missing ${uri}`);
    return loader.loadAsync(url);
  },
  loadTexture: async (uri, opts) => {
    const url = assetUrl(uri);
    if (!url) throw new Error(`bad uri ${uri}`);
    const t = await texLoader.loadAsync(url);
    t.colorSpace = opts?.colorSpace === "linear" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.flipY = opts?.flipY ?? true;
    t.needsUpdate = true;
    return t;
  },
});
scene.add(station.root);
const envCfg = station.environment ?? {};
scene.background = new THREE.Color(envCfg.background ?? 0x101010);
// Avatar lighting as in the shared explorer: a per-material env map, so baked station surfaces are untouched.
const avatarEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
if (envCfg.fog) scene.fog = new THREE.Fog(envCfg.fog.color, envCfg.fog.near, envCfg.fog.far);
const colliders = station.colliders ?? [];
for (const o of [...station.walkable, ...colliders]) ((o as THREE.Mesh).geometry as any).computeBoundsTree?.();

// --- player -------------------------------------------------------------
const player = new THREE.Group();
{
  const jacket = new THREE.MeshStandardMaterial({ envMap: avatarEnv, envMapIntensity: 0.6, color: 0x2f4a6b, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ envMap: avatarEnv, envMapIntensity: 0.6, color: 0xd9b59a, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ envMap: avatarEnv, envMapIntensity: 0.6, color: 0x1d1f24, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 6, 12), jacket);
  body.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
  head.position.y = 1.62;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.55, 4, 10), dark);
  legs.position.y = 0.48;
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.12), dark);
  bag.position.set(0, 1.2, -0.2);
  player.add(body, head, legs, bag);
}
scene.add(player);
const spawns = station.spawnPoints ?? [];
const spawnId = params.get("spawn");
const spawnAt = (sp: { x: number; y: number; z: number }) => player.position.copy(enu(sp));
const sp = spawns.find((s) => s.nodeId === spawnId) ?? spawns[0]!;
spawnAt(sp);
// yaw: radians in renderer frame (0 = facing -Z = north); compass heading h -> yaw = -h
let yaw = params.has("yaw") ? Number(params.get("yaw")) : -(sp.headingDeg * Math.PI) / 180;
let camYaw = yaw, camPitch = Number(params.get("pitch") ?? 0.12), camDist = Number(params.get("dist") ?? 3.4);

const down = new THREE.Raycaster();
const side = new THREE.Raycaster();
function groundAt(p: THREE.Vector3, maxUp = 0.55): number | null {
  down.set(new THREE.Vector3(p.x, p.y + maxUp + 0.05, p.z), new THREE.Vector3(0, -1, 0));
  down.far = maxUp + 1.2;
  const hit = down.intersectObjects(station.walkable, false)[0];
  return hit ? hit.point.y : null;
}
function blocked(from: THREE.Vector3, dir: THREE.Vector3, dist: number): THREE.Vector3 | null {
  for (const h of [0.45, 1.25]) {
    side.set(new THREE.Vector3(from.x, from.y + h, from.z), dir);
    side.far = dist + 0.3;
    const hit = side.intersectObjects(colliders, false)[0];
    if (hit?.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      n.y = 0;
      if (n.lengthSq() < 1e-4) continue;
      return n.normalize();
    }
  }
  return null;
}

// --- input --------------------------------------------------------------
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let dragging = false, lx = 0, ly = 0;
const joy = { id: -1, x0: 0, y0: 0, dx: 0, dy: 0 };
const look = { id: -1, x: 0, y: 0 };
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && e.clientX < innerWidth / 2 && joy.id < 0) {
    Object.assign(joy, { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 });
  } else if (e.pointerType === "touch") {
    Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
  } else {
    dragging = true; lx = e.clientX; ly = e.clientY;
  }
});
addEventListener("pointermove", (e) => {
  if (e.pointerId === joy.id) { joy.dx = (e.clientX - joy.x0) / 60; joy.dy = (e.clientY - joy.y0) / 60; }
  else if (e.pointerId === look.id) { camYaw -= (e.clientX - look.x) * 0.006; camPitch += (e.clientY - look.y) * 0.004; look.x = e.clientX; look.y = e.clientY; }
  else if (dragging) { camYaw -= (e.clientX - lx) * 0.005; camPitch += (e.clientY - ly) * 0.004; lx = e.clientX; ly = e.clientY; }
  camPitch = Math.max(-0.35, Math.min(0.75, camPitch));
});
const release = (e: PointerEvent) => {
  if (e.pointerId === joy.id) { joy.id = -1; joy.dx = joy.dy = 0; }
  if (e.pointerId === look.id) look.id = -1;
  dragging = false;
};
addEventListener("pointerup", release);
addEventListener("pointercancel", release);
// A key or touch released while the page is in the background never reports its release.
const releaseAll = () => { keys.clear(); joy.id = look.id = -1; joy.dx = joy.dy = 0; dragging = false; };
addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });
addEventListener("wheel", (e) => { camDist = Math.max(1.6, Math.min(8, camDist + e.deltaY * 0.004)); });

// --- post ---------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// ?post=explorer mirrors the shared explorer's high-quality chain (default GTAO at 0.8; bloom 0.35 / 0.6 / 0.85),
// so exposure and glare can be compared here against what the product shows.
const asExplorer = params.get("post") === "explorer";
if (!mobile && params.get("ao") !== "0") {
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  if (asExplorer) ao.blendIntensity = 0.8;
  else {
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
    ao.blendIntensity = 0.85;
  }
  composer.addPass(ao);
}
const bloom = asExplorer
  ? new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85)
  : new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), mobile ? 0.3 : 0.32, 0.4, 0.98);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// --- loop ---------------------------------------------------------------
const hud = document.getElementById("hud")!;
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0, bob = 0;
const camPos = new THREE.Vector3();
const camRay = new THREE.Raycaster();
function frame() {
  step(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(frame);
}
let elapsed = 0;
function step(dt: number, render = true) {
  elapsed += dt;
  station.update?.(dt, elapsed);
  // move intent in camera space
  let f = 0, s = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
  f -= joy.dy; s += joy.dx;
  const mag = Math.min(1, Math.hypot(f, s));
  const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(joy.dx, joy.dy) > 1.6;
  if (mag > 0.05) {
    const dirYaw = camYaw + Math.atan2(-s, f);
    yaw += Math.atan2(Math.sin(dirYaw - yaw), Math.cos(dirYaw - yaw)) * Math.min(1, dt * 10);
    const speed = (run ? 3.6 : 1.45) * mag;
    const dir = new THREE.Vector3(-Math.sin(dirYaw), 0, -Math.cos(dirYaw));
    let step = dir.multiplyScalar(speed * dt);
    const n = blocked(player.position, step.clone().normalize(), step.length());
    if (n) step = step.sub(n.multiplyScalar(step.dot(n))).multiplyScalar(0.9);
    if (step.lengthSq() > 0 && !blocked(player.position, step.clone().normalize(), step.length())) {
      const next = player.position.clone().add(step);
      const g = groundAt(next);
      if (g !== null) { next.y = g; player.position.copy(next); }
    }
    bob += dt * speed * 5.5;
  }
  const g = groundAt(player.position, 0.3);
  if (g !== null) player.position.y += (g - player.position.y) * Math.min(1, dt * 20);
  player.rotation.y = yaw;
  player.children[0]!.position.y = 1.12 + Math.abs(Math.sin(bob)) * 0.025;

  // camera: orbit behind player, pulled in by walls/ceiling
  const head = player.position.clone().add(new THREE.Vector3(0, 1.55, 0));
  const back = new THREE.Vector3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  camRay.set(head, back);
  camRay.far = camDist;
  const hit = camRay.intersectObjects([...colliders, ...station.walkable], false)[0];
  const d = hit ? Math.max(0.5, hit.distance - 0.25) : camDist;
  camPos.copy(head).addScaledVector(back, d);
  camera.position.lerp(camPos, Math.min(1, dt * 12));
  camera.lookAt(head.x, head.y - 0.1, head.z);

  if (render) mobile ? renderer.render(scene, camera) : composer.render(dt);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const p = player.position;
  hud.textContent = `${fps.toFixed(0)} fps  ENU x=${p.x.toFixed(1)} y=${(-p.z).toFixed(1)} z=${p.y.toFixed(2)} m TP\nWASD/drag · Shift run · data: PLATEAU (MLIT) CC BY 4.0, modified`;
}
frame();
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = fovFor(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
(window as any).gt = {
  THREE, camera, player, scene, station, renderer,
  setView(y: number, p: number, dist: number) { camYaw = y; camPitch = p; camDist = dist; },
  /** Teleport to station ENU and face a compass heading (for scripted captures). */
  go(x: number, y: number, z: number, headingDeg: number) { spawnAt({ x, y, z }); yaw = camYaw = -(headingDeg * Math.PI) / 180; },
  /** Save the current frame to build/captures/<name>.jpg (dev server only). */
  async capture(name: string) {
    // toDataURL is synchronous (toBlob never resolves in a hidden tab).
    const b64 = renderer.domElement.toDataURL("image/jpeg", 0.9).split(",")[1]!;
    const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return (await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: "POST", body })).ok;
  },
  /**
   * Scripted walk along an ENU polyline at `speed` m/s: steps the simulation at 1/fps and
   * captures every frame as <prefix>-NNNNN.jpg. Call repeatedly with `from` to resume (returns next index).
   */
  async walkCapture(poly: { x: number; y: number; z: number }[], prefix: string, from = 0, frames = 90, speed = 1.6, fps = 15) {
    const pts = poly.map((p) => enu(p));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    const total = cum[cum.length - 1]!;
    let k = from;
    for (; k < from + frames; k++) {
      const s = Math.min(total, (k * speed) / fps);
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < s) i++;
      const t = (s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
      const p = pts[i - 1]!.clone().lerp(pts[i]!, t);
      // look ~4 m ahead along the path for a smooth heading
      let j = i;
      while (j < cum.length - 1 && cum[j]! < s + 4) j++;
      const ahead = pts[j]!.clone().sub(p);
      const target = Math.atan2(-ahead.x, -ahead.z);
      if (ahead.lengthSq() > 1e-4) {
        const dyaw = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
        yaw += dyaw * Math.min(1, 6 / fps);
        camYaw += Math.atan2(Math.sin(yaw - camYaw), Math.cos(yaw - camYaw)) * Math.min(1, 3 / fps);
      }
      player.position.set(p.x, groundAt(p, 0.6) ?? p.y, p.z);
      bob += (speed / fps) * 5.5;
      step(1 / fps, true);
      const b64 = renderer.domElement.toDataURL("image/jpeg", 0.88).split(",")[1]!;
      await fetch(`/__capture?name=${prefix}-${String(k).padStart(5, "0")}`, { method: "POST", body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
      if (s >= total) return -1;
    }
    return k;
  },
  /** Advance n fixed 1/30 s frames synchronously (works while the tab is hidden). */
  tick(n = 30, hold: string[] = []) { hold.forEach((k) => keys.add(k)); for (let i = 0; i < n; i++) step(1 / 30, i === n - 1); hold.forEach((k) => keys.delete(k)); },
};
