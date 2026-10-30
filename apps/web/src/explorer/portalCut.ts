import * as THREE from "three";
import { portalDepthAxis, portalWidthAxis, type Box } from "./greybox.ts";
import { clearClippedPortals, portalWallNormal, setClippedPortals } from "./raycast.ts";
import { currentBvh } from "./meshBvh.ts";

type Vertex = { values: Record<string, number[]>; world: THREE.Vector3 };
export type Plane = (p: THREE.Vector3) => number;

/** A convex volume whose interior triangles are removed. Portals cut vertical faces; stairwells cut horizontal ones. */
export interface CutRegion {
  /** Bookkeeping key: `CutResources.portalMeshes` is filed under it. */
  key: object;
  bounds: THREE.Box3;
  /** Inside scores >= 0 on every plane. */
  planes: Plane[];
  /** GPU clip volume for the shared-mesh fallback; null means the region is always CPU-cut. */
  clip: THREE.Plane[] | null;
  accepts(normal: THREE.Vector3): boolean;
}

function planes(box: Box): Plane[] {
  const c = box.center, across = portalWidthAxis(box), depth = portalDepthAxis(box);
  return [
    p => box.width / 2 + p.clone().sub(c).dot(across),
    p => box.width / 2 - p.clone().sub(c).dot(across),
    p => box.depth / 2 + p.clone().sub(c).dot(depth),
    p => box.depth / 2 - p.clone().sub(c).dot(depth),
    p => p.y - c.y - 0.05,
    p => c.y + box.height - p.y,
  ];
}

/** The six outward-facing planes that define the GPU-discard volume. */
function clipVolume(box: Box): THREE.Plane[] {
  const across = portalWidthAxis(box), depth = portalDepthAxis(box);
  const normals = [across.clone().negate(), across.clone(), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), depth.clone().negate(), depth.clone()];
  const points = [box.center.clone().addScaledVector(across, -box.width / 2), box.center.clone().addScaledVector(across, box.width / 2), box.center.clone().add(new THREE.Vector3(0, 0.05, 0)), box.center.clone().add(new THREE.Vector3(0, box.height, 0)), box.center.clone().addScaledVector(depth, -box.depth / 2), box.center.clone().addScaledVector(depth, box.depth / 2)];
  return normals.map((normal, i) => new THREE.Plane().setFromNormalAndCoplanarPoint(normal, points[i]!));
}

function portalRegion(box: Box): CutRegion {
  const corners: THREE.Vector3[] = [], across = portalWidthAxis(box), depth = portalDepthAxis(box);
  const determinant = across.x * depth.z - across.z * depth.x;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const y of [0, box.height]) {
    const w = a * box.width / 2, d = b * box.depth / 2;
    corners.push(box.center.clone().add(new THREE.Vector3((w * depth.z - across.z * d) / determinant, y, (across.x * d - w * depth.x) / determinant)));
  }
  return {
    key: box, bounds: new THREE.Box3().setFromPoints(corners), planes: planes(box), clip: clipVolume(box),
    accepts: normal => portalWallNormal(normal, box),
  };
}

function mix(a: Vertex, b: Vertex, t: number): Vertex {
  const values: Record<string, number[]> = {};
  for (const key of Object.keys(a.values)) values[key] = a.values[key]!.map((v, i) => v + (b.values[key]![i]! - v) * t);
  return { values, world: a.world.clone().lerp(b.world, t) };
}

/** Split a polygon into the two sides of a plane, preserving interpolated vertex attributes. */
function split(poly: Vertex[], plane: Plane): [Vertex[], Vertex[]] {
  const inside: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const da = plane(a.world), db = plane(b.world);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const v = mix(a, b, da / (da - db));
      inside.push(v); outside.push(v);
    }
  }
  return [inside, outside];
}

export interface PortalCutResources {
  geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; portalMeshes: Map<object, THREE.Mesh[]>;
  originals: Map<THREE.Mesh, { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }>;
  clippedMeshes: THREE.Mesh[];
  instances: { owner: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; copy: THREE.Mesh }[];
}

