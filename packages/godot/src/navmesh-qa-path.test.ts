import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { qaDirectory, qaFile } from "./navmesh-qa-path.ts";

it("rejects output paths escaping .qa via a directory or file symlink", () => {
  const qa = path.resolve(".qa"), dir = fs.mkdtempSync(path.join(qaDirectory(qa), "navmesh-path-test-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-navmesh-test-"));
  try {
    fs.symlinkSync(outside, path.join(dir, "outside"));
    expect(() => qaDirectory(path.join(dir, "outside", "nested"))).toThrow(/outside/);
    fs.symlinkSync(path.join(outside, "output"), path.join(dir, "file"));
    expect(() => qaFile(path.join(dir, "file"))).toThrow(/symlink/);
    expect(qaFile(path.join(dir, "valid.json"))).toBe(path.join(dir, "valid.json"));
  } finally { fs.rmSync(dir, { recursive:true, force:true }); fs.rmSync(outside, { recursive:true, force:true }); }
});
