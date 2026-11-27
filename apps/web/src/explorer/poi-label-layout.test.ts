// @vitest-environment jsdom
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { expect, it } from "vitest";
import { Explorer, type ExplorerMode } from "./explorer.ts";
import { LABEL_CLASS } from "./labelDeclutter.ts";
import { OcclusionSweep, type LabelOcclusion } from "./labelVisibility.ts";
import type { ScreenRect } from "./identityBoards.ts";
import captured from "./poi-label-layout.fixtures.json";

type Label = [id: string, text: string, position: number[], groundY: number, width: number, height: number,
  klass: keyof typeof LABEL_CLASS, routable: boolean, occluded: LabelOcclusion, selected: boolean,
  identityHidden: boolean, identityOffsetY: number];

type Pose = {
  mode: ExplorerMode;
  w: number;
  h: number;
  camera: { position: number[]; rotation: number[]; fov: number; near: number; far: number };
  focusY: number;
  identityRegions: ScreenRect[];
  labels: Label[];
};

// Complete flag-off label sets and native chip sizes from the completed Chromium visibility sweeps.
// The guide poses are 15 m before sign 1ecbdf77 on Exit 1 → Ōedo Line platform.
const poses = captured as unknown as Record<keyof typeof captured, Pose>;

function renderPose(pose: Pose, measureTries = 0) {
  const { w, h, focusY, identityRegions, mode } = pose;
  const { position, rotation, fov, near, far } = pose.camera;
  const camera = new THREE.PerspectiveCamera(fov, w / h, near, far);
  camera.position.fromArray(position);
  camera.quaternion.fromArray(rotation);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const css = new CSS2DRenderer();
  css.setSize(w, h);
  const poiLabels = pose.labels.map(([poiId, text, position, groundY, width, height, klass, routable, occluded, selected, identityHidden, identityOffsetY]) => {
    const el = document.createElement("button");
    el.textContent = text;
    if (identityOffsetY) el.style.translate = `0 ${identityOffsetY}px`;
    const obj = new CSS2DObject(el);
    obj.position.fromArray(position);
    scene.add(obj);
    // jsdom has no CSS box layout. Apply the real CSS2D/Explorer transforms to the native measured box.
    el.getBoundingClientRect = () => {
      if (!el.isConnected || el.style.display === "none") return new DOMRect();
      const [, x, y] = /translate\(([^,]+)px, ([^)]+)px\)/.exec(el.style.transform)!;
      const [dx = 0, dy = 0] = el.style.translate.split(" ").filter(Boolean).map(parseFloat);
      return new DOMRect(Number(x) - width / 2 + dx, Number(y) - height / 2 + dy, width, height);
    };
    return { poiId, obj, groundY, klass: LABEL_CLASS[klass], routable, occluded, selected, identityHidden, identityOffsetY,
      state: "shown", size: null, decluttered: false, measureTries };
  });
  scene.updateMatrixWorld();
  const explorer = Object.assign(Object.create(Explorer.prototype) as { updateLabels(): void }, {
    camera, mode, viewSize: { w, h }, poiLabels, identityRegions, declutterDirty: true, declutterAt: -Infinity,
    labelAt: new THREE.Vector3(), pos: new THREE.Vector3(0, focusY, 0),
    labelCamPos: camera.position.clone(), labelCamQuat: camera.quaternion.clone().normalize(),
    labelMode: mode, labelCamFov: fov, labelCamAspect: w / h,
    labelSweep: new OcclusionSweep(), labelSweepDoneAt: Infinity, identityLabelsDirty: false,
  });
  document.body.append(css.domElement);
  try {
    for (let i = 0; i < 3; i++) {
      explorer.updateLabels();
      css.render(scene, camera);
    }
    return poiLabels.flatMap(({ poiId, obj }) => {
      const el = obj.element;
      const rect = el.getBoundingClientRect();
      return el.style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
        rect.right > 0 && rect.left < w && rect.bottom > 0 && rect.top < h ? [{ poiId, rect }] : [];
    });
  } finally {
    css.domElement.remove();
  }
}

it("keeps every visible label inside the desktop and phone viewports at sign 1ecbdf77", () => {
  const overflow = [poses["1ecbdf77-desktop"], poses["1ecbdf77-phone"]].map((pose) => Math.max(...renderPose(pose)
    .map(({ rect: { left, top, right, bottom } }) => Math.max(0, -left, -top, right - pose.w, bottom - pose.h))));
  expect(overflow).toEqual([0, 0]);
});

it("keeps all visible labels from intersecting at ike-x35", () => {
  const rects = renderPose(poses["ike-x35"]).map(({ rect }) => rect);
  const pairs = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  expect(rects.length ? pairs.length : -1).toBe(0);
});

it("shows the slice-route chips after earlier poses used up identity measurement attempts", () => {
  const retained = [
    renderPose(poses["slice-02-exit1-landing"], 10).some(({ poiId }) => poiId === "poi:elevator:2"),
    renderPose(poses["slice-03-b1-arrival"], 10).some(({ poiId }) => poiId === "poi:gate:2"),
    renderPose(poses["slice-04-b1-corridor"], 10).some(({ poiId }) => poiId === "poi:exit:5"),
  ];
  expect(retained).toEqual([true, true, true]);
});
