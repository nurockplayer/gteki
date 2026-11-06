import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { FOLLOW, FOLLOW_CAT } from "./followCamera.ts";

afterEach(() => vi.unstubAllGlobals());

it("restores the human camera and marker when the cat fails", () => {
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
  const setCameraNearFade = vi.fn();
  const e = Object.create(Explorer.prototype) as any;
  Object.assign(e, { catAvatar: true, camDistance: FOLLOW_CAT.distance, pitch: FOLLOW_CAT.pitch, quality: "high", avatar: new THREE.Group(), avatarMarker: null, stationScene: { setCameraNearFade } });
  e.buildAvatarMarker();
  const oldMarker = e.avatarMarker as THREE.Mesh[];
  const geometryDispose = oldMarker.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
  const texture = (oldMarker[0]!.material as THREE.MeshBasicMaterial).map!;
  const textureDispose = vi.spyOn(texture, "dispose");
  e.fallBackToHumanAvatar();
  expect(e.catAvatar).toBe(false);
  expect(e.camDistance).toBe(FOLLOW.defaultDistance);
  expect(e.pitch).toBe(-0.12);
  expect(setCameraNearFade).toHaveBeenCalledWith(0, 0);
  expect(oldMarker.every((mesh) => mesh.parent === null)).toBe(true);
  expect(geometryDispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(e.avatarMarker[1].geometry.parameters).toMatchObject({ innerRadius: 0.46, outerRadius: 0.5 });
});
