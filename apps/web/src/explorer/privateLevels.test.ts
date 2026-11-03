import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";
import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import { createDemoFiles } from "../demo.ts";
import { gtekiStations } from "../../stations-plugin.ts";
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
    const regions: PolygonRegion[] = [{ kind: "polygon", level: "synthetic-level", y: 0, rings: [ring(0, 10), ring(3, 7)] }];
    const bundle = {
      floors: [{ id: "synthetic-level", renderElevationM: 0 }],
      nodes: [{ id: "a", floorId: "synthetic-level", position: { x: -2, y: 5, z: 0 } }, { id: "b", floorId: "synthetic-level", position: { x: 12, y: 5, z: 0 } }],
      edges: [{ id: "crossing", from: "a", to: "b", mode: "walk" }],
    } as unknown as StationBundle;
    const grey = buildGreybox(bundle, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
    grey.root.updateMatrixWorld(true);
    const hits = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(grey.walkable, true);
    expect(hits(5)).toHaveLength(0);
    expect(hits(11)).toHaveLength(0);
    expect(hits(1).length).toBeGreaterThan(0);
    expect(grey.wallSegments).toHaveLength(8);
    const nav = grey.navFloors!;
    let area = 0;
    for (let i = 0; i < nav.length; i += 9) area += Math.abs((nav[i + 3]! - nav[i]!) * (nav[i + 8]! - nav[i + 2]!) - (nav[i + 5]! - nav[i + 2]!) * (nav[i + 6]! - nav[i]!)) / 2;
    expect(area).toBeCloseTo(84);
    for (const [floorId, z] of [["synthetic-level", 4], ["another-level", 0]] as const) {
      const separate = structuredClone(bundle);
      for (const node of separate.nodes) { node.floorId = floorId; node.position.z = z; }
      const kept = buildGreybox(separate, () => true, () => false, { colliderNear: () => false, wallHit: () => null }, "low", true, regions);
      kept.root.updateMatrixWorld(true);
      const hit = new THREE.Raycaster(new THREE.Vector3(5, z + 0.5, -5), new THREE.Vector3(0, -1, 0)).intersectObjects(kept.walkable, true);
      expect(hit[0]!.point.y).toBeCloseTo(z);
    }
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
