import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Floor, Poi, StationBundle } from "@gteki/schema";
import { createRouter, routeBetween, type RouteEndpoint, type RouteProfile, type RouteResult } from "@gteki/navigation";
import { createSearchIndex } from "@gteki/search";
import { buildStation } from "../../scene/build.ts";
import { pointInRings, WalkWorld, type Plan } from "../../scene/layout.ts";
import { Player, PLAYER_RADIUS, sweepCamera, chooseFollowCamera, type GuidePoint, type MoveInput } from "./player.ts";
import { floorLabel, narrate, summarizeRoute, routeMapFrame, nearbyExits, explainStepFreeFailure, UNKNOWN_LABELS, type Maneuver } from "./narrate.ts";
import { createAvatar } from "./avatar.ts";
import { createStationAudio } from "./audio.ts";
import { CROWD_LIMIT, createCrowd } from "./crowd.ts";

import { placeProjectedLabel, type HudRect } from "./hud-layout.ts";
import { createStartupTimings, paintStartupFrame } from "./hud-startup.ts";

const startup = createStartupTimings();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const isTouch = matchMedia("(pointer: coarse)").matches;
const quality: "low" | "high" = (params.get("q") as "low" | "high") ?? (isTouch ? "low" : "high");
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionPreference.matches;
let bobEnabled = !reducedMotion;
let journey: "idle" | "preview" | "walking" | "guiding" | "arrived" = "idle";
function setJourney(value: typeof journey) {
  journey = value;
  document.body.dataset.journey = value;
  document.body.classList.toggle("has-route", value !== "idle");
}
function setPanel(expanded: boolean, focus = false) {
  $("panel").classList.toggle("collapsed", !expanded);
  $("panel-content").hidden = !expanded;
  $("search-pill").setAttribute("aria-expanded", String(expanded));
  $("sheet-handle").setAttribute("aria-expanded", String(expanded));
  $("search-chevron").textContent = expanded ? "⌃" : "⌄";
  document.body.classList.toggle("sheet-open", expanded);
  if (!expanded && $("panel-content").contains(document.activeElement)) $("search-pill").focus();
  if (focus) { document.body.classList.add("editing-route"); $("to").focus(); }
}
$("search-pill").onclick = () => setPanel(!!$("panel-content").hidden);
$("sheet-handle").onclick = () => setPanel(!!$("panel-content").hidden);
let sheetStartY = 0;
$("sheet-handle").addEventListener("pointerdown", (e) => { sheetStartY = e.clientY; $("sheet-handle").setPointerCapture(e.pointerId); });
$("sheet-handle").addEventListener("pointerup", (e) => {
  if (Math.abs(e.clientY - sheetStartY) > 24) {
    setPanel(e.clientY < sheetStartY);
    // Suppress the click following a completed drag.
    $("sheet-handle").onclick = null;
    setTimeout(() => { $("sheet-handle").onclick = () => setPanel(!!$("panel-content").hidden); }, 0);
  }
});
$("btn-bob").setAttribute("aria-pressed", String(bobEnabled));
$("btn-bob").onclick = () => {
  bobEnabled = !bobEnabled && !reducedMotion;
  $("btn-bob").setAttribute("aria-pressed", String(bobEnabled));
};
motionPreference.addEventListener("change", (e) => {
  reducedMotion = e.matches;
  if (reducedMotion) bobEnabled = false;
  $("btn-bob").setAttribute("aria-pressed", String(bobEnabled));
});

/** Completed phases, rather than an invented download percentage. */
function loadingStep(completed: number, ja: string, en: string) {
  $("loading-step").textContent = `${ja} · ${en}`;
  $("loading-count").textContent = `${completed} / 4`;
  $("loading-progress").setAttribute("aria-valuenow", String(completed));
  $("loading-progress").setAttribute("aria-valuetext", `${completed} / 4 · ${ja} · ${en}`);
  $("loading-fill").style.transform = `scaleX(${completed / 4})`;
}
loadingStep(0, "駅のデータを読み込み中", "Reading station data");
await paintStartupFrame();
startup.milestone("loading-paint");
startup.begin("bundle");
// Defer the JSON modules until the loading veil has had a chance to paint.
const [bundleModule, planModule] = await Promise.all([import("../../data/bundle.ts"), import("../../data/plan.json")]);
const { bundle } = bundleModule.loadShinjukuBundle();
const plan = planModule.default as unknown as Plan;
startup.complete("bundle");
loadingStep(1, "駅の空間を構築中", "Building station spaces");
await paintStartupFrame();

// ------------------------------------------------------------ renderer
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === "high" ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Post passes render too; reset stats once per frame so QA reads whole-frame calls/triangles.
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0c0d10");
scene.fog = new THREE.Fog("#1a1b1f", 30, 110);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight("#fff6ea", "#4a4642", 0.85));
const fill = new THREE.PointLight("#fff1dc", 1.2, 9, 2);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 400);

const station = startup.phase("station", () => buildStation(bundle, plan, { quality }));
scene.add(station.root);
const world = station.world;
const layout = station.layout;

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: quality === "high" ? 4 : 0 }));
composer.addPass(new RenderPass(scene, camera));
let gtao: GTAOPass | null = null;
if (quality === "high") {
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1 });
  composer.addPass(gtao);
}
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.45, 0.97);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------ data helpers
const router = createRouter(bundle);
const search = createSearchIndex(bundle);
const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
const floorById = new Map(bundle.floors.map((f) => [f.id, f]));
const nodeZ = (id: string) => layout.nodeZ.get(id) ?? 0;
// Fare side of a node from its non-gate links (gate links straddle the boundary); null = no evidence.
const nodeFare = new Map(bundle.nodes.map((n) => {
  const edges = bundle.edges.filter((e) => (e.from === n.id || e.to === n.id) && e.crossesFareBoundary !== true);
  return [n.id, !edges.length ? null : edges.every((e) => e.paid === true) ? "paid" : edges.every((e) => e.paid === false) ? "free" : null] as const;
}));
const levelFloors = bundle.floors.filter((f) => !f.intermediate).sort((a, b) => b.renderElevationM - a.renderElevationM);
function floorAtZ(z: number): Floor {
  let best = levelFloors[0]!;
  for (const f of levelFloors) if (Math.abs(f.renderElevationM - z) < Math.abs(best.renderElevationM - z)) best = f;
  // between levels on stairs: report the nearer
  return best;
}
/**
 * Walkable straight attachment p → node: the walker's body (WalkWorld collision, incl. props) swept
 * every 0.1 m over continuous ground, never pushed by a wall, arriving at the node's height.
 */
function attachable(p: { x: number; y: number; z: number }, id: string): boolean {
  const n = nodeById.get(id)!;
  if (world.firstWallHit(p, n.position, p.z + 1.0) < 0.999) return false;
  const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
  const steps = Math.max(1, Math.ceil(d / 0.1));
  let z: number | null = p.z;
  for (let i = 1; i <= steps; i++) {
    const q = { x: p.x + (n.position.x - p.x) * (i / steps), y: p.y + (n.position.y - p.y) * (i / steps) };
    z = world.groundAt(q, z);
    if (z === null) return false;
    const r = world.resolveWalls(q, z, PLAYER_RADIUS);
    if (Math.hypot(r.x - q.x, r.y - q.y) > 0.02) return false;
  }
  return z !== null && Math.abs(z - nodeZ(id)) <= 0.35;
}
function nearestNode(p: { x: number; y: number; z: number }) {
  const slab = layout.levels.flatMap((l) => l.slabs)
    .filter((s) => Math.abs(s.z - p.z) <= 0.6 && pointInRings(p, s.rings))
    .sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z))[0];
  const fare = slab?.fare ?? null;
  const cands: { id: string; d: number }[] = [];
  for (const n of bundle.nodes) {
    if (Math.abs(nodeZ(n.id) - p.z) > 0.6) continue;
    // a known fare side requires affirmative same-side evidence on the node
    if (fare !== null && nodeFare.get(n.id) !== fare) continue;
    const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
    if (d <= 15) cands.push({ id: n.id, d });
  }
  cands.sort((a, b) => a.d - b.d);
  let best: { id: string; d: number } | null = null;
  for (const c of cands) if (attachable(p, c.id)) {
    best = c;
    break;
  }
  return best;
}

