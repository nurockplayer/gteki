// Core lighting policy (presentation only): what the explorer sets on the renderer and scene for a station's
// `environment`. Kept pure so the default and scene-owned semantics are testable without a GL context.

/** Image-based light on `scene.environment` in default lighting, when the station sets no `envIntensity`. Low: the studio map is far brighter than the old hemisphere, and 0.9 washed out Shinjuku. */
export const DEFAULT_ENV_INTENSITY = 0.25;
/** Core hemisphere intensity: the environment light carries ambient, so this is below the old 1.1. */
export const HEMI_INTENSITY = 0.6;
/** Converts a station's `exposure` (tuned under ACES) to AgX, which reads darker at the same exposure. */
export const AGX_EXPOSURE_GAIN = 1.15;
/**
 * High-tier bloom threshold (linear luma). Under the environment light, lit white surfaces pass 1, so only
 * emitters above 2.5 glow. A scene-lit station without it keeps 1.0, the value its bake was balanced against.
 */
export const BLOOM_THRESHOLD = { environment: 2.5, scene: 1.0 } as const;

/** The slice of a scene's `environment` the lighting policy reads. */
export interface LightingEnv {
  exposure?: number;
  lighting?: "default" | "scene";
  envIntensity?: number;
}

export interface LightingPlan {
  mode: "default" | "scene";
  /** Core hemisphere + sun visible. */
  coreLights: boolean;
  hemiIntensity: number;
  /** Set `scene.environment` to the core environment map. */
  sceneEnvironment: boolean;
  /**
   * How the environment lights materials: "envMap" (`scene.environment`, PMREM diffuse + specular), "probe" (SH light probe,
   * diffuse only, low tier), or null (no environment). The low tier skips per-pixel PMREM lookups, which dominated its frame time.
   */
  environmentVia: "envMap" | "probe" | null;
  environmentIntensity: number;
  /** The avatar carries its own envMap (scene mode without `scene.environment`). */
  avatarEnvMap: boolean;
  toneMappingExposure: number;
  bloomThreshold: number;
}

/**
 * "default": hemisphere + sun + `scene.environment`. "scene": the scene owns lighting (lightmaps), so no core
 * lights and no `scene.environment` unless the station opts in with `envIntensity`, and the avatar keeps its
 * own envMap. A lightmapped station is therefore never double-lit by default. `quality` "low" routes the environment
 * through an SH light probe instead of `scene.environment` (`environmentVia`); `avatarEnvMap` is unaffected.
 */
export function resolveLighting(env?: LightingEnv, quality: "low" | "high" = "high"): LightingPlan {
  const mode = env?.lighting === "scene" ? "scene" : "default";
  // A scene-lit station opts in with a positive envIntensity; 0 there would leave the avatar unlit (no core lights, no own envMap).
  const sceneEnvironment = mode === "default" || (env?.envIntensity ?? 0) > 0;
  return {
    mode,
    coreLights: mode === "default",
    hemiIntensity: HEMI_INTENSITY,
    sceneEnvironment,
    environmentVia: !sceneEnvironment ? null : quality === "low" ? "probe" : "envMap",
    environmentIntensity: env?.envIntensity ?? DEFAULT_ENV_INTENSITY,
    avatarEnvMap: !sceneEnvironment,
    toneMappingExposure: (env?.exposure ?? 1) * AGX_EXPOSURE_GAIN,
    bloomThreshold: sceneEnvironment ? BLOOM_THRESHOLD.environment : BLOOM_THRESHOLD.scene,
  };
}