export function disposePortalCuts(opts: PortalCutResources): void {
  for (const mesh of opts.clippedMeshes) clearClippedPortals(mesh);
  for (const { owner, index, matrix, copy } of opts.instances) { owner.setMatrixAt(index, matrix); owner.instanceMatrix.needsUpdate = true; owner.remove(copy); owner.boundingBox = null; owner.boundingSphere = null; }
  for (const [mesh, original] of opts.originals) { mesh.geometry = original.geometry; mesh.material = original.material; }
  for (const geometry of opts.geometries) geometry.dispose();
  for (const material of opts.materials) material.dispose();
}

export interface CutResult {
  cutTriangles: number; cutMs: number; cutMeshes: number; clipped: number; skipped: string[];
  clonedWalkable: number; clonedWalkableVertices: number[]; largeSharedVertices: number[];
  /** Removed triangles per region key. */
  perRegion: Map<object, number>;
  /** World heights of the removed triangles per region key. */
  heights: Map<object, number[]>;
  /** Maximum world height of each removed polygon, per region key. */
  maxHeights: Map<object, number[]>;
}

/**
 * Remove each region's interior from the meshes under `root`, in render and collision alike.
 * `clip` allows the render-only GPU fallback (portals); stairwells pass false, so a shared mesh is
 * always CPU-cut or reported as skipped.
 */
