// CPU estimate for spec 13: catalog only, no wall occlusion. Accessor boxes give conservative spheres;
// followPose supplies the settled, unobstructed desktop camera (collision squeeze is not replayed here).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import { WALKER_BODY } from "@gteki/scene-api";
import { FOLLOW, FOV, followPose } from "../../../apps/web/src/explorer/followCamera.ts";
import { CAMERA_FAR_M } from "../../../apps/web/src/explorer/overviewFraming.ts";
import { CULL_M, NOSING_CLUSTERS, catalogVisibility, loadKitCatalog, loadNosingKit, type CatalogPlacement } from "./kit_catalog_loader.ts";
import placementsFile from "./kit_placements.json";
import graph from "../gteki/graph.json";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATION = path.resolve(HERE, "..");
const ROOT = path.resolve(STATION, "../..");
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

interface GlbJson {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min: [number, number, number]; max: [number, number, number] }[];
}

/** Just bounds and node transforms; no vertex decoding, textures, network or renderer. */
function boundsGlb(uri: string): GLTF {
  const bytes = fs.readFileSync(path.join(STATION, "gteki", uri));
  expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12))) as GlbJson;
  const material = new THREE.MeshStandardMaterial();
  const node = (index: number): THREE.Object3D => {
    const n = json.nodes[index]!;
    const obj = new THREE.Group();
    obj.name = n.name ?? "";
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(obj.position, obj.quaternion, obj.scale);
    else {
      if (n.translation) obj.position.fromArray(n.translation);
      if (n.rotation) obj.quaternion.fromArray(n.rotation);
      if (n.scale) obj.scale.fromArray(n.scale);
    }
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh]!.primitives) {
      const a = json.accessors[p.attributes.POSITION]!;
      expect(a.min).toHaveLength(3);
      expect(a.max).toHaveLength(3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([...a.min, ...a.max], 3));
      geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      obj.add(new THREE.Mesh(geometry, material));
    }
    for (const child of n.children ?? []) obj.add(node(child));
    return obj;
  };
  const scene = new THREE.Group();
  for (const index of json.scenes[json.scene ?? 0]!.nodes) scene.add(node(index));
  return { scene, scenes: [scene] } as unknown as GLTF;
}

const byId = new Map(graph.nodes.map((n) => [n.id, n]));
type Pt = { x: number; y: number };

/** Spec 13: first verified edge (else first edge), oriented from the node, first vertex >= 2 m away. */
function edgeBearing(id: string): number {
  const here = byId.get(id)!.position;
  const edges = graph.edges.filter((e) => e.from === id || e.to === id);
  const edge = edges.find((e) => e.verification === "verified") ?? edges[0];
  if (!edge) return 0;
  const other = byId.get(edge.from === id ? edge.to : edge.from)!.position;
  let points: Pt[] = edge.geometry && edge.geometry.length >= 2 ? edge.geometry : [here, other];
  const distance = (p: Pt) => Math.hypot(p.x - here.x, p.y - here.y);
  if (distance(points.at(-1)!) < distance(points[0]!)) points = [...points].reverse();
  const target = points.slice(1).find((p) => distance(p) >= 2) ?? points.at(-1)!;
  return Math.round(((Math.atan2(target.x - here.x, target.y - here.y) * 180) / Math.PI + 360) % 360);
}

