import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverStations, gtekiStations } from "../stations-plugin.ts";
import { threeAliases } from "../three-alias.ts";

function tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-plugin-"));
  const st = (id: string) => path.join(root, "stations", id);
  fs.mkdirSync(path.join(st("alpha"), "gteki"), { recursive: true });
  fs.mkdirSync(path.join(st("alpha"), "assets"), { recursive: true });
  fs.writeFileSync(path.join(st("alpha"), "gteki", "station.json"), "{}");
  fs.writeFileSync(path.join(st("alpha"), "gteki", "scene.ts"), "export const buildScene = () => null;");
  fs.writeFileSync(path.join(st("alpha"), "assets", "b1.glb"), "x");
  fs.writeFileSync(path.join(st("alpha"), "assets", "b1.meta.json"), "{}");
  fs.symlinkSync("../assets", path.join(st("alpha"), "gteki", "assets"));
  // Escape attempt: a link that points outside the station folder.
  fs.mkdirSync(path.join(root, "secret"), { recursive: true });
  fs.writeFileSync(path.join(root, "secret", "leak.png"), "x");
  fs.symlinkSync(path.join(root, "secret"), path.join(st("alpha"), "gteki", "outside"));
  // A folder without gteki/station.json is not a station.
  fs.mkdirSync(path.join(st("beta"), "data"), { recursive: true });
  return path.join(root, "stations");
}

describe("station discovery", () => {
  it("finds stations by convention, follows in-station symlinks and refuses escapes", () => {
    const found = discoverStations([tree()]);
    expect(found.map((s) => s.dir)).toEqual(["alpha"]);
    expect(found[0]!.assets).toEqual(["assets/b1.glb", "assets/b1.meta.json"]);
    expect(found[0]!.scene).toMatch(/scene\.ts$/);
  });

  it("lets the first root win per station folder", () => {
    const a = tree();
    const b = tree();
    const found = discoverStations([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0]!.gtekiDir.startsWith(a)).toBe(true);
  });
});

describe("threeAliases", () => {
  const dir = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/three"));
  const aliases = threeAliases(dir);
  const resolve = (spec: string) => {
    const a = aliases.find((x) => x.find.test(spec));
    return a ? spec.replace(a.find, a.replacement) : null;
  };

  it("maps addons, examples/jsm and the bare entry through three's exports map to real files", () => {
    for (const spec of ["three", "three/addons", "three/addons/loaders/GLTFLoader.js", "three/examples/jsm/controls/OrbitControls.js", "three/webgpu"]) {
      const file = resolve(spec);
      expect(file, spec).not.toBeNull();
      expect(fs.existsSync(file!), `${spec} → ${file}`).toBe(true);
    }
    expect(resolve("three/addons/loaders/GLTFLoader.js")).toBe(path.join(dir, "examples/jsm/loaders/GLTFLoader.js"));
  });

  it("leaves unrelated specifiers alone", () => {
    expect(resolve("threejs-extra")).toBeNull();
    expect(resolve("three-mesh-bvh")).toBeNull();
  });
});

describe("virtual station module asset URLs", () => {
  const load = (roots: string[], command: "serve" | "build") => {
    const plugin = gtekiStations(roots) as unknown as { configResolved(c: { command: string }): void; load(id: string): string };
    plugin.configResolved({ command });
    return plugin.load("\0virtual:gteki-stations");
  };

  it("serves dev assets from their current real path, so a symlink → folder move is never stale", () => {
    const root = tree();
    const real = fs.realpathSync(path.join(root, "alpha", "assets", "b1.glb"));
    expect(load([root], "serve")).toContain(JSON.stringify(`/@fs${real}`));
    // Station replaces the symlink with a real folder: the next load points at the new file.
    fs.rmSync(path.join(root, "alpha", "gteki", "assets"));
    fs.mkdirSync(path.join(root, "alpha", "gteki", "assets"));
    fs.writeFileSync(path.join(root, "alpha", "gteki", "assets", "b1.glb"), "y");
    const moved = fs.realpathSync(path.join(root, "alpha", "gteki", "assets", "b1.glb"));
    const code = load([root], "serve");
    expect(code).toContain(JSON.stringify(`/@fs${moved}`));
    expect(code).not.toContain(JSON.stringify(`/@fs${real}`));
  });

  it("uses fingerprinted ?url imports for production builds", () => {
    expect(load([tree()], "build")).toMatch(/b1\.glb" \+ "\?url"/);
  });
});
