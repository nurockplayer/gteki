/** Runtime-only passage statistics. Private overlays are built in a temporary directory, never exported. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "node:util";
import * as THREE from "three";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import type { StationScene } from "@gteki/scene-api";
import { buildGreybox, type GreyboxStats } from "../../../apps/web/src/explorer/greybox.ts";
import { greyboxSceneProbes } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { cutStairwells, stairwellWells, type StairwellStats } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { loadScene, sceneProbe } from "./route-clip-audit.ts";

/** Build using the same targets and traversal profile as Explorer.loadStation, including the stairwell cut. */
export function greyboxStats(bundle: StationBundle, scene: StationScene, tier: "high" | "low", allowUnverified = false): GreyboxStats & { stairwells: StairwellStats } {
  scene.root.updateMatrixWorld(true);
  sceneProbe(scene);
  const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
  prepareRayTrees([...targets.ground, ...targets.collider]);
  const probe = floorProbe(new THREE.Raycaster(), targets.ground, true);
  const cache = new Map<string, boolean>();
  const hasFloor = (p: { x: number; y: number; z: number }) => {
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
    let value = cache.get(key);
    if (value === undefined) { value = probe(p); cache.set(key, value); }
    return value;
  };
  const router = createRouter(bundle, { allowUnverified });
  const traversable = (edge: StationBundle["edges"][number]) => router.isTraversable(edge, DEFAULT_PROFILE);
  const greybox = buildGreybox(bundle, traversable, hasFloor,
    greyboxSceneProbes(targets.collider, (scene.walls ?? []).map(wallToRenderer)), tier);
  const cut = cutStairwells(scene.root, stairwellWells(bundle, traversable), { walkable: new Set(targets.ground), tier, greyboxRoot: greybox.root });
  if (cut.finish) greybox.root.add(cut.finish);
  const stats = { ...greybox.stats, triangles: greybox.stats.triangles + cut.bandTriangles, stairwells: cut.stats };
  greybox.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  });
  cut.dispose();
  return stats;
}

function readBundle(dir: string, privateTier: boolean): StationBundle {
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"),
    fs.existsSync(path.join(dir, "tenants.json")) ? read("tenants.json") : undefined, { privateTier });
  if (!parsed.ok) throw new Error(`bundle failed validation: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
  return parsed.bundle;
}

async function main(): Promise<void> {
  const stations: string[] = [];
  const args = process.argv.slice(2);
  let privateDir = process.env.GTEKI_PRIVATE_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i + 1]) stations.push(args[++i]!);
    else if (args[i] === "--private" && args[i + 1]) privateDir = args[++i];
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!stations.length) throw new Error("pass at least one --station");
  const root = process.cwd();
  const tmp = privateDir ? fs.mkdtempSync(path.join(os.tmpdir(), "gteki-greybox-")) : null;
  try {
    if (privateDir && tmp) {
      fs.cpSync(path.join(privateDir, "additions"), path.join(tmp, "additions"), { recursive: true });
      const overlayModule = new URL("../../../tools/private-overlay/build-overlay.ts", import.meta.url).href;
      const { buildOverlay } = await import(overlayModule) as { buildOverlay: (o: { repoRoot: string; privateDir: string; stations: string[] }) => string[] };
      const log = console.log, info = console.info;
      let built: string[];
      try {
        console.log = console.info = (...values: unknown[]) => { process.stderr.write(`${format(...values)}\n`); };
        built = buildOverlay({ repoRoot: root, privateDir: tmp, stations });
      } finally { console.log = log; console.info = info; }
      for (const station of stations) if (!built.includes(station)) throw new Error(`${station}: overlay not built`);
    }
    for (const station of stations) {
      const dir = tmp ? path.join(tmp, "overlay", station, "gteki") : path.join(root, "stations", station, "gteki");
      const bundle = readBundle(dir, Boolean(tmp));
      for (const tier of ["high", "low"] as const) {
        // Scene builders may log diagnostics; reserve stdout for JSON records.
        const log = console.log, info = console.info;
        let scene: StationScene;
        try {
          console.log = console.info = (...values: unknown[]) => { process.stderr.write(`${format(...values)}\n`); };
          scene = await loadScene(station, bundle, tier);
        } finally { console.log = log; console.info = info; }
        try { console.log(JSON.stringify({ station, tier, ...greyboxStats(bundle, scene, tier, Boolean(tmp)) })); }
        finally { scene.dispose?.(); }
      }
    }
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
