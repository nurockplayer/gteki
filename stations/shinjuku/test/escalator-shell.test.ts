import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";
import { buildLayout, type Plan, type XYZ } from "../scene/layout.ts";
import plan from "../data/plan.json" with { type: "json" };
import baseline from "./fixtures/scene-digest.json" with { type: "json" };
import { exactHash, geometryBytesHash, withCanvasStub } from "./helpers/scene-digest.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, plan as unknown as Plan);
const runs = layout.runs.filter((r) => r.mode === "escalator");
const v3 = (p: XYZ) => new THREE.Vector3(p.x, p.z, -p.y);

describe("#49 render-only escalator enclosure", () => {
  let scene: StationScene;
  let sides: THREE.Mesh, soffits: THREE.Mesh;
  beforeAll(async () => {
    scene = await withCanvasStub(() => buildScene({ THREE, bundle, quality: "low" } as never));
    scene.root.updateMatrixWorld(true);
    sides = scene.root.getObjectByName("escalator-shell-sides") as THREE.Mesh;
    soffits = scene.root.getObjectByName("escalator-shell-soffits") as THREE.Mesh;
  }, 60_000);
  afterAll(() => scene?.dispose());

  it("adds two small visible batches covering both sides and the roof of all 21 runs, including eight reaching B6", () => {
    expect(runs).toHaveLength(21);
    const b6 = layout.levels.find((lv) => lv.label === "B6")!.z;
    expect(runs.filter((r) => Math.min(r.a.z, r.b.z) === b6)).toHaveLength(8);
    expect(sides).toBeInstanceOf(THREE.Mesh);
    expect(soffits).toBeInstanceOf(THREE.Mesh);
    const triangles = [sides, soffits].reduce((n, m) => n + m.geometry.index!.count / 3, 0);
    expect(triangles).toBeLessThan(5000);
    const misses: string[] = [];
    const ray = new THREE.Raycaster();
    const existing: THREE.Object3D[] = [];
    scene.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m === sides || m === soffits || Array.isArray(m.material)) return;
      if (m.material instanceof THREE.MeshStandardMaterial && !m.material.transparent && m.material.visible) existing.push(m);
    });
    for (const r of runs) {
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, length = Math.hypot(dx, dy);
      for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const p = { x: r.a.x + dx * t, y: r.a.y + dy * t, z: r.a.z + (r.b.z - r.a.z) * t };
        ray.set(v3({ ...p, z: p.z + 2.45 }), new THREE.Vector3(0, 1, 0));
        ray.far = 4;
        if (!ray.intersectObject(soffits, false).length) misses.push(`${r.edgeId}@${t}:roof`);
        // Where a neighbouring walkway opens the body band, the upper side finish remains.
        for (const side of [-1, 1]) {
          ray.set(v3({ ...p, z: p.z + 2.8 }), new THREE.Vector3(-dy / length * side, 0, -dx / length * side));
          ray.far = r.width / 2 + 0.5;
          if (!ray.intersectObject(sides, false).length) {
            // Crossing passages must remain open. At a mouth, the retained station finish
            // beyond that opening completes the enclosure; the mid-run shell is mandatory.
            // A street-bound flight also hands off to open street above the slab underside.
            const streetHandoff = Math.max(r.a.z, r.b.z) >= -0.5 && p.z + 2.8 >= -0.18;
            ray.far = 30;
            if (t === 0.5 || !streetHandoff && !ray.intersectObjects(existing, false).length) misses.push(`${r.edgeId}@${t}:side${side}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("keeps pre-shell collision/walkable/camera lists and walls byte-identical", () => {
    expect(scene.walkable).toHaveLength(433);
    expect(scene.colliders).toHaveLength(2);
    expect(scene.cameraBlockers).toHaveLength(3);
    expect(scene.walls).toHaveLength(14479);
    for (const name of ["walkable", "colliders", "cameraBlockers"] as const) {
      const meshes = scene[name] ?? [];
      expect(meshes.map(geometryBytesHash), name).toEqual(baseline.scene.low[name]);
      for (const shell of [sides, soffits]) {
        expect(meshes).not.toContain(shell);
        expect(shell.userData.gteki_role).toBeUndefined();
      }
    }
    expect(exactHash(scene.walls)).toBe(baseline.scene.low.walls);
  });

  it("leaves every graph passage clear through the walking body/head band", () => {
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const ray = new THREE.Raycaster();
    const hits: string[] = [];
    for (const e of bundle.edges) {
      const za = layout.nodeZ.get(e.from)!, zb = layout.nodeZ.get(e.to)!;
      const points = e.geometry?.length ? e.geometry : [nodes.get(e.from)!.position, nodes.get(e.to)!.position];
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
      const total = lengths.reduce((a, b) => a + b, 0);
      let acc = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!, length = lengths[i - 1]!;
        const z0 = za + (zb - za) * (total ? acc / total : 0);
        acc += length;
        const z1 = za + (zb - za) * (total ? acc / total : 1);
        const steps = Math.max(1, Math.ceil(Math.hypot(length, z1 - z0) / 0.25));
        for (let k = 0; k < steps; k++) for (const offset of [-0.3, 0, 0.3]) for (const h of [0.3, 1.2, 2.1]) {
          const at = (t: number) => v3({ x: a.x + (b.x - a.x) * t - (length ? (b.y - a.y) / length * offset : offset), y: a.y + (b.y - a.y) * t + (length ? (b.x - a.x) / length * offset : 0), z: z0 + (z1 - z0) * t + h });
          const start = at(k / steps), end = at((k + 1) / steps), dir = end.clone().sub(start);
          if (dir.length() < 1e-8) continue;
          ray.set(start, dir.clone().normalize());
          ray.far = dir.length();
          if (ray.intersectObjects([sides, soffits], false).length) hits.push(`${e.id}:${k}:${offset}:${h}`);
        }
      }
    }
    expect(hits.slice(0, 30)).toEqual([]);
  }, 30_000);
});
