/** CPU texture estimate of the shipped scene; canvas drawing and GPU PMREM are stubbed. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it, vi } from "vitest";
import { glbPrimitivePlugin, type SceneContext } from "@gteki/scene-api";
import { enuToRenderer } from "../../../packages/geo/src/index.ts";
import { loadBundle } from "../../../packages/godot/src/load-bundle.ts";
import { headlessThree, installHeadlessDom, newShimUsage, stubRenderer } from "../../../packages/godot/src/headless-dom.ts";
import { buildScene } from "../gteki/scene.ts";
import { textureBudget } from "../../shinjuku/test/helpers/texture-memory.ts";

const stationDir = fileURLToPath(new URL("..", import.meta.url));
const asset = (uri: string) => new URL(`../gteki/${uri}`, import.meta.url);

// Only dimensions are needed: read the shipped PNG/WebP header, without an image decoder.
function imageSize(bytes: Buffer) {
  if (bytes.toString("ascii", 1, 4) === "PNG") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  expect(kind).toBe("VP8 ");
  return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
}

async function measure(quality: "low" | "high") {
  const usage = newShimUsage();
  const previousDocument = globalThis.document;
  installHeadlessDom(usage);
  vi.stubGlobal("self", globalThis);
  const ctx: SceneContext = {
    THREE: headlessThree(usage), bundle: await loadBundle(stationDir), quality,
    enuToRenderer, renderer: stubRenderer(), assetUrl: (uri) => asset(uri).href,
    loadTexture: async (uri, opts = {}) => {
      const texture = new THREE.Texture(imageSize(await readFile(asset(uri))));
      texture.colorSpace = opts.colorSpace === "linear" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.flipY = opts.flipY ?? true;
      return texture;
    },
    loadGlb: async (uri) => {
      const bytes = await readFile(asset(uri));
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(glbPrimitivePlugin);
      loader.register((parser: GLTFParser) => {
        const p = parser as unknown as {
          json: { images: { bufferView?: number; uri?: string }[] };
          loadImageSource(index: number): Promise<THREE.Texture>;
          getDependency(type: string, index: number): Promise<ArrayBuffer>;
        };
        p.loadImageSource = async (index) => {
          const image = p.json.images[index]!;
          const data = image.bufferView === undefined
            ? await readFile(new URL(image.uri!, asset(uri)))
            : Buffer.from(await p.getDependency("bufferView", image.bufferView));
          return new THREE.Texture(imageSize(data));
        };
        return { name: "texture_memory_dimensions" };
      });
      return new Promise<GLTF>((resolve, reject) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject));
    },
  };
  const scene = await buildScene(ctx);
  try {
    scene.update?.(0, 0);
    await scene.settled?.();
    return textureBudget(scene.root);
  } finally {
    scene.dispose();
    vi.unstubAllGlobals();
    globalThis.document = previousDocument;
  }
}

describe("ikebukuro texture memory", () => {
  for (const quality of ["low", "high"] as const) {
    it(`reports ${quality} quality by category`, async () => {
      const budget = await measure(quality);
      console.table(budget.byCategory.map((c) => ({ quality, category: c.category, textures: c.textures, MiB: Number(c.mib.toFixed(3)) })));
      console.log(`${quality}: ${budget.textureCount} textures, ${budget.totalMib.toFixed(3)} MiB total`);
      if (budget.other.length) console.log(`${quality}: unclassified`, budget.other.map((e) => e.label));
      expect(budget.totalBytes).toBeGreaterThan(0);
      if (quality === "low") {
        // LOW_TEXEL_SCALE 0.56 is the readability floor (0.50 failed); #180 real-phone shots decide further cuts.
        expect(Number(budget.byCategory.find((c) => c.category === "signage")!.mib.toFixed(3))).toBeLessThanOrEqual(54.707);
        expect(budget.byCategory.find((c) => c.category === "finish")!.mib).toBeLessThanOrEqual(40);
        expect(budget.totalMib).toBeLessThanOrEqual(112);
      } else {
        // Shipped scene measured before #276 on c2f6f0ee, including the settled catalog.
        // +#833 Seibu facade + floor board
        // +sharing the escalator atlas between the 5 ids: lighting drops by 4 copies of the 1024x1536 atlas (4 x 8 MiB)
        expect(budget.byCategory.map((c) => Number(c.mib.toFixed(3)))).toEqual([177.092, 0, 0, 0, 156.333, 0, 13.667, 53.257]);
        expect(Number(budget.totalMib.toFixed(3))).toBe(400.35);
      }
    }, 120_000);
  }
});
