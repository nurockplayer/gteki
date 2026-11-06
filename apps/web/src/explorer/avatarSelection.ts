import * as THREE from "three";
import { createAvatar, type AvatarRig } from "./avatar.ts";
import { loadGlbAvatar, type AvatarGlbLoader } from "./avatarGlb.ts";
import { sanitizeAvatarFade } from "./avatarDither.ts";

/** #339 X1: Lane E's E1 asset will occupy this path; a missing asset safely keeps the procedural rig. */
export const DEFAULT_AVATAR_GLB_URL = "/avatars/commuter.glb";

/** #339: the soft commuter is opt-in (?avatar=soft); the Owner rejected it as the default on 2026-10-28. */
export const SOFT_AVATAR_GLB_URL = "/avatars/gteki-commuter-soft.glb";

/** URL reads belong to app.ts; accept only relative paths resolving within the app's origin. */
export function avatarGlbUrl(params: URLSearchParams, pageUrl: string): string | undefined {
  const mode = params.get("avatar");
  if (mode === "soft") return SOFT_AVATAR_GLB_URL;
  if (mode !== "glb") return undefined;
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

/** Which protagonist a page asks for; the human stays the default in stage 1. */
export type AvatarKind = "human" | "cat";

/** #854 scripted cat, picked by gteki-lead on 2026-11-06; a placeholder until the Owner sets breed and coat. */
export const CAT_AVATAR_GLB_URL = "/avatars/cat.glb";
export const CAT_AVATAR_HEIGHT_M = 0.345;

/** Cat mode draws nothing until its GLB arrives: the human must never appear there. */
function emptyRig(): AvatarRig {
  const root = new THREE.Group();
  return { root, update() {}, setEnvMap() {}, setFade() {}, dispose() { root.removeFromParent(); } };
}

/** `?avatar=cat` selects the cat; anything else keeps the human. */
export function avatarKind(params: URLSearchParams): AvatarKind {
  return params.get("avatar") === "cat" ? "cat" : "human";
}

export interface AvatarSelection extends AvatarRig {
  /** Invalidates in-flight work when leaving a station (or disposing). */
  cancelPendingLoad(): void;
  /** Starts/reuses the load for the current station; an already loaded avatar is retained. */
  loadGlb(): Promise<void>;
}

/** The human rig is shown while loading and on GLB failure; ?avatar=cat starts empty instead. */
export function createAvatarRig(opts: { quality: "low" | "high"; glbUrl?: string; loader?: AvatarGlbLoader; kind?: AvatarKind }): AvatarSelection {
  const cat = opts.kind === "cat";
  let current = cat ? emptyRig() : createAvatar({ quality: opts.quality });
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
      const url = cat ? CAT_AVATAR_GLB_URL : opts.glbUrl;
      if (disposed || loaded || !url) return Promise.resolve();
      if (pending) return pending;
      const token = ++generation;
      const load = cat ? { quality: opts.quality, loader: opts.loader, heightM: CAT_AVATAR_HEIGHT_M, cat: true } : opts;
      pending = loadGlbAvatar(url, load).then((next) => {
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
        if (disposed || token !== generation) return;
        // A broken cat GLB leaves nothing to draw, so cat mode falls back to the human once.
        if (cat) {
          loaded = true;
          const human = createAvatar({ quality: opts.quality });
          human.setFade(fade);
          human.setEnvMap(env, intensity);
          current.root.parent?.add(human.root);
          current.root.removeFromParent();
          current.dispose();
          current = human;
        }
        if (!warned) {
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
