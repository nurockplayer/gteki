// Finish packs: an empty manifest leaves the procedural materials alone; an entry loads through ctx.loadTexture.
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import finishManifest from "./finishes.json";
import { type FinishManifest, loadFinishPacks } from "./finishes.ts";
import { createMaterials } from "./materials.ts";

// materials.ts paints canvases; a recording-free 2D context is enough to build the textures without a DOM.
const realDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target ? target[key]
        : key === "createLinearGradient" || key === "createRadialGradient" ? () => ({ addColorStop() {} })
        : key === "getImageData" || key === "createImageData" ? (_x: number, w: number, h?: number) => ({ data: new Uint8ClampedArray(w * (h ?? w) * 4) })
        : () => undefined,
    set: (target, key: string, value) => ((target[key] = value), true),
  });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

/** The host side of ctx: files the station folder holds, and the explorer's loadTexture colour space and flip rules. */
function host(files: string[], pixels = 1024) {
  const loadTexture = vi.fn(async (uri: string, opts: { colorSpace?: "srgb" | "linear"; flipY?: boolean } = {}) => {
    const t = new THREE.Texture({ width: pixels, height: pixels } as unknown as HTMLImageElement);
    t.colorSpace = opts.colorSpace === "linear" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.flipY = opts.flipY ?? true;
    t.name = uri;
    return t;
  });
  const assetUrl = vi.fn((uri: string) => (files.includes(uri) ? `/blob/${uri}` : null));
  return { assetUrl, loadTexture };
}

const FLOOR_FILES = ["albedo.webp", "normal.webp", "roughness.webp"].map((f) => `assets/finishes/floor/${f}`);
const floorPack = { dir: "assets/finishes/floor", repeat_m: 1.2, maps: { albedo: "albedo.webp", normal: "normal.webp", roughness: "roughness.webp" } };
const manifest = (packs: FinishManifest["packs"]): FinishManifest => ({ packs });
const std = (m: THREE.Material) => m as THREE.MeshStandardMaterial;
const px = (t: THREE.Texture | null) => (t!.image as { width: number }).width;

