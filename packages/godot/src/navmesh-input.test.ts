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

it("bakes and audits a synthetic private overlay with a generated greybox", async () => {
  const { execFileSync } = await import("node:child_process");
  const base = path.join(process.cwd(), ".qa"); fs.mkdirSync(base, { recursive:true });
  const dir = fs.mkdtempSync(path.join(base, "navmesh-overlay-test-"));
  try {
    const additions = path.join(dir, "private", "additions", "ikebukuro");
    fs.mkdirSync(additions, { recursive:true });
    const graph = JSON.parse(fs.readFileSync(path.join(process.cwd(), "stations/ikebukuro/gteki/graph.json"),"utf8")) as { edges: Array<{ mode:string; verification:string; attributes?: Record<string,unknown> }> };
    const edge = graph.edges.find(e => e.mode === "walk" && e.verification === "verified");
    if (!edge) throw new Error("no public walk edge for fixture");
    fs.writeFileSync(path.join(additions,"graph.json"),JSON.stringify({nodes:[],edges:[{...edge,attributes:{...edge.attributes,sceneGap:true}}]}));
    const out = path.join(dir,"out");
    const env = {...process.env, GTEKI_PRIVATE_DIR:path.join(dir,"private")};
    const run = (args:string[]) => execFileSync("pnpm",["exec","tsx",...args],{cwd:process.cwd(),env,stdio:"pipe",maxBuffer:16*1024*1024,timeout:120_000});
    run(["packages/godot/src/navmesh-bake.ts","--station","ikebukuro","--with-greybox","--out",out]);
    const metrics = JSON.parse(fs.readFileSync(path.join(out,"ikebukuro-bake.json"),"utf8")) as {greyboxRuns:number};
    expect(metrics.greyboxRuns).toBeGreaterThan(0);
    run(["packages/godot/src/navmesh-audit.ts","--station","ikebukuro","--with-greybox","--navmesh",path.join(out,"ikebukuro.bin"),"--json",path.join(out,"audit.json")]);
    const report = JSON.parse(fs.readFileSync(path.join(out,"audit.json"),"utf8")) as {greyboxRuns:number;routesAudited:number};
    expect(report.greyboxRuns).toBe(metrics.greyboxRuns);
    expect(report.routesAudited).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dir,"private","overlay"))).toBe(false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}, 180_000);
