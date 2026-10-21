import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OverviewLook } from "./overviewLook.ts";

describe("overview look", () => {
  it("drops fog and back faces in overview and restores both exactly", () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x111111, 25, 180);
    scene.fog = fog;
    const root = new THREE.Group();
    const ceiling = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const sign = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const shared = new THREE.Mesh(new THREE.PlaneGeometry(), ceiling);
    root.add(shared, new THREE.Mesh(new THREE.PlaneGeometry(), ceiling), new THREE.Mesh(new THREE.PlaneGeometry(), [sign, ceiling]));
    const look = new OverviewLook();
    look.set(scene, root, true);
    expect(scene.fog).toBeNull();
    expect(ceiling.side).toBe(THREE.FrontSide);
    expect(sign.side).toBe(THREE.BackSide);
    look.set(scene, root, true); // idempotent
    look.set(scene, root, false);
    expect(scene.fog).toBe(fog);
    expect(ceiling.side).toBe(THREE.DoubleSide);
    expect(sign.side).toBe(THREE.BackSide);
    expect(look.isActive).toBe(false);
  });
});
