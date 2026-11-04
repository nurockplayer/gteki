import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { privateLevelRegions } from "../../../apps/web/src/explorer/privateLevels.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { assertPrivateRegionsProvenance } from "./navmesh-audit.ts";
import { navmeshBundle, privateRegionsSha256 } from "./navmesh-input.ts";

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

it("keeps private floor holes, routing exclusions and provenance in the selected slice", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-private-split-")), previous = process.env.GTEKI_PRIVATE_DIR;
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  const bundle = createSyntheticBundle([syntheticEdge("crossing", "start", "a"), syntheticEdge("vertical", "a", "upper", { mode: "stairs" })]);
  bundle.nodes.find(n => n.id === "start")!.position = { x: 1, y: 5, z: 0 };
  bundle.nodes.find(n => n.id === "a")!.position = { x: 9, y: 5, z: 0 };
  const stationDir = path.join(root, "stations/ikebukuro/gteki"), privateDir = path.join(root, "private"), additions = path.join(privateDir, "additions/ikebukuro");
  const write = (dir: string, name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  const rect = (a: number, b: number) => [[a, 0], [b, 0], [b, 10], [a, 10], [a, 0]];
  try {
    fs.mkdirSync(stationDir, { recursive: true }); fs.mkdirSync(additions, { recursive: true });
    write(stationDir, "station.json", { schema: bundle.schema, station: bundle.station, sources: bundle.sources, floors: bundle.floors, coverage: bundle.coverage });
    write(stationDir, "graph.json", { schema: bundle.schema, stationId: bundle.station.id, nodes: bundle.nodes, edges: bundle.edges });
    write(stationDir, "pois.json", { schema: bundle.schema, stationId: bundle.station.id, pois: bundle.pois });
    write(additions, "levels.selection.json", { walkable: ["class-a"], holes: ["class-b"] });
    write(additions, "levels.s03.json", { levels: [
      { floorId: "concourse", renderElevationM: 0, features: [{ facility: "class-a", polygons: [[rect(0, 10)]] }, { facility: "class-b", polygons: [[[[3,3],[7,3],[7,7],[3,7],[3,3]]]] }] },
      { floorId: "upper", renderElevationM: 4, features: [{ facility: "class-a", polygons: [[rect(20, 30)]] }] },
    ] });
    process.env.GTEKI_PRIVATE_DIR = privateDir;
    const full = await navmeshBundle("ikebukuro"), slice = await navmeshBundle("ikebukuro", ["concourse"]);
    expect(slice.sceneBundle).toEqual(full.bundle);
    expect(slice.outOfSplit).toEqual(["vertical"]);
    expect(slice.bundle.edges).toEqual(full.bundle.edges.filter(e => e.id === "crossing"));
    expect(slice.bundle.edges[0]).toMatchObject({ closed: true, attributes: { privateFloorBlockedReason: "explicit-private-hole" } });
    expect(slice.privateRegions).toEqual(full.privateRegions!.filter(r => r.level === "concourse"));
    expect(slice.privateRegions).toHaveLength(1);
    expect(slice.privateRegions![0]!.rings).toHaveLength(2);
    expect(slice.privateRegions![0]!.exclusions).toHaveLength(1);
    const grey = makeGreybox(slice.bundle, { root: new THREE.Group(), walkable: [], colliders: [], dispose() {} }, slice.privateBuild, slice.privateRegions);
    const hit = (x: number, y: number) => new THREE.Raycaster(new THREE.Vector3(x, y, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(grey.probe.ground, true);
    expect(hit(1, 0.5).length).toBeGreaterThan(0);
    expect(hit(5, 0.5)).toHaveLength(0);
    expect(hit(25, 4.5)).toHaveLength(0);
    const provenance = { privateRegionsSha256: privateRegionsSha256(slice.privateRegions) };
    expect(provenance.privateRegionsSha256).not.toBe(privateRegionsSha256(full.privateRegions));
    expect(() => assertPrivateRegionsProvenance(provenance, slice.privateRegions)).not.toThrow();
    const changed = structuredClone(slice.privateRegions!); changed[0]!.exclusions![0]![0]![0]!.x += 0.1;
    expect(() => assertPrivateRegionsProvenance(provenance, changed)).toThrow(/private regions differ/);
    expect(fs.existsSync(path.join(privateDir, "overlay"))).toBe(false);
  } finally {
    cwd.mockRestore();
    if (previous === undefined) delete process.env.GTEKI_PRIVATE_DIR; else process.env.GTEKI_PRIVATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])("bakes and audits private polygon geometry with floor split=%s", async (split) => {
  const previous = process.env.GTEKI_PRIVATE_DIR;
  delete process.env.GTEKI_PRIVATE_DIR;
  const { execFileSync } = await import("node:child_process");
  const base = path.join(process.cwd(), ".qa"); fs.mkdirSync(base, { recursive:true });
  const dir = fs.mkdtempSync(path.join(base, "navmesh-overlay-test-"));
  try {
    const additions = path.join(dir, "private", "additions", "ikebukuro");
    fs.mkdirSync(additions, { recursive:true });
    const graph = JSON.parse(fs.readFileSync(path.join(process.cwd(), "stations/ikebukuro/gteki/graph.json"),"utf8")) as { nodes: Array<{ id: string; floorId: string }>; edges: Array<{ from: string; mode:string; verification:string; attributes?: Record<string,unknown> }> };
    const edge = graph.edges.find(e => e.mode === "walk" && e.verification === "verified");
    if (!edge) throw new Error("no public walk edge for fixture");
    fs.writeFileSync(path.join(additions,"graph.json"),JSON.stringify({nodes:[],edges:[{...edge,attributes:{...edge.attributes,sceneGap:true}}]}));
    const floorId = graph.nodes.find(n => n.id === edge.from)!.floorId;
    const { bundle: publicBundle } = await navmeshBundle("ikebukuro");
    const input: Parameters<typeof privateLevelRegions>[0] = { levels: [{ floorId, renderElevationM: publicBundle.floors.find(f => f.id === floorId)!.renderElevationM, features: [
      { facility: "class-a", polygons: [[[[0,0],[10,0],[10,10],[0,10],[0,0]]]] },
      { facility: "class-b", polygons: [[[[3,3],[7,3],[7,7],[3,7],[3,3]]]] },
    ] }] };
    const selection = { walkable: ["class-a"], holes: ["class-b"] };
    fs.writeFileSync(path.join(additions, "levels.s03.json"), JSON.stringify(input));
    fs.writeFileSync(path.join(additions, "levels.selection.json"), JSON.stringify(selection));
    const flags = split ? ["--floors", floorId] : [];
    // Private-derived output must go under the private directory's .qa (#669 r3).
    const out = path.join(dir,"private",".qa","out");
    const env = {...process.env, GTEKI_PRIVATE_DIR:path.join(dir,"private")};
    const run = (args:string[]) => execFileSync("pnpm",["exec","tsx",...args],{cwd:process.cwd(),env,stdio:"pipe",maxBuffer:16*1024*1024,timeout:120_000});
    run(["packages/godot/src/navmesh-bake.ts","--station","ikebukuro","--with-greybox",...flags,"--out",out]);
    const metrics = JSON.parse(fs.readFileSync(path.join(out,"ikebukuro-bake.json"),"utf8")) as {greyboxRuns:number; privateRegionsSha256: string; floors?: string[]};
    expect(metrics.greyboxRuns).toBeGreaterThan(0);
    expect(metrics.floors).toEqual(split ? [floorId] : undefined);
    expect(metrics.privateRegionsSha256).toBe(privateRegionsSha256(privateLevelRegions(input, selection)));
    run(["packages/godot/src/navmesh-audit.ts","--station","ikebukuro","--with-greybox",...flags,"--navmesh",path.join(out,"ikebukuro.bin"),"--json",path.join(out,"audit.json")]);
    const report = JSON.parse(fs.readFileSync(path.join(out,"audit.json"),"utf8")) as {greyboxRuns:number;routesAudited:number};
    expect(report.greyboxRuns).toBe(metrics.greyboxRuns);
    expect(report.routesAudited).toBeGreaterThan(0);
    input.levels[0]!.features[0]!.polygons[0]![0]![1]![0] = 11;
    fs.writeFileSync(path.join(additions, "levels.s03.json"), JSON.stringify(input));
    expect(() => run(["packages/godot/src/navmesh-audit.ts", "--station", "ikebukuro", "--with-greybox", ...flags, "--navmesh", path.join(out, "ikebukuro.bin"), "--json", path.join(out, "stale.json")])).toThrow(/private regions differ/);
    expect(fs.existsSync(path.join(dir,"private","overlay"))).toBe(false);
  } finally {
    if (previous !== undefined) process.env.GTEKI_PRIVATE_DIR = previous;
    fs.rmSync(dir,{recursive:true,force:true});
  }
}, 180_000);
