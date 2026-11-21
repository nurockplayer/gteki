import fs from "node:fs";
import { expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { glbPrimitivePlugin } from "@gteki/scene-api";
import type { StationBundle } from "@gteki/schema";
import { stairwellWells } from "../../../apps/web/src/explorer/stairwellCut.ts";
import { CONTEXT_GLB, cutContextStairOpenings } from "../scene/context.ts";

type StairwellRect = ReturnType<typeof stairwellWells>[number]["rects"][number];

function readBundle(): StationBundle {
  const base = new URL("../gteki/", import.meta.url);
  const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, base), "utf8"));
  return { ...read("station.json"), ...read("graph.json") } as StationBundle;
}

function areaInsideBox(triangle: THREE.Triangle, rect: StairwellRect, lowerY: number, upperY: number): number {
  let polygon = [triangle.a.clone(), triangle.b.clone(), triangle.c.clone()];
  const planes = [
    (p: THREE.Vector3) => p.x + rect.halfLength,
    (p: THREE.Vector3) => rect.halfLength - p.x,
    (p: THREE.Vector3) => p.y - lowerY,
    (p: THREE.Vector3) => upperY - p.y,
    (p: THREE.Vector3) => p.z + rect.halfWidth,
    (p: THREE.Vector3) => rect.halfWidth - p.z,
  ];
  for (const signed of planes) {
    const clipped: THREE.Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length]!, b = polygon[i]!;
      const da = signed(a), db = signed(b), aInside = da >= -1e-8, bInside = db >= -1e-8;
      if (aInside !== bInside) clipped.push(a.clone().lerp(b, da / (da - db)));
      if (bInside) clipped.push(b);
    }
    polygon = clipped;
    if (polygon.length < 3) return 0;
  }
  let area = 0;
  for (let i = 1; i + 1 < polygon.length; i++) area += polygon[i]!.clone().sub(polygon[0]!).cross(polygon[i + 1]!.clone().sub(polygon[0]!)).length() / 2;
  return area;
}

it("clips only opening portions of crossing context triangles and preserves outside geometry", () => {
  const bundle = readBundle();
  const streetFloors = new Set(bundle.floors.filter(f => f.ordinal === 0 && !f.intermediate).map(f => f.id));
  const exits = new Set(bundle.nodes.filter(n => n.kind === "exit" && streetFloors.has(n.floorId)).map(n => n.id));
  const edge = bundle.edges.find(e => (e.mode === "stairs" || e.mode === "escalator") && (exits.has(e.from) || exits.has(e.to)))!;
  const endpoints = new Set([edge.from, edge.to]);
  const nodes = bundle.nodes.filter(n => endpoints.has(n.id));
  const floorIds = new Set(nodes.map(n => n.floorId));
  const singleEdgeBundle = { ...bundle, edges: [edge], nodes, floors: bundle.floors.filter(f => floorIds.has(f.id)) } as StationBundle;
  const well = stairwellWells(singleEdgeBundle, e => !e.closed)[0]!;
  const rect = well.rects[0]!;
  const y = (well.lowerY + well.upperY) / 2;
  const point = (along: number, across: number) => new THREE.Vector3(
    rect.center.x + rect.along.x * along + rect.across.x * across,
    y,
    rect.center.z + rect.along.z * along + rect.across.z * across,
  );
  const geometry = new THREE.BufferGeometry();
  const points = [point(-rect.halfLength - 2, -rect.halfWidth - 2), point(0, 0), point(rect.halfLength + 2, -rect.halfWidth - 2)];
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(points.flatMap((p, i) => [...p.toArray(), i / 3, 1 - i / 3])), 5);
  geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute("uv", new THREE.InterleavedBufferAttribute(interleaved, 2, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Int16Array([8192, 16384, -24576, 8192, 16384, -24576, 8192, 16384, -24576]), 3, true));
  geometry.getAttribute("normal").name = "quantized-normal";
  geometry.addGroup(0, 3, 1);
  const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
  root.add(mesh);
  expect(cutContextStairOpenings(THREE, root, singleEdgeBundle)).toBe(1);
  expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(3);
  expect(mesh.geometry.groups).toEqual([{ start: 0, count: mesh.geometry.getAttribute("position").count, materialIndex: 1 }]);
  const clippedPositions = mesh.geometry.getAttribute("position");
  for (const [name, source] of Object.entries(geometry.attributes)) {
    const clipped = mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
    expect(clipped).toBeInstanceOf(THREE.BufferAttribute);
    expect(clipped.array).toBeInstanceOf(Float32Array);
    expect(clipped.normalized).toBe(false);
    expect(clipped.usage).toBe(THREE.StaticDrawUsage);
    expect(clipped.count).toBe(clippedPositions.count);
    expect(clipped.name).toBe(source.name);
    // The two outside vertices must retain their decoded source values.
    for (const sourceIndex of [0, 2]) {
      const sourcePosition = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("position"), sourceIndex);
      const clippedIndex = Array.from({ length: clippedPositions.count }, (_, i) => i)
        .find(i => new THREE.Vector3().fromBufferAttribute(clippedPositions, i).equals(sourcePosition));
      expect(clippedIndex).toBeDefined();
      for (let component = 0; component < source.itemSize; component++) {
        expect(clipped.getComponent(clippedIndex!, component)).toBeCloseTo(source.getComponent(sourceIndex, component), 6);
      }
    }
  }
  let retainedArea = 0, openingArea = 0;
  const positions = mesh.geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i += 3) {
    const triangle = new THREE.Triangle().setFromAttributeAndIndices(positions, i, i + 1, i + 2);
    retainedArea += triangle.getArea();
    const local = triangle.clone();
    for (const v of [local.a, local.b, local.c]) {
      const delta = v.clone().sub(rect.center);
      v.set(delta.dot(rect.along), v.y, delta.dot(rect.across));
    }
    openingArea += areaInsideBox(local, rect, well.lowerY, well.upperY);
  }
  expect(retainedArea).toBeGreaterThan(0);
  expect(openingArea).toBeLessThan(1e-8);
});

