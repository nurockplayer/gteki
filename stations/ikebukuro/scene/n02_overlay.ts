// KSJ N02-2025 context only: no labels, track level, walking or collision meaning.
import type * as THREE_NS from "three";
import type { SceneContext } from "@gteki/scene-api";

type ThreeNS = typeof THREE_NS;
type Host = Pick<SceneContext, "assetUrl" | "loadGlb">;

export const N02_GLB = "context/ksj_n02_2025_r700.glb";
export const N02_OFFSET_M = 0.02;
// context.ts leaves street road meshes at three's default renderOrder (0).
export const N02_RENDER_ORDER = 1;
export const N02_COLORS = { railway: 0x475766, station: 0x738392 } as const;

export function createN02Material(THREE: ThreeNS, kind: keyof typeof N02_COLORS): THREE_NS.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: N02_COLORS[kind], side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.name = `ctx_n02_${kind}`;
  return material;
}

/** GLB vertices already use renderer metres (x, z, -y); retain geometry, names and provenance extras. */
export function dressN02Overlay(THREE: ThreeNS, scene: THREE_NS.Object3D): () => void {
  const materials = { railway: createN02Material(THREE, "railway"), station: createN02Material(THREE, "station") };
  const original = new Set<THREE_NS.Material>();
  const geometries = new Set<THREE_NS.BufferGeometry>();
  scene.traverse((o) => {
    const mesh = o as THREE_NS.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) original.add(m);
    mesh.material = materials[mesh.userData.kind === "station" ? "station" : "railway"];
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = N02_RENDER_ORDER;
  });
  for (const m of original) m.dispose();
  // Scene-side offset only: never alter the source vertices or the GLB's z basis.
  scene.position.y += N02_OFFSET_M;
  scene.visible = false;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    scene.removeFromParent();
    for (const g of geometries) g.dispose();
    for (const m of Object.values(materials)) m.dispose();
  };
}

/** Background load with an explicit shared street-context gate; even a late load is freed on teardown. */
export function loadN02Overlay(THREE: ThreeNS, host: Host, root: THREE_NS.Object3D) {
  let scene: THREE_NS.Object3D | null = null;
  let release: (() => void) | null = null;
  let disposed = false;
  let visible = false;
  const setVisible = (show: boolean) => {
    visible = show && !disposed;
    if (!scene) return;
    if (visible && scene.parent !== root) root.add(scene);
    else if (!visible) scene.removeFromParent();
    scene.visible = visible;
  };
  const ready = (async () => {
    try {
      if (host.assetUrl(N02_GLB) === null) throw new Error(`${N02_GLB} is not in the station folder`);
      const loaded = await host.loadGlb(N02_GLB);
      release = dressN02Overlay(THREE, loaded.scene);
      if (disposed) { release(); return; }
      scene = loaded.scene;
      setVisible(visible);
    } catch (err) {
      release?.();
      console.warn(`[ikebukuro] N02 context: ${err instanceof Error ? err.message : String(err)}; skipping overlay`);
    }
  })();
  return {
    ready,
    setVisible,
    dispose() {
      disposed = true;
      setVisible(false);
      release?.();
    },
  };
}
