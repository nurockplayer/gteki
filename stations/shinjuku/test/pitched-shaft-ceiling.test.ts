import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { assembleScene, planBundle } from "../gteki/scene.ts";
import { prepareLayout } from "../scene/build-cache.ts";
import { pointInRings, soffitHeight, type Layout, type Plan, type Soffit } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };
import { exactHash, withCanvasStub } from "./helpers/scene-digest.ts";
import { digestSceneLists } from "./helpers/station-digest.ts";
import { castCamera } from "../../../apps/web/src/explorer/raycast.ts";
import { prepareRayTrees, raycastObject } from "../../../apps/web/src/explorer/meshBvh.ts";

const { bundle } = loadShinjukuBundle();
const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.z, -p.y);
const round = (v: number) => Math.round(v * 10000) / 10000;
const rideIds = ["e:e1fa653048b94a5695777d1063b34417", "e:ac906cd95e89401b9b11858e02f20895"];

// Flatten nearby visible instances without renderer/frustum culling; retain native material winding.
function targets(scene: StationScene, box: THREE.Box3) {
  const meshes: THREE.Mesh[] = [];
  scene.root.updateMatrixWorld(true);
  scene.root.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.every((m) => !m.visible || m.opacity === 0)) return;
    o.geometry.computeBoundingBox();
    const add = (matrix: THREE.Matrix4) => {
      if (!o.geometry.boundingBox!.clone().applyMatrix4(matrix).intersectsBox(box)) return;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.matrixAutoUpdate = false; m.matrixWorld.copy(matrix); m.name = o.name;
      meshes.push(m);
    };
    if (o instanceof THREE.InstancedMesh) {
      for (let i = 0; i < o.count; i++) { const m = new THREE.Matrix4(); o.getMatrixAt(i, m); add(m.premultiply(o.matrixWorld)); }
    } else add(o.matrixWorld);
  });
  prepareRayTrees(meshes);
  return meshes;
}

function first(ray: THREE.Raycaster, meshes: THREE.Mesh[]) {
  const hits: THREE.Intersection[] = [];
  for (const mesh of meshes) raycastObject(mesh, ray, hits);
  return hits.sort((a, b) => a.distance - b.distance)[0];
}
function producer(hit: THREE.Intersection | undefined, layout: Layout) {
  if (!hit) return "void";
  const mesh = hit.object as THREE.Mesh;
  if (mesh.name === "linear-light:underground") return "light";
  if (mesh.name.startsWith("pitched-shaft:")) return "pitched plane";
  if (mesh.name.startsWith("escalator-shell")) return "shell";
  const normal = hit.face!.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld));
  const p = { x: hit.point.x, y: -hit.point.z };
  if (Math.abs(normal.y) < 1e-5) return "fascia/wall";
  for (const s of layout.shaftFinishes) if (Math.abs(soffitHeight(s, p) - hit.point.y) < 0.002 && pointInRings(p, s.rings)) return s.slope ? "flight roof/invert" : "flat shoulder";
  return "level/other";
}