// ------------------------------------------------------------ spawn
const gatePoi = bundle.pois.find((p) => p.category === "ticket_gate");
const spawnNode = nodeById.get(params.get("spawn") ?? "") ?? nodeById.get(gatePoi?.connectorNodeIds[0] ?? "") ?? bundle.nodes[0]!;
let spawnPos = { x: spawnNode.position.x, y: spawnNode.position.y, z: nodeZ(spawnNode.id) };
// step back from the gate line a few metres so the gates are in view
if (gatePoi?.displayPosition) {
  const gp = gatePoi.displayPosition;
  const d = { x: spawnPos.x - gp.x, y: spawnPos.y - gp.y };
  const L = Math.hypot(d.x, d.y) || 1;
  const back = { x: spawnPos.x + (d.x / L) * 4, y: spawnPos.y + (d.y / L) * 4 };
  const g = world.groundAt(back, spawnPos.z);
  if (g !== null) spawnPos = { ...back, z: g };
}
const player = new Player(world, spawnPos);
if (gatePoi?.displayPosition) player.heading = Math.atan2(gatePoi.displayPosition.x - spawnPos.x, gatePoi.displayPosition.y - spawnPos.y);

// The camera clears human-height props. Walker collision remains the complete world.
// Full-height architecture and floor/ceiling slabs still constrain every camera candidate.
const cameraWorld = new WalkWorld({ ...layout, runWalls: [], levels: layout.levels.map((level) => ({
  ...level, railings: [], walls: level.walls.filter((wall) => wall.zMax - wall.zMin > 1.9),
})) });
cameraWorld.addWalls(station.propWalls.filter((wall) => wall.zMax - wall.zMin > 1.9));
// Soffits (landing/shaft roofs, run undersides) too: without them the boom rose through a landing roof
// and looked down on the station from above it.
const cameraSurfaces = [...layout.levels.flatMap((l) => [...l.slabs, ...l.ceilings]), ...layout.pads, ...layout.streetPads, ...layout.soffits];
// Submit core geometry from the same safe spawn view and composer used in play.
// This avoids compiling extra materials for a separate preview camera or pipeline.
const previewHead = { x: player.x, y: player.y, z: player.z + 1.1 };
const previewEye = chooseFollowCamera(previewHead, player.heading, -0.28, 3.6, cameraWorld, cameraSurfaces);
camera.position.set(previewEye.x, previewEye.z, -previewEye.y);
camera.lookAt(player.x + Math.sin(player.heading) * 1.15, previewHead.z + 0.15, -(player.y + Math.cos(player.heading) * 1.15));
fill.position.set(player.x, player.z + 2.4, -player.y);
station.setViewer?.({ x: camera.position.x, y: -camera.position.z, z: camera.position.y });
renderer.info.reset();
composer.render(0);
startup.milestone("first-frame");
$("loading").classList.add("has-frame");
loadingStep(2, "通行人を準備中", "Preparing ambient commuters");
await paintStartupFrame();

const avatar = createAvatar(THREE, 0);
// Decorative ambient commuters (invented, not crowd data). ?crowd=0 disables.
const crowdDefault = quality === "high" ? 36 : 16;
const crowdParam = Number(params.get("crowd") ?? crowdDefault);
const crowdMax = Number.isNaN(crowdParam) ? crowdDefault : Math.max(0, Math.min(CROWD_LIMIT, Math.floor(crowdParam)));
const crowd = startup.phase("crowd", () => createCrowd(THREE, bundle, router, nodeZ, { max: crowdMax, seed: 27, playerAvatar: avatar }));
scene.add(crowd.group);
scene.add(avatar.object);
avatar.object.traverse((o) => ((o as THREE.Mesh).castShadow = false));
loadingStep(3, "操作と表示を準備中", "Preparing controls and views");
await paintStartupFrame();
startup.begin("surface-hooks");

// ------------------------------------------------------------ camera rig
const cam = { yaw: player.heading, pitch: -0.18, dist: 3.6, firstPerson: false, userTurnedAt: -10 };
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let cameraDistance = cam.dist;
let stairPitch = 0;
let transitionFocus = 0;
let camInit = false;
/** QA: fixed free camera in ENU metres (eye → look), used by the screenshot/recording harness. */
let viewOverride: { eye: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } | null = null;
function updateCamera(dt: number, t: number) {
  if (viewOverride) {
    const { eye, look } = viewOverride;
    camera.position.set(eye.x, eye.z, -eye.y);
    camera.lookAt(look.x, look.z, -look.y);
    avatar.object.visible = true;
    return;
  }
  const onRun = Math.abs(player.climbing) > 0.15;
  const target = player.guide?.[player.guideIndex];
  const pathHeading = target && onRun ? Math.atan2(target.x - player.x, target.y - player.y) : player.heading;
  // Stair framing follows the actual run even at the first captured guide frame.
  if (t - cam.userTurnedAt > 1.4 && (player.speed > 0.05 || player.carriedByEscalator)) {
    const d = Math.atan2(Math.sin(pathHeading - cam.yaw), Math.cos(pathHeading - cam.yaw));
    cam.yaw += d * (camInit ? 1 - Math.exp(-(onRun ? 7 : 3) * dt) : 1);
  }
  const targetPitch = onRun ? -0.22 - Math.max(0, -player.climbing) * 0.06 : 0;
  stairPitch += (targetPitch - stairPitch) * (camInit ? 1 - Math.exp(-5 * dt) : 1);
  const bob = bobEnabled && !reducedMotion && !player.carriedByEscalator ? -Math.cos(player.stridePhase * 2) * 0.012 * Math.min(1, player.speed / 1.45) : 0;
  const head = { x: player.x, y: player.y, z: player.z + (cam.firstPerson ? 1.62 : 1.1) + bob };
  transitionFocus *= Math.exp(-3 * dt);
  const pitch = cam.pitch - 0.1 + stairPitch - (reducedMotion ? 0 : transitionFocus * 0.04);
  const safe = cam.firstPerson ? head : chooseFollowCamera(head, cam.yaw, pitch, cam.dist, cameraWorld, cameraSurfaces);
  const want = new THREE.Vector3(safe.x, safe.z, -safe.y);
  const lookAhead = cam.firstPerson ? 4 : 1.15;
  const look = new THREE.Vector3(head.x + Math.sin(cam.yaw) * lookAhead, head.z + (cam.firstPerson ? Math.sin(cam.pitch) * 4 : 0.15), -(head.y + Math.cos(cam.yaw) * lookAhead));
  if (!camInit || reducedMotion || cam.firstPerson) {
    camPos.copy(want);
    camTarget.copy(look);
    camInit = true;
  }
  camPos.lerp(want, 1 - Math.exp(-8 * dt));
  camTarget.lerp(look, 1 - Math.exp(-12 * dt));
  const final = sweepCamera(head, { x: camPos.x, y: -camPos.z, z: camPos.y }, cameraWorld, cameraSurfaces);
  // Smoothing across two safe candidates can cross a corner. Use the safe candidate
  // immediately in that case, then recover smoothly once the corridor opens.
  const smoothedClearance = Math.hypot(final.x - head.x, final.y - head.y, final.z - head.z);
  const candidateClearance = Math.hypot(safe.x - head.x, safe.y - head.y, safe.z - head.z);
  if (smoothedClearance < Math.min(1.6, candidateClearance * 0.8)) camPos.copy(want);
  else camPos.set(final.x, final.z, -final.y);
  cameraDistance = Math.hypot(camPos.x - head.x, -camPos.z - head.y, camPos.y - head.z);
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  avatar.object.visible = !cam.firstPerson && cameraDistance >= 0.9;
}

