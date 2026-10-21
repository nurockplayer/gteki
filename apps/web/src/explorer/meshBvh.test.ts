import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { castAll } from "./raycast.ts";
import { cacheBvh, currentBvh, prepareRayTrees } from "./meshBvh.ts";
import { TriangleBvh } from "./triangleBvh.ts";

/** Seeded uniform [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const brute = (ray: THREE.Raycaster, targets: THREE.Object3D[]) => ray.intersectObjects(targets, false);

/** Exactly three's hits: same objects, distances, points, faces and order. */
function expectSame(got: THREE.Intersection[], want: THREE.Intersection[]): void {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(got[i]!.object).toBe(want[i]!.object);
    expect(got[i]!.distance).toBe(want[i]!.distance);
    expect(got[i]!.faceIndex).toBe(want[i]!.faceIndex);
    expect(got[i]!.face?.materialIndex).toBe(want[i]!.face?.materialIndex);
    expect(got[i]!.point.toArray()).toEqual(want[i]!.point.toArray());
  }
}

/** Random rays at and through `box`, some with a finite far and a near. Returns how many hit anything. */
function compareRays(targets: THREE.Object3D[], box: THREE.Box3, n: number, seed: number): number {
  const r = rng(seed);
  const ray = new THREE.Raycaster();
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(1.5);
  const center = box.getCenter(new THREE.Vector3());
  const at = () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiply(size).add(center);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const origin = at();
    const dir = at().sub(origin).normalize();
    ray.set(origin, dir);
    ray.near = r() < 0.2 ? r() * 0.5 : 0;
    ray.far = r() < 0.5 ? r() * size.length() : Infinity;
    const want = brute(ray, targets);
    expectSame(castAll(ray, targets), want);
    if (want.length) hit++;
  }
  return hit;
}

function prepared(...objects: THREE.Object3D[]): THREE.Object3D[] {
  for (const o of objects) o.updateMatrixWorld(true);
  prepareRayTrees(objects);
  return objects;
}

afterEach(() => vi.restoreAllMocks());

