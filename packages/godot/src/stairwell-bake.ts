/**
 * Bake the stairwell cut recipe (#650) for public stations, headless, with the explorer's own cut inputs:
 *   pnpm tsx packages/godot/src/stairwell-bake.ts --station <s> [--station <s>] [--check] [--out <dir>]
 * Writes stations/<s>/scene/stairwell-cut.<tier>.b64.txt for both tiers: the recipe bytes base64-encoded, one line with no
 * trailing newline (a declared data file, bundled as text with `?raw`). Under --out <dir>/<s>/ when given, for runs
 * inside a container whose writes come back only through a bind mount. Each bake first runs the live cut with
 * the portal cut applied (as Explorer.loadStation does), then replays the file's recipe on the same scene and
 * compares the two. `--check` exits 1 when a committed file differs from a fresh bake or the replay disagrees.
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { format } from "node:util";
import * as THREE from "three";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import type { StationScene } from "@gteki/scene-api";
import { buildGreybox } from "../../../apps/web/src/explorer/greybox.ts";
import { greyboxSceneProbes } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { cutPortals, disposePortalCuts, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import { cutStairwells, stairwellWells, type StairwellCut } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { RECIPE_VERSION, canonicalJson, decodeRecipe, encodeRecipe, sha256Hex, type CutRecipe, type MeshRecord } from "../../../apps/web/src/explorer/cutRecipe.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { loadScene } from "./route-clip-audit.ts";

/** Stations with a baked recipe. Ikebukuro stays on the live cut for now (follow-up issue). */
export const PUBLIC_STATIONS = ["shinjuku"] as const;
type Tier = "high" | "low";
/** Tolerance for an attribute component replayed against the live cut. */
const ATTR_TOLERANCE = 1e-5;
/** Float32 storage makes one ulp of a 256 m coordinate 1.5e-5 m, and the replay rounds its weights too: the tolerance is relative above 1 m. */
const tolerance = (live: number) => ATTR_TOLERANCE * Math.max(1, Math.abs(live));