// ------------------------------------------------------------ input
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { setPanel(false); canvas.focus(); }
  if ((e.target as HTMLElement).matches("input, button, summary, [contenteditable=true]") || document.querySelector("dialog[open]")) {
    return;
  }
  keys.add(e.code);
  if (e.code === "Slash") (e.preventDefault(), setPanel(true, true));
  if (e.code === "KeyV") cam.firstPerson = !cam.firstPerson;
  if (e.code === "KeyG") toggleGuide();
  if (e.code === "KeyM") toggleMap();
  if (e.code === "KeyE") interact();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

let dragging: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && e.clientX < innerWidth * 0.45) return;
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.focus();
  if (journey !== "preview" && journey !== "arrived") setPanel(false);
  canvas.setPointerCapture(e.pointerId);
  audio.start().catch(() => {});
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging || dragging.id !== e.pointerId) return;
  const s = e.pointerType === "touch" ? 0.008 : 0.005;
  cam.yaw += (e.clientX - dragging.x) * s;
  cam.pitch = Math.max(-1.1, Math.min(0.55, cam.pitch - (e.clientY - dragging.y) * s));
  cam.userTurnedAt = performance.now() / 1000;
  dragging.x = e.clientX;
  dragging.y = e.clientY;
});
const endDrag = (e: PointerEvent) => {
  if (dragging?.id === e.pointerId) dragging = null;
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("wheel", (e) => {
  cam.dist = Math.max(1.6, Math.min(7.5, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
}, { passive: true });

// touch joystick
const stick = { x: 0, y: 0, id: -1 as number, run: false };
{
  const el = $("stick");
  const knob = $("knob");
  const set = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) (dx /= m), (dy /= m);
    stick.x = dx;
    stick.y = -dy;
    knob.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  };
  el.addEventListener("pointerdown", (e) => {
    stick.id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    set(e);
    audio.start().catch(() => {});
  });
  el.addEventListener("pointermove", (e) => e.pointerId === stick.id && set(e));
  const end = (e: PointerEvent) => {
    if (e.pointerId !== stick.id) return;
    stick.id = -1;
    stick.x = stick.y = 0;
    knob.style.transform = "";
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  $("btn-run").addEventListener("click", () => {
    stick.run = !stick.run;
    $("btn-run").classList.toggle("on", stick.run);
    $("btn-run").setAttribute("aria-pressed", String(stick.run));
  });
  $("btn-act").addEventListener("click", () => interact());
}

function readInput(): MoveInput {
  if (document.querySelector("dialog[open]") || (document.activeElement as HTMLElement)?.matches("input, [contenteditable=true]")) return { forward: 0, strafe: 0, run: false };
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) + stick.y;
  const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) + stick.x;
  return { forward: Math.max(-1, Math.min(1, f)), strafe: Math.max(-1, Math.min(1, s)), run: keys.has("ShiftLeft") || keys.has("ShiftRight") || stick.run || Math.hypot(stick.x, stick.y) > 0.95 };
}

// ------------------------------------------------------------ audio
const audio = createStationAudio();
for (const e of station.escalators) audio.addEscalator(e.run.edgeId, e.run.a, e.run.b);
$("btn-sound").addEventListener("click", async () => {
  await audio.start();
  audio.setMuted(!audio.muted);
  player.stridePhase = 0;
  $("btn-sound").textContent = audio.muted ? "消音 Muted" : "音 Sound on";
});
canvas.addEventListener("pointerdown", async () => {
  if (audioPrimed) return;
  audioPrimed = true;
  await audio.start();
  audio.setMuted(false);
  player.stridePhase = 0;
  $("btn-sound").textContent = "音 Sound on";
}, { once: false });
let audioPrimed = false;

// ------------------------------------------------------------ search UI
type Pick = { kind: "here" } | { kind: "poi"; poi: Poi };
let fromPick: Pick = { kind: "here" };
let toPick: Pick | null = null;
let activeField: "from" | "to" = "to";
const ICON: Record<string, [string, string]> = { exit: ["出", "exit"], ticket_gate: ["改", ""], platform: ["E", "platform"], elevator: ["EV", ""], toilet: ["WC", ""], escalator: ["⇅", ""], stairs: ["⇵", ""] };
const CATEGORY: Record<string, string> = { exit: "出口 · Exit", ticket_gate: "改札 · Ticket gates", platform: "ホーム · Platform", elevator: "エレベーター · Elevator", toilet: "トイレ · Toilet", escalator: "エスカレーター · Escalator", stairs: "階段 · Stairs" };
function poiName(p: Poi) {
  return { ja: p.names.find((n) => n.lang === "ja")?.text ?? p.names[0]!.text, en: p.names.find((n) => n.lang === "en")?.text ?? "" };
}
function renderResults(q: string) {
  const ul = $("results");
  ul.innerHTML = "";
  const hits = q.trim() ? search.search(q, { limit: 8 }) : bundle.pois.filter((p) => ["exit", "platform", "ticket_gate", "toilet"].includes(p.category)).slice(0, 8).map((poi) => ({ poi, routable: poi.connectorNodeIds.length > 0, score: 0, matched: "" }));
  if (activeField === "from") {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ico">◎</span><span class="meta"><b>現在地</b><small>Current location</small></span>`;
    li.onclick = () => choose({ kind: "here" });
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); } };
    ul.appendChild(li);
  }
  for (const h of hits) {
    const li = document.createElement("li");
    const [ico, cls] = ICON[h.poi.category] ?? ["•", ""];
    const nm = poiName(h.poi);
    const fl = h.poi.floorId ? floorLabel(floorById.get(h.poi.floorId)).short : "";
    li.innerHTML = `<span class="ico ${cls}">${ico}</span><span class="meta"><b></b><small></small></span>${h.routable ? "" : '<span class="badge">案内不可 search-only</span>'}`;
    li.querySelector("b")!.textContent = nm.ja;
    li.querySelector("small")!.textContent = `${nm.en}${fl ? " · " + fl : ""}`;
    li.onclick = () => choose({ kind: "poi", poi: h.poi });
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); } };
    ul.appendChild(li);
  }
}
function choose(p: Pick) {
  if (activeField === "from") {
    fromPick = p;
    ($("from") as HTMLInputElement).value = p.kind === "here" ? "" : poiName(p.poi).ja;
  } else {
    toPick = p;
    ($("to") as HTMLInputElement).value = p.kind === "here" ? "" : poiName(p.poi).ja;
  }
  $("results").innerHTML = "";
  (document.activeElement as HTMLElement)?.blur();
  computeRoute();
}
for (const id of ["from", "to"] as const) {
  const el = $<HTMLInputElement>(id);
  el.addEventListener("focus", () => {
    activeField = id;
    document.body.classList.add("editing-route");
    renderResults(el.value);
    setPanel(true);
  });
  el.addEventListener("input", () => renderResults(el.value));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("results").querySelector("li") as HTMLElement | null)?.click();
    if (e.key === "ArrowDown") { e.preventDefault(); ($("results").querySelector("li") as HTMLElement | null)?.focus(); }
  });
}
$("results").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const choices = [...$("results").querySelectorAll<HTMLElement>("li")];
  const i = choices.indexOf(document.activeElement as HTMLElement);
  choices[(i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
});
$("ticketed").addEventListener("change", () => computeRoute());
$("stepfree").addEventListener("change", () => computeRoute());
$("clear").addEventListener("click", () => clearRoute());
$("guide").addEventListener("click", () => toggleGuide());
$("guide-pause").addEventListener("click", () => toggleGuide());
$("edit-route").onclick = () => {
  if (player.guide) { resumeIndex = player.guideIndex; player.stopGuide(); setJourney("walking"); }
  setPanel(true, true);
};
$("prompt").onclick = interact;
$("new-destination").onclick = () => { clearRoute(); toPick = null; $<HTMLInputElement>("to").value = ""; fromPick = { kind: "here" }; $<HTMLInputElement>("from").value = ""; setPanel(true, true); };
$("route-again").onclick = () => { clearRoute(); fromPick = { kind: "here" }; $<HTMLInputElement>("from").value = ""; setPanel(true, true); };

