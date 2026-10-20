import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Floor, Poi, StationBundle } from "@gteki/schema";
import { createRouter, type RouteProfile, type RouteResult } from "@gteki/navigation";
import { createSearchIndex } from "@gteki/search";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import planJson from "../../data/plan.json";
import { buildStation } from "../../scene/build.ts";
import { pointInRings, type Plan } from "../../scene/layout.ts";
import { Player, PLAYER_RADIUS, type GuidePoint, type MoveInput } from "./player.ts";
import { floorLabel, narrate, UNKNOWN_LABELS, type Maneuver } from "./narrate.ts";
import { createAvatar } from "./avatar.ts";
import { createStationAudio } from "./audio.ts";
import { CROWD_LIMIT, createCrowd } from "./crowd.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const isTouch = matchMedia("(pointer: coarse)").matches;
const quality: "low" | "high" = (params.get("q") as "low" | "high") ?? (isTouch ? "low" : "high");

// ------------------------------------------------------------ renderer
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === "high" ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;

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

const station = buildStation(bundle, plan, { quality });
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

const avatar = createAvatar(THREE, 0);
// Decorative ambient commuters (invented, not crowd data). ?crowd=0 disables.
const crowdDefault = quality === "high" ? 36 : 16;
const crowdParam = Number(params.get("crowd") ?? crowdDefault);
const crowdMax = Number.isNaN(crowdParam) ? crowdDefault : Math.max(0, Math.min(CROWD_LIMIT, Math.floor(crowdParam)));
const crowd = createCrowd(THREE, bundle, router, nodeZ, { max: crowdMax, seed: 27 });
scene.add(crowd.group);
scene.add(avatar.object);
avatar.object.traverse((o) => ((o as THREE.Mesh).castShadow = false));

// ------------------------------------------------------------ camera rig
const cam = { yaw: player.heading, pitch: -0.18, dist: 3.6, firstPerson: false, userTurnedAt: -10 };
const camPos = new THREE.Vector3();
const camTarget = new THREE.Vector3();
let camInit = false;
function updateCamera(dt: number, t: number) {
  // gentle auto-follow behind the character while moving and the user is not steering the camera
  if (t - cam.userTurnedAt > 1.4 && player.speed > 0.4) {
    let d = player.heading - cam.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.yaw += d * (1 - Math.exp(-1.6 * dt));
  }
  const head = { x: player.x, y: player.y, z: player.z + (cam.firstPerson ? 1.62 : 1.45) };
  const lv = floorAtZ(player.z);
  const level = layout.levels.find((l) => l.floorId === lv.id);
  const ceiling = level && Math.abs(player.z - level.z) < 0.4 ? level.ceilingZ - 0.25 : player.z + 2.5;
  const fwd = { x: Math.sin(cam.yaw) * Math.cos(cam.pitch), y: Math.cos(cam.yaw) * Math.cos(cam.pitch), z: Math.sin(cam.pitch) };
  let dist = cam.firstPerson ? 0 : cam.dist;
  if (dist > 0) {
    const back = { x: head.x - fwd.x * dist, y: head.y - fwd.y * dist };
    const hit = world.firstWallHit(head, back, head.z - 0.2);
    dist = Math.max(0.35, dist * hit - 0.25);
  }
  const want = new THREE.Vector3(head.x - fwd.x * dist, Math.min(head.z - fwd.z * dist, ceiling), -(head.y - fwd.y * dist));
  const look = new THREE.Vector3(head.x + fwd.x * 4, head.z + fwd.z * 4, -(head.y + fwd.y * 4));
  if (!camInit) {
    camPos.copy(want);
    camTarget.copy(look);
    camInit = true;
  }
  const k = 1 - Math.exp(-14 * dt);
  camPos.lerp(want, k);
  camTarget.lerp(look, 1 - Math.exp(-20 * dt));
  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  avatar.object.visible = !cam.firstPerson && camPos.distanceTo(new THREE.Vector3(player.x, player.z + 1.2, -player.y)) > 0.9;
}

