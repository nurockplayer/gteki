import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(repo, "scripts/deploy-private.sh");

describe("private Cloudflare Pages deploy guards", () => {
  it("refuses when GTEKI_PRIVATE_DIR is unset", () => {
    const env = { ...process.env };
    delete env.GTEKI_PRIVATE_DIR;
    const result = spawnSync("bash", [script], { env, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GTEKI_PRIVATE_DIR");
  });

  it("refuses in CI before the build", () => {
    const result = spawnSync("bash", [script], {
      env: { ...process.env, GTEKI_PRIVATE_DIR: "/tmp", CI: "1" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not run from CI");
  });

  it("refuses --branch main before the build", () => {
    const result = spawnSync("bash", [script, "--branch", "main"], {
      env: { ...process.env, GTEKI_PRIVATE_DIR: "/tmp" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--branch is not allowed");
  });

  it("refuses GTEKI_DEPLOY_BRANCH=production before the build", () => {
    const result = spawnSync("bash", [script], {
      env: { ...process.env, GTEKI_PRIVATE_DIR: "/tmp", GTEKI_DEPLOY_BRANCH: "production" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GTEKI_DEPLOY_BRANCH");
  });
});