describe("BVH ray tests match three's brute-force Mesh.raycast", () => {
  it("indexed and unindexed meshes, any side, moved, rotated and scaled, near and far", () => {
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2, 0.6, 128, 16), new THREE.MeshBasicMaterial());
    const back = new THREE.Mesh(new THREE.TorusKnotGeometry(1.5, 0.4, 96, 12).toNonIndexed(), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
    back.position.set(3, -1, 2);
    back.rotation.set(0.3, 1.1, -0.4);
    back.scale.set(1.7, 0.6, 2.3);
    const both = new THREE.Mesh(new THREE.SphereGeometry(1.2, 48, 32), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    both.position.set(-2.5, 1, -1);
    const tiny = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); // tested triangle by triangle
    tiny.position.set(1, 2.5, 0);
    const targets = prepared(knot, back, both, tiny);
    for (const m of [knot, back, both]) expect(currentBvh(m.geometry)).not.toBeNull();
    const spy = vi.spyOn(TriangleBvh.prototype, "rayCandidates");
    const box = new THREE.Box3();
    for (const m of targets) box.expandByObject(m);
    expect(compareRays(targets, box, 3000, 1)).toBeGreaterThan(600);
    expect(spy).toHaveBeenCalled();
  });

  it("material arrays: groups (overlapping too) and draw ranges, in three's group-major order", () => {
    const g = new THREE.BoxGeometry(2, 2, 2, 6, 6, 6);
    g.addGroup(0, 36, 0); // overlaps the first face's group: its triangles are tested (and hit) twice, as in three
    const sides = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide];
    const boxMesh = new THREE.Mesh(g, g.groups.map((_, i) => new THREE.MeshBasicMaterial({ side: sides[i % 3] })));
    const ranged = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.5, 24, 48), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    ranged.geometry.setDrawRange(300, 2400);
    ranged.position.set(0, 0, 3);
    const targets = prepared(boxMesh, ranged);
    const box = new THREE.Box3().expandByObject(boxMesh).expandByObject(ranged);
    expect(compareRays(targets, box, 3000, 2)).toBeGreaterThan(400);
    // The narrowed draw range and groups are put back.
    expect(ranged.geometry.drawRange).toEqual({ start: 300, count: 2400 });
    expect(g.groups.length).toBe(7);
  });

  it("ties on shared edges and vertices keep three's order", () => {
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(8, 8, 8, 8), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const twin = new THREE.Mesh(grid.geometry, grid.material);
    const targets = prepared(grid, twin);
    const ray = new THREE.Raycaster();
    let ties = 0;
    for (let x = -4; x <= 4; x += 0.5) {
      for (let y = -4; y <= 4; y += 0.5) {
        for (const dir of [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0.3, -0.2, -1).normalize()]) {
          ray.set(new THREE.Vector3(x, y, 5).addScaledVector(dir, -0.01), dir);
          const want = brute(ray, targets);
          expectSame(castAll(ray, targets), want);
          if (want.length > 2) ties++;
        }
      }
    }
    expect(ties).toBeGreaterThan(50);
  });

  it("rays grazing and lying in axis-aligned walls", () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 0.2, 20, 6, 1), new THREE.MeshBasicMaterial());
    const targets = prepared(wall);
    const ray = new THREE.Raycaster();
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const y = [-1.5, 0, 0.3, 1.5][i % 4]! + (i % 8 < 4 ? 0 : (r() - 0.5) * 1e-9);
      const z = [-0.1, 0.1, 0][i % 3]!;
      const a = r() * Math.PI * 2;
      ray.set(new THREE.Vector3((r() - 0.5) * 14, y, z + (r() - 0.5) * 2), new THREE.Vector3(Math.cos(a), 0, Math.sin(a) * (i % 5 === 0 ? 0 : 1)).normalize());
      ray.far = r() < 0.5 ? Infinity : 3;
      expectSame(castAll(ray, targets), brute(ray, targets));
    }
  });

  it("interleaved positions", () => {
    const src = new THREE.IcosahedronGeometry(2, 6).toNonIndexed();
    const p = src.getAttribute("position");
    const data = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) data.set([p.getX(i), p.getY(i), p.getZ(i), 0], i * 4);
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(data, 4), 3, 0));
    const targets = prepared(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    expect(currentBvh(g)).not.toBeNull();
    expect(compareRays(targets, new THREE.Box3().setFromObject(targets[0]!), 1500, 4)).toBeGreaterThan(300);
  });

  it("a tree stays valid when its mesh moves; an edited geometry is tested triangle by triangle", () => {
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2, 0.6, 64, 8), new THREE.MeshBasicMaterial());
    const targets = prepared(knot);
    const tree = currentBvh(knot.geometry);
    knot.position.set(4, 2, -3);
    knot.rotation.y = 1;
    knot.updateMatrixWorld(true);
    const spy = vi.spyOn(TriangleBvh.prototype, "rayCandidates");
    expect(compareRays(targets, new THREE.Box3().setFromObject(knot), 800, 5)).toBeGreaterThan(100);
    expect(spy).toHaveBeenCalled();
    expect(currentBvh(knot.geometry)).toBe(tree);

    const position = knot.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) position.setY(i, position.getY(i) * 1.5);
    position.needsUpdate = true;
    knot.geometry.computeBoundingSphere();
    knot.geometry.computeBoundingBox();
    expect(currentBvh(knot.geometry)).toBeNull();
    spy.mockClear();
    expect(compareRays(targets, new THREE.Box3().setFromObject(knot), 800, 6)).toBeGreaterThan(100);
    expect(spy).not.toHaveBeenCalled();
  });

  it("deforming, instanced and partial-triangle meshes keep three's own raycast", () => {
    const skinGeometry = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
    const vertices = skinGeometry.getAttribute("position").count;
    skinGeometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
    skinGeometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(vertices * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const skinned = new THREE.SkinnedMesh(skinGeometry, new THREE.MeshBasicMaterial());
    skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
    const morphed = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 4, 4, 4), new THREE.MeshBasicMaterial());
    morphed.geometry.morphAttributes.position = [morphed.geometry.getAttribute("position").clone()];
    morphed.updateMorphTargets();
    morphed.morphTargetInfluences![0] = 0.5;
    morphed.position.x = 2;
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1, 4, 4, 4), new THREE.MeshBasicMaterial(), 2);
    instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 2, 0));
    instanced.position.x = -2;
    const partial = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 4, 4, 4), new THREE.MeshBasicMaterial());
    partial.geometry.setDrawRange(1, 200);
    partial.position.z = 2;
    for (const m of [skinned, morphed, instanced, partial]) cacheBvh(m.geometry);
    const targets = prepared(skinned, morphed, instanced, partial);
    expect(prepareRayTrees(targets).trees).toBe(0);
    const spy = vi.spyOn(TriangleBvh.prototype, "rayCandidates");
    const box = new THREE.Box3();
    for (const m of targets) box.expandByObject(m);
    expect(compareRays(targets, box, 1500, 7)).toBeGreaterThan(100);
    expect(spy).not.toHaveBeenCalled();
  });

  it("only targets on the ray's layers are tested, as in intersectObjects", () => {
    const a = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const b = new THREE.Mesh(a.geometry, a.material);
    b.position.z = -3;
    b.layers.set(2);
    const targets = prepared(a, b);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(castAll(ray, targets).map((h) => h.object)).toEqual([a, a]);
    ray.layers.enable(2);
    expectSame(castAll(ray, targets), brute(ray, targets));
    expect(castAll(ray, targets).length).toBe(4);
  });

  it("reports what the trees cost, once per shared geometry", () => {
    const g = new THREE.TorusKnotGeometry(1, 0.3, 64, 8);
    const stats = prepareRayTrees(prepared(new THREE.Mesh(g), new THREE.Mesh(g), new THREE.Group()));
    expect(stats.trees).toBe(1);
    expect(stats.triangles).toBe(64 * 8 * 2);
    expect(stats.bytes).toBeGreaterThan(stats.triangles * 40);
    expect(stats.buildMs).toBeGreaterThanOrEqual(0);
  });
});