describe("J7 pitched shaft ceilings (2026-11-12 JST)", () => {
  let off: StationScene, on: StationScene, layout: Layout, oldLayout: Layout;
  beforeAll(() => {
    const ctx = { THREE, bundle, quality: "low" as const };
    off = withCanvasStub(() => assembleScene(ctx as never, undefined, undefined, { pitchedCeilings: false }));
    oldLayout = prepareLayout(planBundle(bundle), plan as unknown as Plan, { reuse: true, pitchedCeilings: false }).layout;
    on = withCanvasStub(() => assembleScene(ctx as never));
    layout = prepareLayout(planBundle(bundle), plan as unknown as Plan, { reuse: true }).layout;
  }, 120_000);
  afterAll(() => { off?.dispose(); on?.dispose(); });

  it("does not overlap underground linear lights at similar heights", () => {
    const mesh = on.root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
    expect(mesh).toBeDefined();
    const fixtures = Array.from({ length: mesh.count }, (_, i) => {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      const a = new THREE.Vector3(0, 0, -0.5).applyMatrix4(matrix);
      const b = new THREE.Vector3(0, 0, 0.5).applyMatrix4(matrix);
      const dx = b.x - a.x, dy = b.z - a.z, len = Math.hypot(dx, dy);
      const center = a.clone().add(b).multiplyScalar(0.5);
      return { center, dx, dy, corners: [-1, 1].flatMap((u) => [-1, 1].map((v) => ({
        x: center.x + u * dx * 0.52 - v * dy / len * 0.15,
        y: center.z + u * dy * 0.52 + v * dx / len * 0.15,
      }))) };
    });
    for (let i = 0; i < fixtures.length; i++) for (let j = 0; j < i; j++) {
      const a = fixtures[i]!, b = fixtures[j]!;
      if (Math.abs(a.center.y - b.center.y) >= 0.5) continue;
      const overlap = [a, b].every(({ dx, dy }) => [[dx, dy], [-dy, dx]].every(([x, y]) => {
        const pa = a.corners.map((p) => p.x * x! + p.y * y!), pb = b.corners.map((p) => p.x * x! + p.y * y!);
        return Math.max(...pa) > Math.min(...pb) + 1e-5 && Math.max(...pb) > Math.min(...pa) + 1e-5;
      }));
      expect(overlap, `fixtures ${i} and ${j}`).toBe(false);
    }
  });

  it("keeps physical layout and explorer lists identical and caps steep queries at drawn roofs", () => {
    const { shaftCeilingPreview: _render, ...physical } = layout;
    expect(exactHash(physical)).toBe(exactHash(oldLayout));
    expect(digestSceneLists(on)).toEqual(digestSceneLists(off));
    const ray = new THREE.Raycaster(); ray.far = 15;
    for (const id of rideIds) {
      const r = layout.runs.find((r) => r.edgeId === id)!;
      for (const t of [0.1, 0.5, 0.9]) {
        ray.set(v3({ x: r.a.x + (r.b.x - r.a.x) * t, y: r.a.y + (r.b.y - r.a.y) * t, z: r.a.z + (r.b.z - r.a.z) * t + 1.6 }), new THREE.Vector3(0, 1, 0));
        const p = { x: ray.ray.origin.x, y: -ray.ray.origin.z };
        const roof = layout.shaftCeilingPreview!.roofs.find((s) => pointInRings(p, s.rings))!;
        expect(roof).toBeDefined();
        const hit = castCamera(ray, on.cameraBlockers!, new Set(on.cameraBlockers!))[0];
        expect(hit).toBeDefined();
        expect(hit!.point.y).toBeLessThanOrEqual(soffitHeight(roof, p) + 0.002);
      }
    }
  });

  it("covers the hull at five offsets, follows its pitch, closes mouths and never lowers a flight roof", () => {
    const roofs = layout.shaftCeilingPreview!.roofs;
    console.log("2026-11-12 JST qualifying groups", roofs.length, roofs.map((r) => r.spaceId).join(","));
    const rows: unknown[] = [], failures: string[] = [];
    let offFailures = 0;
    for (const id of rideIds) {
      const r = layout.runs.find((r) => r.edgeId === id)!;
      const roof = roofs.find((s) => pointInRings({ x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 }, s.rings))!;
      expect(roof).toBeDefined();
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, length = Math.hypot(dx, dy), u = { x: dx / length, y: dy / length }, n = { x: -u.y, y: u.x };
      const across = (p: { x: number; y: number }) => (p.x - r.a.x) * n.x + (p.y - r.a.y) * n.y;
      const ns = roof.rings[0]!.map(across), lo = Math.min(...ns), hi = Math.max(...ns);
      const box = new THREE.Box3().setFromPoints(roof.rings[0]!.map((p) => v3({ ...p, z: soffitHeight(roof, p) }))).expandByScalar(17);
      const before = targets(off, box), after = targets(on, box), ray = new THREE.Raycaster(); ray.far = 15; ray.near = 0.001;
      const counts: Record<string, Record<string, number>> = { before: {}, after: {} };
      let checked = 0, mouths = 0, maxError = 0, minClearance = Infinity;
      const stations = [-2, -1, ...Array.from({ length: Math.floor(length) + 1 }, (_, i) => i), length, length + 1, length + 2];
      for (const s of stations) for (const fraction of [0, 0.25, 0.5, 0.75, 1]) for (const angle of [-30, 0, 30]) {
        const lateral = lo + 0.05 + fraction * (hi - lo - 0.1);
        const p = { x: r.a.x + u.x * s + n.x * lateral, y: r.a.y + u.y * s + n.y * lateral, z: r.a.z + (r.b.z - r.a.z) * s / length + 1.6 };
        const dir = new THREE.Vector3(u.x * Math.sin(angle * Math.PI / 180), Math.cos(angle * Math.PI / 180), -u.y * Math.sin(angle * Math.PI / 180));
        ray.set(v3(p), dir);
        const visible = first(ray, after), old = first(ray, before);
        // Retained enclosure sides may occlude the roof at the edge of a shaft.
        const h = visible?.object.name === "escalator-shell-sides"
          ? first(ray, after.filter((mesh) => mesh.name !== "escalator-shell-sides")) : visible;
        const roofDistance = (soffitHeight(roof, p) - p.z) / (dir.y - (roof.slope!.x * dir.x - roof.slope!.y * dir.z));
        const intersection = v3(p).addScaledVector(dir, roofDistance);
        // A ray leaving the flight span is a mouth/hall query, not an interior ceiling query.
        const interior = s >= 0 && s <= length && pointInRings({ x: intersection.x, y: -intersection.z }, roof.rings);
        if (!h) failures.push(`${id}@${round(s)}/${fraction}/${angle}:void`);
        if (!interior) { mouths++; continue; }
        checked++;
        for (const [which, hit, l] of [["before", old, oldLayout], ["after", h, layout]] as const) { const label = producer(hit, l); counts[which]![label] = (counts[which]![label] ?? 0) + 1; }
        if (!old || producer(old, oldLayout) !== "light" && Math.abs(old.point.y - soffitHeight(roof, { x: old.point.x, y: -old.point.z })) > 0.05) offFailures++;
        if (!h || producer(h, layout) === "light") continue;
        const error = Math.abs(h.point.y - soffitHeight(roof, { x: h.point.x, y: -h.point.z }));
        maxError = Math.max(maxError, error);
        if (producer(h, layout) !== "pitched plane" || error > 0.05) failures.push(`${id}@${round(s)}/${fraction}/${angle}:${producer(h, layout)} error=${round(error)}`);
        minClearance = Math.min(minClearance, soffitHeight(roof, p) - (p.z - 1.6));
      }
      const prefix = roof.spaceId.replace("pitched-shaft", "shaft-roof") + ":flight:";
      for (const flight of oldLayout.shaftFinishes.filter((s) => s.spaceId.startsWith(prefix))) for (const p of flight.rings.flat()) expect(soffitHeight(roof, p) + 1e-6).toBeGreaterThanOrEqual(soffitHeight(flight, p));
      rows.push({ edge: id, checked, mouths, maxError: round(maxError), minClearance: round(minClearance), ...counts });
    }
    console.log("2026-11-12 JST J7 before/after", JSON.stringify(rows));
    expect(offFailures, "forcing the flag off must falsify the plane oracle").toBeGreaterThan(0);
    expect(failures.slice(0, 20), `${failures.length} failed rays`).toEqual([]);
  }, 120_000);
});
