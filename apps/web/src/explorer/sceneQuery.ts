import * as THREE from "three";
import { castAll } from "./raycast.ts";

type PickPoint = { x: number; y: number } | {
  origin: THREE.Vector3Tuple;
  direction: THREE.Vector3Tuple;
};

export class SceneQuery {
  private readonly ray = new THREE.Raycaster();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly avatar: THREE.Object3D,
    private readonly viewport: () => Pick<DOMRect, "left" | "top" | "width" | "height">,
  ) {}

  private meshes(): THREE.Mesh[] {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    const visit = (object: THREE.Object3D) => {
      if (!object.visible || object === this.avatar) return;
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
      for (const child of object.children) visit(child);
    };
    visit(this.scene);
    return meshes;
  }

  private hit(meshes: readonly THREE.Mesh[]) {
    return castAll(this.ray, meshes).find(({ object, face }) => {
      const { material } = object as THREE.Mesh;
      const m = Array.isArray(material) ? material[face?.materialIndex ?? 0] : material;
      return m?.visible !== false && !(m?.transparent && !m.depthWrite);
    });
  }

  pick(point: PickPoint) {
    const meshes = this.meshes();
    if ("origin" in point) {
      this.ray.set(new THREE.Vector3(...point.origin), new THREE.Vector3(...point.direction).normalize());
      this.ray.near = 0;
      this.ray.far = Infinity;
    } else {
      const { left, top, width, height } = this.viewport();
      this.ray.setFromCamera({
        x: 2 * (point.x - left) / width - 1,
        y: 1 - 2 * (point.y - top) / height,
      }, this.camera);
      this.ray.near = this.camera.near;
      this.ray.far = this.camera.far;
    }
    const hit = this.hit(meshes);
    return hit ? this.describe(hit) : null;
  }

  describe({ object, instanceId }: Pick<THREE.Intersection, "object" | "instanceId">) {
    const mesh = object as THREE.Mesh;
    let dataId: string | null = instanceId === undefined ? null : mesh.userData.instanceDataId?.(instanceId) ?? null;
    let zoneId: string | null = null, buildingId: string | null = null, floorId: string | null = null;
    const path = [];
    for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
      const data = parent.userData;
      dataId ??= data.dataId ?? data.nodeId ?? data.edgeId ?? data.gtekiAsset?.id ?? null;
      zoneId ??= data.zoneId ?? data.gteki_zone ?? null;
      buildingId ??= data.buildingId ?? data.gteki_building ?? null;
      floorId ??= data.floorId ?? data.gteki_floor ?? null;
      if (parent.name) path.push(parent.name);
    }
    const bounds = this.bounds(mesh, this.worldMatrix(mesh, instanceId));
    return {
      name: mesh.name || (Array.isArray(mesh.material) ? "" : mesh.material.name) || mesh.type,
      path, dataId, zoneId, buildingId, floorId, instanceId: instanceId ?? null,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    };
  }

  private worldMatrix(mesh: THREE.Mesh, instanceId?: number) {
    if (instanceId === undefined) return mesh.matrixWorld;
    const matrix = new THREE.Matrix4();
    (mesh as THREE.InstancedMesh).getMatrixAt(instanceId, matrix);
    return matrix.premultiply(mesh.matrixWorld);
  }

  private bounds(mesh: THREE.Mesh, matrix: THREE.Matrix4) {
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      return skinned.boundingBox!.clone().applyMatrix4(matrix);
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
  }

  near(radiusM: number) {
    const meshes = this.meshes();
    const sphere = new THREE.Sphere(this.camera.position, radiusM);
    return meshes.flatMap(mesh => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.every(m => !m.visible || (m.transparent && !m.depthWrite))) return [];
      const instanced = mesh as THREE.InstancedMesh;
      const hits = [];
      for (let i = 0; i < (instanced.isInstancedMesh ? instanced.count : 1); i++) {
        const instanceId = instanced.isInstancedMesh ? i : undefined;
        const matrix = this.worldMatrix(mesh, instanceId);
        if (matrix.determinant() === 0 || !sphere.intersectsBox(this.bounds(mesh, matrix))) continue;
        const { index, attributes, drawRange } = mesh.geometry;
        const end = Math.min(drawRange.start + drawRange.count, index?.count ?? attributes.position!.count);
        const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
        for (let j = drawRange.start; j + 2 < end; j += 3) {
          mesh.getVertexPosition(index ? index.getX(j) : j, triangle.a).applyMatrix4(matrix);
          mesh.getVertexPosition(index ? index.getX(j + 1) : j + 1, triangle.b).applyMatrix4(matrix);
          mesh.getVertexPosition(index ? index.getX(j + 2) : j + 2, triangle.c).applyMatrix4(matrix);
          if (!sphere.containsPoint(triangle.closestPointToPoint(sphere.center, closest))) continue;
          hits.push(this.describe({ object: mesh, instanceId }));
          break;
        }
      }
      return hits;
    });
  }

  /** The journey's 16 × 10 camera-ray grid, to 0.3 m. Keep hit instances for diagnosis. */
  nearClip() {
    const meshes = this.meshes().filter(mesh => {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return true;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const sphere = mesh.geometry.boundingSphere?.clone().applyMatrix4(mesh.matrixWorld);
      return !sphere || sphere.distanceToPoint(this.camera.position) <= 0.3;
    });
    const hits: THREE.Intersection[] = [];
    this.ray.near = 0;
    this.ray.far = 0.3;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) {
      this.ray.setFromCamera({ x: (x + 0.5) / 8 - 1, y: 1 - (y + 0.5) / 5 }, this.camera);
      const hit = this.hit(meshes);
      if (hit) hits.push(hit);
    }
    return { ratio: hits.length / 160, hits };
  }
}
