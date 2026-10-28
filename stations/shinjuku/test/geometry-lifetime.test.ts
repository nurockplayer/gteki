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
    ], { timeout: 60_000 });
    const result = JSON.parse(stdout);
    expect(result.retired).toBeGreaterThan(30_000); // exercise the real PLATEAU and station merges
    expect(result.retained).toBe(0);
    expect(result.live).toBe(145); // #221: +3 render-only room floors (B1, B3, B6); vertical pass: +2 (risers, truss)
    expect(result.bytes).toBe(14_045_174); // vertical pass: +490,580 B riser planes and nosing lips; batch 3: +12,096 B contact shade + soffit luminaires
    // #49 retains two clipped render-only shell batches: +217,498 B and +5,055 triangles
    // after #316 stopped letting surfaces below the runs suppress the shell.
    // Removing only those batches reproduces the previous visual digest; all physical
    // buffers remain byte-identical (scene-digest.test.ts). Retired arrays stay collectible.
    expect(result.geometryHash).toBe("9dd1a6cb50f5baa60cc30228b31ca6574a9de869f8238b5bc8388763f24cfb09");
  }, 60_000);
});