// ------------------------------------------------------------ input
const keys = new Set<string>();
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") {
    if (e.key === "Escape") (e.target as HTMLInputElement).blur();
    return;
  }
  keys.add(e.code);
  if (e.code === "Slash") (e.preventDefault(), $("to").focus());
  if (e.code === "KeyV") cam.firstPerson = !cam.firstPerson;
  if (e.code === "KeyG") toggleGuide();
  if (e.code === "KeyM") $("minimap").classList.toggle("big");
  if (e.code === "KeyE") interact();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

let dragging: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && e.clientX < innerWidth * 0.45) return;
  dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
  });
  $("btn-act").addEventListener("click", () => interact());
}

function readInput(): MoveInput {
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
  $("btn-sound").textContent = audio.muted ? "🔇 音" : "🔊 音";
});
canvas.addEventListener("pointerdown", async () => {
  if (audioPrimed) return;
  audioPrimed = true;
  await audio.start();
  audio.setMuted(false);
  $("btn-sound").textContent = "🔊 音";
}, { once: false });
let audioPrimed = false;

// ------------------------------------------------------------ search UI
type Pick = { kind: "here" } | { kind: "poi"; poi: Poi };
let fromPick: Pick = { kind: "here" };
let toPick: Pick | null = null;
let activeField: "from" | "to" = "to";
const ICON: Record<string, [string, string]> = { exit: ["出", "exit"], ticket_gate: ["改", ""], platform: ["E", "platform"], elevator: ["EV", ""], toilet: ["WC", ""], escalator: ["⇅", ""], stairs: ["⇵", ""] };
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
    renderResults(el.value);
    $("panel").classList.remove("collapsed");
  });
  el.addEventListener("input", () => renderResults(el.value));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("results").querySelector("li") as HTMLElement | null)?.click();
  });
}
$("ticketed").addEventListener("change", () => computeRoute());
$("stepfree").addEventListener("change", () => computeRoute());
$("clear").addEventListener("click", () => clearRoute());
$("guide").addEventListener("click", () => toggleGuide());

