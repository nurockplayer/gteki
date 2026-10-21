import { describe, expect, it } from "vitest";
import { AGX_EXPOSURE_GAIN, DEFAULT_ENV_INTENSITY, HEMI_INTENSITY, resolveLighting } from "./lighting.ts";

describe("core lighting plan", () => {
  it("lights a default station with core lights and the environment at the default intensity", () => {
    for (const env of [undefined, {}, { lighting: "default" as const }]) {
      const p = resolveLighting(env);
      expect(p).toMatchObject({ mode: "default", coreLights: true, hemiIntensity: HEMI_INTENSITY, sceneEnvironment: true, environmentIntensity: DEFAULT_ENV_INTENSITY, avatarEnvMap: false });
    }
  });

  it("takes the station's envIntensity in default lighting", () => {
    expect(resolveLighting({ envIntensity: 0.3 }).environmentIntensity).toBe(0.3);
    expect(resolveLighting({ envIntensity: 0 })).toMatchObject({ sceneEnvironment: true, environmentIntensity: 0 });
  });

  it("never double-lights a scene-lit station by default", () => {
    const p = resolveLighting({ lighting: "scene", exposure: 1 });
    expect(p).toMatchObject({ mode: "scene", coreLights: false, sceneEnvironment: false, avatarEnvMap: true });
  });

  it("gives a scene-lit station the environment only when it sets envIntensity", () => {
    const p = resolveLighting({ lighting: "scene", envIntensity: 0.25 });
    expect(p).toMatchObject({ coreLights: false, sceneEnvironment: true, environmentIntensity: 0.25, avatarEnvMap: false });
  });

  it("scales exposure for AgX and defaults it to 1", () => {
    expect(resolveLighting().toneMappingExposure).toBeCloseTo(AGX_EXPOSURE_GAIN);
    expect(resolveLighting({ exposure: 0.92 }).toneMappingExposure).toBeCloseTo(0.92 * AGX_EXPOSURE_GAIN);
    expect(resolveLighting({ lighting: "scene", exposure: 1.0 }).toneMappingExposure).toBeCloseTo(AGX_EXPOSURE_GAIN);
  });
});
