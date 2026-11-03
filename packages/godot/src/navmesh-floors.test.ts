import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import * as THREE from "three";
import { createSyntheticBundle, syntheticEdge } from "../../navigation/src/fixtures.ts";
import { floorScene, floorSplitPlan, parseFloors, splitFloors } from "./navmesh-floors.ts";
import { navmeshBundle } from "./navmesh-input.ts";

it("keeps an induced subgraph, trims POI connectors and counts boundary edges separately", () => {
  const bundle = createSyntheticBundle([
    syntheticEdge("walk", "start", "a"),
    syntheticEdge("stair", "a", "upper", { mode: "stairs" }),
    syntheticEdge("lift", "upper", "other", { mode: "elevator" }),
    syntheticEdge("outside", "other", "other"),
  ]);
  bundle.pois.push({ ...bundle.pois[0]!, id: "multi", floorId: null, connectorNodeIds: ["a", "upper", "other"] });
  bundle.spawnNodeIds = ["a", "upper", "other"]; bundle.spawnHeadings = { a: 90, other: 180 };
  const before = JSON.stringify(bundle);
  const split = splitFloors(bundle, ["concourse", "upper"]);
  expect(split.bundle.nodes.every(n => n.floorId !== "other-concourse")).toBe(true);
  expect(split.bundle.edges.map(e => e.id)).toEqual(["walk", "stair"]);
  expect(split.outOfSplit).toEqual(["lift"]);
  expect(split.bundle.pois.find(p => p.id === "multi")!.connectorNodeIds).toEqual(["a", "upper"]);
  expect(split.bundle.spawnNodeIds).toEqual(["a", "upper"]);
  expect(split.bundle.spawnHeadings).toEqual({ a: 90 });
  const lower = splitFloors(bundle, ["concourse"]);
  expect(lower.outOfSplit).toEqual(["stair"]);
  expect(lower.bundle.edges.map(e => e.id)).toEqual(["walk"]);
  expect(JSON.stringify(bundle)).toBe(before);
  expect(splitFloors(bundle).bundle).toBe(bundle);
  expect(JSON.stringify(splitFloors(bundle).bundle)).toBe(before);
  expect(() => splitFloors(bundle, ["typo"])).toThrow("unknown floor");
  expect(() => parseFloors("concourse,")).toThrow();
  expect(parseFloors("upper,concourse,upper")).toEqual(["concourse", "upper"]);
});

it("filters triangles inside merged, transformed and instanced meshes before greybox input", () => {
  const bundle = createSyntheticBundle();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0,0,0, 0,0,4, 4,0,0, // selected floor
    0,4,0, 0,4,4, 4,4,0, // omitted upper floor
  ], 3));
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const floor = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1,2,1), new THREE.MeshBasicMaterial(), 2);
  wall.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0,1,0));
  wall.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0,5,0));
  Object.defineProperty(wall.userData, "gtekiGateTriangles", { value: [0,1], writable: true });
  Object.defineProperty(wall.userData, "gteki_source", { value: "fixture" });
  const root = new THREE.Group().add(floor, wall); root.position.x = 10; root.updateMatrixWorld(true);
  const scene = { root, walkable:[floor], colliders:[wall], walls:[
    { a:{x:0,y:0}, b:{x:1,y:0}, zMin:0, zMax:2 },
    { a:{x:0,y:0}, b:{x:1,y:0}, zMin:4, zMax:6 },
  ], dispose() {} };
  expect(floorScene(scene, bundle)).toBe(scene);
  const filtered = floorScene(scene, bundle, ["concourse"]);
  const mesh = filtered.walkable[0] as THREE.Mesh;
  expect(mesh.geometry.getAttribute("position").count).toBe(3);
  expect(mesh.geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);
  const ray = new THREE.Raycaster(new THREE.Vector3(11, 1, 1), new THREE.Vector3(0, -1, 0));
  expect(ray.intersectObject(mesh)).toHaveLength(1);
  expect(mesh.geometry.getAttribute("position").getX(0)).toBe(10);
  expect((filtered.colliders![0] as THREE.Mesh).geometry.getAttribute("position").count).toBe(36);
  expect(filtered.colliders![0]!.userData.gtekiGateTriangles).toEqual([0,1]);
  expect(filtered.colliders![0]!.userData.gteki_source).toBe("fixture");
  expect(filtered.walls).toHaveLength(1);
  expect(filtered.root.children).toHaveLength(2);
  expect(geometry.getAttribute("position").count).toBe(6);
  filtered.dispose(); geometry.dispose(); wall.geometry.dispose();
});

it("public Shinjuku: no-flag input restricted to a planned group equals --floors input, edge for edge", async () => {
  const original = process.env.GTEKI_PRIVATE_DIR; delete process.env.GTEKI_PRIVATE_DIR;
  try {
    const full = await navmeshBundle("shinjuku");
    const groups = floorSplitPlan(full.bundle);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap(g => g.floors).sort()).toEqual(full.bundle.floors.map(f => f.id).sort());
    const group = groups.find(g => g.floors.includes("toei-nwd-m6"))!;
    const floorIds = new Set(group.floors);
    const nodeIds = new Set(full.bundle.nodes.filter(n => floorIds.has(n.floorId)).map(n => n.id));
    const expected = full.bundle.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some(e => ["stairs", "escalator", "elevator"].includes(e.mode))).toBe(true);
    const flagged = await navmeshBundle("shinjuku", group.floors);
    // Scene generation needs the complete authored graph: partial inputs rederive fare fences.
    expect(flagged.sceneBundle).toEqual(full.bundle);
    expect(flagged.bundle.edges).toEqual(expected);
    expect(flagged.bundle.nodes).toEqual(full.bundle.nodes.filter(n => nodeIds.has(n.id)));
    expect(flagged.outOfSplit).toEqual(full.bundle.edges.filter(e => nodeIds.has(e.from) !== nodeIds.has(e.to)).map(e => e.id));
    // No-flag bundle bytes are still those of the parsed public input.
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join("stations/shinjuku/gteki", file), "utf8"));
    const { parseStationFiles } = await import("@gteki/schema");
    const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
    if (!parsed.ok) throw new Error("public input invalid");
    expect(JSON.stringify(full.bundle)).toBe(JSON.stringify(parsed.bundle));
  } finally {
    if (original !== undefined) process.env.GTEKI_PRIVATE_DIR = original;
  }
});