// ------------------------------------------------------------ route
let route: RouteResult | null = null;
let maneuvers: Maneuver[] = [];
let routePts: GuidePoint[] = [];
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
function profile(): RouteProfile {
  return { fare: $<HTMLInputElement>("ticketed").checked ? "ticketed" : "unpaid_only", stepFree: $<HTMLInputElement>("stepfree").checked };
}
/** Start node(s): every connector of a picked POI (the router picks the cheapest), or the attached node. */
function startNodeIds(): string[] {
  if (fromPick.kind === "poi") return fromPick.poi.connectorNodeIds;
  const n = nearestNode(player);
  return n ? [n.id] : [];
}
function computeRoute() {
  $("route-error").classList.add("hidden");
  if (!toPick || toPick.kind !== "poi") return;
  const goal = toPick.poi;
  if (!goal.connectorNodeIds.length) return showRouteError("この目的地は位置情報のみで、検証済みの入口がありません。This destination has no verified entrance node (search-only).");
  const from = startNodeIds();
  if (!from.length) return showRouteError("現在地から経路に接続できません。出発地を選んでください / Can't connect your position to the network — choose a start point");
  const r = router.route(from, goal.connectorNodeIds, profile());
  if (!r.ok) {
    const why: Record<string, string> = {
      no_path: "条件を満たす検証済み経路がありません（例: 段差なし・改札外のみ）。No verified route satisfies the profile.",
      start_equals_goal: "すでに目的地にいます。You are already there.",
      unknown_start: "出発地が不明です。",
      unknown_goal: "目的地が不明です。",
    };
    return showRouteError(why[r.reason] ?? r.message);
  }
  clearRoute();
  route = r;
  maneuvers = narrate(bundle, r);
  routePts = r.nodeIds.map((id, i) => ({ ...nodeById.get(id)!.position, z: nodeZ(id), nodeId: id, elevator: i > 0 && r.steps[i - 1]!.mode === "elevator" }));
  // start the guide from the player's current position when starting "here"
  if (fromPick.kind === "here") routePts.unshift({ x: player.x, y: player.y, z: player.z, nodeId: "here" });
  drawRibbon();
  renderRoutePanel();
}
function showRouteError(msg: string) {
  clearRoute();
  $("route-error").textContent = msg;
  $("route-error").classList.remove("hidden");
}
function clearRoute() {
  route = null;
  maneuvers = [];
  routePts = [];
  player.stopGuide();
  routeOffSince = -1;
  disposeRibbon();
  $("route").classList.add("hidden");
  $("next").classList.add("hidden");
  $("guide").textContent = "▶ 案内歩行 Guide";
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
  const ribbonMat = new THREE.MeshBasicMaterial({ map: chevronTex, transparent: true, depthWrite: false, color: "#ff5cc0", polygonOffset: true, polygonOffsetFactor: -4 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: "#ff3fae", transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
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
    const za = a.z + 0.05;
    const zb = b.z + 0.05;
    pos.push(a.x + nx, za, -(a.y + ny), a.x - nx, za, -(a.y - ny), b.x + nx, zb, -(b.y + ny), b.x - nx, zb, -(b.y - ny));
    const L3 = Math.hypot(L, b.z - a.z);
    uv.push(0, -acc / 0.8, 1, -acc / 0.8, 0, -(acc + L3) / 0.8, 1, -(acc + L3) / 0.8);
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
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 32, 1, true), beaconMat);
  beacon.position.set(end.x, end.z + 1.6, -end.y);
  ribbon.add(beacon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 40), beaconMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(end.x, end.z + 0.06, -end.y);
  ribbon.add(ring);
}
const MI: Record<string, string> = { walk: "↑", turn: "↱", stairs: "⇵", escalator: "⇅", elevator: "⇕", gate: "⛩", ramp: "◢", arrive: "◎" };
function renderRoutePanel() {
  if (!route) return;
  $("route").classList.remove("hidden");
  $("route-dist").textContent = `${Math.round(route.totalLengthM)} m`;
  $("route-eta").textContent = `約 ${Math.max(1, Math.round(route.estimatedSeconds / 60))} 分 · ${route.floorChanges} 回の階移動${route.crossesFareBoundary === true ? " · 改札通過" : route.crossesFareBoundary === null ? " · 改札通過 不明" : ""}`;
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
  const src = bundle.sources.filter((s) => route!.sourceIds.includes(s.id));
  $("prov").textContent = `根拠 Evidence: ${src.map((s) => s.publisher).filter((v, i, a) => a.indexOf(v) === i).join(", ")} · データ ${bundle.coverage.freshness} · 確認 ${route.evidenceCheckedDate} · 高さは推定 heights estimated · 実際の通行可否は現地表示に従ってください`;
}
function toggleGuide() {
  if (!route) return;
  if (player.guide) {
    player.stopGuide();
    $("guide").textContent = "▶ 案内歩行 Guide";
    return;
  }
  // restart from current location on resume
  if (fromPick.kind === "here") computeRoute();
  if (!route) return;
  player.startGuide(routePts);
  $("guide").textContent = "⏸ 停止 Pause";
  audio.uiClick();
}
player.onGuideEvent = (e) => {
  if (e.type === "elevator") {
    fadeFlash();
  } else if (e.type === "arrived") {
    $("guide").textContent = "▶ 案内歩行 Guide";
    audio.arrivalChime();
  }
};
function fadeFlash() {
  $("fade").classList.add("on");
  setTimeout(() => $("fade").classList.remove("on"), 380);
}

