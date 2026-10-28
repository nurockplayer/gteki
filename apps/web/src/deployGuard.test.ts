import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repo, "deploy/cloudflare-pages/build.sh");

describe("public Cloudflare Pages build guard", () => {
  it.each(["GTEKI_PRIVATE_OVERLAY", "GTEKI_STATION_ROOTS"])("refuses when %s is set", (key) => {
    const result = spawnSync("bash", [script], { env: { ...process.env, [key]: "/x" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing");
  });
});
