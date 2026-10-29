import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { navmeshBundle } from "./navmesh-input.ts";

it("builds a temporary private overlay without writing to the source directory", async () => {
  const previous = process.env.GTEKI_PRIVATE_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-navmesh-fixture-"));
  try {
    fs.mkdirSync(path.join(dir, "additions"));
    process.env.GTEKI_PRIVATE_DIR = dir;
    const result = await navmeshBundle("ikebukuro");
    expect(result.privateBuild).toBe(true);
    expect(result.bundle.station.id).toBeTruthy();
    expect(fs.existsSync(path.join(dir, "overlay"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.GTEKI_PRIVATE_DIR; else process.env.GTEKI_PRIVATE_DIR = previous;
    fs.rmSync(dir, { recursive:true, force:true });
  }
});
