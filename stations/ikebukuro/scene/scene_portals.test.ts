import fs from "node:fs";
import * as THREE from "three";
import { expect, it } from "vitest";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { assembleCollision } from "./scene.ts";

it("cuts the real Exit 39 sky triangles out of the verified stair route without closing it with beyond", () => {
  // Read the committed portal primitive; no textures or WebGL renderer are needed.
  const buf = fs.readFileSync(new URL("../gteki/assets/ikebukuro_b1_lit.glb", import.meta.url));
  const jsonLength = buf.readUInt32LE(12);
  const glb = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
  const node = glb.nodes.find((n: { name: string }) => n.name === "portals");
  const primitive = glb.meshes[node.mesh].primitives[0];
  const accessor = glb.accessors[primitive.attributes.POSITION];
  const view = glb.bufferViews[accessor.bufferView];
  expect(primitive.indices).toBeUndefined();
  expect(accessor.componentType).toBe(5126);
  const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytes = Uint8Array.from(buf.subarray(offset, offset + accessor.count * 12));
  const positions = new Float32Array(bytes.buffer);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry);
  mesh.name = "portals";
  mesh.updateMatrixWorld(true);
  const group = new THREE.Group();
  group.add(mesh);
  const materialFor = (role: string) => Object.assign(new THREE.MeshBasicMaterial(), { name: role });
  const parts = assembleCollision(THREE, group, {
    materialFor,
    toRenderer: (x, y, z) => new THREE.Vector3(...enuToRenderer({ x, y, z })),
    enuToRenderer,
    fenceCollider: new THREE.Group(),
  });
  const output = (role: string) => parts.extra.find((m) => (m.material as THREE.Material).name === role)!;
  const triangles = (values: ArrayLike<number>) => {
    const out: number[][] = [];
    for (let i = 0; i < values.length; i += 9) out.push(Array.from(values).slice(i, i + 9));
    return out;
  };
  const input = triangles(positions);
  const sky: number[][] = [], beyond: number[][] = [];
  for (const t of input) {
    const [a, b, c] = [0, 3, 6].map((i) => new THREE.Vector3(t[i], t[i + 1], t[i + 2]));
    const normal = new THREE.Triangle(a!, b!, c!).getNormal(new THREE.Vector3());
    (Math.abs(normal.y) > 0.9 && (a!.y + b!.y + c!.y) / 3 > 31 ? sky : beyond).push(t);
  }
  const remaining = triangles(output("portal_sky").geometry.getAttribute("position").array);
  const kept = new Set(remaining.map((t) => t.join(",")));
  const dropped = sky.filter((t) => !kept.has(t.join(",")));
  // These two real portal triangles sit over Exit 39's stair flight at TP 32.79 m.
  const exit39 = sky.filter((t) => [0, 3, 6].every((i) => t[i]! > 170 && t[i]! < 174 && t[i + 2]! > 178 && t[i + 2]! < 182));
  expect(exit39).toHaveLength(2);
  expect(exit39.every((t) => !kept.has(t.join(",")))).toBe(true);
  expect(dropped.length).toBeGreaterThanOrEqual(2);
  expect(triangles(output("portal_beyond").geometry.getAttribute("position").array)).toEqual(beyond);
  expect(parts.colliders).not.toContain(output("portal_sky"));
  console.log(`Sky triangles dropped: ${dropped.length} total; ${exit39.length} at Exit 39; ${remaining.length} retained.`);
});
