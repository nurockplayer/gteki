/** Slow public scene builds use the existing *.heavy.test.ts convention; run in a light orb-test container. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { navmeshBundle } from "./navmesh-input.ts";
import { floorSplitPlan } from "./navmesh-floors.ts";

it("bakes and audits the smallest estimated public Shinjuku floor group through both CLIs", async () => {
  const env = { ...process.env }; delete env.GTEKI_PRIVATE_DIR;
  const previous = process.env.GTEKI_PRIVATE_DIR; delete process.env.GTEKI_PRIVATE_DIR;
  const qa = path.join(process.cwd(), ".qa"); fs.mkdirSync(qa, { recursive:true });
  const out = fs.mkdtempSync(path.join(qa, "navmesh-floor-cli-"));
  try {
    const { bundle } = await navmeshBundle("shinjuku");
    const group = floorSplitPlan(bundle).sort((a,b) => a.estimatedBakeMiB-b.estimatedBakeMiB || a.nodes-b.nodes)[0]!;
    const floors = new Set(group.floors), nodes = new Set(bundle.nodes.filter(n => floors.has(n.floorId)).map(n => n.id));
    const boundary = bundle.edges.filter(e => nodes.has(e.from) !== nodes.has(e.to)).map(e => e.id);
    expect(boundary.length).toBeGreaterThan(0);
    const common = ["--station", "shinjuku", "--floors", group.floors.join(","), "--with-greybox"];
    // Node runs the same tsx CLI without a package-manager wrapper that can outlive a timeout.
    const run = (file: string, args: string[]) => execFileSync(process.execPath, ["--import", "tsx", `packages/godot/src/${file}.ts`, ...common, ...args], { env, stdio:"pipe", timeout:150_000, maxBuffer:4*1024*1024 });
    run("navmesh-bake", ["--out", out]);
    run("navmesh-audit", ["--navmesh", path.join(out,"shinjuku.bin"), "--json", path.join(out,"audit.json")]);
    const bake = JSON.parse(fs.readFileSync(path.join(out,"shinjuku-bake.json"), "utf8"));
    const audit = JSON.parse(fs.readFileSync(path.join(out,"audit.json"), "utf8"));
    expect(bake.floors).toEqual(group.floors);
    expect(audit.floors).toEqual(bake.floors);
    expect(audit.routesAudited).toBeGreaterThan(0);
    expect(audit.incompleteRoutes).toBe(0);
    for (const result of [bake, audit]) {
      expect(result.outOfSplit).toBe(boundary.length);
      expect(result.outOfSplitEdgeIds).toEqual(boundary);
    }
    expect(audit.bakeProvenance.meshSha256).toBe(bake.meshSha256);
    expect(audit.failureEdges.every((e: { edgeId:string }) => !boundary.includes(e.edgeId))).toBe(true);
    console.log(`PUBLIC CLI SPLIT PASS: ${group.floors.join(",")}; ${boundary.length} boundary edges; ${audit.routesAudited} routes; 0 incomplete`);
  } finally {
    if (previous !== undefined) process.env.GTEKI_PRIVATE_DIR = previous;
    fs.rmSync(out, { recursive:true, force:true });
  }
}, 330_000);
