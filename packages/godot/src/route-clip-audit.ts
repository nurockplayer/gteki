/**
 * Headless clip audit of a private build: does each private-addition edge, drawn the way the explorer draws a
 * route (routePolyline), stay on the scene's floor and out of its walls?
 *   GTEKI_PRIVATE_DIR=<dir> pnpm tsx packages/godot/src/route-clip-audit.ts [--station <s>]... [--top 20]
 *     [--route <fromPoiId> <toPoiId>] [--all] [--json <out>]
 * Per sample (every 0.5 m): the walkable surface within ±3 m of the drawn height must be within ±0.3 m of it.
 * Between samples, a body-height segment must not cross a collider or a scene wall. Elevator interiors are
 * exempt from the floor check (the car moves between floors). Writes nothing into the private dir: the overlay
 * is built in a temp copy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { enuToRenderer } from "@gteki/geo";
import { createRouter, routeBetween, routePolyline, type PolylinePoint, type RouteResult } from "@gteki/navigation";
import { parseStationFiles, type Edge, type StationBundle } from "@gteki/schema";
import { glbPrimitivePlugin, type SceneContext, type StationScene, type StationSceneModule, type WallSegment } from "@gteki/scene-api";
import { headlessGltfTextures, headlessThree, installHeadlessDom, newShimUsage, stubRenderer } from "./headless-dom.ts";
import { settleScene } from "./export-scene.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { castAll, castCamera, castTargets } from "../../../apps/web/src/explorer/raycast.ts";

export const FLOOR_TOLERANCE_M = 0.3;
const STEP_M = 0.5;
const PROBE_M = 3;
/** Body band checked against walls: knee to head, above the drawn route height. */
const BODY_LOW_M = 0.5, BODY_HIGH_M = 1.5;

export interface EdgeAudit {
  station: string; edgeId: string; sourceFile: string; mode: string; lengthM: number;
  samples: number; offFloor: number; noFloor: number; maxAbsDzM: number; wallHits: number; worst: string;
}

export interface SceneProbe { ground: THREE.Object3D[]; collider: THREE.Object3D[]; walls: WallSegment[] }

const repoRoot = process.cwd();

export async function loadScene(station: string, bundle: StationBundle): Promise<StationScene> {
  const gtekiDir = path.join(repoRoot, "stations", station, "gteki");
  const usage = newShimUsage();
  installHeadlessDom(usage);
  const inStation = (uri: string) => path.resolve(gtekiDir, uri);
  const ctx: SceneContext = {
    THREE: headlessThree(usage), bundle, enuToRenderer: (p) => enuToRenderer(p),
    assetUrl: (uri) => pathToFileURL(inStation(uri)).href,
    loadGlb: async (uri): Promise<GLTF> => {
      const buf = fs.readFileSync(inStation(uri));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(glbPrimitivePlugin).register(headlessGltfTextures(usage));
      return new Promise<GLTF>((ok, fail) => loader.parse(ab, "", ok, fail));
    },
    loadTexture: async () => new THREE.Texture(),
    quality: "low",
    renderer: stubRenderer(),
  };
  const module = (await import(pathToFileURL(path.join(gtekiDir, "scene.ts")).href)) as StationSceneModule;
  const scene = await module.buildScene(ctx);
  await settleScene(scene, station, 120_000);
  scene.update?.(0, 0);
  scene.root.updateMatrixWorld(true);
  return scene;
}

export function sceneProbe(scene: StationScene): SceneProbe {
  const colliders = scene.colliders ?? [];
  const ground = castTargets(scene.walkable, colliders);
  const collider = castTargets(colliders, scene.walkable);
  prepareRayTrees([...ground, ...collider]);
  return { ground, collider, walls: scene.walls ?? [] };
}

