/** A committed stairwell recipe must match a fresh bake and replay to the live cut (see stairwell-bake.ts). */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { buildGreybox } from "../../../apps/web/src/explorer/greybox.ts";
import { greyboxSceneProbes } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { explorerTargets } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees } from "../../../apps/web/src/explorer/meshBvh.ts";
import { cutPortals, disposePortalCuts, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import { cutStairwells, stairwellWells } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { canonicalJson, decodeRecipe, sha256Hex, type MeshRecord } from "../../../apps/web/src/explorer/cutRecipe.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { loadScene } from "./route-clip-audit.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("stairwell recipes", () => {
  it.each(["high", "low"] as const)("ikebukuro %s: explorer's initial cut key equals the baked key", async (tier) => {
    const dir = path.join(ROOT, "stations/ikebukuro/gteki");
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
    if (!parsed.ok) throw new Error("invalid Ikebukuro bundle");
    const bundle = parsed.bundle;
    // Explorer.loadStation cuts after buildScene resolves, before the first update starts lazy catalog dressing.
    const scene = await loadScene("ikebukuro", bundle, tier, false);
    const portals: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
    try {
      const targets = explorerTargets(scene.walkable, scene.colliders ?? [], scene.cameraBlockers ?? []);
      prepareRayTrees(targets.camera);
      const probe = floorProbe(new THREE.Raycaster(), targets.ground, true);
      const cache = new Map<string, boolean>();
      const hasFloor = (p: { x: number; y: number; z: number }) => {
        const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
        if (!cache.has(key)) cache.set(key, probe(p));
        return cache.get(key)!;
      };
      const router = createRouter(bundle, { allowUnverified: false });
      const traversable = (edge: StationBundle["edges"][number]) => router.isTraversable(edge, DEFAULT_PROFILE);
      const greybox = buildGreybox(bundle, traversable, hasFloor, greyboxSceneProbes(targets.collider, (scene.walls ?? []).map(wallToRenderer)), tier);
      cutPortals(scene.root, greybox.openings, portals, new Set(targets.ground));
      const wells = stairwellWells(bundle, traversable);
      const recipe = decodeRecipe(Buffer.from(fs.readFileSync(path.join(ROOT, `stations/ikebukuro/scene/stairwell-cut.${tier}.b64.txt`), "utf8"), "base64"));
      const recorded: MeshRecord[] = [];
      const cut = cutStairwells(scene.root, wells, {
        tier, walkable: new Set(targets.ground), greyboxRoot: greybox.root,
        collision: [...scene.walkable, ...(scene.colliders ?? []), ...(scene.cameraBlockers ?? [])], record: recorded,
      });
      try {
        expect(sha256Hex(canonicalJson(wells))).toBe(recipe.wellsSha256);
        expect(wells.flatMap(w => w.skipped ? [] : w.rects).length).toBe(recipe.keyCount);
        expect(cut.meshKeysHash).toBe(recipe.meshKeysHash);
        const keys = (meshes: MeshRecord[]) => meshes.map(({ count, hash, matrix }) => ({ count, hash, matrix }));
        expect(keys(recorded)).toEqual(keys(recipe.meshes));
      } finally { cut.dispose(); }
    } finally { disposePortalCuts(portals); scene.dispose?.(); }
  }, 900_000);

  it.each(["shinjuku", "ikebukuro"])("%s: committed recipes match a fresh bake", (station) => {
    execFileSync("pnpm", ["exec", "tsx", "packages/godot/src/stairwell-bake.ts", "--station", station, "--check"], { cwd: ROOT, stdio: "pipe" });
  }, 900_000);
});