it("estimates spec-13 catalog draws before/after distance culling at every default and spawn viewpoint", async () => {
  // Read the authoritative lists without importing Playwright or building the station scene.
  const spec = fs.readFileSync(path.join(ROOT, "tests/e2e/specs/13-ikebukuro-vantage-shots.spec.ts"), "utf8");
  const defaults = spec.match(/const DEFAULT_NODES = \[([\s\S]*?)\];/)![1]!;
  const spots = [...defaults.matchAll(/"(\w+):([^"]+)"/g)].map((m) => ({ group: m[1]!, id: m[2]! }));
  const scene = fs.readFileSync(path.join(HERE, "scene.ts"), "utf8");
  const spawns = scene.match(/const SPAWNS:[^=]+ = \[([\s\S]*?)\];/)![1]!;
  for (const m of spawns.matchAll(/nodeId: "([^"]+)"/g)) spots.push({ group: "spawn", id: m[1]! });
  expect(spots).toHaveLength(19); // 13 defaults (including control:x35), plus all 6 spawn nodes
  expect(spots.filter((s) => s.group === "spawn")).toHaveLength(6);
  const host = {
    assetUrl: (uri: string) => fs.existsSync(path.join(STATION, "gteki", uri)) ? uri : null,
    loadGlb: async (uri: string) => boundsGlb(uri),
    loadTexture: async () => new THREE.Texture(),
  };
  const kit = await loadKitCatalog(THREE, host, (placementsFile as unknown as { placements: CatalogPlacement[] }).placements, false);
  // Batch C (desktop tier; the phone copies are the stacked follow-up): 69 strips merged into a few meshes.
  const nosing = await loadNosingKit(THREE, host, (placementsFile as unknown as { placements: CatalogPlacement[] }).placements, false);
  const env = new THREE.Texture();
  try {
    const { group, stats } = kit.build(THREE, env, toRenderer);
    expect(stats.parts).toBe(26);
    expect(group.children.length).toBeGreaterThan(0);
    const nosingBuilt = nosing.build(THREE, env, toRenderer);
    expect(nosingBuilt.stats.parts).toBe(69);
    expect(nosingBuilt.stats.clusters).toBe(nosingBuilt.group.children.length);
    expect(nosingBuilt.group.children.length).toBeLessThanOrEqual(NOSING_CLUSTERS); // against 61 one-per-id draws
    const visibility = catalogVisibility(THREE);
    visibility.add(group);
    const nosingVisibility = catalogVisibility(THREE);
    nosingVisibility.add(nosingBuilt.group);
    group.updateMatrixWorld(true);
    nosingBuilt.group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(FOV.follow, 1440 / 900, 0.05, CAMERA_FAR_M);
    const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
    const rows: { group: string; node: string; heading: number; before: number; after: number; nosingBefore: number; nosingAfter: number }[] = [];
    for (const spot of spots) for (const offset of [0, 90, 180, 270]) {
      const p = byId.get(spot.id)!.position;
      expect(p.z).not.toBeNull();
      const heading = (edgeBearing(spot.id) + offset) % 360;
      // Explorer walkFromNode + settled placeCamera: eye 1.62 m, pitch -0.12, shoulder/boom/aim from FOLLOW.
      const pose = followPose(toRenderer(p.x, p.y, p.z! + WALKER_BODY.eyeM), -heading * Math.PI / 180, -0.12);
      camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld(true);
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const before = group.children.filter((m) => frustum.intersectsObject(m)).length;
      const nosingBefore = nosingBuilt.group.children.filter((m) => frustum.intersectsObject(m)).length;
      visibility.update(camera);
      nosingVisibility.update(camera);
      const after = group.children.filter((m) => m.visible && frustum.intersectsObject(m)).length;
      const nosingAfter = nosingBuilt.group.children.filter((m) => m.visible && frustum.intersectsObject(m)).length;
      expect(after).toBeLessThanOrEqual(before);
      expect(nosingAfter).toBeLessThanOrEqual(nosingBefore);
      rows.push({ group: spot.group, node: spot.id, heading, before: before * 2, after: after * 2, nosingBefore: nosingBefore * 2, nosingAfter: nosingAfter * 2 });
    }
    expect(rows).toHaveLength(76);
    const report = `CPU catalog draw estimate: ${group.children.length} meshes, CULL_M=${CULL_M}; x2 = colour + GTAO depth/normal.\n` +
      `Nosing (batch C, high tier): 69 strips in ${nosingBuilt.group.children.length} merged cluster meshes (61 draws if instanced), same CULL_M; x2.\n` +
      "Accessor-box spheres; 1440x900, FOV 50, settled unobstructed follow pose; no ground snap, camera collision or wall occlusion. GPU totals need spec 13.\n" +
      "group | views | before p50 | before max | after p50 | after max | nosing before p50 | nosing after p50\n" +
      ["gate", "rail", "exit", "spawn", "control"].map((name) => {
        const mine = rows.filter((r) => r.group === name);
        const summary = (key: "before" | "after" | "nosingBefore" | "nosingAfter") => {
          const draws = mine.map((r) => r[key]).sort((a, b) => a - b);
          return `${draws[Math.floor(draws.length * 0.5)]} | ${draws.at(-1)}`; // spec 13's p50 convention
        };
        return `${name} | ${mine.length} | ${summary("before")} | ${summary("after")} | ${summary("nosingBefore")} | ${summary("nosingAfter")}`;
      }).join("\n");
    console.info(report);
    // Keep the numbers available even when the test runner suppresses stdout from passing tests.
    const out = path.join(ROOT, ".qa", "ikebukuro-catalog-budget.txt");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report + "\n\nCatalog draws x2 by viewpoint:\nnode | group | heading | before | after | nosing before | nosing after\n" +
      rows.map((r) => `${r.node} | ${r.group} | ${r.heading} | ${r.before} | ${r.after} | ${r.nosingBefore} | ${r.nosingAfter}`).join("\n") + "\n");
    for (const name of ["rail", "spawn"]) {
      const mine = rows.filter((r) => r.group === name);
      expect(mine.some((r) => r.after < r.before), `${name}: a distant frustum candidate is removed`).toBe(true);
    }
  } finally {
    kit.dispose();
    nosing.dispose();
    env.dispose();
  }
});