function readBundle(dir: string): StationBundle {
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"),
    fs.existsSync(path.join(dir, "tenants.json")) ? read("tenants.json") : undefined, { privateTier: false });
  if (!parsed.ok) throw new Error(`bundle failed validation: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
  return parsed.bundle;
}

/** Copy of every attribute of a mesh's geometry, one component list per attribute. */
function attributesOf(mesh: THREE.Mesh): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
    const values: number[] = [];
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) values.push(attr.getComponent(i, c));
    out[name] = values;
  }
  return out;
}

interface Outcome {
  stats: StairwellCut["stats"];
  walls: StairwellCut["walls"];
  /** Triangles the band added to the greybox shell (or the finish group); compared with the shell arrays. */
  bandTriangles: number;
  /** The greybox shell's attribute arrays after the run, when a shell takes the band. */
  shell: Record<string, number[]> | null;
  finish: number[][];
  /** Cut meshes in the order the cut reached them; instance copies are rebuilt on every run, so identity is not kept. */
  meshes: { name: string; attrs: Record<string, number[]> }[];
}

/** The attributes the band appends to on the greybox shell. */
const SHELL_ATTRIBUTES = ["position", "color", "normal"] as const;

function outcomeOf(cut: StairwellCut, shell: THREE.Mesh | undefined): Outcome {
  const finish: number[][] = [];
  cut.finish?.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) finish.push(Array.from(mesh.geometry.getAttribute("position").array as ArrayLike<number>));
  });
  const meshes = [...cut.resources.originals.keys()].map((mesh) => ({ name: mesh.name, attrs: attributesOf(mesh) }));
  return { stats: cut.stats, walls: cut.walls, bandTriangles: cut.bandTriangles, shell: shell ? attributesOf(shell) : null, finish, meshes };
}

/** Max abs difference between the two runs, or throws when the structure differs. */
function compareOutcomes(live: Outcome, replay: Outcome): number {
  const same = (a: unknown, b: unknown, what: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`replay differs: ${what}`); };
  same({ ...live.stats, cutMs: 0, recipe: "" }, { ...replay.stats, cutMs: 0, recipe: "" }, "stats");
  same(live.walls, replay.walls, "walls");
  same(live.bandTriangles, replay.bandTriangles, "band triangles");
  same(live.shell === null, replay.shell === null, "greybox shell presence");
  same(live.finish.length, replay.finish.length, "finish meshes");
  if (live.shell && replay.shell) {
    for (const name of SHELL_ATTRIBUTES) {
      const a = live.shell[name]!, b = replay.shell[name]!;
      same(a.length, b.length, `greybox shell ${name} size`);
      a.forEach((v, k) => {
        const d = Math.abs(v - b[k]!);
        maxErr = Math.max(maxErr, d);
        if (d > tolerance(v)) throw new Error(`greybox shell ${name} off by ${d} at ${k}`);
      });
    }
  }
  let maxErr = 0;
  live.finish.forEach((positions, n) => {
    same(positions.length, replay.finish[n]!.length, "finish geometry size");
    positions.forEach((v, k) => {
      const d = Math.abs(v - replay.finish[n]![k]!);
      maxErr = Math.max(maxErr, d);
      if (d > tolerance(v)) throw new Error(`replay finish geometry off by ${d}`);
    });
  });
  same(live.meshes.length, replay.meshes.length, "cut mesh count");
  live.meshes.forEach((liveMesh, m) => {
    const other = replay.meshes[m]!;
    same(liveMesh.name, other.name, `cut mesh ${m}`);
    same(Object.keys(liveMesh.attrs), Object.keys(other.attrs), `attributes of ${liveMesh.name}`);
    for (const name of Object.keys(liveMesh.attrs)) {
      const a = liveMesh.attrs[name]!, b = other.attrs[name]!;
      same(a.length, b.length, `${name} size of ${liveMesh.name}`);
      for (let k = 0; k < a.length; k++) {
        const d = Math.abs(a[k]! - b[k]!);
        if (d > maxErr) maxErr = d;
        if (d > tolerance(a[k]!)) throw new Error(`${name} of ${liveMesh.name} off by ${d} at ${k}`);
      }
    }
  });
  return maxErr;
}

interface BakeResult { bytes: Uint8Array; report: Record<string, unknown> }

async function bakeTier(station: string, bundle: StationBundle, tier: Tier): Promise<BakeResult> {
  const log = console.log, info = console.info;
  let scene: StationScene;
  try {
    console.log = console.info = (...values: unknown[]) => { process.stderr.write(`${format(...values)}\n`); };
    scene = await loadScene(station, bundle, tier);
  } finally { console.log = log; console.info = info; }
  try {
    // Mirrors Explorer.loadStation: targets, greybox, portal cut, then the stairwell cut.
    scene.root.updateMatrixWorld(true);
    const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
    prepareRayTrees(targets.camera);
    const probe = floorProbe(new THREE.Raycaster(), targets.ground, true);
    const cache = new Map<string, boolean>();
    const hasFloor = (p: { x: number; y: number; z: number }) => {
      const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
      let value = cache.get(key);
      if (value === undefined) { value = probe(p); cache.set(key, value); }
      return value;
    };
    const router = createRouter(bundle, { allowUnverified: false });
    const traversable = (edge: StationBundle["edges"][number]) => router.isTraversable(edge, DEFAULT_PROFILE);
    const greybox = buildGreybox(bundle, traversable, hasFloor, greyboxSceneProbes(targets.collider, (scene.walls ?? []).map(wallToRenderer)), tier);
    const portalResources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
    cutPortals(scene.root, greybox.openings, portalResources, new Set(targets.ground));

    const wells = stairwellWells(bundle, traversable);
    const walkable = new Set(targets.ground);
    const collision = [...scene.walkable, ...(scene.colliders ?? []), ...(scene.cameraBlockers ?? [])];
    // The band is appended to the greybox shell, so the shell is put back between the live and the replay run.
    const shell = greybox.root.getObjectByName("greybox-shell") as THREE.Mesh | undefined;
    const shellBefore = shell ? Object.fromEntries(SHELL_ATTRIBUTES.map((n) => [n, shell.geometry.getAttribute(n)])) : null;
    const recorded: MeshRecord[] = [];
    const live = cutStairwells(scene.root, wells, { walkable, tier, greyboxRoot: greybox.root, collision, record: recorded });
    const liveOutcome = outcomeOf(live, shell);
    if (shell && shellBefore) for (const n of SHELL_ATTRIBUTES) shell.geometry.setAttribute(n, shellBefore[n]!);
    const recipe: CutRecipe = {
      version: RECIPE_VERSION, tier, wellsSha256: sha256Hex(canonicalJson(wells)), keyCount: wells.flatMap((w) => w.skipped ? [] : w.rects).length,
      meshKeysHash: live.meshKeysHash, meshes: recorded,
    };
    const bytes = encodeRecipe(recipe);
    live.dispose();

    // Replay the encoded bytes (not the in-memory record) on the same scene, and compare.
    const decoded = decodeRecipe(bytes);
    const replay = cutStairwells(scene.root, wells, { walkable, tier, greyboxRoot: greybox.root, collision, recipe: decoded });
    if (replay.stats.recipe !== "replayed") throw new Error(`${station} ${tier}: replay came back "${replay.stats.recipe}"`);
    const replayOutcome = outcomeOf(replay, shell);
    const maxAttrError = compareOutcomes(liveOutcome, replayOutcome);
    replay.dispose();
    disposePortalCuts(portalResources);

    const report = {
      station, tier, bytes: bytes.length, gzipBytes: gzipSync(bytes).length,
      meshes: recorded.length, cutMeshes: live.stats.cutMeshes, cutTriangles: live.stats.cutTriangles,
      liveCutMs: Math.round(live.stats.cutMs), replayCutMs: Math.round(replay.stats.cutMs), speedup: Math.round(live.stats.cutMs / Math.max(1, replay.stats.cutMs) * 10) / 10,
      maxAttrError, recipe: replay.stats.recipe,
    };
    return { bytes, report };
  } finally { scene.dispose?.(); }
}

async function main(): Promise<void> {
  const stations: string[] = [];
  let check = false, outDir: string | null = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i + 1]) stations.push(args[++i]!);
    else if (args[i] === "--check") check = true;
    else if (args[i] === "--out" && args[i + 1]) outDir = path.resolve(args[++i]!);
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!stations.length) throw new Error("pass at least one --station");
  const root = process.cwd();
  let stale = 0;
  for (const station of stations) {
    if (!(PUBLIC_STATIONS as readonly string[]).includes(station)) throw new Error(`${station}: not a public station`);
    const bundle = readBundle(path.join(root, "stations", station, "gteki"));
    for (const tier of ["high", "low"] as const) {
      const { bytes, report } = await bakeTier(station, bundle, tier);
      const file = outDir ? path.join(outDir, station, `stairwell-cut.${tier}.b64.txt`) : path.join(root, "stations", station, "scene", `stairwell-cut.${tier}.b64.txt`);
      const text = Buffer.from(bytes).toString("base64");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (check) {
        const committed = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
        if (committed !== text) { stale++; process.stderr.write(`${file}: stale, run pnpm bake:stairwells\n`); }
      } else fs.writeFileSync(file, text);
      console.log(JSON.stringify({ ...report, file: path.relative(root, file), check }));
    }
  }
  if (stale) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