describe("empty finishes manifest (the default)", () => {
  it("ships empty, and never touches the host", async () => {
    expect(finishManifest.packs).toEqual({});
    const h = host(FLOOR_FILES);
    const loaded = await loadFinishPacks(THREE, h, finishManifest as FinishManifest, false);
    expect(loaded.packs).toEqual({});
    expect(h.assetUrl).not.toHaveBeenCalled();
    expect(h.loadTexture).not.toHaveBeenCalled();
  });

  it("builds today's procedural materials (high tier)", () => {
    const { byRole } = createMaterials(THREE, false, {});
    const floor = std(byRole.floor!);
    expect(floor.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(px(floor.map)).toBe(1024);
    expect(floor.map!.repeat.x).toBeCloseTo(1 / 2.4);
    expect(floor.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(floor.roughnessMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(px(floor.roughnessMap)).toBe(512);
    expect(floor.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(floor.normalMap).toBeInstanceOf(THREE.CanvasTexture);
    expect(floor.roughness).toBe(1);
    expect(std(byRole.ceiling!).map!.repeat.x).toBeCloseTo(1 / 2.4);
    expect(std(byRole.ceiling!).roughness).toBe(0.95);
    expect(std(byRole.stairs_ramps!).map!.repeat.x).toBeCloseTo(1 / 1.2);
    expect(px(std(byRole.stairs_ramps!).map)).toBe(512);
    expect(std(byRole.wall!).color.getHex()).toBe(0xdedee0);
    expect(std(byRole.wall!).roughness).toBe(0.42);
    expect(std(byRole.barriers!).color.getHex()).toBe(0xc6cacf);
    expect(std(byRole.windows!).map).toBe(std(byRole.windows!).emissiveMap);
    expect(px(std(byRole.windows!).map)).toBe(256);
    expect(std(byRole.windows!).roughness).toBe(0.15);
    expect(std(byRole.doors!).roughness).toBe(0.2);
  });

  it("builds today's low-tier textures: half size, no relief maps", () => {
    const { byRole } = createMaterials(THREE, true, {});
    expect(px(std(byRole.floor!).map)).toBe(512);
    expect(std(byRole.floor!).normalMap).toBeNull();
    expect(std(byRole.ceiling!).normalMap).toBeNull();
    expect(std(byRole.stairs_ramps!).normalMap).toBeNull();
  });

  it("defaults the packs argument, so the two-argument call is the same", () => {
    const a = createMaterials(THREE, false);
    const b = createMaterials(THREE, false, {});
    for (const role of Object.keys(a.byRole)) expect(a.byRole[role]!.constructor).toBe(b.byRole[role]!.constructor);
    expect(std(a.byRole.floor!).roughness).toBe(std(b.byRole.floor!).roughness);
  });
});

describe("a finish pack entry", () => {
  it("loads through ctx.loadTexture with colour spaces, the repeat in metres, and no procedural floor texture", async () => {
    const h = host(FLOOR_FILES);
    const loaded = await loadFinishPacks(THREE, h, manifest({ floor: floorPack }), false);
    expect(h.loadTexture.mock.calls.map(([uri, opts]) => [uri, opts]).sort()).toEqual([
      ["assets/finishes/floor/albedo.webp", { colorSpace: "srgb", flipY: true }],
      ["assets/finishes/floor/normal.webp", { colorSpace: "linear", flipY: true }],
      ["assets/finishes/floor/roughness.webp", { colorSpace: "linear", flipY: true }],
    ]);
    const pack = loaded.packs.floor!;
    for (const t of [pack.map!, pack.normalMap!, pack.roughnessMap!]) {
      expect(t.repeat.toArray()).toEqual([1 / 1.2, 1 / 1.2]);
      expect(t.wrapS).toBe(THREE.RepeatWrapping);
      expect(t.wrapT).toBe(THREE.RepeatWrapping);
    }
    expect(pack.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(pack.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(pack.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);

    const mats = createMaterials(THREE, false, loaded.packs);
    const floor = std(mats.byRole.floor!);
    expect(floor.map).toBe(pack.map);
    expect(floor.normalMap).toBe(pack.normalMap);
    expect(floor.roughnessMap).toBe(pack.roughnessMap);
    expect(floor.roughness).toBe(1);
    expect(floor.envMapIntensity).toBeCloseTo(0.35);
    // other roles keep their procedural textures
    expect(std(mats.byRole.ceiling!).map).toBeInstanceOf(THREE.CanvasTexture);
    // pack textures belong to the loader: disposing the materials leaves them alone, loaded.dispose() frees them
    const spy = vi.spyOn(pack.map!, "dispose");
    mats.dispose();
    expect(spy).not.toHaveBeenCalled();
    loaded.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("takes a rectangular repeat, an ORM map as the roughness map, and a roughness factor without one", async () => {
    const h = host(["assets/finishes/ceil/a.png", "assets/finishes/ceil/orm.png", "assets/finishes/stairs/a.png"]);
    const loaded = await loadFinishPacks(THREE, h, manifest({
      ceiling: { dir: "assets/finishes/ceil", repeat_m: [2.4, 0.6], maps: { albedo: "a.png", orm: "orm.png" } },
      stairs_ramps: { dir: "assets/finishes/stairs", repeat_m: 0.6, maps: { albedo: "a.png" } },
    }), false);
    expect(loaded.packs.ceiling!.map!.repeat.toArray()).toEqual([1 / 2.4, 1 / 0.6]);
    expect(loaded.packs.ceiling!.roughnessMap!.name).toBe("assets/finishes/ceil/orm.png");
    const mats = createMaterials(THREE, false, loaded.packs);
    expect(std(mats.byRole.ceiling!).roughnessMap).toBe(loaded.packs.ceiling!.roughnessMap);
    expect(std(mats.byRole.stairs_ramps!).roughnessMap).toBeNull();
    expect(std(mats.byRole.stairs_ramps!).roughness).toBe(0.7);
  });

  it("does not fetch relief maps on the low tier, and prefers a `low` variant", async () => {
    const h = host([...FLOOR_FILES, "assets/finishes/floor/albedo_512.webp"]);
    const loaded = await loadFinishPacks(THREE, h, manifest({ floor: { ...floorPack, low: { albedo: "albedo_512.webp" } } }), true);
    expect(h.loadTexture.mock.calls.map(([uri]) => uri).sort()).toEqual(["assets/finishes/floor/albedo_512.webp", "assets/finishes/floor/roughness.webp"]);
    expect(loaded.packs.floor!.normalMap).toBeNull();
  });

  it("holds the low tier to 1k textures: a bigger image drops the pack back to the procedural texture", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = host(FLOOR_FILES, 2048);
    expect((await loadFinishPacks(THREE, h, manifest({ floor: floorPack }), true)).packs).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("floor"));
    expect((await loadFinishPacks(THREE, h, manifest({ floor: floorPack }), false)).packs.floor).toBeDefined(); // high tier takes 2k
    warn.mockRestore();
  });

  it("falls back, with a warning, when a file is not in the station folder or the manifest entry is bad", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = host(["assets/finishes/floor/albedo.webp"]); // normal and roughness missing
    const loaded = await loadFinishPacks(THREE, h, manifest({
      floor: floorPack,
      ceiling: { dir: "assets/finishes/ceil", repeat_m: 0, maps: { albedo: "a.webp" } },
      stairs_ramps: { dir: "../outside", repeat_m: 1, maps: { albedo: "a.webp" } },
      wall: { dir: "assets/finishes/wall", repeat_m: 1 }, // neither albedo nor colour
      barriers: { dir: "assets/finishes/b", repeat_m: 1, color: "red" },
      nonsense: floorPack,
    } as FinishManifest["packs"]), false);
    expect(loaded.packs).toEqual({});
    expect(warn).toHaveBeenCalledTimes(6);
    const mats = createMaterials(THREE, false, loaded.packs);
    expect(std(mats.byRole.floor!).map).toBeInstanceOf(THREE.CanvasTexture);
    warn.mockRestore();
  });

  it("recolours wall and barriers from the manifest, and tints a textured wall white by default", async () => {
    const h = host(["assets/finishes/wall/a.webp"]);
    const loaded = await loadFinishPacks(THREE, h, manifest({
      barriers: { dir: "assets/finishes/b", repeat_m: 1, color: "#8090a0" },
      wall: { dir: "assets/finishes/wall", repeat_m: 1.2, maps: { albedo: "a.webp" } },
    }), false);
    const { byRole } = createMaterials(THREE, false, loaded.packs);
    expect(std(byRole.barriers!).color.getHex()).toBe(0x8090a0);
    expect(std(byRole.barriers!).map).toBeNull();
    expect(std(byRole.barriers!).roughness).toBe(0.3);
    expect(std(byRole.wall!).color.getHex()).toBe(0xffffff);
    expect(std(byRole.wall!).map).toBe(loaded.packs.wall!.map);
  });

  it("drives both glazed roles from one shopfront pack, albedo doubling as the emissive map", async () => {
    const h = host(["assets/finishes/shop/a.webp"]);
    const loaded = await loadFinishPacks(THREE, h, manifest({ shopfront: { dir: "assets/finishes/shop", repeat_m: 2.4, maps: { albedo: "a.webp" } } }), false);
    const { byRole } = createMaterials(THREE, false, loaded.packs);
    for (const role of ["windows", "doors"]) {
      const m = std(byRole[role]!);
      expect(m.map).toBe(loaded.packs.shopfront!.map);
      expect(m.emissiveMap).toBe(loaded.packs.shopfront!.map);
    }
    expect(std(byRole.windows!).emissiveIntensity).toBeCloseTo(1.15);
    expect(std(byRole.doors!).emissiveIntensity).toBeCloseTo(1.35);
  });
});