// progress along route → next maneuver
function updateNext() {
  if (!route || !routePts.length) return;
  // nearest route point index ahead of player
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < routePts.length; i++) {
    const p = routePts[i]!;
    const d = Math.hypot(p.x - player.x, p.y - player.y) + Math.abs(p.z - player.z) * 4;
    if (d < bestD) (bestD = d), (bestI = i);
  }
  const offset = fromPick.kind === "here" ? 1 : 0;
  const nodeIndex = Math.max(0, bestI - offset);
  let cur = maneuvers.findIndex((m, i) => m.startIndex > nodeIndex && i > 0) - 1;
  if (cur < 0) cur = maneuvers.length - 1;
  const nextM = maneuvers[Math.min(maneuvers.length - 1, cur + 1)] ?? maneuvers[cur]!;
  const show = bestD < 12 ? nextM : maneuvers[cur]!;
  $("next").classList.remove("hidden");
  $("next-icon").textContent = show.kind === "turn" ? (show.en.includes("left") ? "↰" : "↱") : MI[show.kind]!;
  // remaining distance to that maneuver
  let rem = 0;
  for (let i = bestI; i < Math.min(routePts.length - 1, show.startIndex + offset); i++) rem += Math.hypot(routePts[i + 1]!.x - routePts[i]!.x, routePts[i + 1]!.y - routePts[i]!.y);
  $("next-ja").textContent = `${show.ja}${rem > 3 && show.kind !== "walk" ? `（あと ${Math.round(rem)} m）` : ""}`;
  $("next-en").textContent = `${show.en}${rem > 3 && show.kind !== "walk" ? ` · in ${Math.round(rem)} m` : ""}`;
  document.querySelectorAll("#steps li").forEach((li) => li.classList.toggle("cur", Number((li as HTMLElement).dataset.i) === maneuvers.indexOf(show)));
  if (bestD > 9 && !player.guide && routeOffSince < 0) routeOffSince = performance.now();
  if (bestD <= 9) routeOffSince = -1;
  if (routeOffSince > 0 && performance.now() - routeOffSince > 2500 && fromPick.kind === "here") {
    routeOffSince = -1;
    const guiding = !!player.guide;
    computeRoute(); // re-route from current position
    if (guiding && route) {
      player.startGuide(routePts);
      $("guide").textContent = "⏸ 停止 Pause";
    }
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
function drawMinimap() {
  const W = mm.width;
  const big = mm.classList.contains("big");
  const scale = big ? 2.2 : 3.2; // px per metre
  mmc.setTransform(1, 0, 0, 1, 0, 0);
  mmc.clearRect(0, 0, W, W);
  mmc.fillStyle = "rgba(14,16,20,0.92)";
  mmc.fillRect(0, 0, W, W);
  mmc.save();
  mmc.translate(W / 2, W / 2);
  if (!big) mmc.rotate(-cam.yaw);
  mmc.scale(scale, -scale);
  mmc.translate(-player.x, -player.y);
  const lvFloor = floorAtZ(player.z);
  for (const lv of layout.levels) {
    const isCur = lv.floorId === lvFloor.id;
    if (!isCur && Math.abs(lv.z - player.z) > 9) continue;
    mmc.globalAlpha = isCur ? 1 : 0.18;
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
    mmc.lineWidth = 1.4;
    mmc.lineCap = "round";
    mmc.lineJoin = "round";
    for (let i = 1; i < routePts.length; i++) {
      const a = routePts[i - 1]!;
      const b = routePts[i]!;
      if (b.elevator) continue;
      const near = Math.abs((a.z + b.z) / 2 - player.z) < 2.5;
      mmc.strokeStyle = near ? "#ff3fae" : "rgba(255,63,174,0.3)";
      mmc.beginPath();
      mmc.moveTo(a.x, a.y);
      mmc.lineTo(b.x, b.y);
      mmc.stroke();
    }
    const e = routePts[routePts.length - 1]!;
    mmc.fillStyle = "#ffd84a";
    mmc.beginPath();
    mmc.arc(e.x, e.y, 2.2, 0, Math.PI * 2);
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
  mmc.translate(W / 2, W / 2);
  mmc.rotate(big ? player.heading : player.heading - cam.yaw);
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
  mmc.fillText(floorLabel(lvFloor).short, 16, 34);
}

// ------------------------------------------------------------ coverage / help dialogs
$("btn-help").addEventListener("click", () => $<HTMLDialogElement>("dlg-help").showModal());
$("btn-cov").addEventListener("click", () => {
  const c = bundle.coverage;
  const rows = c.gaps.map((g) => `<tr><td>${esc(g.zone)}</td><td>${esc(g.missingFact)}</td><td>${esc(g.fieldWorkNeeded)}</td></tr>`).join("");
  const srcs = bundle.sources.map((s) => `<li>${esc(s.title)} — ${esc(s.publisher)} · ${esc(s.license?.name ?? "")} · dataset ${esc(s.datasetDate ?? "?")} · 公開期限 ${esc(s.validUntil ?? "-")}</li>`).join("");
  $("cov-body").innerHTML = `<h3>データ範囲と未確認事項 Coverage &amp; gaps</h3><p>${esc(c.summary[0]!.text)}<br><small>${esc(c.summary[1]?.text ?? "")}</small></p><table><tr><th>範囲 Zone</th><th>欠落 Missing</th><th>必要な調査 Needed</th></tr>${rows}</table><h4>出典 Sources</h4><ul>${srcs}</ul><p><small>表示用の階高さ・改札機の台数・ホーム柵・案内サインの意匠は GTEki による簡略表現で、実物の再現ではありません。Visual details (heights, gate machine count, platform doors, sign design) are GTEki simplifications, not reproductions.</small></p><p>通勤客の動き・列車の発着とドアの開閉は演出であり、実際の混雑や時刻表ではありません。<br><small>Commuters, train arrivals and door cycles are simulated ambience — not real crowd data or timetables.</small></p>`;
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
function step(dt: number) {
  const t = clock.elapsedTime + simOffset;
  player.update(dt, readInput(), cam.yaw);
  station.update(dt, t);
  crowd.update(dt, { x: player.x, y: player.y, z: player.z });
  updateCamera(dt, performance.now() / 1000);
  avatar.object.position.set(player.x, player.z, -player.y);
  avatar.object.rotation.y = -player.heading + Math.PI; // avatar faces -Z (north) at rotation 0... heading 0 = north
  avatar.object.rotation.y = -player.heading;
  avatar.update(dt, player.speed, { onStairs: Math.abs(player.climbing) > 0.2, climbing: player.climbing });
  fill.position.set(player.x, player.z + 2.4, -player.y);
  chevronTex.offset.y = (chevronTex.offset.y - dt * 1.1) % 1;
  const lv = floorAtZ(player.z);
  const fl = floorLabel(lv);
  $("floor-label").textContent = fl.short;
  $("floor-sub").textContent = `推定 ${lv.renderElevationM.toFixed(0)} m · est.`;
  audio.update(dt, { x: player.x, y: player.y, z: player.z, heading: cam.yaw }, { speed: player.speed, onStairs: Math.abs(player.climbing) > 0.2, onEscalator: false, levelLabel: fl.short, ceilingHeight: 3.2 });
  if (route) updateNext();
  updatePrompt();
  drawMinimap();
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

requestAnimationFrame(() => {
  $("loading").classList.add("done");
  frame();
});

// ------------------------------------------------------------ automation / QA hooks
declare global {
  interface Window {
    __gteki: unknown;
  }
}
window.__gteki = {
  player,
  cam,
  bundle,
  routeTo(poiId: string, fromPoiId?: string) {
    const p = bundle.pois.find((x) => x.id === poiId);
    if (!p) return "no poi";
    fromPick = fromPoiId ? { kind: "poi", poi: bundle.pois.find((x) => x.id === fromPoiId)! } : { kind: "here" };
    toPick = { kind: "poi", poi: p };
    computeRoute();
    return route ? { m: Math.round(route.totalLengthM), steps: maneuvers.map((m) => m.ja) } : $("route-error").textContent;
  },
  guide: toggleGuide,
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
  crowd,
  station,
  state: () => ({ crowd: crowd.count, x: player.x, y: player.y, z: player.z, heading: player.heading, floor: floorLabel(floorAtZ(player.z)).short, fps: Math.round(fps), guiding: !!player.guide, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
};