// ------------------------------------------------------------ route
let route: RouteResult | null = null;
let maneuvers: Maneuver[] = [];
let routePts: GuidePoint[] = [];
let resumeIndex = 1;
let lastVertical = -1;
let toastUntil = 0;
let cuePoint: GuidePoint | null = null;
const ribbonPlayer = { value: new THREE.Vector3() };
const ribbon = new THREE.Group();
scene.add(ribbon);
const chevronTex = (() => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "rgba(255,63,174,0.28)";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(20, 96);
  g.lineTo(64, 44);
  g.lineTo(108, 96);
  g.lineTo(88, 96);
  g.lineTo(64, 68);
  g.lineTo(40, 96);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
addEventListener("pagehide", (e) => {
  if (!e.persisted) { disposeRibbon(); chevronTex.dispose(); }
});
/** Today's calendar day at the station (Asia/Tokyo), "YYYY-MM-DD", for source staleness/expiry. */
function stationToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
function profile(): RouteProfile {
  return { fare: $<HTMLInputElement>("ticketed").checked ? "ticketed" : "unpaid_only", stepFree: $<HTMLInputElement>("stepfree").checked, today: stationToday() };
}
function computeRoute() {
  $("route-error").classList.add("hidden");
  if (!toPick || toPick.kind !== "poi") return;
  const goal = toPick.poi;
  if (!goal.connectorNodeIds.length) return showRouteError("この目的地は位置情報のみで、検証済みの入口がありません。This destination has no verified entrance node (search-only).");
  let origin: RouteEndpoint;
  if (fromPick.kind === "poi") origin = { kind: "poi", poi: fromPick.poi };
  else {
    const here = nearestNode(player);
    if (!here) return showRouteError("現在地から経路に接続できません。出発地を選んでください / Can't connect your position to the network — choose a start point");
    origin = { kind: "node", nodeId: here.id };
  }
  // shared helper: POI fare check under unpaid-only (fails closed) + both POIs' evidence
  const r = routeBetween(router, origin, goal, profile());
  if (!r.ok) {
    const why: Record<string, string> = {
      no_path: /paid area/.test(r.message)
        ? "改札内（または改札内外が未確認）の施設のため、「きっぷ・IC あり」なしでは案内できません。This place is inside, or not known to be outside, the paid area."
        : "条件を満たす検証済み経路がありません（例: 段差なし・改札外のみ）。No verified route satisfies the profile.",
      start_equals_goal: "すでに目的地にいます。You are already there.",
      unknown_start: "出発地が不明です。Unknown origin.",
      unknown_goal: "目的地が不明です。Unknown destination.",
    };
    if (profile().stepFree && r.reason === "no_path" && !/paid area/.test(r.message)) {
      const refusal = explainStepFreeFailure(bundle, router, origin, goal, profile());
      showRouteError(`${refusal.reason.ja} ${refusal.reason.en}`);
      if (refusal.alternative) {
        const alternative = refusal.alternative;
        const button = document.createElement("button");
        button.className = "ghost alternative";
        const name = poiName(alternative.poi);
        button.textContent = `段差なし: ${name.ja} · Step-free: ${name.en} · ${alternative.distanceM} m`;
        button.onclick = () => {
          toPick = { kind: "poi", poi: alternative.poi };
          $<HTMLInputElement>("to").value = name.ja;
          computeRoute();
        };
        $("route-error").appendChild(button);
      }
      return;
    }
    return showRouteError(why[r.reason] ?? r.message);
  }
  clearRoute();
  route = r;
  maneuvers = narrate(bundle, r);
  routePts = r.nodeIds.map((id, i) => ({ ...nodeById.get(id)!.position, z: nodeZ(id), nodeId: id, elevator: i > 0 && r.steps[i - 1]!.mode === "elevator", escalator: i > 0 && r.steps[i - 1]!.mode === "escalator" }));
  // start the guide from the player's current position when starting "here"
  if (fromPick.kind === "here") routePts.unshift({ x: player.x, y: player.y, z: player.z, nodeId: "here" });
  drawRibbon();
  renderRoutePanel();
  document.body.classList.remove("editing-route");
  setJourney("preview");
  setPanel(true);
  $("search-label").textContent = `${poiName(goal).ja} · ${poiName(goal).en}`;
  $("guide").focus();
}
function showRouteError(msg: string) {
  clearRoute();
  $("results").replaceChildren();
  $("route-error").textContent = msg;
  $("route-error").classList.remove("hidden");
  setPanel(true);
  requestAnimationFrame(() => $("route-error").scrollIntoView({ block: "nearest" }));
}
function clearRoute() {
  route = null;
  maneuvers = [];
  routePts = [];
  player.stopGuide();
  routeOffSince = -1;
  resumeIndex = 1;
  lastVertical = -1;
  cuePoint = null;
  setJourney("idle");
  disposeRibbon();
  $("route").classList.add("hidden");
  $("next").classList.add("hidden");
  for (const id of ["arrival", "journey-evidence", "maneuver-anchor", "destination-label", "floor-toast"]) $(id).classList.add("hidden");
  $("guide").textContent = "▶ 出発 Start";
  $("search-label").innerHTML = "どこへ行きますか？ <small>Find a destination</small>";
}
function disposeRibbon() {
  const materials = new Set<THREE.Material>();
  ribbon.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const m of materials) m.dispose();
  ribbon.clear();
}
function drawRibbon() {
  disposeRibbon();
  const ribbonMat = new THREE.MeshBasicMaterial({ map: chevronTex, transparent: true, depthWrite: false, color: "#f0d8b2", side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  ribbonMat.onBeforeCompile = (shader) => {
    shader.uniforms.guidancePlayer = ribbonPlayer;
    shader.vertexShader = "varying vec3 guidancePosition;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nguidancePosition = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = "varying vec3 guidancePosition;\nuniform vec3 guidancePlayer;\n" + shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= smoothstep(0.65, 2.2, distance(guidancePosition, guidancePlayer)) * (1.0 - smoothstep(5.0, 10.0, abs(guidancePosition.y - guidancePlayer.y))); ");
  };
  // Original navigation marker, not station equipment. Visible through floors.
  const beaconMat = new THREE.MeshBasicMaterial({ color: "#e8d7b2", transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let acc = 0;
  const W = 0.32;
  for (let i = 1; i < routePts.length; i++) {
    const a = routePts[i - 1]!;
    const b = routePts[i]!;
    if (b.elevator) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.05) continue;
    const nx = (-(b.y - a.y) / L) * W;
    const ny = ((b.x - a.x) / L) * W;
    const base = pos.length / 3;
    // Above the symbolic stair treads / moving escalator steps, without changing ground.
    const lift = Math.abs(b.z - a.z) > 0.05 ? 0.22 : 0.055;
    const za = a.z + lift;
    const zb = b.z + lift;
    pos.push(a.x + nx, za, -(a.y + ny), a.x - nx, za, -(a.y - ny), b.x + nx, zb, -(b.y + ny), b.x - nx, zb, -(b.y - ny));
    const L3 = Math.hypot(L, b.z - a.z);
    uv.push(0, acc / 0.8, 1, acc / 0.8, 0, (acc + L3) / 0.8, 1, (acc + L3) / 0.8);
    acc += L3;
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, ribbonMat);
  m.renderOrder = 5;
  ribbon.add(m);
  const end = routePts[routePts.length - 1]!;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), beaconMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(end.x, end.z + 0.06, -end.y);
  ring.renderOrder = 6;
  ribbon.add(ring);
}
const MI: Record<string, string> = { walk: "↑", turn: "↱", stairs: "⇵", escalator: "⇅", elevator: "⇕", gate: "▥", ramp: "◢", arrive: "◎" };
function renderRoutePanel() {
  if (!route) return;
  $("route").classList.remove("hidden");
  const summary = summarizeRoute(bundle, route);
  $("route-origin").textContent = fromPick.kind === "poi" ? `出発 From: ${poiName(fromPick.poi).ja} / ${poiName(fromPick.poi).en} · 選択した位置から開始 / Start places you at this origin` : "現在のアバター位置から開始 · Start from the avatar’s current location";
  $("route-dist").textContent = `${summary.distanceM} m`;
  $("route-eta").textContent = `約 ${summary.minutes} 分 · ~${summary.minutes} min`;
  $("route-floors").textContent = `${summary.floorLabels.join(" → ")} · ${summary.floorChanges} 回の階移動 / floor changes${profile().stepFree ? " · 段差なし Step-free" : ""}`;
  $("route-fare").textContent = `${summary.fare.ja} · ${summary.fare.en}`;
  const ol = $("steps");
  ol.innerHTML = "";
  maneuvers.forEach((m, i) => {
    const li = document.createElement("li");
    li.dataset.i = String(i);
    li.innerHTML = `<span class="si">${m.kind === "turn" ? (m.en.includes("left") ? "↰" : "↱") : MI[m.kind]}</span><span><b></b><small></small></span>`;
    li.querySelector("b")!.textContent = m.ja;
    li.querySelector("small")!.textContent = m.en;
    ol.appendChild(li);
  });
  const un = $("unknowns");
  un.innerHTML = "";
  for (const u of route.unknowns) {
    const s = document.createElement("span");
    s.textContent = `${UNKNOWN_LABELS[u.kind]?.ja ?? u.kind} · ${UNKNOWN_LABELS[u.kind]?.en ?? ""}`;
    s.title = `${u.edgeIds.length} edges`;
    un.appendChild(s);
  }
  if (route.expiredSourceIds.length || route.stale === true) {
    const s = document.createElement("span");
    s.className = "warn";
    s.textContent = route.expiredSourceIds.length ? "出典の有効期限切れ · Source validity ended" : "データが古い可能性 · Data may be outdated";
    s.title = [...route.expiredSourceIds].join(", ");
    un.appendChild(s);
  }
  const src = bundle.sources.filter((s) => route!.sourceIds.includes(s.id));
  $("prov").textContent = `根拠 Evidence: ${src.map((s) => s.publisher).filter((v, i, a) => a.indexOf(v) === i).join(", ")} · データ Data ${route.oldestSourceDate ?? "未確認 / unverified"} · 確認 Checked ${route.evidenceCheckedDate ?? "未確認 / unverified"} · 高さは推定 Heights estimated · 現地表示を確認 Check local signs`;
  const trust = route.synthetic ? "仮想データ Synthetic" : "公開データ由来 · Public-data route";
  const freshness = route.stale === true ? "古い可能性 · May be outdated" : route.stale === null ? "時効未確認 · Freshness unverified" : "";
  $("evidence-detail").textContent = `${trust} · ${route.oldestSourceDate ?? "date unknown"}${freshness ? " · " + freshness : ""} · ${summary.fare.ja} / ${summary.fare.en} · ${$("unknowns").textContent} · 高さは推定 Heights estimated`;
  const unverified = route.unknowns.length;
  $("evidence-toggle").textContent = `ⓘ 未確認 ${unverified} · Unverified ${unverified}`;
  $("hours-chip").classList.toggle("hidden", !route.unknowns.some((u) => u.kind === "hours"));
  $<HTMLDetailsElement>("evidence-disclosure").open = false;
  $("journey-evidence").classList.remove("hidden");
}
$("guide-speed").onclick = () => {
  const speed = player.guideSpeedMultiplier === 1 ? 2 : player.guideSpeedMultiplier === 2 ? 4 : 1;
  player.setGuideSpeed(speed);
  $("guide-speed").textContent = `×${speed}`;
  $("guide-speed").setAttribute("aria-label", `案内速度 ${speed} 倍 · Guide speed ${speed} times. Click to change`);
};
function toggleGuide() {
  if (!route) return;
  if (journey === "arrived") { setPanel(true, true); return; }
  if (player.guide) {
    resumeIndex = player.guideIndex;
    player.stopGuide();
    setJourney("walking");
    $("guide").textContent = "▶ 再開 Resume";
    $("guide-pause").textContent = "▶";
    return;
  }
  // Resume from the actual body-swept attachment. A manual detour must never
  // create a straight shortcut back to an old route node through a wall.
  if (journey !== "preview") {
    fromPick = { kind: "here" };
    $<HTMLInputElement>("from").value = "";
    computeRoute();
  }
  if (!route) return;
  if (fromPick.kind === "poi" && journey === "preview") { player.teleport(routePts[0]!); camInit = false; }
  player.startGuide(routePts);
  player.guideIndex = resumeIndex;
  setJourney("guiding");
  setPanel(false);
  canvas.focus();
  $("guide").textContent = "⏸ 停止 Pause";
  $("guide-pause").textContent = "Ⅱ";
  audio.uiClick();
}
player.onGuideEvent = (e) => {
  if (e.type === "elevator") {
    fadeFlash();
    camInit = false;
    const index = routePts.findIndex((p) => p.nodeId === e.point.nodeId) - 1 - (routePts[0]?.nodeId === "here" ? 1 : 0);
    const m = [...maneuvers].reverse().find((m) => m.kind === "elevator" && m.startIndex <= index);
    if (m) showFloorToast(m);
  } else if (e.type === "arrived") {
    showArrival();
  }
};
function fadeFlash() {
  if (reducedMotion) { camInit = false; return; }
  $("fade").classList.add("on");
  setTimeout(() => $("fade").classList.remove("on"), 380);
}

function showArrival() {
  if (journey === "arrived" || !toPick || toPick.kind !== "poi") return;
  player.stopGuide();
  setJourney("arrived");
  setPanel(false);
  $("next").classList.add("hidden");
  $("maneuver-anchor").classList.add("hidden");
  $("destination-label").classList.add("hidden");
  $("floor-toast").classList.add("hidden");
  const p = toPick.poi, name = poiName(p);
  const end = routePts[routePts.length - 1]!;
  const floorId = nodeById.get(end.nodeId)?.floorId ?? p.floorId;
  $("arrival-name").textContent = `${name.ja} · ${name.en}`;
  const floor = floorById.get(floorId ?? "");
  $("arrival-eyebrow").textContent = p.category === "exit" && floor?.ordinal === 0
    ? "地上に出ました · You are at street level" : "◎ 到着しました · You have arrived";
  $("arrival-place").textContent = `${floorLabel(floor).short} · ${CATEGORY[p.category] ?? "施設 · Facility"}`;
  // Graph-routed distances on the destination floor; no invented exit numbers or compass directions.
  const exits = p.category === "exit" ? [] : nearbyExits(bundle, router, end.nodeId, profile());
  $("arrival-exits").textContent = exits.length ? `近くの出口 Nearby exits: ${exits.map((x) => `${poiName(x.poi).ja} / ${poiName(x.poi).en} · ${x.distanceM} m`).join(" · ")}` : "";
  $("arrival-exits").hidden = exits.length === 0;
  $("arrival").classList.remove("hidden");
  $("guide").textContent = "▶ 出発 Start";
  audio.arrivalChime();
  $("new-destination").focus({ preventScroll: true });
}

function showFloorToast(m: Maneuver) {
  if (!m.fromFloorLabel || !m.toFloorLabel || m.fromFloorLabel === m.toFloorLabel || m.startIndex === lastVertical) return;
  lastVertical = m.startIndex;
  const mode = { stairs: "階段 · Stairs", escalator: "エスカレーター · Escalator", elevator: "エレベーター · Elevator", ramp: "スロープ · Ramp" }[m.kind as "stairs" | "escalator" | "elevator" | "ramp"] ?? "";
  $("floor-toast").textContent = `${m.fromFloorLabel} → ${m.toFloorLabel} · ${mode}`;
  $("floor-toast").classList.remove("hidden");
  toastUntil = performance.now() + 3800;
  transitionFocus = reducedMotion ? 0 : 1;
}

// progress along route → next maneuver
function updateNext() {
  if (!route || !routePts.length || journey === "arrived" || journey === "preview") return;
  let bestI = 0, bestD = Infinity, along = 0;
  // Project onto segments, rather than nearest nodes (long corridors have few nodes).
  for (let i = 0; i < routePts.length - 1; i++) {
    const a = routePts[i]!, b = routePts[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z - a.z) * 3;
    const t = Math.max(0, Math.min(1, ((player.x - a.x) * dx + (player.y - a.y) * dy + (player.z - a.z) * 3 * dz) / (dx * dx + dy * dy + dz * dz || 1)));
    const d = Math.hypot(player.x - a.x - dx * t, player.y - a.y - dy * t, (player.z - a.z) * 3 - dz * t);
    if (d < bestD) { bestD = d; bestI = i; along = t; }
  }
  if (player.guide) { bestI = Math.max(0, player.guideIndex - 1); resumeIndex = player.guideIndex; }
  const end = routePts[routePts.length - 1]!;
  if (!player.guide && Math.hypot(player.x - end.x, player.y - end.y) < 0.8 && Math.abs(player.z - end.z) < 0.35) { showArrival(); return; }
  const offset = routePts[0]?.nodeId === "here" ? 1 : 0;
  const nodeIndex = Math.max(0, bestI - offset);
  let cur = 0;
  for (let i = 0; i < maneuvers.length; i++) if (maneuvers[i]!.startIndex <= nodeIndex) cur = i;
  const current = maneuvers[cur]!;
  const upcoming = maneuvers.slice(cur + 1).find((m) => m.kind !== "walk") ?? current;
  let rem = 0;
  for (let i = bestI; i < Math.min(routePts.length - 1, upcoming.startIndex + offset); i++) {
    const a = routePts[i]!, b = routePts[i + 1]!;
    rem += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * (i === bestI ? 1 - along : 1);
  }
  const show = current.kind === "walk" && rem < 14 ? upcoming : current;
  $("next").classList.remove("hidden");
  $("next-icon").textContent = show.kind === "turn" ? (show.en.includes("left") ? "↰" : "↱") : MI[show.kind]!;
  $("next-ja").textContent = `${show.ja}${show === upcoming && rem > 3 ? ` · あと ${Math.round(rem)} m` : ""}`;
  $("next-en").textContent = `${show.en}${show === upcoming && rem > 3 ? ` · in ${Math.round(rem)} m` : ""}`;
  cuePoint = routePts[Math.min(routePts.length - 1, show.startIndex + offset)]!;
  $("maneuver-anchor").textContent = `${$("next-icon").textContent} ${show.kind === "turn" ? (show.en.includes("left") ? "左 Left" : "右 Right") : show.toFloorLabel ?? `${Math.round(rem)} m`}`;
  document.querySelectorAll("#steps li").forEach((li) => li.classList.toggle("cur", Number((li as HTMLElement).dataset.i) === maneuvers.indexOf(show)));
  showFloorToast(current);
  if (bestD > 9 && !player.guide && routeOffSince < 0) routeOffSince = performance.now();
  if (bestD <= 9) routeOffSince = -1;
  if (routeOffSince > 0 && performance.now() - routeOffSince > 2500 && fromPick.kind === "here") {
    computeRoute(); // Uses the same body-swept current-location attachment as initial routing.
  }
}
const labelHud = [...document.querySelectorAll<HTMLElement>("#hud-top .brand, #hud-top .floor, #next, #journey-evidence, #evidence-detail, #floor-toast, #minimap, #panel, #foot, #stick, #btn-run, #btn-act, #prompt, #arrival")];
function visibleHudRect(el: HTMLElement): HudRect | null {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return !rect.width || !rect.height || style.display === "none" || style.visibility === "hidden" ? null : rect;
}
function projectLabel(id: string, point: GuidePoint, height: number, clamp: boolean) {
  const el = $(id);
  const p = new THREE.Vector3(point.x, point.z + height, -point.y).project(camera);
  const inFront = p.z > -1 && p.z < 1;
  const visible = inFront && (clamp || (Math.abs(p.x) < 0.85 && Math.abs(p.y) < 0.7 && Math.abs(point.z - player.z) < 4));
  el.classList.toggle("hidden", !visible);
  if (!visible) return;
  const obstacles = labelHud.flatMap((element) => { const rect = visibleHudRect(element); return rect ? [rect] : []; });
  // Reserve the entire band occupied by guidance and its evidence chips.
  const guidanceBottom = ["next", "journey-evidence"].reduce((bottom, name) => {
    const rect = visibleHudRect($(name));
    return rect ? Math.max(bottom, rect.y + rect.height + 8) : bottom;
  }, 90);
  if (id === "destination-label") {
    const cue = visibleHudRect($("maneuver-anchor"));
    if (cue) obstacles.push(cue);
  }
  const bottom = innerWidth <= 600 ? innerHeight - 324 : innerHeight - 110;
  const placed = placeProjectedLabel(
    { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 },
    { width: el.offsetWidth, height: el.offsetHeight },
    { x: 12, y: guidanceBottom, width: innerWidth - 24, height: bottom - guidanceBottom }, obstacles,
  );
  el.classList.toggle("hidden", !placed);
  if (placed) el.style.transform = `translate(${placed.x}px, ${placed.y}px)`;
}
function updateWorldLabels() {
  if (!route || journey === "arrived") return;
  if (cuePoint && journey !== "preview") projectLabel("maneuver-anchor", cuePoint, 0.9, false);
  else $("maneuver-anchor").classList.add("hidden");
  const end = routePts[routePts.length - 1]!;
  if (toPick?.kind === "poi") {
    const f = nodeById.get(end.nodeId)?.floorId ?? toPick.poi.floorId;
    $("destination-label").textContent = `◎ ${poiName(toPick.poi).ja} / ${poiName(toPick.poi).en} · ${floorLabel(floorById.get(f ?? "")).short}`;
    projectLabel("destination-label", end, 1.4, true);
  }
}
let routeOffSince = -1;

// ------------------------------------------------------------ elevators
const elevatorPois = bundle.pois.filter((p) => p.category === "elevator");
let nearElevator: Poi | null = null;
function updatePrompt() {
  nearElevator = null;
  for (const p of elevatorPois)
    for (const id of p.connectorNodeIds) {
      const n = nodeById.get(id)!;
      if (Math.abs(nodeZ(id) - player.z) < 0.6 && Math.hypot(n.position.x - player.x, n.position.y - player.y) < 2.2) nearElevator = p;
    }
  const pr = $("prompt");
  if (nearElevator && !player.guide) {
    pr.innerHTML = `<kbd>E</kbd>エレベーターに乗る · Use elevator`;
    pr.classList.remove("hidden");
    $("btn-act").classList.remove("hidden");
  } else {
    pr.classList.add("hidden");
    $("btn-act").classList.add("hidden");
  }
}
function interact() {
  if (!nearElevator) return;
  const dlg = $<HTMLDialogElement>("dlg-elev");
  const box = $("elev-floors");
  box.innerHTML = "";
  const stops = nearElevator.connectorNodeIds
    .map((id) => ({ id, f: floorById.get(nodeById.get(id)!.floorId)! }))
    .filter((s, i, a) => a.findIndex((x) => x.f.id === s.f.id) === i)
    .sort((a, b) => b.f.renderElevationM - a.f.renderElevationM);
  for (const s of stops) {
    const b = document.createElement("button");
    b.textContent = floorLabel(s.f).short;
    if (Math.abs(nodeZ(s.id) - player.z) < 0.6) b.classList.add("here");
    b.onclick = () => {
      dlg.close();
      fadeFlash();
      setTimeout(() => {
        const n = nodeById.get(s.id)!;
        player.teleport({ x: n.position.x, y: n.position.y, z: nodeZ(s.id) });
        camInit = false;
      }, 300);
    };
    box.appendChild(b);
  }
  dlg.showModal();
}

// ------------------------------------------------------------ minimap
const mm = $<HTMLCanvasElement>("minimap");
const mmc = mm.getContext("2d")!;
function toggleMap() { mm.classList.toggle("big"); mm.setAttribute("aria-pressed", String(mm.classList.contains("big"))); }
mm.onclick = toggleMap;
mm.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMap(); } };
function drawMinimap() {
  const W = mm.width;
  const big = mm.classList.contains("big");
  const overview = journey === "preview" ? routeMapFrame(routePts, W) : null;
  const scale = overview?.scale ?? (big ? 2.2 : 3.2);
  const center = overview ?? player;
  mmc.setTransform(1, 0, 0, 1, 0, 0);
  mmc.clearRect(0, 0, W, W);
  mmc.fillStyle = "rgba(14,16,20,0.92)";
  mmc.fillRect(0, 0, W, W);
  mmc.save();
  mmc.translate(W / 2, W / 2);
  if (!big && !overview) mmc.rotate(-cam.yaw);
  mmc.scale(scale, -scale);
  mmc.translate(-center.x, -center.y);
  const lvFloor = floorAtZ(player.z);
  for (const lv of layout.levels) {
    const isCur = lv.floorId === lvFloor.id;
    if (!overview && !isCur && Math.abs(lv.z - player.z) > 9) continue;
    mmc.globalAlpha = isCur ? 1 : overview ? 0.28 : 0.18;
    for (const s of lv.slabs) {
      mmc.beginPath();
      for (const ring of s.rings) {
        ring.forEach((p, i) => (i ? mmc.lineTo(p.x, p.y) : mmc.moveTo(p.x, p.y)));
        mmc.closePath();
      }
      mmc.fillStyle = s.fare === "paid" ? "#3d3a46" : "#45484e";
      mmc.fill("evenodd");
    }
  }
  mmc.globalAlpha = 1;
  // route
  if (routePts.length > 1) {
    mmc.lineWidth = overview ? 3 / scale : 1.4;
    mmc.lineCap = "round";
    mmc.lineJoin = "round";
    for (let i = 1; i < routePts.length; i++) {
      const a = routePts[i - 1]!;
      const b = routePts[i]!;
      if (b.elevator) continue;
      const near = Math.abs((a.z + b.z) / 2 - player.z) < 2.5;
      mmc.strokeStyle = overview ? "#eedcb8" : near ? "#eedcb8" : "rgba(238,220,184,0.3)";
      mmc.beginPath();
      mmc.moveTo(a.x, a.y);
      mmc.lineTo(b.x, b.y);
      mmc.stroke();
    }
    const e = routePts[routePts.length - 1]!;
    mmc.fillStyle = "#ffd84a";
    mmc.beginPath();
    mmc.arc(e.x, e.y, overview ? 6 / scale : 2.2, 0, Math.PI * 2);
    mmc.fill();
  }
  // POIs on this level
  for (const p of bundle.pois) {
    if (!p.displayPosition || (p.floorId && Math.abs((floorById.get(p.floorId)?.renderElevationM ?? 99) - player.z) > 3)) continue;
    mmc.fillStyle = p.category === "exit" ? "#f4c81a" : p.category === "ticket_gate" ? "#7fd3ff" : p.category === "toilet" ? "#9be39b" : "#ddd";
    mmc.fillRect(p.displayPosition.x - 1.2, p.displayPosition.y - 1.2, 2.4, 2.4);
  }
  mmc.restore();
  // player arrow
  mmc.save();
  mmc.translate(W / 2 + (player.x - center.x) * scale, W / 2 - (player.y - center.y) * scale);
  mmc.rotate(big || overview ? player.heading : player.heading - cam.yaw);
  mmc.fillStyle = "#ffffff";
  mmc.beginPath();
  mmc.moveTo(0, -14);
  mmc.lineTo(9, 10);
  mmc.lineTo(0, 5);
  mmc.lineTo(-9, 10);
  mmc.closePath();
  mmc.fill();
  mmc.restore();
  mmc.fillStyle = "rgba(255,255,255,0.75)";
  mmc.font = "700 22px sans-serif";
  mmc.fillText(overview ? "経路全体 · Route overview" : floorLabel(lvFloor).short, 16, 34);
}

