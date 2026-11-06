import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { expect, it } from "vitest";
import { buildWallProps, wallPropDrawRanges, type WallPropPlacement } from "./wallProps.ts";

// A stand-in for the renderer frame mapping (ENU y up → renderer y up, z = -north).
const toRenderer = (x: number, y: number, z: number) => ({ x, y: z, z: -y });

const interactive: WallPropPlacement = { id: "v", kind: "vending", wall: [0, 0], n: [1, 0], z: 0, w: 1.1, d: 0.75, interaction: "v-1" };
const kiosk: WallPropPlacement = { id: "k", kind: "kiosk", wall: [10, 0], n: [0, 1], z: 0, w: 2.1, d: 0.4 };

it("builds one merged mesh per call", () => {
  const mesh = buildWallProps(THREE, mergeGeometries, toRenderer, [interactive, kiosk], "test");
  expect(mesh.isMesh).toBe(true);
  expect(mesh.userData.gtekiWallProps).toBe(true);
  expect(mesh.name).toBe("wall-props:test");
  const markers = mesh.children.filter((o) => typeof o.userData.gtekiInteractionId === "string");
  expect(markers.map((o) => o.userData.gtekiInteractionId)).toEqual(["v-1"]);
  expect(markers[0]!.visible).toBe(false);
});

it("starts at the idle draw range, and the full range includes the reaction parts", () => {
  const mesh = buildWallProps(THREE, mergeGeometries, toRenderer, [interactive, kiosk], "test");
  const { idle, full } = wallPropDrawRanges(mesh);
  const total = mesh.geometry.index!.count;
  expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: idle });
  expect(idle).toBeLessThan(full);
  expect(full).toBe(total);
  // The reaction boxes are appended last: without the interaction the whole index is the idle range.
  const { interaction: _interaction, ...inert } = interactive;
  const plain = buildWallProps(THREE, mergeGeometries, toRenderer, [inert, kiosk], "plain");
  expect(plain.geometry.index!.count).toBe(idle);
});
