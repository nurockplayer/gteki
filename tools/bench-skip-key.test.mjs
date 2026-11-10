import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { shouldSkip } = require("./bench/skip-key.cjs");
const row = { suite: "test", variant: "node24", rep: 1, memory_limit: "3g", files: "", wall_s: null };
const params = { suite: "test", variant: "node24", rep: 1, memory: "3g", files: "", wallS: null };

describe("bench skip key", () => {
  it("skips a row with the same parameters", () => {
    expect(shouldSkip([row], params)).toBe(true);
  });

  it.each([
    ["files", { files: "packages/foo" }],
    ["wall time", { wallS: 30 }],
    ["memory", { memory: "2g" }],
  ])("runs again when %s differs", (_label, change) => {
    expect(shouldSkip([row], { ...params, ...change })).toBe(false);
  });

  it("runs a timed out row again", () => {
    expect(shouldSkip([{ ...row, timedOut: true }], params)).toBe(false);
  });

  it("matches old rows with default parameters", () => {
    const { files: _files, wall_s: _wall, ...oldRow } = row;
    expect(shouldSkip([oldRow], params)).toBe(true);
  });

  it("returns run for a missing file from the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-skip-key-"));
    try {
      const result = spawnSync(process.execPath, [
        join(import.meta.dirname, "bench/skip-key.cjs"), join(dir, "missing.jsonl"),
        "test", "node24", "1", "3g", "", "",
      ]);
      expect(result.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
