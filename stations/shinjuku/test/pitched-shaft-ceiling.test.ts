import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { assembleScene, planBundle } from "../gteki/scene.ts";
import { prepareLayout } from "../scene/build-cache.ts";
import { cladWallGeometry, escalatorShellGeometry } from "../scene/build.ts";
import { pointInRings, soffitHeight, stairShaftGroups, type Layout, type Plan, type Soffit, type XYZ } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };
import { exactHash, plainHash, withCanvasStub } from "./helpers/scene-digest.ts";
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
  let off: StationScene, on: StationScene, layout: Layout, oldLayout: Layout, regularRoofs: Omit<Soffit, "kind">[];
  beforeAll(() => {
    const ctx = { THREE, bundle, quality: "low" as const };
    off = withCanvasStub(() => assembleScene(ctx as never, undefined, undefined, { pitchedCeilings: false }));
    oldLayout = prepareLayout(planBundle(bundle), plan as unknown as Plan, { reuse: true, pitchedCeilings: false }).layout;
    on = withCanvasStub(() => assembleScene(ctx as never));
    layout = prepareLayout(planBundle(bundle), plan as unknown as Plan, { reuse: true }).layout;
    regularRoofs = [...layout.levels.flatMap((lv) => lv.ceilings.map((s) => ({ ...s, floorId: lv.floorId }))),
      ...layout.soffits.filter((s) => !/^shaft-(roof|invert|collar):/.test(s.spaceId)),
      ...layout.shaftFinishes, ...escalatorShellGeometry(layout, planBundle(bundle)).finishes];
  }, 600_000);
  afterAll(() => { off?.dispose(); on?.dispose(); });

  it("culls unrelated-floor preview roofs and retains overhead roofs from both ride ends (#1238.3)", () => {
    on.root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
    const visibleAt = (p: XYZ) => {
      camera.position.copy(v3({ ...p, z: p.z + 1.65 })); camera.updateMatrixWorld(true);
      on.beforeRender!(null, camera);
      const visible = new Set<THREE.Object3D>();
      on.root.traverseVisible((o) => visible.add(o));
      return visible;
    };
    const roofs = layout.shaftCeilingPreview!.roofs;
    const bottom = layout.levels.reduce((a, b) => a.z < b.z ? a : b);
    // A real floor node away from any run keeps this camera off a ride.
    const node = bundle.nodes.find((n) => Math.abs((layout.nodeZ.get(n.id) ?? Infinity) - bottom.z) < 0.01 &&
      layout.runs.every((r) => {
        const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y;
        const t = Math.max(0, Math.min(1, ((n.position.x - r.a.x) * dx + (n.position.y - r.a.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(n.position.x - r.a.x - dx * t, n.position.y - r.a.y - dy * t) > r.width;
      }))!;
    expect(node).toBeDefined();
    const unrelated = roofs.filter((r) => layout.levels.find((l) => l.floorId === r.floorId)!.label === "B1");
    expect(unrelated.length).toBeGreaterThan(0);
    try {
      const visible = visibleAt({ ...node.position, z: bottom.z });
      for (const roof of unrelated) expect(visible.has(on.root.getObjectByName(roof.spaceId)!)).toBe(false);
      let checked = 0;
      for (const run of layout.runs) {
        const at = (t: number): XYZ => ({ x: run.a.x + (run.b.x - run.a.x) * t,
          y: run.a.y + (run.b.y - run.a.y) * t, z: run.a.z + (run.b.z - run.a.z) * t });
        const overhead = roofs.filter((roof) => [0.1, 0.5, 0.9].some((t) => {
          const p = at(t), gap = soffitHeight(roof, p) - p.z;
          return pointInRings(p, roof.rings) && gap >= 2.5 && gap <= 5.2;
        }));
        if (!overhead.length) continue;
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const visible = visibleAt(at(t));
          for (const roof of overhead) {
            expect(visible.has(on.root.getObjectByName(roof.spaceId)!), `${roof.spaceId} above ${run.edgeId}@${t}`).toBe(true);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    } finally { on.afterRender!(); }
  });

  const sourceNodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const sourceEdges = new Map(bundle.edges.map((e) => [e.id, e]));
  const fixture = (mesh: THREE.InstancedMesh, i: number) => {
    const mount = mesh.userData.mounts[i] as { edgeId: string; sample: number; roof: Omit<Soffit, "kind">; section: number };
    const edge = sourceEdges.get(mount.edgeId)!;
    const a = sourceNodes.get(edge.from)!, b = sourceNodes.get(edge.to)!;
    const za = layout.nodeZ.get(a.id)!, zb = layout.nodeZ.get(b.id)!;
    const surfaceZ = (p: { x: number; y: number }) => {
      const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
      const t = ((p.x - a.position.x) * dx + (p.y - a.position.y) * dy) / (dx * dx + dy * dy);
      return za + (zb - za) * t;
    };
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
    const at = (x: number, y: number, z: number): XYZ => {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
      return { x: p.x, y: -p.z, z: p.y };
    };
    return { ...mount, edge, surfaceZ, at };
  };

  it("counts only fixtures mounted to their chosen roof section above their own surface (#1391)", () => {
    const mesh = on.root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
    // Corrected own-roof minima, not XY overlap counts (2026-11-17 JST).
    const minima = [4, 2, 0, 0, 0, 3, 27, 27, 4, 33, 33, 14];
    const roofs = layout.shaftCeilingPreview!.roofs;
    const shafts = stairShaftGroups(layout.runs);
    const counts = roofs.map(() => 0);
    const clearances: number[] = [], heights: number[] = [];
    for (let i = 0; i < mesh.count; i++) {
      const f = fixture(mesh, i), tag = `${f.edgeId}@${f.sample} fixture ${i}`;
      const samples = [-0.5, 0, 0.5].map((z) => f.at(0, 0, z));
      heights.push(samples[1]!.z);
      for (const [index, p] of samples.entries()) {
        // A regular strip may cross flight/landing sections; do not extend its centre plane.
        const roof = index === 1 || f.section >= 0 ? f.roof : regularRoofs.filter((r) => {
          const clearance = soffitHeight(r, p) - f.surfaceZ(p);
          return pointInRings(p, r.rings) && clearance >= 2.5 - 0.00002 && clearance <= 5.2 + 0.00002;
        }).sort((a, b) => soffitHeight(a, p) - soffitHeight(b, p))[0]!;
        expect(roof, tag).toBeDefined();
        expect(pointInRings(p, roof.rings), tag).toBe(true);
        // Regular strips retain the existing 0.15 m centre fit across flight/landing seams.
        const mountingTolerance = index === 1 && f.section < 0 ? 0.15002 : 0.00002;
        expect(Math.abs(soffitHeight(roof, p) - p.z - 0.065), tag).toBeLessThan(mountingTolerance);
        const clearance = soffitHeight(roof, p) - f.surfaceZ(p);
        clearances.push(clearance);
        expect(clearance, tag).toBeGreaterThanOrEqual(2.5 - 0.00002);
        expect(clearance, tag).toBeLessThanOrEqual(5.2 + 0.00002);
      }
      if (f.section < 0) continue;
      const roof = roofs[f.section]!;
      expect(plainHash(f.roof), tag).toBe(plainHash(roof));
      const ownShaft = shafts[Number(roof.spaceId.split(":")[1])]!.some((r) => r.edgeId === f.edgeId);
      const ownFlat = !layout.runs.some((r) => r.edgeId === f.edgeId) && sourceNodes.get(f.edge.from)!.floorId === roof.floorId;
      expect(ownShaft || ownFlat, tag).toBe(true);
      for (const p of samples) {
        expect(pointInRings(p, roof.rings), tag).toBe(true);
        expect(Math.abs(soffitHeight(roof, p) - p.z - 0.065), tag).toBeLessThan(0.00002);
      }
      counts[f.section] = counts[f.section]! + 1;
    }
    const totals = [mesh.count, heights.filter((z) => z > -19 && z < -5).length,
      heights.filter((z) => z > -39 && z < -21).length];
    console.log("2026-11-17 JST own-roof counts", JSON.stringify(counts), "totals", totals,
      "out-of-band", clearances.filter((z) => z < 2.5 || z > 5.2).length);
    expect(totals).toEqual([490, 105, 82]);
    expect(counts).toHaveLength(minima.length);
    for (const [section, minimum] of minima.entries()) expect(counts[section], `${roofs[section]!.spaceId} section ${section}`).toBeGreaterThanOrEqual(minimum);
  });

  it("keeps flag-off strip count and rounded matrices identical to main", () => {
    const mesh = off.root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
    // Captured once in a scratch checkout of origin/main 4724fc44 (2026-11-14 JST).
    expect({ count: mesh.count, matrixHash: plainHash(mesh.instanceMatrix.array) }).toEqual({
      count: 452, matrixHash: "c3d88625830bebe18cecb71715a638b4f9f82fe49fbc9533132db60cd53462da",
    });
  });

  it("keeps re-oriented shared-roof casings above their diffusers", () => {
    on.root.updateMatrixWorld(true);
    const mesh = on.root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
    let checked = 0;
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
      const { section } = fixture(mesh, i);
      const roof = layout.shaftCeilingPreview!.roofs[section];
      if (!roof || !(roof.slope?.x || roof.slope?.y)) continue;
      matrix.premultiply(mesh.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
      const d = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      expect(up.y, `fixture ${i}, ${roof.spaceId}`).toBeGreaterThanOrEqual(Math.sqrt(1 - d.y ** 2) - 0.01);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("covers all 147 preview-roof casings at endpoints and corners in the actual section (#1391)", () => {
    const mesh = on.root.getObjectByName("linear-light:underground") as THREE.InstancedMesh;
    const failures: string[] = [];
    let checked = 0;
    for (let i = 0; i < mesh.count; i++) {
      const f = fixture(mesh, i);
      if (f.section < 0) continue;
      checked++;
      // BoxGeometry casing: 0.25 wide, 0.045 high, 1.04 long, translated +0.035 Y.
      const samples = [-0.5, 0.5].map((z) => f.at(0, 0, z));
      samples.push(...[-0.125, 0.125].flatMap((x) => [-0.52, 0.52].map((z) => f.at(x, 0.0575, z))));
      for (const [sample, p] of samples.entries()) {
        // Street-mouth sections share an ID. At a seam use the section covering this XY.
        const sections = layout.shaftCeilingPreview!.roofs.filter((r) => r.spaceId === f.roof.spaceId);
        const roofs = sections.filter((r) => pointInRings(p, r.rings)).filter((r) => {
          const clearance = soffitHeight(r, p) - f.surfaceZ(p);
          return clearance >= 2.5 - 0.00002 && clearance <= 5.2 + 0.00002;
        }).sort((a, b) => soffitHeight(a, p) - soffitHeight(b, p));
        const valid = roofs.slice(0, 1).some((roof) => {
          const underside = soffitHeight(roof, p), gap = underside - p.z;
          const clearance = underside - f.surfaceZ(p);
          return gap >= -0.01 && gap <= 0.065 + 0.01 && clearance >= 2.5 - 0.00002 && clearance <= 5.2 + 0.00002;
        });
        if (!valid) failures.push(`${i} ${f.edgeId}@${f.sample} ${f.roof.spaceId} section ${f.section} sample ${sample}: ` +
          (roofs[0] ? `${roofs[0].spaceId} gap ${(soffitHeight(roofs[0], p) - p.z).toFixed(4)}` : "no covering own-surface roof"));
      }
    }
    expect(checked).toBe(147);
    expect(failures).toEqual([]);
  });

  it("keeps the flight stripe continuous with the B3 landing sleeve", () => {
    const corner = { x: -47.88399540831238, y: 166.38398726353313 };
    const walls = [...layout.levels.find((lv) => lv.label === "B3")!.walls,
      ...layout.cornerFills.filter((w) => w.level === "B3")];
    const touches = (p: { x: number; y: number }) => Math.hypot(p.x - corner.x, p.y - corner.y) < 0.0001;
    const pitched = walls.find((w) => w.finish === "shaft" && touches(w.b) && w.surfaceBase &&
      Math.abs(w.surfaceBase.a - w.surfaceBase.b) > 0.01 && w.surfaceBase.b < -23)!;
    const flat = walls.find((w) => w.finish === "shaft" && touches(w.a) && w.surfaceBase &&
      Math.abs(w.surfaceBase.a + 23.92) < 0.001 && Math.abs(w.surfaceBase.b + 23.92) < 0.001 &&
      Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 1)!;
    expect(pitched).toBeDefined();
    expect(flat).toBeDefined();
    const datum = (wall: typeof pitched) => {
      const geometry = cladWallGeometry([wall])!;
      const p = geometry.attributes.position!, uv = geometry.attributes.uv!;
      let nearest = 0;
      for (let i = 1; i < p.count; i++) if (Math.hypot(p.getX(i) - corner.x, -p.getZ(i) - corner.y) <
        Math.hypot(p.getX(nearest) - corner.x, -p.getZ(nearest) - corner.y)) nearest = i;
      const result = p.getY(nearest) - uv.getY(nearest) * 3.2;
      geometry.dispose();
      return result;
    };
    expect(Math.abs(datum(pitched) - datum(flat))).toBeLessThanOrEqual(0.03);
  });

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
