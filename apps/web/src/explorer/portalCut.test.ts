import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { cutPortals } from "./portalCut.ts";
import { prepareRayTrees, raycastObject } from "./meshBvh.ts";

const opening = { center: new THREE.Vector3(), along: new THREE.Vector3(0, 0, 1), across: new THREE.Vector3(1, 0, 0), width: 2, depth: 0.6, height: 2 };
const resources = () => ({ geometries: [] as THREE.BufferGeometry[], materials: [] as THREE.Material[], portalMeshes: new Map<typeof opening, THREE.Mesh[]>(), originals: new Map<THREE.Mesh, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }>() });
const ray = (mesh: THREE.Mesh, x: number, y: number) => {
  const hits: THREE.Intersection[] = [];
  raycastObject(mesh, new THREE.Raycaster(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1)), hits);
  return hits;
};

describe("portal cuts", () => {
  it("splits the wall into a rectangular opening, retains floor faces and builds usable ray trees", () => {
    const root = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.y = 1.5; root.add(wall);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    floor.position.y = -0.1; root.add(floor);
    const owned = resources(); const result = cutPortals(root, [opening], owned);
    expect(result.cutMeshes).toBeGreaterThanOrEqual(1);
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
    expect((a.material as THREE.Material).clippingPlanes).toHaveLength(6);
    const disposed = vi.fn(); owned.materials[0]!.addEventListener("dispose", disposed); owned.materials.forEach(m => m.dispose()); expect(disposed).toHaveBeenCalledOnce();
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
  it("reports an instanced mesh as skipped", () => {
    const root = new THREE.Group(), mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1);
    root.add(mesh); expect(cutPortals(root, [opening], resources()).skipped[0]).toContain("InstancedMesh");
  });
});
