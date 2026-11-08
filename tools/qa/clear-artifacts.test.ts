// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./clear-artifacts.sh", import.meta.url));

let root: string;
let artifacts: string;

const packFiles = ["l2-review.md", "l2-pack.json", "manifest.json", "sheets/a.jpg"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clear-artifacts-"));
  artifacts = join(root, "artifacts");
  for (const station of ["shinjuku", "ikebukuro"]) {
    const pack = join(artifacts, `l2-pack-${station}`);
    mkdirSync(join(pack, "sheets"), { recursive: true });
    for (const file of packFiles) writeFileSync(join(pack, file), `${station} ${file}\n`);
  }
  mkdirSync(join(artifacts, "evidence"), { recursive: true });
  writeFileSync(join(artifacts, "evidence", "x.json"), "{}");
  writeFileSync(join(artifacts, "manifest.json"), "{}");
  writeFileSync(join(artifacts, "results.json"), "{}");
  mkdirSync(join(artifacts, "test-results"), { recursive: true });
  writeFileSync(join(artifacts, "test-results", "run.txt"), "x");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clear-artifacts.sh (#1017)", () => {
  it("keeps every finished L2 pack and clears everything else", () => {
    execFileSync("sh", [script, artifacts]);
    for (const station of ["shinjuku", "ikebukuro"]) {
      for (const file of packFiles) {
        expect(existsSync(join(artifacts, `l2-pack-${station}`, file)), `${station}/${file}`).toBe(true);
      }
    }
    for (const gone of ["evidence", "manifest.json", "results.json", "test-results"]) {
      expect(existsSync(join(artifacts, gone)), gone).toBe(false);
    }
  });

  it("removes a symlinked artifacts directory as a link, never emptying its target", () => {
    rmSync(artifacts, { recursive: true, force: true });
    const target = join(root, "elsewhere");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "x");
    symlinkSync(target, artifacts);
    execFileSync("sh", [script, artifacts]);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
    expect(lstatSync(artifacts).isSymbolicLink()).toBe(false);
    expect(readdirSync(artifacts)).toEqual([]);
  });

  it("creates a missing artifacts directory", () => {
    rmSync(artifacts, { recursive: true, force: true });
    execFileSync("sh", [script, artifacts]);
    expect(existsSync(artifacts)).toBe(true);
  });
});