function cross2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(p: { x: number; y: number }, q: { x: number; y: number }, w: WallSegment): boolean {
  const d1 = cross2(w.a, w.b, p), d2 = cross2(w.a, w.b, q), d3 = cross2(p, q, w.a), d4 = cross2(p, q, w.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Resample a polyline every STEP_M (keeping every vertex), z linear along each piece. */
function resample(points: readonly PolylinePoint[]): { x: number; y: number; z: number }[] {
  const out = [{ x: points[0]!.x, y: points[0]!.y, z: points[0]!.z }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP_M));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  return out;
}

const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

/** Audit one drawn polyline against the scene. */
export function auditPolyline(probe: SceneProbe, points: readonly PolylinePoint[], opts: { skipInteriorFloor?: boolean } = {}):
  Pick<EdgeAudit, "samples" | "offFloor" | "noFloor" | "maxAbsDzM" | "wallHits" | "worst"> {
  const samples = resample(points);
  let offFloor = 0, noFloor = 0, maxAbsDzM = 0, wallHits = 0, worst = "";
  const twoSided = new Set(probe.collider);
  samples.forEach((s, i) => {
    const interior = i > 0 && i < samples.length - 1;
    if (!(opts.skipInteriorFloor && interior)) {
      const [x, y, z] = enuToRenderer({ x: s.x, y: s.y, z: s.z + PROBE_M });
      ray.set(new THREE.Vector3(x, y, z), down);
      ray.far = 2 * PROBE_M;
      // Nearest walkable to the drawn height, not the first one down: a mezzanine above must not count.
      const hit = castAll(ray, probe.ground).sort((a, b) => Math.abs(s.z - a.point.y) - Math.abs(s.z - b.point.y))[0];
      if (!hit) { noFloor++; if (!worst) worst = `no floor at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, z ${s.z.toFixed(2)})`; }
      else {
        const dz = s.z - hit.point.y;
        if (Math.abs(dz) > maxAbsDzM) maxAbsDzM = Math.abs(dz);
        if (Math.abs(dz) > FLOOR_TOLERANCE_M) { offFloor++; if (!worst) worst = `route z ${s.z.toFixed(2)} vs floor ${hit.point.y.toFixed(2)} at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`; }
      }
    }
    if (i === 0) return;
    const p = samples[i - 1]!;
    let crossed = false;
    for (const lift of [BODY_LOW_M, BODY_HIGH_M]) {
      const a = new THREE.Vector3(...enuToRenderer({ x: p.x, y: p.y, z: p.z + lift }));
      const b = new THREE.Vector3(...enuToRenderer({ x: s.x, y: s.y, z: s.z + lift }));
      const len = a.distanceTo(b);
      if (len < 1e-6) continue;
      ray.set(a, b.clone().sub(a).normalize());
      ray.far = len;
      if (castCamera(ray, probe.collider, twoSided).length > 0) crossed = true;
    }
    const zLo = Math.min(p.z, s.z) + BODY_LOW_M, zHi = Math.max(p.z, s.z) + BODY_HIGH_M;
    for (const w of probe.walls) if (w.zMax > zLo && w.zMin < zHi && segmentsCross(p, s, w)) { crossed = true; break; }
    if (crossed) { wallHits++; if (!worst) worst = `crosses a wall near (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, z ${s.z.toFixed(2)})`; }
  });
  return { samples: samples.length, offFloor, noFloor, maxAbsDzM, wallHits, worst };
}

/** The polyline the explorer would draw for this one edge, traversed forward. */
function edgePolyline(bundle: StationBundle, edge: Edge): PolylinePoint[] {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const route = { ok: true, nodeIds: [edge.from, edge.to], steps: [{ edgeId: edge.id, fromNodeId: edge.from, toNodeId: edge.to, reversed: false,
    mode: edge.mode, lengthM: edge.lengthM ?? 0, fromFloorId: nodes.get(edge.from)!.floorId, toFloorId: nodes.get(edge.to)!.floorId }] };
  return routePolyline(bundle, route as unknown as RouteResult);
}

export const violations = (a: Pick<EdgeAudit, "offFloor" | "noFloor" | "wallHits">): number => a.offFloor + a.noFloor + a.wallHits;

function additionsEdgeFiles(addDir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of fs.readdirSync(addDir).filter((n) => /^graph(\..+)?\.json$/.test(n)).sort()) {
    const graph = JSON.parse(fs.readFileSync(path.join(addDir, name), "utf8")) as { edges?: { id: string }[] };
    for (const e of graph.edges ?? []) files.set(e.id, `additions/${path.basename(addDir)}/${name}`);
  }
  return files;
}

