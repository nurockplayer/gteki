import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";

const { bundle } = loadShinjukuBundle();
type HookScene = StationScene & { cameraBlockers?: THREE.Object3D[] };

describe("shared-explorer scene hook: camera caps", () => {
  let scene: HookScene;
  let layoutZ: Map<string, number>;
  beforeAll(async () => {
    // Geometry only: stub canvas drawing as the enclosure test does.
    const context = new Proxy({}, { get: (_t, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    scene = (await buildScene({ THREE, bundle, quality: "low" } as never)) as HookScene;
    layoutZ = new Map(bundle.nodes.map((n) => [n.id, n.renderZ ?? 0]));
    scene.root.updateMatrixWorld(true);
  }, 60_000);
  afterAll(() => {
    scene?.dispose();
    vi.unstubAllGlobals();
  });

  it("exports the underground ceiling caps as camera blockers and (until the explorer reads them) colliders", () => {
    const caps = scene.cameraBlockers ?? [];
    expect(caps.length).toBe(1);
    expect(scene.colliders).toContain(caps[0]);
    expect((caps[0] as THREE.Mesh).material).toMatchObject({ visible: false, side: THREE.DoubleSide });
  });

  it("caps the follow camera above underground nodes (except lift shafts and exit stairs open to the sky)", () => {
    const ray = new THREE.Raycaster();
    // The explorer's follow camera raycasts colliders + walkable (+ cameraBlockers once supported).
    const blockers = [...scene.cameraBlockers!, ...scene.walkable];
    const visible: THREE.Object3D[] = [];
    scene.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && !Array.isArray(m.material) && m.material.visible !== false) visible.push(m); });
    const open: string[] = [];
    for (const n of bundle.nodes) {
      const z = layoutZ.get(n.id)!;
      if (z >= -0.5 || n.kind === "elevator") continue; // a lift shaft is open vertically by design
      const eye = new THREE.Vector3(n.position.x, z + 1.62, -n.position.y);
      ray.set(eye, new THREE.Vector3(0, 1, 0));
      ray.far = 6;
      if (ray.intersectObjects(blockers, false).length) continue;
      // Exit stairwells open to the street: allowed only near street level, with nothing drawn overhead
      // below street level (a canopy above street level is fine).
      ray.far = 60;
      const first = ray.intersectObjects(visible, false)[0];
      if (z >= -4.5 && (!first || first.point.y >= -0.05)) continue;
      open.push(`${n.id} ${n.floorId} z${z}`);
    }
    expect(open).toEqual([]);
  }, 60_000);

  it("never blocks the walker's horizontal rays along any graph edge", () => {
    const ray = new THREE.Raycaster();
    const caps = scene.cameraBlockers!;
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const hits: string[] = [];
    for (const e of bundle.edges) {
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      const za = layoutZ.get(a.id)!, zb = layoutZ.get(b.id)!;
      const len = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
      if (len < 0.3) continue;
      const dir = new THREE.Vector3(b.position.x - a.position.x, 0, -(b.position.y - a.position.y)).normalize();
      const n = Math.ceil(len / 0.5);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const p = new THREE.Vector3(a.position.x + (b.position.x - a.position.x) * t, za + (zb - za) * t, -(a.position.y + (b.position.y - a.position.y) * t));
        for (const h of [0.5, 1.2]) {
          ray.set(p.clone().add(new THREE.Vector3(0, h, 0)), dir);
          ray.far = 0.6;
          if (ray.intersectObjects(caps, false).length) hits.push(`${e.id}@${t.toFixed(2)}+${h}`);
        }
      }
    }
    expect(hits).toEqual([]);
  }, 60_000);
});
