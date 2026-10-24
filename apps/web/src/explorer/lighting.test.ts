import { describe, expect, it } from "vitest";
import { AGX_EXPOSURE_GAIN, BLOOM_THRESHOLD, DEFAULT_ENV_INTENSITY, HEMI_INTENSITY, resolveLighting } from "./lighting.ts";

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
    expect(resolveLighting({ lighting: "scene", envIntensity: 0 })).toMatchObject({ sceneEnvironment: false, avatarEnvMap: true });
    const p = resolveLighting({ lighting: "scene", envIntensity: 0.25 });
    expect(p).toMatchObject({ coreLights: false, sceneEnvironment: true, environmentIntensity: 0.25, avatarEnvMap: false });
  });

  it("scales exposure for AgX and defaults it to 1", () => {
    expect(resolveLighting().toneMappingExposure).toBeCloseTo(AGX_EXPOSURE_GAIN);
    expect(resolveLighting({ exposure: 0.92 }).toneMappingExposure).toBeCloseTo(0.92 * AGX_EXPOSURE_GAIN);
    expect(resolveLighting({ lighting: "scene", exposure: 1.0 }).toneMappingExposure).toBeCloseTo(AGX_EXPOSURE_GAIN);
  });

  it("keeps a scene-lit station's bloom threshold unless it opts into the environment light", () => {
    expect(resolveLighting().bloomThreshold).toBe(BLOOM_THRESHOLD.environment);
    expect(resolveLighting({ lighting: "scene" }).bloomThreshold).toBe(BLOOM_THRESHOLD.scene);
    expect(resolveLighting({ lighting: "scene", envIntensity: 0.2 }).bloomThreshold).toBe(BLOOM_THRESHOLD.environment);
  });

  it("routes the environment through an envMap on the high tier and a probe on the low tier", () => {
    expect(resolveLighting().environmentVia).toBe("envMap");
    expect(resolveLighting({}, "high").environmentVia).toBe("envMap");
    expect(resolveLighting({}, "low")).toMatchObject({ environmentVia: "probe", sceneEnvironment: true, environmentIntensity: DEFAULT_ENV_INTENSITY });
    expect(resolveLighting({ envIntensity: 0.3 }, "low")).toMatchObject({ environmentVia: "probe", environmentIntensity: 0.3 });
  });

  it("has no environment path when the scene has no environment, on either tier", () => {
    for (const quality of ["low", "high"] as const) {
      expect(resolveLighting({ lighting: "scene" }, quality)).toMatchObject({ environmentVia: null, sceneEnvironment: false, avatarEnvMap: true });
      expect(resolveLighting({ lighting: "scene", envIntensity: 0 }, quality).environmentVia).toBeNull();
    }
  });

  it("lets a scene-lit station opt into the probe on the low tier, and keeps the avatar off its own envMap then", () => {
    expect(resolveLighting({ lighting: "scene", envIntensity: 0.25 }, "low")).toMatchObject({ environmentVia: "probe", environmentIntensity: 0.25, avatarEnvMap: false });
  });

  it("does not change the rest of the plan with quality", () => {
    const { environmentVia: _a, ...high } = resolveLighting({ exposure: 0.9 }, "high");
    const { environmentVia: _b, ...low } = resolveLighting({ exposure: 0.9 }, "low");
    expect(low).toEqual(high);
  });
});
