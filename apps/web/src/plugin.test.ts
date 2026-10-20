import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverStations } from "../stations-plugin.ts";

function tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-plugin-"));
  const st = (id: string) => path.join(root, "stations", id);
  fs.mkdirSync(path.join(st("alpha"), "gteki"), { recursive: true });
  fs.mkdirSync(path.join(st("alpha"), "assets"), { recursive: true });
  fs.writeFileSync(path.join(st("alpha"), "gteki", "station.json"), "{}");
  fs.writeFileSync(path.join(st("alpha"), "gteki", "scene.ts"), "export const buildScene = () => null;");
  fs.writeFileSync(path.join(st("alpha"), "assets", "b1.glb"), "x");
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
    expect(found[0]!.assets).toEqual(["assets/b1.glb"]);
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
