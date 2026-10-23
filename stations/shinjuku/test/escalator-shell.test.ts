import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { buildScene } from "../gteki/scene.ts";
import { escalatorShellGeometry } from "../scene/build.ts";
import { buildLayout, pointInRings, soffitHeight, type Plan, type XYZ } from "../scene/layout.ts";
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

  it("encloses the underground voids of 21 runs, including eight reaching B6, and hands off to existing finish", () => {
    expect(runs).toHaveLength(21);
    const b6 = layout.levels.find((lv) => lv.label === "B6")!.z;
    expect(runs.filter((r) => Math.min(r.a.z, r.b.z) === b6)).toHaveLength(8);
    expect(sides).toBeInstanceOf(THREE.Mesh);
    expect(soffits).toBeInstanceOf(THREE.Mesh);
    const triangles = [sides, soffits].reduce((n, m) => n + m.geometry.index!.count / 3, 0);
    expect(triangles).toBeLessThan(5000);
    const misses: string[] = [];
    const roofs = [...layout.levels.flatMap((lv) => lv.ceilings), ...layout.soffits];
    const covered = (p: XYZ, top: number) => roofs.some((s) => pointInRings(p, s.rings) && soffitHeight(s, p) <= top + 1e-6);
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
        if (p.z + 3.4 < -0.181 && !covered(p, p.z + 3.4) && !ray.intersectObject(soffits, false).length) misses.push(`${r.edgeId}@${t}:roof`);
        // Where a neighbouring walkway opens the body band, the upper side finish remains.
        for (const side of [-1, 1]) {
          ray.set(v3({ ...p, z: p.z + 2.8 }), new THREE.Vector3(-dy / length * side, 0, -dx / length * side));
          ray.far = r.width / 2 + 0.5;
          if (!ray.intersectObject(sides, false).length) {
            // Crossing passages remain open; existing ceilings take precedence over
            // the shell. Otherwise the mid-run enclosure must still be drawn.
            // A street-bound flight hands off above the slab underside.
            const streetHandoff = Math.max(r.a.z, r.b.z) >= -0.5 && p.z + 2.8 >= -0.18;
            ray.far = 30;
            const atSide = { ...p, x: p.x - dy / length * side * (r.width / 2 + 0.45), y: p.y + dx / length * side * (r.width / 2 + 0.45) };
            if (!streetHandoff && !covered(atSide, p.z + 3.4) && (t === 0.5 || !ray.intersectObjects(existing, false).length)) misses.push(`${r.edgeId}@${t}:side${side}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("keeps every shell vertex strictly below the street slab underside", () => {
    for (const mesh of [sides, soffits]) {
      const positions = mesh.geometry.attributes.position!;
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i), `${mesh.name}:${i}`).toBeLessThan(-0.18);
    }
  });

  it("caps the first drawn roof at every near-street roofed-link sample", () => {
    const visible: THREE.Object3D[] = [];
    scene.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && !Array.isArray(m.material) && m.material.visible !== false) visible.push(m);
    });
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const ray = new THREE.Raycaster(), failures: string[] = [];
    let samples = 0;
    for (const e of bundle.edges) {
      if (e.attributes?.roof !== 2 || e.mode === "elevator") continue;
      const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
      for (let k = 1; k < 10; k++) {
        const t = k / 10, z = (a.renderZ ?? 0) + ((b.renderZ ?? 0) - (a.renderZ ?? 0)) * t;
        if (z < -4.5 || z > 0.1) continue;
        samples++;
        ray.set(v3({ x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t, z: z + 1.62 }), new THREE.Vector3(0, 1, 0));
        ray.far = 60;
        const roof = ray.intersectObjects(visible, false)[0];
        const cap = ray.intersectObjects([...scene.cameraBlockers!, ...scene.walkable], false)[0];
        if (!roof || !cap || cap.distance > roof.distance + 0.15) failures.push(`${e.id}@${t}:${roof?.object.name}`);
      }
    }
    expect(samples).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it("uses existing roof footprints, holes and affine heights for both shell batches", () => {
    const r = runs.find((r) => Math.max(r.a.z, r.b.z) < -6)!;
    const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, length = Math.hypot(dx, dy);
    const at = (t: number, side = 0): XYZ => ({ x: r.a.x + dx * t - dy / length * side, y: r.a.y + dy * t + dx / length * side, z: r.a.z + (r.b.z - r.a.z) * t });
    const strip = (from: number, to: number, half: number) => [at(from, -half), at(to, -half), at(to, half), at(from, half)];
    const half = r.width / 2 + 0.45;
    const lower = { ...layout.soffits[0]!, rings: [strip(0.2, 0.6, half + 1), strip(0.35, 0.45, half + 0.5)],
      z: r.a.z + 2.9, origin: r.a, slope: { x: dx * (r.b.z - r.a.z) / length ** 2, y: dy * (r.b.z - r.a.z) / length ** 2 } };
    // This roof crosses the shell height at t=.8; only its lower half wins.
    const crossing = { ...lower, rings: [strip(0.7, 0.9, half + 1)], z: r.a.z + 3.4 - 0.8,
      slope: { x: lower.slope.x + dx / length ** 2, y: lower.slope.y + dy / length ** 2 } };
    const shell = escalatorShellGeometry({ ...layout, levels: [], pads: [], linkStrips: [], streetPads: [], runs: [r], soffits: [lower, crossing] }, { ...bundle, edges: [] });
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const meshes = { sides: new THREE.Mesh(shell.sides!, material), soffits: new THREE.Mesh(shell.soffits!, material) };
    const ray = new THREE.Raycaster();
    try {
      for (const [t, drawn] of [[0.1, true], [0.3, false], [0.4, true], [0.5, false], [0.75, false], [0.85, true]] as const) {
        const p = at(t);
        ray.set(v3({ ...p, z: p.z + 2.5 }), new THREE.Vector3(0, 1, 0));
        ray.far = 2;
        expect(ray.intersectObject(meshes.soffits, false).length > 0, `roof@${t}`).toBe(drawn);
        for (const side of [-1, 1]) {
          ray.set(v3({ ...p, z: p.z + 2.8 }), new THREE.Vector3(-dy / length * side, 0, -dx / length * side));
          ray.far = half + 0.1;
          expect(ray.intersectObject(meshes.sides, false).length > 0, `side${side}@${t}`).toBe(drawn);
        }
      }
    } finally {
      shell.sides?.dispose();
      shell.soffits?.dispose();
      material.dispose();
    }
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
