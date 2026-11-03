import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";
import * as THREE from "three";
import { parseStationFiles, type StationBundle } from "@gteki/schema";
import { createRouter } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { createDemoFiles } from "../demo.ts";
import { gtekiStations } from "../../stations-plugin.ts";
import { privateFloorRoutingEdges } from "./privateFloorRouting.ts";
import { buildGreybox } from "./greybox.ts";
import { privateLevelRegions, type PrivateLevels, type PolygonRegion } from "./privateLevels.ts";

// Keep the tools entry point outside the app typecheck, as the headless loader does.
const { buildOverlay } = await import(new URL("../../../../tools/private-overlay/build-overlay.ts", import.meta.url).href) as {
  buildOverlay(options: { repoRoot: string; privateDir: string }): string[];
};

const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const selection = { walkable: ["class-a"], holes: ["class-b"] };
const input: PrivateLevels = { levels: [{ floorId: "synthetic-level", renderElevationM: 7, features: [
  { facility: "class-a", polygons: [[rect(0, 0, 6, 10), rect(1, 1, 1, 1)]] },
  { facility: "class-a", polygons: [[rect(4, 0, 6, 10)]] },
  { facility: "class-b", polygons: [[rect(3, 3, 4, 4)]] },
  { facility: "class-c", polygons: [[rect(-20, -20, 40, 40)]] },
  { facility: null, polygons: [[rect(-20, -20, 40, 40)]] },
] }] };

