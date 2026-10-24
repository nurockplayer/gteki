import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { collectIdentityBoards, identityFront, identityNameCentre, identityNameCorners, identityRegionRect, intersectsRect, parseIdentityBoard, protectIdentityChip } from "./identityBoards.ts";

const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.2), new THREE.MeshBasicMaterial());
describe("identity tags", () => {
  it("defaults to +Z and whole mesh bounds, independently of sign role", () => {
    const o = mesh();
    o.userData.gteki_identity = {};
    const b = parseIdentityBoard(o)!;
    expect(b.front.toArray()).toEqual([0, 0, 1]);
    expect(b.regions[0]!.kind).toBe("name");
    expect(b.regions[0]!.box.getSize(new THREE.Vector3()).toArray()).toEqual([4, 2, expect.closeTo(0.2)]);
    o.userData.gteki_role = "sign";
    expect(collectIdentityBoards(o)).toHaveLength(1);
  });
  it("uses group-local descendant bounds and transforms normal/name centre to world", () => {
    const group = new THREE.Group();
    group.position.set(10, 5, 0);
    group.rotation.y = Math.PI / 2;
    group.scale.set(2, 1, 3);
    const child = mesh();
    child.position.set(3, 0, 0);
    group.add(child);
    group.userData.gteki_identity = {};
    const b = parseIdentityBoard(group)!;
    expect(b.regions[0]!.box.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(3, 0, 0))).toBeLessThan(1e-6);
    expect(identityNameCentre(b).distanceTo(new THREE.Vector3(10, 5, -6))).toBeLessThan(1e-6);
    expect(identityFront(b).distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-6);
  });
  it("transforms all name-box corners without including arrow regions", () => {
    const o = mesh(); o.position.set(10, 5, -2); o.rotation.y = Math.PI / 3; o.scale.set(2, 3, 1);
    o.userData.gteki_identity = { regions: [
      { kind: "name", min: [-1, -0.5, -0.1], max: [1, 0.5, 0.1] },
      { kind: "arrow", min: [20, 20, 20], max: [30, 30, 30] },
    ] };
    o.updateMatrixWorld(true);
    const b = parseIdentityBoard(o)!;
    const corners = identityNameCorners(b);
    expect(corners).toHaveLength(8);
    const inverse = o.matrixWorld.clone().invert();
    const local = new THREE.Box3().setFromPoints(corners.map((p) => p.clone().applyMatrix4(inverse)));
    expect(local.min.distanceTo(b.regions[0]!.box.min)).toBeLessThan(1e-8);
    expect(local.max.distanceTo(b.regions[0]!.box.max)).toBeLessThan(1e-8);
  });
  it("accepts explicit name/arrow regions without including the rest of the board", () => {
    const o = mesh();
    o.userData.gteki_identity = { front: [0, 0, 2], regions: [{ kind: "name", min: [-1, 0, 0], max: [1, 1, 0] }, { kind: "arrow", min: [1, 0, 0], max: [2, 1, 0] }] };
    expect(parseIdentityBoard(o)!.regions).toHaveLength(2);
    expect(identityNameCentre(parseIdentityBoard(o)!).y).toBe(0.5);
  });
  it.each([undefined, null, true, [], "yes", { front: [0, 0, 0] }, { front: [NaN, 0, 1] }, { front: [0, 1] }, { regions: [] }, { regions: [null] }, { regions: [{ kind: "arrow", min: [0, 0, 0], max: [1, 1, 1] }] }, { regions: [{ kind: "name", min: [1, 0, 0], max: [0, 1, 1] }] }, { regions: [{ kind: "name", min: [0, 0, 0], max: [Infinity, 1, 1] }] }])("ignores malformed tag %j", (tag) => {
    const o = mesh(); o.userData.gteki_identity = tag;
    expect(parseIdentityBoard(o)).toBeNull();
  });
  it("ignores an empty group with no explicit regions", () => {
    const o = new THREE.Group(); o.userData.gteki_identity = {};
    expect(parseIdentityBoard(o)).toBeNull();
  });
});

describe("identity screen regions and chip protection", () => {
  const region = { x0: 100, y0: 100, x1: 250, y1: 150 };
  const chip = { x0: 125, y0: 120, x1: 225, y1: 146 };
  it("hides an intersecting unselected chip", () => {
    expect(protectIdentityChip(chip, false, [region])).toEqual({ hidden: true, offsetY: 0 });
  });
  it("leaves non-overlapping chips untouched, including selected chips", () => {
    for (const selected of [false, true]) expect(protectIdentityChip({ ...chip, x0: 300, x1: 400 }, selected, [region])).toEqual({ hidden: false, offsetY: 0 });
  });
  it.each([region, { ...region, y0: 0 }])("offsets selected chips above if room, else below", (r) => {
    const result = protectIdentityChip(chip, true, [r]);
    expect(result.hidden).toBe(false);
    expect(result.offsetY < 0).toBe(r.y0 > 0);
    expect(intersectsRect({ ...chip, y0: chip.y0 + result.offsetY, y1: chip.y1 + result.offsetY }, r)).toBe(false);
  });
  it("clears all horizontally overlapping name/arrow regions without accumulating offsets", () => {
    const regions = [{ ...region, y0: 75, y1: 95 }, region, { ...region, y0: 155, y1: 180 }];
    const result = protectIdentityChip(chip, true, regions);
    for (const r of regions) expect(intersectsRect({ ...chip, y0: chip.y0 + result.offsetY, y1: chip.y1 + result.offsetY }, r)).toBe(false);
    expect(protectIdentityChip(chip, true, regions)).toEqual(result);
  });
  it("uses available space between disjoint boards instead of moving an endpoint off screen", () => {
    const regions = [{ ...region, y0: 0, y1: 10 }, region, { ...region, y0: 800, y1: 840 }];
    const result = protectIdentityChip(chip, true, regions);
    expect(chip.y0 + result.offsetY).toBeGreaterThanOrEqual(0);
    expect(chip.y1 + result.offsetY).toBeLessThanOrEqual(region.y0);
    for (const r of regions) expect(intersectsRect({ ...chip, y0: chip.y0 + result.offsetY, y1: chip.y1 + result.offsetY }, r)).toBe(false);
  });
  it("projects transformed regions in CSS pixels and rejects boxes behind or outside the frustum", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    camera.position.z = 10; camera.updateMatrixWorld(true);
    const o = mesh(); o.updateMatrixWorld(true);
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 0));
    const rect = identityRegionRect(box, o, camera, 400, 400)!;
    expect(rect.x0).toBeLessThan(200); expect(rect.x1).toBeGreaterThan(200);
    expect(rect.y0).toBeLessThan(200); expect(rect.y1).toBeGreaterThan(200);
    o.position.z = 11; o.updateMatrixWorld(true);
    expect(identityRegionRect(box, o, camera, 400, 400)).toBeNull();
    o.position.set(100, 0, 0); o.updateMatrixWorld(true);
    expect(identityRegionRect(box, o, camera, 400, 400)).toBeNull();
  });
  it("clips a region crossing the near plane without non-finite rectangles", () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.updateMatrixWorld(true);
    const o = mesh(); o.updateMatrixWorld(true);
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const rect = identityRegionRect(box, o, camera, 400, 400)!;
    expect(Object.values(rect).every(Number.isFinite)).toBe(true);
    expect(rect.x0).toBeLessThan(0); expect(rect.x1).toBeGreaterThan(400);
  });
});