it("leaves zero context surface area in every street-exit stair opening in both shipped tiers", async () => {
  const bundle = readBundle();
  const base = new URL("../gteki/", import.meta.url);
  const streets = new Set(bundle.floors.filter(f => f.ordinal === 0 && !f.intermediate).map(f => f.id));
  const exits = bundle.nodes.filter(n => n.kind === "exit" && streets.has(n.floorId));
  const ids = new Set(exits.map(n => n.id));
  const wells = stairwellWells(bundle, e => !e.closed && (ids.has(e.from) || ids.has(e.to)));
  expect(exits).toHaveLength(20);
  expect(wells).toHaveLength(20);
  for (const uri of Object.values(CONTEXT_GLB)) {
    const bytes = fs.readFileSync(new URL(uri, base));
    const gltf = await new GLTFLoader().register(glbPrimitivePlugin).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    const originals = new Map<THREE.Mesh, THREE.BufferGeometry>();
    gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) originals.set(o as THREE.Mesh, (o as THREE.Mesh).geometry); });
    expect(cutContextStairOpenings(THREE, gltf.scene, bundle)).toBeGreaterThan(0);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const probes = [[170, 180], [170.7, 179], [169, 179.1], [170.5, 181.1]];
    for (const id of ["e_low__x35", "se_j__x42", "se_j__x43"]) {
      const exit = bundle.nodes.find(node => node.id === bundle.edges.find(edge => edge.id === id)!.to)!;
      probes.push([exit.position.x, -exit.position.y]);
      const rect = wells.find(well => well.edgeId === id)!.rects.at(-1)!;
      for (const fraction of [-0.8, 0, 0.8]) probes.push([
        rect.center.x + rect.along.x * rect.halfLength * fraction,
        rect.center.z + rect.along.z * rect.halfLength * fraction,
      ]);
    }
    for (const [x, z] of probes) {
      ray.set(new THREE.Vector3(x, 33, z), new THREE.Vector3(0, -1, 0));
      ray.far = 7;
      expect(ray.intersectObjects([...originals.keys()], false), `${uri}: context lid at ${x}, ${z}`).toHaveLength(0);
    }
    const triangle = new THREE.Triangle(), local = new THREE.Triangle();
    for (const well of wells) {
      let intrusions = 0, maxArea = 0;
      for (const [mesh, original] of originals) {
        const positions = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
        for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
          [triangle.a, triangle.b, triangle.c].forEach((v, k) => v.fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld));
          const overlap = well.rects.reduce((max, rect) => {
            [local.a, local.b, local.c].forEach((v, k) => {
              const point = [triangle.a, triangle.b, triangle.c][k]!, delta = point.clone().sub(rect.center);
              v.set(delta.dot(rect.along), point.y, delta.dot(rect.across));
            });
            return Math.max(max, areaInsideBox(local, rect, well.lowerY, well.upperY));
          }, 0);
          maxArea = Math.max(maxArea, overlap);
          if (overlap > 1e-4) intrusions++;
        }
        if (mesh.geometry !== original) {
          for (const [name, attribute] of Object.entries(original.attributes)) {
            const clipped = mesh.geometry.getAttribute(name);
            expect(clipped.itemSize, `${uri}: ${name} item size`).toBe(attribute.itemSize);
            expect(Array.from(clipped.array as ArrayLike<number>).every(Number.isFinite), `${uri}: ${name} finite values`).toBe(true);
          }
        }
      }
      expect(intrusions, `${uri}: ${well.edgeId}, max overlap area ${maxArea} m²`).toBe(0);
      console.log(`${uri}: ${well.edgeId}: no measurable context area inside opening (<1e-4 m²)`);
    }
    for (const [mesh, original] of originals) {
      if (mesh.geometry === original) continue;
      mesh.geometry.dispose();
    }
    for (const geometry of originals.values()) geometry.dispose();
  }
}, 60_000);
