import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { cutPortals, disposePortalCuts } from "./portalCut.ts";
import { castAll, castCamera, castTargets, portalPassable } from "./raycast.ts";
import { prepareRayTrees, raycastObject } from "./meshBvh.ts";

const opening = { center: new THREE.Vector3(), along: new THREE.Vector3(0, 0, 1), across: new THREE.Vector3(1, 0, 0), width: 2, depth: 0.6, height: 2 };
const resources = () => ({ geometries: [] as THREE.BufferGeometry[], materials: [] as THREE.Material[], portalMeshes: new Map<typeof opening, THREE.Mesh[]>(), originals: new Map<THREE.Mesh, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }>(), clippedMeshes: [] as THREE.Mesh[], instances: [] as { owner: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; copy: THREE.Mesh }[] });
const ray = (mesh: THREE.Mesh, x: number, y: number) => {
  const hits: THREE.Intersection[] = [];
  raycastObject(mesh, new THREE.Raycaster(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1)), hits);
  return hits;
};

describe("portal cuts", () => {
  it.each([false, true])("avoids rebuilding a bounds-only overlap (cached BVH: %s)", (withTree) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -3, 0, 0, -2, 0, 0, -2, 3, 0,
      2, 0, 0, 3, 0, 0, 2, 3, 0,
    ], 3));
    const uv = new THREE.Float32BufferAttribute(new Float32Array(12), 2);
    geometry.setAttribute("uv", uv);
    const expanded = vi.spyOn(uv, "getComponent");
    const root = new THREE.Group(), mesh = new THREE.Mesh(geometry);
    root.add(mesh); if (withTree) prepareRayTrees([mesh]);
    const owned = resources(), result = cutPortals(root, [opening], owned);
    expect(mesh.geometry).toBe(geometry); expect(result.cutMeshes).toBe(0);
    expect(owned.geometries).toHaveLength(0); expect(owned.materials).toHaveLength(0);
    expect(expanded).not.toHaveBeenCalled();
  });
  it("splits the wall into a rectangular opening, retains floor faces and builds usable ray trees", () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.y = 1.5; root.add(wall);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    floor.position.y = -0.1; root.add(floor);
    const owned = resources(); const result = cutPortals(root, [opening], owned);
    expect(result.cutMeshes).toBeGreaterThanOrEqual(1); expect(result.cutTriangles).toBeGreaterThan(0); expect(result.cutMs).toBeGreaterThan(0);
    prepareRayTrees([wall, floor]);
    expect(ray(wall, 0, 1)).toHaveLength(0);
    expect(ray(wall, 2, 1).length).toBeGreaterThan(0);
    expect(ray(wall, 0, 2.5).length).toBeGreaterThan(0);
    expect(new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)).intersectObject(floor).length).toBeGreaterThan(0);
    const disposed = vi.fn(); owned.geometries[0]!.addEventListener("dispose", disposed); owned.geometries.forEach(g => g.dispose()); expect(disposed).toHaveBeenCalledOnce();
  });
  it("does not mutate shared geometry", () => {
    const geometry = new THREE.BoxGeometry(6, 3, 0.2), root = new THREE.Group();
    const a = new THREE.Mesh(geometry), b = new THREE.Mesh(geometry);
    a.position.y = 1.5; b.position.set(10, 1.5, 0); root.add(a, b);
    cutPortals(root, [opening], resources());
    expect(a.geometry).not.toBe(geometry); expect(b.geometry).toBe(geometry); expect(geometry.index!.count).toBe(36);
  });
  it("uses cloned clipping materials for a large shared geometry", () => {
    const geometry = new THREE.PlaneGeometry(6, 3, 224, 224), root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    a.position.y = 1.5; b.position.set(10, 1.5, 0); root.add(a, b);
    const owned = resources(); const result = cutPortals(root, [opening], owned);
    expect(result.clipped).toBe(1); expect(a.geometry).toBe(geometry); expect(a.material).not.toBe(material);
    const clippingPlanes = (a.material as THREE.Material).clippingPlanes!;
    expect(clippingPlanes).toHaveLength(6);
    expect((a.material as THREE.Material).clipShadows).toBe(true);
    const discarded = (p: THREE.Vector3) => clippingPlanes.every(plane => plane.distanceToPoint(p) < 0);
    // A floor triangle inside the opening remains, while a point just above it is clipped.
    for (const p of [new THREE.Vector3(-0.4, 0, -0.1), new THREE.Vector3(0.4, 0, -0.1), new THREE.Vector3(0, 0, 0.1)]) expect(discarded(p)).toBe(false);
    expect(discarded(new THREE.Vector3(0, 0.06, 0))).toBe(true);
    expect(discarded(new THREE.Vector3(0, opening.height + 0.01, 0))).toBe(false);
    const disposed = vi.fn(); owned.materials[0]!.addEventListener("dispose", disposed); owned.materials.forEach(m => m.dispose()); expect(disposed).toHaveBeenCalledOnce();
  });
  it("allows GPU clipping with a horizontal triangle below the clip volume", () => {
    const wall = new THREE.PlaneGeometry(6, 3, 224, 224).translate(0, 1.5, 0).toNonIndexed();
    const wallPositions = wall.getAttribute("position").array;
    const floor = [-0.4, 0.03, -0.1, 0.4, 0.03, -0.1, 0, 0.03, 0.1];
    const positions = new Float32Array(wallPositions.length + floor.length);
    positions.set(wallPositions); positions.set(floor, wallPositions.length);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const root = new THREE.Group(), a = new THREE.Mesh(geometry), b = new THREE.Mesh(geometry);
    b.position.x = 10; root.add(a, b);
    const owned = resources(), result = cutPortals(root, [opening], owned);
    expect(result.clipped).toBe(1); expect(result.cutMeshes).toBe(0);
    const clips = (a.material as THREE.Material).clippingPlanes!;
    for (let i = 0; i < floor.length; i += 3) {
      const p = new THREE.Vector3(floor[i]!, floor[i + 1]!, floor[i + 2]!);
      expect(clips.every(plane => plane.distanceToPoint(p) < 0)).toBe(false);
    }
    disposePortalCuts(owned);
  });
  it("keeps a pillar's passage-parallel faces solid and visible", () => {
    const root = new THREE.Group();
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 0.4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    pillar.position.y = 1; root.add(pillar);
    cutPortals(root, [opening], resources()); prepareRayTrees([pillar]);
    const sideRay = new THREE.Raycaster(new THREE.Vector3(-0.8, 1, 0), new THREE.Vector3(1, 0, 0));
    expect(castAll(sideRay, [pillar]).length).toBeGreaterThan(0);
    expect(sideRay.intersectObject(pillar).length).toBeGreaterThan(0);
  });
  it("CPU cuts shared walkable geometry and leaves the other instance unchanged", () => {
    const geometry = new THREE.PlaneGeometry(6, 3, 224, 224), root = new THREE.Group();
    const a = new THREE.Mesh(geometry), b = new THREE.Mesh(geometry);
    a.position.y = 1.5; b.position.set(10, 1.5, 0); root.add(a, b);
    const owned = resources();
    const result = cutPortals(root, [opening], owned, new Set([a]));
    expect(result.clonedWalkable).toBe(1); expect(result.clonedWalkableVertices).toEqual([geometry.getAttribute("position").count]); expect(result.clipped).toBe(0);
    expect(a.geometry).not.toBe(geometry); expect(b.geometry).toBe(geometry); expect(owned.materials).toHaveLength(0);
    prepareRayTrees([a]); expect(ray(a, 0, 1)).toHaveLength(0); expect(ray(a, 2, 1).length).toBeGreaterThan(0);
    const loneRoot = new THREE.Group(), lone = new THREE.Mesh(new THREE.PlaneGeometry(6, 3));
    lone.position.y = 1.5; loneRoot.add(lone);
    const unshared = cutPortals(loneRoot, [opening], resources(), new Set([lone]));
    expect(unshared.clonedWalkable).toBe(0); expect(unshared.cutMeshes).toBe(1);
  });
  it("cuts and filters a wall crossed at 45 degrees, leaving a parallel pillar side", () => {
    const normal = new THREE.Vector3(1, 0, 1).normalize();
    const box = { ...opening, wallNormal: normal };
    const root = new THREE.Group(), wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.rotation.y = Math.PI / 4; wall.position.y = 1.5; root.add(wall);
    const pillar = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    pillar.rotation.y = Math.PI / 2; pillar.position.set(0.1, 1, 0); root.add(pillar);
    cutPortals(root, [box], resources()); prepareRayTrees([wall, pillar]);
    expect(ray(wall, 0, 1)).toHaveLength(0);
    expect(castAll(new THREE.Raycaster(new THREE.Vector3(-0.5, 1, 0), new THREE.Vector3(1, 0, 0)), [pillar]).length).toBeGreaterThan(0);
    const large = new THREE.PlaneGeometry(6, 3, 224, 224), scene = new THREE.Group();
    const a = new THREE.Mesh(large, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), b = new THREE.Mesh(large);
    a.rotation.y = Math.PI / 4; a.position.y = 1.5; b.position.set(20, 0, 0); scene.add(a, b);
    const owned = resources(), result = cutPortals(scene, [box], owned);
    expect(result.clipped).toBe(1);
    const rawHit = ray(a, 0, 1)[0]!; expect(portalPassable(rawHit)).toBe(true);
    const sideHit = { ...rawHit, face: { ...rawHit.face!, normal: new THREE.Vector3(1, 0, 1).normalize() } };
    // Local 45-degree normal transformed by the wall matrix is perpendicular to passage.
    expect(portalPassable(sideHit)).toBe(false);
    disposePortalCuts(owned);
  });
  it("CPU cuts a large mixed wall so passage-parallel faces remain", () => {
    const geometry = new THREE.BoxGeometry(0.4, 2, 0.4, 100, 100, 100), root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    a.position.y = 1; b.position.set(10, 1, 0); root.add(a, b);
    const result = cutPortals(root, [opening], resources());
    expect(result.clipped).toBe(0); expect(result.cutMeshes).toBe(1);
    const side = new THREE.Raycaster(new THREE.Vector3(-0.8, 1, 0), new THREE.Vector3(1, 0, 0));
    expect(castAll(side, [a]).length).toBeGreaterThan(0);
  });
  it("cuts large shared geometry on the CPU for multiple openings", () => {
    const geometry = new THREE.PlaneGeometry(6, 3, 224, 224), root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    a.position.y = 1.5; b.position.set(10, 1.5, 0); root.add(a, b);
    const other = { ...opening, center: new THREE.Vector3(2, 0, 0), width: 1 };
    const result = cutPortals(root, [opening, other], resources());
    expect(result.largeSharedVertices).toEqual([geometry.getAttribute("position").count]);
    expect(result.clipped).toBe(0); expect(a.geometry).not.toBe(geometry); expect(b.geometry).toBe(geometry);
    prepareRayTrees([a]); expect(ray(a, 0, 1)).toHaveLength(0); expect(ray(a, 2, 1)).toHaveLength(0);
  });
  it("extracts and cuts intersecting instances, then restores them on disposal", () => {
    const root = new THREE.Group(), geometry = new THREE.BoxGeometry(6, 3, 0.2);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 2);
    const first = new THREE.Matrix4().makeTranslation(0, 1.5, 0), second = new THREE.Matrix4().makeTranslation(10, 1.5, 0);
    mesh.setMatrixAt(0, first); mesh.setMatrixAt(1, second);
    const source = mesh.material as THREE.MeshBasicMaterial;
    source.color.setRGB(0.8, 0.6, 0.4); mesh.setColorAt(0, new THREE.Color(0.5, 0.25, 1));
    mesh.setColorAt(1, new THREE.Color(1, 1, 1)); root.add(mesh);
    const owned = resources(); const result = cutPortals(root, [opening], owned);
    expect(result.cutMeshes).toBe(1); expect(owned.instances).toHaveLength(1);
    const copy = owned.instances[0]!.copy, current = new THREE.Matrix4();
    const tinted = copy.material as THREE.MeshBasicMaterial;
    expect(tinted).not.toBe(source); expect(tinted.color.r).toBeCloseTo(0.4); expect(tinted.color.g).toBeCloseTo(0.15); expect(tinted.color.b).toBeCloseTo(0.4);
    expect(source.color.r).toBeCloseTo(0.8);
    const disposed = vi.fn(); tinted.addEventListener("dispose", disposed);
    mesh.getMatrixAt(0, current); expect(current.determinant()).toBe(0);
    mesh.getMatrixAt(1, current); expect(current.equals(second)).toBe(true);
    prepareRayTrees(castTargets([mesh]));
    expect(castCamera(new THREE.Raycaster(new THREE.Vector3(0, 1, 3), new THREE.Vector3(0, 0, -1)), castTargets([mesh]), new Set(castTargets([mesh])))).toHaveLength(0);
    expect(ray(copy, 2, 1).length).toBeGreaterThan(0);
    disposePortalCuts(owned); expect(disposed).toHaveBeenCalledOnce(); mesh.getMatrixAt(0, current); expect(current.equals(first)).toBe(true);
    mesh.getMatrixAt(1, current); expect(current.equals(second)).toBe(true); expect(mesh.children).not.toContain(copy);
  });
  it("filters clipped mesh hits for camera and shared casts", () => {
    const geometry = new THREE.PlaneGeometry(6, 3, 224, 224), root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    a.position.y = 1.5; b.position.set(10, 1.5, 0); root.add(a, b);
    const owned = resources(); cutPortals(root, [opening], owned); prepareRayTrees([a]);
    const shoot = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 1, 3), new THREE.Vector3(0, 0, -1));
    expect(castCamera(shoot(0), [a], new Set([a]))).toHaveLength(0);
    expect(castAll(shoot(0), [a])).toHaveLength(0);
    const wallHit = ray(a, 0, 1)[0]!;
    expect(portalPassable(wallHit)).toBe(true);
    const floorHit = { ...wallHit, face: { ...wallHit.face!, normal: new THREE.Vector3(0, 1, 0) } };
    expect(portalPassable(floorHit)).toBe(false);
    const ceilingHit = { ...wallHit, face: { ...wallHit.face!, normal: new THREE.Vector3(0, -1, 0) } };
    expect(portalPassable(ceilingHit)).toBe(false);
    const sideHit = { ...wallHit, face: { ...wallHit.face!, normal: new THREE.Vector3(1, 0, 0) } };
    expect(portalPassable(sideHit)).toBe(false);
    expect(castCamera(shoot(2), [a], new Set([a])).length).toBeGreaterThan(0);
    disposePortalCuts(owned); expect(castAll(shoot(0), [a]).length).toBeGreaterThan(0);
  });
});
