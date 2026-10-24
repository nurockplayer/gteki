import * as THREE from "three";
import { createAvatar, type AvatarRig } from "./avatar.ts";
import { loadGlbAvatar, type AvatarGlbLoader } from "./avatarGlb.ts";
import { sanitizeAvatarFade } from "./avatarDither.ts";

/** #339 X1: Lane E's E1 asset will occupy this path; a missing asset safely keeps the procedural rig. */
export const DEFAULT_AVATAR_GLB_URL = "/avatars/commuter.glb";

/** URL reads belong to app.ts; accept only relative paths resolving within the app's origin. */
export function avatarGlbUrl(params: URLSearchParams, pageUrl: string): string | undefined {
  if (params.get("avatar") !== "glb") return undefined;
  const path = params.get("avatarUrl") ?? DEFAULT_AVATAR_GLB_URL;
  if (!path || path !== path.trim() || /^[a-z][a-z\d+.-]*:|^\/\/|^[?#]/i.test(path) || /[\\\u0000-\u0020\u007f]/.test(path)) return undefined;
  try {
    const base = new URL(pageUrl);
    const url = new URL(path, base);
    // Dot-segment normalization can expose a leading //; never return a protocol-relative loader URL.
    if (url.origin !== base.origin || url.pathname.startsWith("//") || !["http:", "https:"].includes(url.protocol)) return undefined;
    return url.pathname + url.search;
  } catch { return undefined; }
}

export interface AvatarSelection extends AvatarRig {
  /** Invalidates in-flight work when leaving a station (or disposing). */
  cancelPendingLoad(): void;
  /** Starts/reuses the load for the current station; an already loaded avatar is retained. */
  loadGlb(): Promise<void>;
}

/** A procedural rig is available synchronously; only a validated, still-current GLB can replace it. */
export function createAvatarRig(opts: { quality: "low" | "high"; glbUrl?: string; loader?: AvatarGlbLoader }): AvatarSelection {
  let current = createAvatar({ quality: opts.quality });
  let generation = 0;
  let disposed = false;
  let loaded = false;
  let warned = false;
  let pending: Promise<void> | null = null;
  let fade = 1;
  let env: THREE.Texture | null = null;
  let intensity = 0.6;
  const selection: AvatarSelection = {
    get root() { return current.root; },
    update(dt, speed) { if (!disposed) current.update(dt, speed); },
    setFade(value) { fade = sanitizeAvatarFade(value); if (!disposed) current.setFade(fade); },
    setEnvMap(value, strength = 0.6) { env = value; intensity = strength; if (!disposed) current.setEnvMap(env, intensity); },
    cancelPendingLoad() { generation++; pending = null; },
    loadGlb() {
      if (disposed || loaded || !opts.glbUrl) return Promise.resolve();
      if (pending) return pending;
      const token = ++generation;
      pending = loadGlbAvatar(opts.glbUrl, opts).then((next) => {
        if (disposed || token !== generation) { next.dispose(); return; }
        next.setFade(fade);
        next.setEnvMap(env, intensity);
        const previous = current;
        previous.root.parent?.add(next.root);
        previous.root.removeFromParent();
        current = next;
        loaded = true;
        previous.dispose();
      }).catch((error: unknown) => {
        if (!disposed && token === generation && !warned) {
          warned = true;
          console.warn("GLB avatar unavailable; keeping the procedural avatar.", error);
        }
      });
      return pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      selection.cancelPendingLoad();
      current.root.removeFromParent();
      current.dispose();
    },
  };
  void selection.loadGlb();
  return selection;
}
