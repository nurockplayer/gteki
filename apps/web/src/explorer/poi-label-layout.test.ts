import * as THREE from "three";
import { expect, it } from "vitest";
import { Explorer } from "./explorer.ts";

type Label = readonly [id: string, position: number[], w: number, h: number, klass: number];

// Flag-off English patrol poses, with world anchors and CSS2D box sizes measured in Chromium.
// Shinjuku: Exit 1 → Ōedo Line platform, 15 m before sign 1ecbdf77.
const shinjuku = [
  { w: 1440, h: 900, position: [-59.073176, -7.130658, -188.821828], rotation: [-0.014444, -0.571709, -0.010067, 0.820267] },
  { w: 412, h: 839, position: [-59.085673, -7.133565, -188.925710], rotation: [-0.014325, -0.571711, -0.009984, 0.820269] },
];
const gate: Label = ["poi:gate:2", [-30, -5.4, -189.48], 157.883, 28, 2];

// Ikebukuro: golden camera ike-x35, heading 306°.
const ikeX35 = { w: 1440, h: 900, position: [156.045367, 31.973950, -17.261167], rotation: [-0.017245, 0.453905, 0.008787, 0.890840] };
const ikeLabels: Label[] = [
  ["exit-22", [80, 34.822, -114.5], 83.641, 28, 1],
  ["exit-26", [101, 34.646, -92], 83.766, 28, 1],
  ["exit-28", [127, 34.77, -95], 83.742, 28, 1],
  ["exit-34", [139.5, 34.291, -53.5], 84.164, 28, 1],
  ["shop-ikb-parco", [80, 34.822, -114.5], 92.641, 28, 3],
  ["shop-ikb-pparco", [80, 34.822, -114.5], 144.539, 24.5, 3],
];

function visibleRects(mode: "guide" | "walk", pose: typeof ikeX35, fov: number, labels: Label[]) {
  const { w, h, position, rotation } = pose;
  const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 2000);
  camera.position.fromArray(position);
  camera.quaternion.fromArray(rotation).normalize();
  camera.updateMatrixWorld();
  const poiLabels = labels.map(([poiId, position, w, h, klass]) => {
    const obj = Object.assign(new THREE.Object3D(), { element: { style: { translate: "" } } });
    obj.position.fromArray(position);
    obj.updateMatrixWorld();
    return { poiId, obj, size: { w, h }, klass, selected: false, routable: true, state: "shown", identityOffsetY: 0, decluttered: false };
  });
  const explorer = Object.assign(Object.create(Explorer.prototype) as { updateDeclutter(): void }, {
    camera, mode, viewSize: { w, h }, poiLabels, identityRegions: [], declutterDirty: true,
  });
  explorer.updateDeclutter();
  return poiLabels.filter((l) => !l.decluttered).map(({ obj, size }) => {
    const p = obj.position.clone().project(camera);
    const [dx = 0, dy = 0] = obj.element.style.translate.split(" ").filter(Boolean).map(parseFloat);
    const left = (p.x + 1) * w / 2 - size.w / 2 + dx;
    const top = (1 - p.y) * h / 2 - size.h / 2 + dy;
    return { left, top, right: left + size.w, bottom: top + size.h };
  });
}

it("keeps labels inside the desktop and phone viewports at sign 1ecbdf77", () => {
  const overflow = shinjuku.map((pose) => Math.max(...visibleRects("guide", pose, 58.187308, [gate])
    .map(({ left, top, right, bottom }) => Math.max(0, -left, -top, right - pose.w, bottom - pose.h))));
  expect(overflow).toEqual([0, 0]);
});

it("keeps visible labels from intersecting at ike-x35", () => {
  const rects = visibleRects("walk", ikeX35, 50, ikeLabels);
  const pairs = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  expect(pairs.length).toBe(0);
});
