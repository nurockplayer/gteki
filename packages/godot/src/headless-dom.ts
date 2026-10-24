/**
 * Minimal browser shims so a station's real `buildScene` runs under Node for the Godot scene snapshot.
 *
 * Everything here is a DEGRADATION, not an emulation: the 2D canvas records nothing (so every canvas-painted
 * texture is blank), PMREM yields an empty texture, and the renderer exposes only the two capability reads the
 * station scenes make. The exporter lists each shim it relied on in the sidecar `warnings`, so nothing produced
 * through them is presented as faithful. No canvas library is used.
 */
import * as THREE from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

/** What the station scenes asked of the shims; the exporter turns this into sidecar warnings. */
export interface ShimUsage {
  canvases: number;
  measuredTexts: number;
  imageDataReads: number;
  pmremEnvironments: number;
  placeholderTextures: string[];
  /** Distinct image sources in GLBs loaded through `ctx.loadGlb`, replaced by blank placeholders (not decoded). */
  glbEmbeddedImages: number;
  glbExternalImages: number;
}

export function newShimUsage(): ShimUsage {
  return { canvases: 0, measuredTexts: 0, imageDataReads: 0, pmremEnvironments: 0, placeholderTextures: [], glbEmbeddedImages: 0, glbExternalImages: 0 };
}

/**
 * GLTFLoader plugin that never decodes an image: every glTF image source becomes a blank `THREE.Texture`. Decoding
 * needs a browser (`self.URL`, `createImageBitmap` or an `<img>`); without this, a GLB with an image fails to load at
 * all under Node and the station falls back or skips the piece. The snapshot strips every texture anyway, so only the
 * slot and its sampling state matter.
 *
 * It replaces `parser.loadImageSource`, the one step every texture path shares: the core path and the built-in
 * EXT_texture_webp / EXT_texture_avif / KHR_texture_basisu handlers (which run before registered plugins) all go
 * through `loadTextureImage`, which still sets flipY, name and sampler, and `assignTexture` still sets channel and
 * colour space. A stub `ktx2Loader` keeps a required KHR_texture_basisu on that path instead of throwing. Each image
 * source is counted once, split into embedded (bufferView or data URI) and external URIs.
 */
export function headlessGltfTextures(usage: ShimUsage): (parser: GLTFParser) => GLTFLoaderPlugin {
  return (parser) => {
    const p = parser as unknown as {
      json: { images?: { uri?: string; bufferView?: number }[] };
      options: { ktx2Loader?: unknown };
      loadImageSource: (sourceIndex: number, loader: unknown) => Promise<THREE.Texture>;
    };
    const counted = new Set<number>();
    p.options.ktx2Loader ??= { gteki_headless_stub: true };
    p.loadImageSource = (sourceIndex) => {
      if (!counted.has(sourceIndex)) {
        counted.add(sourceIndex);
        const uri = p.json.images?.[sourceIndex]?.uri;
        if (typeof uri === "string" && !uri.startsWith("data:")) usage.glbExternalImages += 1;
        else usage.glbEmbeddedImages += 1;
      }
      const texture = new THREE.Texture();
      texture.userData.gteki_glb_placeholder = true;
      return Promise.resolve(texture);
    };
    return { name: "gteki_headless_textures" };
  };
}

/**
 * Text width for the no-op canvas: `measureText` drives sign sizes (Ikebukuro `signs.ts`), so a constant 0 would
 * collapse them. Approximation: 1 em per CJK/full-width character, 0.56 em otherwise, from the CSS `font` size.
 */
export function approximateTextWidth(font: string, text: string): number {
  const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  let em = 0;
  for (const ch of text) em += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹯＀-￯]/u.test(ch) ? 1 : 0.56;
  return em * px;
}

function noopContext(canvas: object, usage: ShimUsage): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas, font: "10px sans-serif" };
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  const methods: Record<string, unknown> = {
    measureText: (text: string) => {
      usage.measuredTexts += 1;
      return { width: approximateTextWidth(String(state.font), text) };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      usage.imageDataReads += 1;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
  };
  return new Proxy(state, {
    get: (target, prop: string) => (prop in methods ? methods[prop] : prop in target ? target[prop] : noop),
    set: (target, prop: string, value) => { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

/** Installs `document.createElement("canvas")` and the `FileReader` GLTFExporter needs for binary output. */
export function installHeadlessDom(usage: ShimUsage): void {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`headless DOM: createElement("${tag}") is not shimmed`);
      usage.canvases += 1;
      const canvas: Record<string, unknown> = { width: 300, height: 150, style: {} };
      canvas.getContext = () => noopContext(canvas, usage);
      return canvas;
    },
  };
  // GLTFExporter reads its Blob back through FileReader (a browser API, absent in Node).
  g.FileReader = class {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); }); }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`;
        this.onloadend?.();
      });
    }
  };
}

/** A renderer exposing only the capability reads station scenes make (`getMaxAnisotropy`, `maxTextureSize`). */
export function stubRenderer(): THREE.WebGLRenderer {
  return { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096, isWebGL2: true } } as unknown as THREE.WebGLRenderer;
}

/** `ctx.THREE` with PMREM stubbed (it needs a GPU). The environment texture is empty and never exported. */
export function headlessThree(usage: ShimUsage): typeof THREE {
  class StubPMREMGenerator {
    fromScene() {
      usage.pmremEnvironments += 1;
      return { texture: new THREE.Texture(), dispose() {} };
    }
    dispose() {}
  }
  return { ...THREE, PMREMGenerator: StubPMREMGenerator } as unknown as typeof THREE;
}
