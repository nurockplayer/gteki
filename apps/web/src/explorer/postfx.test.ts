import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { AO_AVATAR_HIDE_BELOW, AO_AVATAR_SHOW_FROM, FadeAwareGTAOPass, aoSkipsAvatar } from "./postfx.ts";

describe("aoSkipsAvatar", () => {
  it("keeps an opaque avatar in GTAO and drops a clearly dithered one", () => {
    expect(aoSkipsAvatar(1, false)).toBe(false);
    expect(aoSkipsAvatar(AO_AVATAR_HIDE_BELOW, false)).toBe(false);
    expect(aoSkipsAvatar(AO_AVATAR_HIDE_BELOW - 0.01, false)).toBe(true);
    expect(aoSkipsAvatar(0.25, false)).toBe(true);
  });

  it("returns only once the fade has recovered past the hysteresis band", () => {
    expect(aoSkipsAvatar(AO_AVATAR_HIDE_BELOW + 0.02, true)).toBe(true);
    expect(aoSkipsAvatar(AO_AVATAR_SHOW_FROM - 0.01, true)).toBe(true);
    expect(aoSkipsAvatar(AO_AVATAR_SHOW_FROM, true)).toBe(false);
    expect(aoSkipsAvatar(1, true)).toBe(false);
  });
});

describe("FadeAwareGTAOPass", () => {
  afterEach(() => vi.restoreAllMocks());

  const args = [null, null, null] as unknown as Parameters<GTAOPass["render"]>;
  const makePass = () => new FadeAwareGTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 8, 8);

  it("draws an opaque avatar into GTAO and hides a faded one for that draw only", () => {
    const seen: boolean[] = [];
    const avatar = new THREE.Group();
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { seen.push(avatar.visible); });
    const pass = makePass();
    for (const fade of [1, 0.5, 1]) {
      pass.setFade(avatar, fade);
      pass.render(...args);
    }
    expect(seen).toEqual([true, false, true]);
    expect(avatar.visible).toBe(true);
  });

  it("restores visibility even when the draw throws", () => {
    const avatar = new THREE.Group();
    vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => { throw new Error("boom"); });
    const pass = makePass();
    pass.setFade(avatar, 0.3);
    expect(() => pass.render(...args)).toThrow("boom");
    expect(avatar.visible).toBe(true);
  });

  it("draws everything when no avatar is registered", () => {
    const render = vi.spyOn(GTAOPass.prototype, "render").mockImplementation(() => {});
    const pass = makePass();
    pass.setFade(null, 0.1);
    pass.render(...args);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
