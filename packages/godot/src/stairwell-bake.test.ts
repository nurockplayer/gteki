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
import { cutStairwells, stairwellWells, wellsSha256 } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { decodeRecipe, type MeshRecord } from "../../../apps/web/src/explorer/cutRecipe.ts";
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
    // The browser measures real fonts: canvas-sized sign positions differ from the headless approximation.
    const signs = scene.root.getObjectByName("ikebukuro_signs");
    expect(signs).toBeDefined();
    signs!.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) * 1.01);
      mesh.geometry.computeBoundingBox();
    });
    // The kit frame is fitted to the same canvas dimensions, so its instance transforms vary too.
    const frames = scene.root.getObjectByName("ikebukuro_kit_signs");
    expect(frames).toBeDefined();
    frames!.traverse(object => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); matrix.elements[0]! *= 1.01; matrix.elements[12]! += 0.01;
        mesh.setMatrixAt(i, matrix);
      }
      mesh.boundingBox = null; mesh.boundingSphere = null;
    });
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
        expect(wellsSha256(wells)).toBe(recipe.wellsSha256);
        expect(wells.flatMap(w => w.skipped ? [] : w.rects).length).toBe(recipe.keyCount);
        expect(cut.meshKeysHash).toBe(recipe.meshKeysHash);
        const keys = (meshes: MeshRecord[]) => meshes.map(({ count, hash, matrix }) => ({ count, hash, matrix }));
        expect(keys(recorded)).toEqual(keys(recipe.meshes));
      } finally { cut.dispose(); }
    } finally { disposePortalCuts(portals); scene.dispose?.(); }
  }, 900_000);

  it.each(["high", "low"] as const)("ikebukuro %s: a committed recipe still replays once the context blockers fill", async (tier) => {
    const dir = path.join(ROOT, "stations/ikebukuro/gteki");
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
    if (!parsed.ok) throw new Error("invalid Ikebukuro bundle");
    const bundle = parsed.bundle;
    const scene = await loadScene("ikebukuro", bundle, tier, false);
    // The station loads its street context in the background and fills the camera blockers when it arrives. Wait for
    // that, so the cut sees the blockers filled as a settled scene does; the bake never does (#1031).
    const blockers = (scene.cameraBlockers ?? []) as THREE.Mesh[];
    expect(blockers.length).toBeGreaterThan(0);
    const placeholder = blockers[0]!.geometry;
    const deadLine = Date.now() + 120_000;
    while (!blockers.some((mesh) => mesh.geometry !== placeholder)) {
      if (Date.now() > deadLine) throw new Error("the context blockers never filled");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const blockerTriangles = blockers.reduce((sum, mesh) => { const position = mesh.geometry.getAttribute("position"); return sum + (mesh.geometry.index ? mesh.geometry.index.count : position.count) / 3; }, 0);
    expect(blockerTriangles).toBeGreaterThan(0);
    // The browser measures real fonts: canvas-sized sign positions differ from the headless approximation.
    const signs = scene.root.getObjectByName("ikebukuro_signs");
    expect(signs).toBeDefined();
    signs!.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) position.setX(i, position.getX(i) * 1.01);
      mesh.geometry.computeBoundingBox();
    });
    // The kit frame is fitted to the same canvas dimensions, so its instance transforms vary too.
    const frames = scene.root.getObjectByName("ikebukuro_kit_signs");
    expect(frames).toBeDefined();
    frames!.traverse(object => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); matrix.elements[0]! *= 1.01; matrix.elements[12]! += 0.01;
        mesh.setMatrixAt(i, matrix);
      }
      mesh.boundingBox = null; mesh.boundingSphere = null;
    });
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
      const cut = cutStairwells(scene.root, wells, {
        tier, walkable: new Set(targets.ground), greyboxRoot: greybox.root,
        collision: [...scene.walkable, ...(scene.colliders ?? []), ...(scene.cameraBlockers ?? [])], recipe,
      });
      try {
        expect(cut.stats.recipe).toBe("replayed");
        expect(cut.meshKeysHash).toBe(recipe.meshKeysHash);
      } finally { cut.dispose(); }
    } finally { disposePortalCuts(portals); scene.dispose?.(); }
  }, 900_000);

  it.each(["shinjuku", "ikebukuro"])("%s: committed recipes match a fresh bake", (station) => {
    execFileSync("pnpm", ["exec", "tsx", "packages/godot/src/stairwell-bake.ts", "--station", station, "--check"], { cwd: ROOT, stdio: "pipe" });
  }, 900_000);
});
