import * as THREE from "three";
import type { Box } from "./greybox.ts";
import { clearClippedPortals, setClippedPortals } from "./raycast.ts";

type Vertex = { values: Record<string, number[]>; world: THREE.Vector3 };
type Plane = (p: THREE.Vector3) => number;

function planes(box: Box): Plane[] {
  const c = box.center;
  return [
    p => box.width / 2 + p.clone().sub(c).dot(box.across),
    p => box.width / 2 - p.clone().sub(c).dot(box.across),
    p => box.depth / 2 + p.clone().sub(c).dot(box.along),
    p => box.depth / 2 - p.clone().sub(c).dot(box.along),
    p => p.y - c.y,
    p => c.y + box.height - p.y,
  ];
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
  geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; portalMeshes: Map<Box, THREE.Mesh[]>;
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

/** Runtime-only portal cuts. The caller owns the returned clones and must dispose them. */
export function cutPortals(root: THREE.Object3D, openings: readonly Box[], opts: PortalCutResources): { cutTriangles: number; cutMeshes: number; clipped: number; skipped: string[]; largeSharedVertices: number[] } {
  const result = { cutTriangles: 0, cutMeshes: 0, clipped: 0, skipped: [] as string[], largeSharedVertices: [] as number[] };
  root.updateWorldMatrix(true, true);
  const uses = new Map<THREE.BufferGeometry, number>();
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) uses.set(m.geometry, (uses.get(m.geometry) ?? 0) + 1); });
  const openingBounds = new Map(openings.map(box => {
    const corners: THREE.Vector3[] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const y of [0, box.height]) corners.push(box.center.clone().addScaledVector(box.along, a * box.depth / 2).addScaledVector(box.across, b * box.width / 2).add(new THREE.Vector3(0, y, 0)));
    return [box, new THREE.Box3().setFromPoints(corners)] as const;
  }));
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    const instance = mesh as THREE.InstancedMesh;
    if (instance.isInstancedMesh && !instance.boundingBox) instance.computeBoundingBox();
    const bounds = (instance.isInstancedMesh && instance.boundingBox ? instance.boundingBox : geometry.boundingBox).clone().applyMatrix4(mesh.matrixWorld);
    const relevant = openings.filter(box => bounds.intersectsBox(openingBounds.get(box)!));
    if (!relevant.length) return;
    if (instance.isInstancedMesh) {
      const matrix = new THREE.Matrix4(), world = new THREE.Matrix4();
      for (let i = 0; i < instance.count; i++) {
        instance.getMatrixAt(i, matrix);
        world.multiplyMatrices(instance.matrixWorld, matrix);
        const instanceBounds = geometry.boundingBox.clone().applyMatrix4(world);
        if (!relevant.some(box => instanceBounds.intersectsBox(openingBounds.get(box)!))) continue;
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
        instance.add(copy); copy.updateWorldMatrix(false, false);
        opts.instances.push({ owner: instance, index: i, matrix: matrix.clone(), copy });
        instance.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      }
      instance.instanceMatrix.needsUpdate = true; instance.boundingBox = null; instance.boundingSphere = null;
      return;
    }
    for (const box of relevant) opts.portalMeshes.set(box, [...(opts.portalMeshes.get(box) ?? []), mesh]);
    const position = geometry.getAttribute("position");
    if (!position || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Object.keys(geometry.morphAttributes).length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) {
      result.skipped.push(`${mesh.name || mesh.uuid}: unsupported geometry`); return;
    }
    const largeShared = (uses.get(geometry) ?? 0) > 1 && position.count >= 50000;
    if (largeShared && relevant.length === 1 && !mesh.userData.portalInstanceCopy) {
      const box = relevant[0]!;
      const normals = [box.across.clone().negate(), box.across.clone(), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0), box.along.clone().negate(), box.along.clone()];
      const points = [box.center.clone().addScaledVector(box.across, -box.width / 2), box.center.clone().addScaledVector(box.across, box.width / 2), box.center.clone().add(new THREE.Vector3(0, 0.05, 0)), box.center.clone().add(new THREE.Vector3(0, box.height, 0)), box.center.clone().addScaledVector(box.along, -box.depth / 2), box.center.clone().addScaledVector(box.along, box.depth / 2)];
      const clips = normals.map((n, i) => new THREE.Plane().setFromNormalAndCoplanarPoint(n, points[i]!));
      const clone = (m: THREE.Material) => { const c = m.clone(); c.clippingPlanes = clips; c.clipIntersection = true; opts.materials.push(c); return c; };
      opts.originals.set(mesh, { geometry: mesh.geometry, material: mesh.material });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      setClippedPortals(mesh, relevant); opts.clippedMeshes.push(mesh);
      result.clipped++; return;
    }
    if (largeShared) result.largeSharedVertices.push(position.count);
    const attrs = Object.entries(geometry.attributes);
    const output: Record<string, number[]> = Object.fromEntries(attrs.map(([name]) => [name, []]));
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
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
        if (Math.abs(normal.y) <= 0.5) for (const box of relevant) {
          const next: Vertex[][] = [];
          for (const poly of polys) {
            let inside = poly;
            const outside: Vertex[][] = [];
            for (const plane of planes(box)) {
              const [ins, out] = split(inside, plane); inside = ins;
              if (out.length >= 3) outside.push(out);
              if (inside.length < 3) break;
            }
            if (inside.length >= 3) { removed++; next.push(...outside); } else next.push(poly);
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
  });
  return result;
}