export function cutRegions(root: THREE.Object3D, regions: readonly CutRegion[], opts: PortalCutResources, walkable: ReadonlySet<THREE.Object3D> = new Set(), clip = true, vertexLimit = Infinity): CutResult {
  const started = performance.now();
  const result: CutResult = { cutTriangles: 0, cutMs: 0, cutMeshes: 0, clipped: 0, skipped: [], clonedWalkable: 0, clonedWalkableVertices: [], largeSharedVertices: [], perRegion: new Map(), heights: new Map(), maxHeights: new Map() };
  root.updateWorldMatrix(true, true);
  const uses = new Map<THREE.BufferGeometry, number>();
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) uses.set(m.geometry, (uses.get(m.geometry) ?? 0) + 1); });
  const walkableCopies = new WeakSet<THREE.Mesh>();
  const countRegion = (key: object) => result.perRegion.set(key, (result.perRegion.get(key) ?? 0) + 1);
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    const instance = mesh as THREE.InstancedMesh;
    if (instance.isInstancedMesh && !instance.boundingBox) instance.computeBoundingBox();
    const bounds = (instance.isInstancedMesh && instance.boundingBox ? instance.boundingBox : geometry.boundingBox).clone().applyMatrix4(mesh.matrixWorld);
    const relevant = regions.filter(region => bounds.intersectsBox(region.bounds));
    if (!relevant.length) return;
    // Both paths would pay for a mesh this size: the instance copies as much as the full rebuild.
    const position = geometry.getAttribute("position");
    if (position && position.count > vertexLimit) {
      result.skipped.push(`${mesh.name || mesh.uuid}: ${position.count} vertices over ${vertexLimit}`); return;
    }
    if (instance.isInstancedMesh) {
      const matrix = new THREE.Matrix4(), world = new THREE.Matrix4();
      for (let i = 0; i < instance.count; i++) {
        instance.getMatrixAt(i, matrix);
        world.multiplyMatrices(instance.matrixWorld, matrix);
        const instanceBounds = geometry.boundingBox.clone().applyMatrix4(world);
        if (!relevant.some(region => instanceBounds.intersectsBox(region.bounds))) continue;
        let material = instance.material;
        if (instance.instanceColor) {
          const tint = new THREE.Color(); instance.getColorAt(i, tint);
          const tinted = (source: THREE.Material) => {
            const clone = source.clone();
            const colored = clone as THREE.Material & { color?: THREE.Color };
            colored.color?.multiply(tint);
            opts.materials.push(clone); return clone;
          };
          material = Array.isArray(material) ? material.map(tinted) : tinted(material);
        }
        const copy = new THREE.Mesh(geometry, material);
        copy.name = instance.name; copy.matrixAutoUpdate = false; copy.matrix.copy(matrix);
        copy.userData = { ...instance.userData, portalInstanceCopy: true };
        copy.castShadow = instance.castShadow; copy.receiveShadow = instance.receiveShadow; copy.layers.mask = instance.layers.mask;
        if (walkable.has(instance)) walkableCopies.add(copy);
        instance.add(copy); copy.updateWorldMatrix(false, false);
        opts.instances.push({ owner: instance, index: i, matrix: matrix.clone(), copy });
        instance.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      }
      instance.instanceMatrix.needsUpdate = true; instance.boundingBox = null; instance.boundingSphere = null;
      return;
    }
    for (const region of relevant) opts.portalMeshes.set(region.key, [...(opts.portalMeshes.get(region.key) ?? []), mesh]);
    if (!position || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(geometry.morphAttributes).length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) {
      result.skipped.push(`${mesh.name || mesh.uuid}: unsupported geometry`); return;
    }
    const isWalkable = walkable.has(mesh) || walkableCopies.has(mesh);
    const shared = (uses.get(geometry) ?? 0) > 1 || walkableCopies.has(mesh);
    const largeShared = shared && position.count >= 50000;
    // Test positions only before expanding every vertex attribute into rebuild arrays.
    const index = geometry.index, count = index ? index.count : position.count;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    const tree = groups.every(g => g.start % 3 === 0 && g.count % 3 === 0) ? currentBvh(geometry) : null;
    const inverse = mesh.matrixWorld.clone().invert();
    const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const triangleBounds = new THREE.Box3();
    const readWorld = (i: number, into: THREE.Vector3) => {
      const k = index ? index.getX(i) : i;
      return into.set(position.getX(k), position.getY(k), position.getZ(k)).applyMatrix4(mesh.matrixWorld);
    };
    const hasCut = relevant.some(region => {
      const intersects = (i: number) => {
        for (let j = 0; j < 3; j++) readWorld(i + j, vertices[j]!);
        const normal = vertices[1]!.clone().sub(vertices[0]!).cross(vertices[2]!.clone().sub(vertices[0]!)).normalize();
        if (!region.accepts(normal)) return false;
        return triangleBounds.setFromPoints(vertices).intersectsBox(region.bounds);
      };
      if (tree && mesh.matrixWorld.determinant() !== 0) {
        const localBounds = region.bounds.clone().applyMatrix4(inverse);
        const sphere = localBounds.getBoundingSphere(new THREE.Sphere()), candidates: number[] = [];
        tree.pointCandidates(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius + 1e-6, candidates);
        return candidates.some(id => {
          const i = id * 3;
          return groups.some(g => i >= g.start && i + 3 <= Math.min(g.start + g.count, count)) && intersects(i);
        });
      }
      for (const group of groups) for (let i = group.start; i + 2 < Math.min(group.start + group.count, count); i += 3) if (intersects(i)) return true;
      return false;
    });
    if (!hasCut) return;
    // Clipping planes cannot distinguish the cut faces from returns or obstacles in the same mesh.
    // If any non-cut triangle intersects the clip volume, use the CPU cut instead.
    const first = relevant[0]!;
    const hasOtherFaces = () => {
      const clipPlanes = first.clip!.map(plane => (p: THREE.Vector3) => -plane.distanceToPoint(p));
      for (let i = 0; i + 2 < count; i += 3) {
        const points = [0, 1, 2].map(j => readWorld(i + j, new THREE.Vector3()));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
        if (first.accepts(normal)) continue;
        let poly = points.map(world => ({ world, values: {} }));
        for (const plane of clipPlanes) { poly = split(poly, plane)[0]; if (poly.length < 3) break; }
        if (poly.length >= 3) return true;
      }
      return false;
    };
    if (clip && largeShared && !isWalkable && relevant.length === 1 && !mesh.userData.portalInstanceCopy && first.clip && !hasOtherFaces()) {
      const clips = first.clip;
      const clone = (m: THREE.Material) => { const c = m.clone(); c.clippingPlanes = clips; c.clipIntersection = true; c.clipShadows = true; opts.materials.push(c); return c; };
      opts.originals.set(mesh, { geometry: mesh.geometry, material: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      setClippedPortals(mesh, relevant.map(region => region.key as Box));
      opts.clippedMeshes.push(mesh);
      result.clipped++; return;
    }
    if (largeShared) result.largeSharedVertices.push(position.count);
    const attrs = Object.entries(geometry.attributes);
    const output: Record<string, number[]> = Object.fromEntries(attrs.map(([name]) => [name, []]));
    const outGroups: { start: number; count: number; materialIndex: number }[] = [];
    let removed = 0;
    for (const group of groups) {
      const start = output.position!.length / position.itemSize;
      for (let i = group.start; i + 2 < Math.min(group.start + group.count, count); i += 3) {
        const vertices = [0, 1, 2].map(j => {
          const k = index ? index.getX(i + j) : i + j;
          const values: Record<string, number[]> = {};
          for (const [name, attr] of attrs) values[name] = Array.from({ length: attr.itemSize }, (_, n) => attr.getComponent(k, n));
          return { values, world: new THREE.Vector3(position.getX(k), position.getY(k), position.getZ(k)).applyMatrix4(mesh.matrixWorld) };
        });
        const normal = vertices[1]!.world.clone().sub(vertices[0]!.world).cross(vertices[2]!.world.clone().sub(vertices[0]!.world)).normalize();
        let polys = [vertices];
        for (const region of relevant) {
          if (!region.accepts(normal)) continue;
          const next: Vertex[][] = [];
          for (const poly of polys) {
            let inside = poly;
            const outside: Vertex[][] = [];
            for (const plane of region.planes) {
              const [ins, out] = split(inside, plane); inside = ins;
              if (out.length >= 3) outside.push(out);
              if (inside.length < 3) break;
            }
            if (inside.length >= 3) {
              removed++; countRegion(region.key);
              const heights = result.heights.get(region.key) ?? [];
              heights.push(inside.reduce((sum, v) => sum + v.world.y, 0) / inside.length);
              result.heights.set(region.key, heights);
              const maxHeights = result.maxHeights.get(region.key) ?? [];
              maxHeights.push(Math.max(...inside.map(v => v.world.y)));
              result.maxHeights.set(region.key, maxHeights);
              next.push(...outside);
            } else next.push(poly);
          }
          polys = next;
        }
        for (const poly of polys) for (let j = 1; j + 1 < poly.length; j++) for (const v of [poly[0]!, poly[j]!, poly[j + 1]!]) for (const [name] of attrs) output[name]!.push(...v.values[name]!);
      }
      outGroups.push({ start, count: output.position!.length / position.itemSize - start, materialIndex: group.materialIndex ?? 0 });
    }
    if (!removed) return;
    const clone = new THREE.BufferGeometry();
    for (const [name, attr] of attrs) clone.setAttribute(name, new THREE.Float32BufferAttribute(output[name]!, attr.itemSize, false));
    if (geometry.groups.length) for (const group of outGroups) clone.addGroup(group.start, group.count, group.materialIndex);
    clone.computeBoundingBox(); clone.computeBoundingSphere();
    opts.originals.set(mesh, { geometry: mesh.geometry, material: mesh.material });
    mesh.geometry = clone; opts.geometries.push(clone); result.cutTriangles += removed; result.cutMeshes++;
    if (isWalkable && shared) { result.clonedWalkable++; result.clonedWalkableVertices.push(position.count); }
  });
  result.cutMs = performance.now() - started;
  return result;
}

/** Runtime-only portal cuts. The caller owns the returned clones and must dispose them. */
export function cutPortals(root: THREE.Object3D, openings: readonly Box[], opts: PortalCutResources, walkable: ReadonlySet<THREE.Object3D> = new Set()): CutResult {
  return cutRegions(root, openings.map(portalRegion), opts, walkable);
}
