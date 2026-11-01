import * as THREE from "three";

type CanvasLike = { width: number; height: number };

/** A canvas (HTML or Offscreen) whose size can be set; an ImageBitmap or image element is left alone. */
function isCanvas(image: unknown): image is CanvasLike {
  return !!image && typeof image === "object" && typeof (image as { getContext?: unknown }).getContext === "function";
}

/**
 * Free the GL textures a station scene's materials reference, and optionally the backing store of the
 * canvases they were painted on. Called when the explorer leaves a station for another one; three re-uploads
 * a disposed texture that is used again, so this is safe for anything a cache still holds.
 */
export function releaseSceneTextures(root: THREE.Object3D, opts: { freeCanvases: boolean }): { textures: number; canvases: number } {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const key of Object.keys(m)) {
        const value = (m as unknown as Record<string, unknown>)[key] as THREE.Texture | null | undefined;
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  let canvases = 0;
  for (const texture of textures) {
    texture.dispose();
    if (!opts.freeCanvases || !(texture as { isCanvasTexture?: boolean }).isCanvasTexture) continue;
    const image = texture.image as unknown;
    if (!isCanvas(image)) continue;
    image.width = 0;
    image.height = 0;
    canvases++;
  }
  return { textures: textures.size, canvases };
}
