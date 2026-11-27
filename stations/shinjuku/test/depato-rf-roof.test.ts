// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { createHash } from "node:crypto";
import { enuToRenderer } from "@gteki/geo";
import { WALKER_BODY, type SceneContext, type StationScene } from "@gteki/scene-api";
import * as THREE from "three";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { catShoulder, escalatorPose, FOLLOW, followLens, followPose } from "../../../apps/web/src/explorer/followCamera.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import rollout from "../data/depato-rollout.json";
import planJson from "../data/plan.json";
import surfaceJson from "../data/surface.json";
import { attachDepatoPreview, depatoPreviewBundle } from "../scene/depato.ts";
import { buildLayout, type Plan } from "../scene/layout.ts";
import { buildSurface, type SurfaceData } from "../scene/surface.ts";

const { bundle } = loadShinjukuBundle();
const preview = depatoPreviewBundle(bundle);
let scene: StationScene;

beforeAll(async () => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 1, height: 1, getContext: () => ({ fillRect() {}, fillText() {} }) }),
    fonts: { load: async () => [] },
  });
  const layout = buildLayout(bundle, planJson as Plan);
  const data = surfaceJson as SurfaceData;
  const shipping = buildSurface(data, layout, { bundle, quality: "high" });
  // Report the same surface digest on both sides of the fix without updating a golden.
  const digest = createHash("sha256");
  shipping.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    digest.update(object.name);
    for (const attribute of [object.geometry.getIndex(), ...Object.values(object.geometry.attributes)] as (THREE.BufferAttribute | null)[]) {
      if (attribute) digest.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
  });
  console.info("Flag-off surface SHA-256:", digest.digest("hex"));
  shipping.dispose();

  const surface = buildSurface(data, layout, { bundle, quality: "high", previewNext: true });
  scene = await attachDepatoPreview({ THREE, bundle: preview, quality: "high", previewNext: true, enuToRenderer } as SceneContext, {
    root: surface.root, walkable: [], dispose: surface.dispose,
  });
  scene.root.updateMatrixWorld(true);
});

afterAll(() => {
  scene?.dispose();
  vi.unstubAllGlobals();
});

it.each(["isetan-shinjuku-main", "isetan-shinjuku-mens", "keio-shinjuku"])("%s RF avatar and camera clear the old roof", id => {
  const { buildingId } = rollout.stores.find(row => row.id === id)!;
  const facade = scene.root.getObjectByName(`department-store:${buildingId}:facade`)!;
  const roofFloor = `depato-${id}-RF-floor`;
  const roofNodes = new Set(preview.nodes.filter(n => n.floorId === roofFloor).map(n => n.id));
  const flights = preview.edges.filter(e => e.mode === "escalator" && (roofNodes.has(e.from) || roofNodes.has(e.to)));
  expect(flights).toHaveLength(2);

  const ray = new THREE.Raycaster();
  const samples = { avatar: 0, desktop: 0, phone: 0 };
  const blocked = { ...samples };
  const hitsFacade = (from: THREE.Vector3, to: THREE.Vector3) => {
    const delta = to.clone().sub(from);
    ray.far = delta.length();
    ray.set(from, delta.normalize());
    return ray.intersectObject(facade, false).length > 0;
  };
  for (const { geometry } of flights) {
    const [start, end] = geometry.map(p => new THREE.Vector3(p.x, p.z!, -p.y));
    const axis = end!.clone().sub(start!).normalize();
    const yaw = Math.atan2(-axis.x, -axis.z);
    const count = Math.ceil(start!.distanceTo(end!) / 0.1);
    let previous: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] | undefined;
    for (let i = 0; i <= count; i++) {
      const feet = start!.clone().lerp(end!, i / count);
      const head = feet.clone().add(new THREE.Vector3(0, WALKER_BODY.bodyTopM, 0));
      const human = followPose(feet.clone().setY(feet.y + WALKER_BODY.eyeM), yaw, -0.12, FOLLOW.shoulder);
      const humanCamera = human.pivot.clone().addScaledVector(human.back, FOLLOW.defaultDistance);
      const desktop = escalatorPose(feet, axis, catShoulder(16 / 9), 1, yaw, 0, 16 / 9, followLens("guide", false, false, true, 16 / 9));
      const phone = escalatorPose(feet, axis, catShoulder(9 / 16), 1, yaw, 0, 9 / 16, followLens("guide", false, false, true, 9 / 16));

      samples.avatar++;
      if (hitsFacade(feet, head) || hitsFacade(head, humanCamera) ||
          (previous && (hitsFacade(previous[0], feet) || hitsFacade(previous[1], head) || hitsFacade(previous[2], humanCamera)))) blocked.avatar++;
      samples.desktop++;
      if (hitsFacade(desktop.position, feet) || (previous && hitsFacade(previous[3], desktop.position))) blocked.desktop++;
      samples.phone++;
      if (hitsFacade(phone.position, feet) || (previous && hitsFacade(previous[4], phone.position))) blocked.phone++;
      previous = [feet, head, humanCamera, desktop.position, phone.position];
    }
  }
  console.info(id, { blocked, samples });
  expect(blocked).toEqual({ avatar: 0, desktop: 0, phone: 0 });
});
