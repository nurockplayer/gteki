import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { occludedLineStyle } from "./occludedLine.ts";

const geo = () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0), new THREE.Vector3(3, 0, 4)]);

describe("occludedLineStyle", () => {
  it("builds a depth-tested solid pass and a dashed GreaterDepth pass below it", () => {
    const s = occludedLineStyle(0x5ef0ff, 0.9);
    const [dashed, solid] = s.lines(geo(), 6);
    expect(solid!.material).toBe(s.visible);
    expect(s.visible.depthTest).toBe(true);
    expect(s.visible.depthWrite).toBe(false);
    expect(dashed!.material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(s.occluded.depthTest).toBe(true);
    expect(s.occluded.depthFunc).toBe(THREE.GreaterDepth);
    expect(s.occluded.depthWrite).toBe(false);
    expect(s.occluded.opacity).toBeCloseTo(0.2);
    expect(s.occluded.color.getHex()).toBe(s.visible.color.getHex());
    expect(solid!.renderOrder).toBe(6);
    expect(dashed!.renderOrder).toBeLessThan(solid!.renderOrder);
  });

  it("computes line distances for the dashes", () => {
    const [dashed] = occludedLineStyle(0xffffff, 1).lines(geo(), 2);
    expect(Array.from(dashed!.geometry.getAttribute("lineDistance").array)).toEqual([0, 3, 7]);
  });

  it("x-ray restores the always-on-top look and drops the occluded pass", () => {
    const s = occludedLineStyle(0xffffff, 1);
    s.setXray(true);
    expect(s.visible.depthTest).toBe(false);
    expect(s.occluded.visible).toBe(false);
    s.setXray(false);
    expect(s.visible.depthTest).toBe(true);
    expect(s.occluded.visible).toBe(true);
  });
});