// ------------------------------------------------------------ coverage / help dialogs
$("btn-help").addEventListener("click", () => $<HTMLDialogElement>("dlg-help").showModal());
$("btn-cov").addEventListener("click", () => {
  const c = bundle.coverage;
  const rows = c.gaps.map((g) => `<tr><td>${esc(g.zone)}</td><td>${esc(g.missingFact)}</td><td>${esc(g.fieldWorkNeeded)}</td></tr>`).join("");
  const srcs = bundle.sources.map((s) => `<li>${esc(s.title)} — ${esc(s.publisher)} · ${esc(s.license?.name ?? "")} · dataset ${esc(s.datasetDate ?? "?")} ${s.validUntil ? `· 有効期限 ${esc(s.validUntil)}` : ""}${s.notes ? `<br><small>${esc(s.notes)}</small>` : ""}</li>`).join("");
  $("cov-body").innerHTML = `<h3>データ範囲と未確認事項 Coverage &amp; gaps</h3><p>${esc(c.summary[0]!.text)}<br><small>${esc(c.summary[1]?.text ?? "")}</small></p><table><tr><th>範囲 Zone</th><th>欠落 Missing</th><th>必要な調査 Needed</th></tr>${rows}</table><h4>出典 Sources</h4><ul>${srcs}</ul><p><small>表示用の階高さ・改札機の台数・ホーム柵・案内サインの意匠は GTEki による簡略表現で、実物の再現ではありません。Visual details (heights, gate machine count, platform doors, sign design) are GTEki simplifications, not reproductions.<br>地上の建物・道路は PLATEAU の外形と高さを簡略化したもので、外観・出入口上屋・街路設備は GTEki の表現です。Street buildings and roads are simplified PLATEAU outlines and heights; facades, entrance canopies and street furniture are GTEki's own rendering.</small></p><p>通勤客の動き・列車の発着とドアの開閉は演出であり、実際の混雑や時刻表ではありません。<br><small>Commuters, train arrivals and door cycles are simulated ambience — not real crowd data or timetables.</small></p>`;
  $<HTMLDialogElement>("dlg-cov").showModal();
});
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ------------------------------------------------------------ loop
const clock = new THREE.Clock();
let fpsAcc = 0;
let fpsN = 0;
let fps = 0;
/** QA: simulated time offset so automated reviews can jump the train cycle etc. */
let simOffset = 0;
function frame() {
  step(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(frame);
}
function step(dt: number, render = true) {
  const t = clock.elapsedTime + simOffset;
  const input = readInput();
  const manual = Math.abs(input.forward) > 0.05 || Math.abs(input.strafe) > 0.05;
  if (manual) {
    if (journey === "guiding") resumeIndex = player.guideIndex;
    if (route && journey !== "arrived") setJourney("walking");
    if (!$("panel-content").hidden) setPanel(false);
    $("guide-pause").textContent = "▶";
    $("guide").textContent = "▶ 案内歩行 Guide";
  }
  if (!document.querySelector("dialog[open]")) player.update(dt, input, cam.yaw);
  else { player.speed = player.vx = player.vy = player.stridePhase = 0; }
  if (!render) {
    // Fast-forward uses the same camera integration as normal play, without GPU work.
    updateCamera(dt, performance.now() / 1000);
    return;
  }
  station.update(dt, t);
  crowd.update(dt, { x: player.x, y: player.y, z: player.z });
  updateCamera(dt, performance.now() / 1000);
  station.setViewer?.({ x: camera.position.x, y: -camera.position.z, z: camera.position.y }); // W2: cull street from underground passes.
  avatar.object.position.set(player.x, player.z, -player.y);
  avatar.object.rotation.y = -player.heading + Math.PI; // avatar faces -Z (north) at rotation 0... heading 0 = north
  avatar.object.rotation.y = -player.heading;
  avatar.update(dt, player.carriedByEscalator ? 0 : player.speed, { onStairs: !player.carriedByEscalator && Math.abs(player.climbing) > 0.2, climbing: player.carriedByEscalator ? 0 : player.climbing });
  fill.position.set(player.x, player.z + 2.4, -player.y);
  if (!reducedMotion) chevronTex.offset.y = (chevronTex.offset.y - dt * 0.65) % 1;
  ribbonPlayer.value.set(player.x, player.z, -player.y);
  const lv = floorAtZ(player.z);
  const fl = floorLabel(lv);
  $("floor-label").textContent = fl.short;
  $("floor-sub").textContent = `推定 ${lv.renderElevationM.toFixed(0)} m · est.`;
  audio.update(dt, { x: player.x, y: player.y, z: player.z, heading: cam.yaw }, { speed: player.carriedByEscalator ? 0 : player.speed, onStairs: Math.abs(player.climbing) > 0.2, onEscalator: player.carriedByEscalator, levelLabel: fl.short, ceilingHeight: 3.2 });
  if (route) updateNext();
  updateWorldLabels();
  if (performance.now() > toastUntil) $("floor-toast").classList.add("hidden");
  updatePrompt();
  drawMinimap();
  renderer.info.reset();
  crowd.prepareRender(camera);
  composer.render(dt);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 1) (fps = fpsN / fpsAcc), (fpsAcc = 0), (fpsN = 0);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------ automation / QA hooks
declare global {
  interface Window {
    __gteki: unknown;
  }
}
const qaHooks = {
  timings: startup.snapshot,
  player,
  cam,
  bundle,
  routeTo(poiId: string, fromPoiId?: string) {
    const p = bundle.pois.find((x) => x.id === poiId);
    if (!p) return "no poi";
    const fromPoi = fromPoiId ? bundle.pois.find((x) => x.id === fromPoiId) : null;
    if (fromPoiId && !fromPoi) return "no origin poi";
    fromPick = fromPoi ? { kind: "poi", poi: fromPoi } : { kind: "here" };
    $<HTMLInputElement>("from").value = fromPoi ? poiName(fromPoi).ja : "";
    $<HTMLInputElement>("to").value = poiName(p).ja;
    toPick = { kind: "poi", poi: p };
    computeRoute();
    return route ? { m: Math.round(route.totalLengthM), steps: maneuvers.map((m) => m.ja) } : $("route-error").textContent;
  },
  guide: toggleGuide,
  /** Capture real guide progress, never manufacture an arrival event. */
  walkUntil(stage: "stairs" | "arrival", maxSeconds = 600, minRunDistance = 0) {
    if (!route) return { ok: false, reason: "no route" };
    let elapsed = 0;
    for (; elapsed < maxSeconds; elapsed += 1 / 30) {
      step(1 / 30, false);
      const stepIndex = Math.max(0, player.guideIndex - 1 - (routePts[0]?.nodeId === "here" ? 1 : 0));
      const mode = route.steps[stepIndex]?.mode;
      const runStart = routePts[Math.max(0, player.guideIndex - 1)]!;
      const alongRun = Math.hypot(player.x - runStart.x, player.y - runStart.y, player.z - runStart.z);
      if (stage === "stairs" && player.guide && (mode === "stairs" || mode === "escalator") && Math.abs(player.climbing) > 0.2 && alongRun >= minRunDistance) { camInit = false; step(0); return { ok: true, elapsed, mode }; }
      if (stage === "arrival" && journey === "arrived") { camInit = false; step(0); return { ok: true, elapsed }; }
      if (!player.guide) return { ok: false, reason: "guide stopped", elapsed };
    }
    return { ok: false, reason: "timeout", elapsed };
  },
  panel: setPanel,
  teleportNode(id: string, heading?: number) {
    const n = nodeById.get(id);
    if (!n) return false;
    player.teleport({ x: n.position.x, y: n.position.y, z: nodeZ(id) }, heading);
    cam.yaw = player.heading;
    camInit = false;
    return true;
  },
  /** QA: advance the simulation by `seconds` of station time and render (works while the tab is backgrounded). */
  advance(seconds = 0, frames = 30) {
    simOffset += seconds;
    for (let i = 0; i < frames; i++) step(1 / 30);
    return true;
  },
  /** QA: fixed free camera (ENU metres); `null` returns to the follow camera. */
  view(v: typeof viewOverride) {
    viewOverride = v;
    camInit = false;
    return true;
  },
  /** QA: renders one frame and returns the share of near-black pixels (open void / unlit background). */
  voidFraction() {
    step(1 / 30);
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let dark = 0, n = 0;
    for (let i = 0; i < px.length; i += 4 * 7) {
      n++;
      if (px[i]! < 24 && px[i + 1]! < 24 && px[i + 2]! < 28) dark++;
    }
    return Math.round((dark / n) * 1000) / 1000;
  },
  crowd,
  station,
  state: () => ({ crowd: crowd.count, x: player.x, y: player.y, z: player.z, heading: player.heading, floor: floorLabel(floorAtZ(player.z)).short, fps: Math.round(fps), guiding: !!player.guide, journey, stepFree: profile().stepFree, destination: toPick?.kind === "poi" ? toPick.poi.id : null, cameraDistance: +cameraDistance.toFixed(2), avatarVisible: avatar.object.visible, carried: player.carriedByEscalator, guideSpeed: player.guideSpeedMultiplier, reducedMotion, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
};

startup.complete("surface-hooks");
loadingStep(4, "準備できました", "Ready to explore");
await paintStartupFrame();
clock.start();
frame();
startup.milestone("interactive");
$("loading").classList.add("done");
$("loading").setAttribute("aria-busy", "false");
$("loading").setAttribute("aria-hidden", "true");
// Publish the established hooks together only after the normal scene is rendered.
window.__gteki = qaHooks;
