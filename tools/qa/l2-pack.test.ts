// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./l2-pack.mjs", import.meta.url));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "l2-pack-framing-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// #1015: the designed boundary is exactly 0.5; a raw `< FRAMING.min` fails on float rounding.
function framingLine(viewportShare: number): string {
  mkdirSync(join(root, "evidence", "phone-webkit"), { recursive: true });
  writeFileSync(join(root, "evidence", "phone-webkit", "shinjuku-overview.json"), JSON.stringify({
    project: "phone-webkit", mode: "overview",
    framing: { framingDirect: { source: "overviewFrame", value: { viewportShare } }, routable: { spread: null } },
  }));
  execFileSync(process.execPath, [script, join(root, "evidence"), "--station", "shinjuku", "--no-sheets", "--out", join(root, "pack")], { stdio: "ignore" });
  const pack = JSON.parse(readFileSync(join(root, "pack", "l2-pack.json"), "utf8"));
  return pack.rows.find((r: { id: string }) => r.id === "C2").auto.find((l: string) => l.startsWith("11 framing:"));
}

describe("l2-pack 11 framing tolerance (#1015)", () => {
  it("passes 0.49999999999999944 at the 0.5 boundary", () => {
    expect(framingLine(0.49999999999999944)).toMatch(/^11 framing: webkit overview mode, .*0\.5 of the shorter side$/);
  });
  it("still fails 0.4999", () => {
    expect(framingLine(0.4999)).toMatch(/^11 framing: webkit FAIL /);
  });
});
