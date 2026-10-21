import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Explorer } from "./explorer.ts";
import { explorerTargets } from "./raycast.ts";

describe("label occlusion proxies", () => {
  it("are walls and floors only: a hidden camera-only blocker never hides a POI label", () => {
    const plane = (y: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
      mesh.position.y = y;
      return mesh;
    };
    const floor = plane(0);
    const wall = plane(1);
    const blocker = plane(2.6);
    blocker.visible = false;
    const root = new THREE.Group().add(floor, wall, blocker);
    const t = explorerTargets([floor], [wall], [blocker]);
    // buildOccluders reads only these fields; call it on a stand-in rather than a WebGL-backed Explorer.
    const state = { occluders: [] as { mesh: THREE.Object3D }[], proxies: new Set<THREE.Object3D>(), cameraTargets: t.camera, skyTargets: t.sky, labelSweepDoneAt: 0 };
    (Explorer.prototype as unknown as { buildOccluders(this: typeof state, root: THREE.Object3D): void }).buildOccluders.call(state, root);
    expect([...state.proxies]).toEqual(expect.arrayContaining([floor, wall]));
    expect(state.proxies.has(blocker)).toBe(false);
    // Still a candidate, but only while drawn (it is hidden), as for any visual mesh.
    expect(state.occluders.map((o) => o.mesh)).toContain(blocker);
  });
});
