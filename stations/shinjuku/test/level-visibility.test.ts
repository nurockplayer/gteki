import { expect, it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import type { Plan } from "../scene/layout.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";

/** #1023: the low tier hides whole level-* groups for the duration of a render only. */

const build = (quality: "low" | "high"): BuiltStation => {
  const { bundle } = loadShinjukuBundle();
  return withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality, reuseLayout: true }));
};

const levelZ = (built: BuiltStation, label: string): number => built.layout.levels.find((lv) => lv.label === label)!.z;
const groupOf = (built: BuiltStation, label: string): THREE.Group => {
  const group = [...built.levelGroups.values()].find((g) => g.name === `level-${label}`);
  expect(group, `level group for ${label}`).toBeTruthy();
  return group!;
};

/** A camera at the given root-local height; +Y is up in the station root's frame. */
const cameraAt = (y: number): THREE.PerspectiveCamera => {
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 10000);
  camera.position.set(0, y, 0);
  camera.updateMatrixWorld();
  return camera;
};
const eyeOn = (built: BuiltStation, label: string): THREE.PerspectiveCamera => cameraAt(levelZ(built, label) + 1.6);

it("a camera on B1 hides B6 for that render and afterRender restores it", { timeout: 60_000 }, () => {
  const built = build("low");
  try {
    const b6 = groupOf(built, "B6");
    const b5 = groupOf(built, "B5");
    expect(b6.visible).toBe(true);

    built.beforeRender!(null, eyeOn(built, "B1"));
    expect(groupOf(built, "B1").visible).toBe(true);
    expect(b6.visible).toBe(false);
    expect(b5.visible).toBe(false);

    built.afterRender!();
    expect(b6.visible).toBe(true);
    expect(b5.visible).toBe(true);

    built.afterRender!(); // safe to call twice, or without a beforeRender before it
    expect(b6.visible).toBe(true);
  } finally {
    built.dispose();
  }
});

it("a camera on B6 hides level-1 and keeps the B3 escalator landing it can see", () => {
  const built = build("low");
  try {
    const top = groupOf(built, "1");
    expect(top.visible).toBe(true);

    built.beforeRender!(null, eyeOn(built, "B6"));
    // B3 is two levels above B6: only the escalator run B6↔B3 keeps it visible.
    expect(groupOf(built, "B3").visible).toBe(true);
    expect(groupOf(built, "B2").visible).toBe(false);
    expect(top.visible).toBe(false);

    built.afterRender!();
    expect(top.visible).toBe(true);
  } finally {
    built.dispose();
  }
});

it("a camera 10 m above the top level hides nothing", () => {
  const built = build("low");
  try {
    built.beforeRender!(null, cameraAt(levelZ(built, "1") + 10));
    for (const [floorId, group] of built.levelGroups) expect(group.visible, floorId).toBe(true);
    built.afterRender!();
    for (const [floorId, group] of built.levelGroups) expect(group.visible, floorId).toBe(true);
  } finally {
    built.dispose();
  }
});

it("the high tier has no render-only level hook", () => {
  const built = build("high");
  try {
    expect(built.beforeRender).toBeUndefined();
    expect(built.afterRender).toBeUndefined();
  } finally {
    built.dispose();
  }
});
