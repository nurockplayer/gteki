import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { headlessGltfTextures, newShimUsage } from "./headless-dom.ts";

/** A one-triangle GLB whose material samples an embedded PNG (bufferView image) through TEXCOORD_1 as its occlusion. */
function glbWithEmbeddedImage(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const png = Buffer.from("89504e470d0a1a0a", "hex"); // header bytes only: never decoded
  const pad = (n: number) => (n + 3) & ~3;
  const bin = Buffer.alloc(pad(positions.byteLength + uvs.byteLength * 2 + png.length));
  Buffer.from(positions.buffer).copy(bin, 0);
  Buffer.from(uvs.buffer).copy(bin, positions.byteLength);
  Buffer.from(uvs.buffer).copy(bin, positions.byteLength + uvs.byteLength);
  png.copy(bin, positions.byteLength + uvs.byteLength * 2);
  const json = {
    asset: { version: "2.0" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 }, material: 0 }] }],
    materials: [{ name: "strip", occlusionTexture: { index: 0, texCoord: 1 } }],
    textures: [{ source: 0 }], images: [{ name: "nosing_ao", bufferView: 3, mimeType: "image/png" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs.byteLength, byteLength: uvs.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + uvs.byteLength * 2, byteLength: png.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
    ],
  };
  const jsonChunk = Buffer.from(JSON.stringify(json).padEnd(pad(JSON.stringify(json).length), " "));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const chunk = (data: Buffer, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  const glb = Buffer.concat([header, chunk(jsonChunk, 0x4e4f534a), chunk(bin, 0x004e4942)]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
}

describe("headlessGltfTextures (GLB images under Node)", () => {
  it("loads a GLB with an embedded image as a blank placeholder, keeping the slot and its UV set", async () => {
    const usage = newShimUsage();
    const loader = new GLTFLoader().register(headlessGltfTextures(usage));
    const gltf = await new Promise<GLTF>((ok, fail) => loader.parse(glbWithEmbeddedImage(), "", ok, fail));
    let material: THREE.MeshStandardMaterial | undefined;
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; });
    expect(material?.aoMap).toBeInstanceOf(THREE.Texture);
    expect(material!.aoMap!.userData.gteki_glb_placeholder).toBe(true);
    expect(material!.aoMap!.channel).toBe(1);
    expect(material!.aoMap!.flipY).toBe(false);
    expect(material!.aoMap!.name).toBe("nosing_ao");
    expect(usage.glbTextures).toBe(1);
  });
});
