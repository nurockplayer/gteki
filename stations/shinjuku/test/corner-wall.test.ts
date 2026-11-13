import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, type Plan } from "../scene/layout.ts";
import { cladWallGeometry } from "../scene/build.ts";

it("closes the slice-09 B3 void ray with source cladding and a wall collider", () => {
  const { bundle } = loadShinjukuBundle();
  const layout = buildLayout(bundle, planJson as unknown as Plan);
  const level = layout.levels.find((lv) => lv.label === "B3")!;
  const wall = level.walls.find((w) => w.a.x === -55.51 && w.a.y === 158.39 &&
    w.b.x === -53.21 && w.b.y === 152.76)!;
  expect(wall).toBeDefined();
  expect(wall.zMin).toBe(level.z);
  expect(wall.zMax).toBe(level.ceilingZ);
  // Corrected #1254 diagnosis, sampled void ray 150 (renderer XYZ).
  // The restored collider also keeps the follow camera off this wall plane.
  const origin = new THREE.Vector3(-55.22235657217172, -23.03405124163393, -157.71483369738533);
  const direction = new THREE.Vector3(-39.37773265052433, -0.012000000104304576, 17.536832914593305).sub(origin).normalize();
  const geometry = cladWallGeometry([wall])!;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    const hit = new THREE.Raycaster(origin, direction, 0, 1).intersectObject(new THREE.Mesh(geometry, material))[0];
    expect(hit).toBeDefined();
    expect(hit!.point.x).toBeCloseTo(-55.219, 3);
    expect(-hit!.point.z).toBeCloseTo(157.6777, 3);
  } finally { geometry.dispose(); material.dispose(); }
}, 30_000);

it("keeps the B3 wall at the shaft corner", () => {
  const { bundle } = loadShinjukuBundle();
  const layout = buildLayout(bundle, planJson as unknown as Plan);
  const level = layout.levels.find((lv) => lv.label === "B3")!;
  const midpoint = { x: -54.6015, y: 154.2518 };
  const atCorner = (w: typeof level.walls[number]) => {
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    const t = Math.max(0, Math.min(1, ((midpoint.x - w.a.x) * dx + (midpoint.y - w.a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(midpoint.x - w.a.x - t * dx, midpoint.y - w.a.y - t * dy) < 0.02 &&
      w.zMin <= level.z + 1 && w.zMax >= level.z + 1;
  };
  expect(layout.cornerFills.some((w) => w.level === "B3" && atCorner(w))).toBe(true);
  expect(level.walls.some(atCorner)).toBe(false);
  expect(createHash("sha256").update(JSON.stringify(layout.levels.map((lv) => lv.walls))).digest("hex")).toBe("e17a8457f1c842958251ba37426fbecd35f81a80e7ecddd5847896385520baf3");
}, 30_000);
