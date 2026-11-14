// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterEach, beforeEach, expect, it } from "vitest";

const script = fileURLToPath(new URL("./golden-diff.mjs", import.meta.url));
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "golden-diff-"));
  for (const dir of ["base", "head"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, "cameras.json"), JSON.stringify({ cameras: [{ id: "block", expect: "a view" }] }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function shot(dir: string, id: string, pixels: number, value = 255) {
  const png = new PNG({ width: 100, height: 100 });
  for (let i = 0; i < 10000; i++) {
    png.data[i * 4] = i < pixels ? value : 0;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(join(root, dir, `${id}.png`), PNG.sync.write(png));
}
function run() {
  execFileSync(process.execPath, [script, join(root, "base"), join(root, "head"), join(root, "out"), "--cameras", join(root, "cameras.json")]);
  return JSON.parse(readFileSync(join(root, "out", "diff.json"), "utf8"));
}
it("reports identical images and the channel cutoff without pictures", () => {
  shot("base", "same", 0); shot("head", "same", 0);
  shot("base", "cutoff", 0); shot("head", "cutoff", 10000, 24);
  expect(run()).toEqual([{ camera: "cutoff", expect: "", diffRatio: 0, changed: false }, { camera: "same", expect: "", diffRatio: 0, changed: false }]);
  expect(readdirSync(join(root, "out"))).toEqual(["diff.json"]);
});
it("writes a comparison for a four percent change and a missing side", () => {
  shot("base", "block", 0); shot("head", "block", 400); shot("head", "missing", 0);
  expect(run()).toEqual([{ camera: "block", expect: "a view", diffRatio: 0.04, changed: true }, { camera: "missing", expect: "", diffRatio: 1, changed: true }]);
  expect(PNG.sync.read(readFileSync(join(root, "out", "block.png"))).width).toBe(300);
  expect(readdirSync(join(root, "out"))).toContain("missing.png");
});
it("writes only the eight largest changes", () => {
  for (let i = 1; i <= 10; i++) { shot("base", `cam${i}`, 0); shot("head", `cam${i}`, i * 200); }
  expect(run()).toHaveLength(10);
  const pictures = readdirSync(join(root, "out")).filter((f) => f.endsWith(".png"));
  expect(pictures).toHaveLength(8);
  expect(pictures).not.toContain("cam1.png");
  expect(pictures).not.toContain("cam2.png");
});