describe("private level selection and rendering", () => {
  it("unions selected floors, subtracts exclusions, and keeps intrinsic holes without changing input", () => {
    const original = structuredClone(input), regions = privateLevelRegions(input, selection);
    expect(input).toEqual(original);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.rings).toHaveLength(3);
    expect(JSON.stringify(regions)).not.toContain("class-");
    expect(privateLevelRegions(input, { walkable: [], holes: [] })).toEqual([]);
    expect(() => privateLevelRegions(input, {} as typeof selection)).toThrow("Private level selection requires string arrays");
  });

  it("keeps a selected floor's hole empty when a graph passage crosses it", () => {
    const ring = (a: number, b: number) => [{ x: a, z: -a }, { x: b, z: -a }, { x: b, z: -b }, { x: a, z: -b }];
    const regions: PolygonRegion[] = [{ kind: "polygon", level: "synthetic-level", y: 0, rings: [ring(0, 10), ring(3, 7)], exclusions: [[ring(3, 7)]] }];
    const bundle = {
      floors: [{ id: "synthetic-level", renderElevationM: 0 }],
      nodes: [{ id: "a", floorId: "synthetic-level", position: { x: -2, y: 5, z: 0 } }, { id: "b", floorId: "synthetic-level", position: { x: 12, y: 5, z: 0 } }],
      edges: [{ id: "crossing", from: "a", to: "b", mode: "walk" }],
    } as unknown as StationBundle;
    const grey = buildGreybox(bundle, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
    grey.root.updateMatrixWorld(true);
    const hits = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(grey.walkable, true);
    expect(hits(5)).toHaveLength(0);
    expect(hits(11).length).toBeGreaterThan(0);
    expect(hits(1).length).toBeGreaterThan(0);
    expect(grey.wallSegments.length).toBeGreaterThanOrEqual(8);
    const nav = grey.navFloors!;
    let area = 0;
    for (let i = 0; i < nav.length; i += 9) area += Math.abs((nav[i + 3]! - nav[i]!) * (nav[i + 8]! - nav[i + 2]!) - (nav[i + 5]! - nav[i + 2]!) * (nav[i + 6]! - nav[i]!)) / 2;
    expect(area).toBeGreaterThan(84);
    const intrinsicOnly = regions.map(({ exclusions: _mask, ...region }) => region);
    const filled = buildGreybox(bundle, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", false, intrinsicOnly);
    filled.root.updateMatrixWorld(true);
    expect(new THREE.Raycaster(new THREE.Vector3(5, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(filled.walkable, true).length).toBeGreaterThan(0);
    const navMesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(nav, 3)), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    expect(new THREE.Raycaster(new THREE.Vector3(5, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObject(navMesh)).toHaveLength(0);
    expect(new THREE.Raycaster(new THREE.Vector3(11, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObject(navMesh).length).toBeGreaterThan(0);
    for (const [floorId, z] of [["synthetic-level", 4], ["another-level", 0]] as const) {
      const separate = structuredClone(bundle);
      for (const node of separate.nodes) { node.floorId = floorId; node.position.z = z; }
      const kept = buildGreybox(separate, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
      kept.root.updateMatrixWorld(true);
      const hit = new THREE.Raycaster(new THREE.Vector3(5, z + 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(kept.walkable, true);
      expect(hit[0]!.point.y).toBeCloseTo(z);
    }
  });

  it("retains explicit masks outside selected footprints, including levels with no selected floors", () => {
    for (const withFloor of [false, true]) {
      const regions = privateLevelRegions({ levels: [{ floorId: "concourse", renderElevationM: 0, features: [
        ...(withFloor ? [{ facility: "class-a", polygons: [[rect(0, 0, 10, 10)]] }] : []),
        { facility: "class-b", polygons: [[rect(12, 3, 2, 4)]] },
      ] }] }, selection);
      expect(regions[0]!.exclusions).toHaveLength(1);
      const bundle = createSyntheticBundle([syntheticEdge("crossing", "start", "a")]);
      bundle.nodes.find(n => n.id === "start")!.position = { x: 11, y: 5, z: 0 };
      bundle.nodes.find(n => n.id === "a")!.position = { x: 15, y: 5, z: 0 };
      const grey = buildGreybox(bundle, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
      grey.root.updateMatrixWorld(true);
      const hit = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(grey.walkable, true);
      expect(hit(11.5).length).toBeGreaterThan(0);
      expect(hit(13)).toHaveLength(0);
      expect(hit(14.5).length).toBeGreaterThan(0);
      expect(privateFloorRoutingEdges(bundle, regions)[0]!.closed).toBe(true);
    }
  });

  it("routes around private exclusions, or returns no route when the crossing is the only edge", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-private-route-")), privateDir = path.join(root, "private");
    const stationDir = path.join(root, "stations", "demo", "gteki"), additions = path.join(privateDir, "additions", "demo");
    fs.mkdirSync(stationDir, { recursive: true }); fs.mkdirSync(additions, { recursive: true });
    const write = (dir: string, name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    const direct = syntheticEdge("crossing", "start", "a");
    const bundle = createSyntheticBundle([direct]);
    for (const [id, x, y] of [["start", 1, 5], ["a", 9, 5], ["b", 1, 1], ["goal", 9, 1]] as const)
      bundle.nodes.find((n) => n.id === id)!.position = { x, y, z: 0 };
    write(stationDir, "station.json", { schema: bundle.schema, station: bundle.station, sources: bundle.sources, floors: bundle.floors, coverage: bundle.coverage });
    write(stationDir, "pois.json", { schema: bundle.schema, stationId: bundle.station.id, pois: [] });
    const writeGraph = () => write(stationDir, "graph.json", { schema: bundle.schema, stationId: bundle.station.id, nodes: bundle.nodes, edges: bundle.edges });
    write(additions, "levels.s03.json", { levels: [{ floorId: "concourse", renderElevationM: 0, features: [{ facility: "class-a", polygons: [[rect(0, 0, 10, 10)]] }, { facility: "class-b", polygons: [[rect(3, 3, 4, 4)]] }] }] });
    write(additions, "levels.selection.json", selection);
    const load = () => {
      writeGraph(); buildOverlay({ repoRoot: root, privateDir });
      const dir = path.join(privateDir, "overlay", "demo", "gteki");
      const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), undefined, { privateTier: true });
      if (!parsed.ok) throw new Error("synthetic overlay did not parse");
      return parsed.bundle;
    };
    try {
      expect(createRouter(bundle).route("start", "a").ok).toBe(true);
      const blocked = load();
      expect(createRouter(blocked).route("start", "a")).toMatchObject({ ok: false, reason: "no_path" });
      expect(blocked.edges[0]).toMatchObject({ closed: true, attributes: { privateFloorBlockedReason: "explicit-private-hole" } });
      bundle.edges.push(syntheticEdge("around-1", "start", "b"), syntheticEdge("around-2", "b", "goal"), syntheticEdge("around-3", "goal", "a"));
      const route = createRouter(load()).route("start", "a");
      expect(route.ok).toBe(true);
      if (route.ok) expect(route.steps.map((step) => step.edgeId)).toEqual(["around-1", "around-2", "around-3"]);
      expect(direct.closed).toBe(false);
      fs.rmSync(path.join(additions, "levels.s03.json"));
      expect(load().edges[0]!.closed).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("loads only overlay geometry and emits real walkable/navmesh floors with empty holes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gteki-levels-")), privateDir = path.join(root, "private");
    const stationDir = path.join(root, "stations", "demo", "gteki"), additions = path.join(privateDir, "additions", "demo");
    fs.mkdirSync(stationDir, { recursive: true }); fs.mkdirSync(additions, { recursive: true });
    const write = (dir: string, name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    const [manifest, graph, pois] = createDemoFiles();
    for (const [name, value] of [["station.json", manifest], ["graph.json", graph], ["pois.json", pois]] as const) write(stationDir, name, value);
    write(additions, "levels.s03.json", input); write(additions, "levels.selection.json", selection);
    const load = async (overlay: string | null): Promise<PolygonRegion[] | undefined> => {
      const server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [gtekiStations([path.join(root, "stations")], { overlay })], server: { middlewareMode: true, watch: null } });
      try {
        const { stations } = await server.ssrLoadModule("virtual:gteki-stations");
        return await stations[0].privateRegions?.();
      } finally { await server.close(); }
    };
    try {
      buildOverlay({ repoRoot: root, privateDir });
      const regions = await load(path.join(privateDir, "overlay"));
      expect(regions).toEqual(JSON.parse(JSON.stringify(privateLevelRegions(input, selection))));
      write(stationDir, "private_regions.json", regions);
      expect(await load(null)).toBeUndefined();
      const bundle = { floors: [], nodes: [], edges: [] } as unknown as StationBundle;
      const grey = buildGreybox(bundle, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
      grey.root.updateMatrixWorld(true);
      const hit = (x: number, north: number) => new THREE.Raycaster(new THREE.Vector3(x, 7.5, -north), new THREE.Vector3(0, -1, 0)).intersectObjects(grey.walkable, true);
      expect(hit(8, 5)[0]!.point.y).toBeCloseTo(7);
      expect(hit(5, 5)).toHaveLength(0);
      expect(hit(1.5, 1.5)).toHaveLength(0);
      expect(hit(12, 5)).toHaveLength(0);
      expect(grey.wallSegments).toHaveLength(12);
      const nav = grey.navFloors!;
      let area = 0;
      for (let i = 0; i < nav.length; i += 9) area += Math.abs((nav[i + 3]! - nav[i]!) * (nav[i + 8]! - nav[i + 2]!) - (nav[i + 5]! - nav[i + 2]!) * (nav[i + 6]! - nav[i]!)) / 2;
      expect(area).toBeCloseTo(83);
      grey.root.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      fs.rmSync(path.join(additions, "levels.s03.json"));
      buildOverlay({ repoRoot: root, privateDir });
      expect(await load(path.join(privateDir, "overlay"))).toBeUndefined();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
});