async function main(): Promise<void> {
  let privateDir = process.env.GTEKI_PRIVATE_DIR, top = 20, jsonOut: string | null = null, all = false;
  const stations: string[] = [];
  let route: [string, string] | null = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--private" && args[i + 1]) privateDir = args[++i];
    else if (args[i] === "--station" && args[i + 1]) stations.push(args[++i]!);
    else if (args[i] === "--top" && args[i + 1]) top = Number(args[++i]);
    else if (args[i] === "--json" && args[i + 1]) jsonOut = args[++i]!;
    else if (args[i] === "--route" && args[i + 2]) route = [args[++i]!, args[++i]!];
    else if (args[i] === "--all") all = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!privateDir) throw new Error("set GTEKI_PRIVATE_DIR or pass --private <dir>");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-clip-"));
  try {
    fs.cpSync(path.join(privateDir, "additions"), path.join(tmp, "additions"), { recursive: true });
    // A runtime path: the overlay builder lives outside this package's typecheck.
    const overlayModule = new URL("../../../tools/private-overlay/build-overlay.ts", import.meta.url).href;
    const { buildOverlay } = (await import(overlayModule)) as { buildOverlay: (o: { repoRoot: string; privateDir: string; stations?: string[] }) => string[] };
    const built = buildOverlay({ repoRoot, privateDir: tmp, ...(stations.length ? { stations } : {}) });
    const results: EdgeAudit[] = [];
    for (const station of built) {
      const dir = path.join(tmp, "overlay", station, "gteki");
      const read = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as unknown;
      const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"),
        fs.existsSync(path.join(dir, "tenants.json")) ? read("tenants.json") : undefined, { privateTier: true });
      if (!parsed.ok) throw new Error(`${station}: overlay failed validation: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
      const bundle = parsed.bundle;
      const probe = sceneProbe(await loadScene(station, bundle));
      const sourceOf = additionsEdgeFiles(path.join(tmp, "additions", station));
      if (route) {
        const poi = (id: string) => { const p = bundle.pois.find((x) => x.id === id); if (!p) throw new Error(`${station}: no POI ${id}`); return p; };
        const res = routeBetween(createRouter(bundle, { allowUnverified: true }), { kind: "poi", poi: poi(route[0]) }, poi(route[1]),
          { fare: "ticketed", stepFree: false, hours: "warn_unknown" });
        if (!res.ok) { console.log(`${station}: no route: ${res.reason} ${res.message}`); continue; }
        const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
        const polyline = routePolyline(bundle, res);
        for (const id of res.nodeIds) {
          const n = nodes.get(id)!, z = polyline.find((p) => p.x === n.position.x && p.y === n.position.y)?.z;
          console.log(`node ${id}  floor ${n.floorId}  (${n.position.x.toFixed(1)}, ${n.position.y.toFixed(1)})  drawn z ${z?.toFixed(2) ?? "?"}`);
        }
        // The route total sums the per-edge audits, so the elevator exemption applies to it too.
        const total = { violations: 0, samples: 0, offFloor: 0, noFloor: 0, wallHits: 0, maxAbsDzM: 0 };
        for (const step of res.steps) {
          const edge = bundle.edges.find((e) => e.id === step.edgeId)!;
          const a = auditPolyline(probe, edgePolyline(bundle, edge), { skipInteriorFloor: edge.mode === "elevator" });
          total.violations += violations(a); total.samples += a.samples; total.offFloor += a.offFloor; total.noFloor += a.noFloor;
          total.wallHits += a.wallHits; total.maxAbsDzM = Math.max(total.maxAbsDzM, a.maxAbsDzM);
          console.log(`edge ${edge.id}  ${edge.mode}  ${sourceOf.get(edge.id) ?? "public"}  violations ${violations(a)} (off-floor ${a.offFloor}, no-floor ${a.noFloor}, wall ${a.wallHits})${a.worst ? `  first: ${a.worst}` : ""}`);
        }
        console.log(`route total: ${total.violations} violations over ${total.samples} samples (off-floor ${total.offFloor}, no-floor ${total.noFloor}, wall ${total.wallHits}, max |dz| ${total.maxAbsDzM.toFixed(2)} m)`);
        continue;
      }
      for (const edge of bundle.edges) {
        const sourceFile = sourceOf.get(edge.id);
        if (!sourceFile && !all) continue;
        const a = auditPolyline(probe, edgePolyline(bundle, edge), { skipInteriorFloor: edge.mode === "elevator" });
        results.push({ station, edgeId: edge.id, sourceFile: sourceFile ?? "public", mode: edge.mode, lengthM: edge.lengthM ?? 0, ...a });
      }
      const mine = results.filter((r) => r.station === station);
      const bad = mine.filter((r) => violations(r) > 0);
      console.log(`${station}: ${mine.length} edges audited, ${bad.length} with violations`);
      const byFile = new Map<string, [number, number]>();
      for (const r of mine) { const c = byFile.get(r.sourceFile) ?? [0, 0]; c[0]++; if (violations(r) > 0) c[1]++; byFile.set(r.sourceFile, c); }
      for (const [file, [n, b]] of byFile) console.log(`  ${file}: ${b}/${n} edges with violations`);
    }
    if (route) return;
    const ranked = results.filter((r) => violations(r) > 0).sort((a, b) => violations(b) - violations(a) || b.maxAbsDzM - a.maxAbsDzM);
    console.log(`\nworst ${Math.min(top, ranked.length)} edges:`);
    for (const r of ranked.slice(0, top))
      console.log(`${r.station}\t${r.edgeId}\t${r.sourceFile}\t${r.mode}\tviol ${violations(r)}/${r.samples}\toff ${r.offFloor} none ${r.noFloor} wall ${r.wallHits}\tmax|dz| ${r.maxAbsDzM.toFixed(2)}\t${r.worst}`);
    if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 1)}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
