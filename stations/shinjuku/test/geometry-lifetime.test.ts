import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeRetiredGeometries } from "../scene/build.ts";

const run = promisify(execFile);

describe("station geometry lifetime", () => {
  it("retires replaced geometry while preserving shared, nested and instanced meshes", () => {
    const root = new THREE.Group(), nested = new THREE.Group();
    const live = new THREE.BoxGeometry(), retired = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const other = { dispose: vi.fn() };
    root.add(nested);
    nested.add(new THREE.Mesh(live, material), new THREE.InstancedMesh(live, material, 2));
    const liveDispose = vi.spyOn(live, "dispose"), retiredDispose = vi.spyOn(retired, "dispose");
    const attributes = { ...live.attributes }, index = live.index;
    const resources = [live, retired, material, other];
    disposeRetiredGeometries(root, resources);
    expect(resources).toEqual([live, material, other]);
    expect(retiredDispose).toHaveBeenCalledOnce();
    expect(liveDispose).not.toHaveBeenCalled();
    expect(other.dispose).not.toHaveBeenCalled();
    expect(live.attributes).toEqual(attributes);
    expect(live.index).toBe(index);
    for (const [key, attribute] of Object.entries(attributes)) expect(live.attributes[key]).toBe(attribute);
    // Retained CPU arrays still support a new GPU upload and Three's raycaster.
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObjects(root.children, true).length).toBeGreaterThan(0);
    disposeRetiredGeometries(root, resources);
    expect(retiredDispose).toHaveBeenCalledOnce();
    live.dispose();
    material.dispose();
    nested.children.forEach((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
  });

  it("collects merged source arrays while keeping final geometry byte-identical", async () => {
    const { stdout } = await run(process.execPath, [
      "--expose-gc", "--import", "tsx", fileURLToPath(new URL("./helpers/retained-geometry.ts", import.meta.url)),
    ], { timeout: 180_000 });
    const result = JSON.parse(stdout);
    expect(result.retired).toBeGreaterThan(30_000); // exercise the real PLATEAU and station merges
    expect(result.retained).toBe(0);
    // #968: no closure defined inside assembleScene is reachable from the returned scene, so its scope (the
    // layout copy, the built station, every intermediate array) is collected while the scene is still held.
    expect(result.sceneScopeCollected).toBe(true);
    // #789 (2026-11-04 JST): geometry remeasured after repairing the node display heights.
    expect(result.live).toBe(146); // #221: +3 render-only room floors (B1, B3, B6); vertical pass: +2 (risers, truss)
    // #645 step 2c: lift-door clearances split two restricted boundaries (+5,184 B); the shaft-geometry
    // cut of the join:/return: pieces inside a stop square then removes 44,592 B.
    expect(result.bytes).toBe(16493354); // vertical pass: +490,580 B riser planes and nosing lips; batch 3: +39,792 B contact-shade colours + soffit luminaires
    // #49 retains two clipped render-only shell batches: +217,498 B and +5,055 triangles
    // after #316 stopped letting surfaces below the runs suppress the shell.
    // #789 updates the expected buffers for the repaired display heights; the
    // scene-digest fixture records those changes. Retired arrays stay collectible.
    // #342 (2026-11-06 JST): only the identity faces and hardware moved.
    // #870 (2026-11-06 JST): platform door panels and caps split around the aligned openings (+3,360 B).
    expect(result.geometryHash).toBe("7fd032a462e68a4c359031f275609c2ac24eecf7fc94785efcbac74119c21534");
  }, 180_000);
});
