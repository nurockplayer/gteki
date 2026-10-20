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
    expect(result.live).toBe(135);
    expect(result.bytes).toBe(11_570_910);
    // df6fb7e (adds the fare/access fences), with both ownership fixes disabled: the same 135
    // geometries, attribute/index bytes, transforms, visibility and instance matrices
    // (17,340 retired sources were still retained there). Update together with any geometry change.
    expect(result.geometryHash).toBe("bd0f0f068c3f5152d5fc05a38d2692d2e2cf120cc14265c8dd63ff5659abf82c");
  }, 60_000);
});
