import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Explorer } from "./explorer.ts";
import { CameraCut } from "./cameraCut.ts";
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

describe("label blocker classification", () => {
  /** A quad facing +z, `z` m along the view axis, `size` wide. */
  const quad = (z: number, size = 4) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.z = z;
    return mesh;
  };
  type Stand = { occluders: { mesh: THREE.Object3D }[]; proxies: Set<THREE.Object3D>; skyTargets: THREE.Object3D[]; signMeshes: Set<THREE.Object3D>; labelSweepDoneAt: number; scene: THREE.Scene; camera: THREE.PerspectiveCamera; cameraCut: CameraCut };
  const proto = Explorer.prototype as unknown as {
    buildOccluders(this: Stand, root: THREE.Object3D): void;
    refreshOccluders(this: Stand): void;
    labelOccluded(this: Stand, label: unknown): string;
  };
  /** Camera at z = 10 looking down -z; the label at z = 0. */
  const classify = (blockers: THREE.Mesh[], signs: THREE.Mesh[], previous = "none") => {
    const scene = new THREE.Scene();
    const root = new THREE.Group().add(...blockers);
    scene.add(root);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    camera.position.set(0, 0, 10);
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const state: Stand = { occluders: [], proxies: new Set(), skyTargets: [], signMeshes: new Set(signs), labelSweepDoneAt: 0, scene, camera, cameraCut: new CameraCut() };
    proto.buildOccluders.call(state, root);
    proto.refreshOccluders.call(state);
    const obj = new THREE.Object3D();
    scene.add(obj);
    obj.updateMatrixWorld(true);
    return proto.labelOccluded.call(state, { obj, occluded: previous });
  };

  it("reports none, geometry or sign by what the view ray meets", () => {
    const wall = quad(5);
    const sign = quad(4);
    expect(classify([], [])).toBe("none");
    expect(classify([wall], [])).toBe("geometry");
    expect(classify([sign], [sign])).toBe("sign");
  });

  it("reports geometry when a wall stands anywhere along a ray a sign also blocks", () => {
    const sign = quad(8);
    expect(classify([sign, quad(2)], [sign])).toBe("geometry");
    expect(classify([quad(2), sign], [sign])).toBe("geometry");
  });

  it.each([
    [0.1, "sign"],
    [-0.3, "sign"],
    [-1, "none"],
  ])("classifies a sign at z = %s as %s", (z, expected) => {
    const sign = quad(z);
    expect(classify([sign], [sign])).toBe(expected);
  });

  it.each([-0.3, 0.1])("ignores a wall at z = %s within or behind the anchor margin", (z) => {
    expect(classify([quad(z)], [])).toBe("none");
  });

  it("ignores a sign the ray misses", () => {
    const sign = quad(4, 0.2);
    sign.position.x = 3;
    expect(classify([sign], [sign])).toBe("none");
  });
});

