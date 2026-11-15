import { LoaderUtils } from "three";
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Decode precompressed build assets while retaining the loader's plugins and resource fence. */
export async function fetchGlb(loader: GLTFLoader, url: string): Promise<GLTF> {
  if (!url.endsWith(".gz")) return loader.loadAsync(url);
  const resolved = loader.manager.resolveURL(url);
  loader.manager.itemStart(resolved);
  try {
    const response = await fetch(resolved);
    if (!response.ok) throw new Error(`GLB fetch failed: ${response.status} ${resolved}`);
    // Fetch already decodes Content-Encoding (Vite preview sets it on .gz files).
    const body = response.headers.get("Content-Encoding") === "gzip"
      ? response.body!
      : response.body!.pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(body).arrayBuffer();
    return await loader.parseAsync(buffer, loader.resourcePath || LoaderUtils.extractUrlBase(url));
  } catch (error) {
    loader.manager.itemError(resolved);
    throw error;
  } finally {
    loader.manager.itemEnd(resolved);
  }
}
