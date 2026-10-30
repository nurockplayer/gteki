/** A committed stairwell recipe must match a fresh bake and replay to the live cut (see stairwell-bake.ts). */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("stairwell recipes", () => {
  it.each(["shinjuku"])("%s: committed recipes match a fresh bake", (station) => {
    execFileSync("pnpm", ["exec", "tsx", "packages/godot/src/stairwell-bake.ts", "--station", station, "--check"], { cwd: ROOT, stdio: "pipe" });
  }, 900_000);
});
