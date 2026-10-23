import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { collectIdentityBoards, intersectsRect } from "./identityBoards.ts";
import { OcclusionSweep } from "./labelVisibility.ts";
import { CameraCut } from "./cameraCut.ts";

/** Exercise actual placement/occlusion methods on a CPU-only stand-in, never construct a renderer. */
function runtime(boardZ = -10) {
  const scene = new THREE.Scene();
  const root = new THREE.Group(); scene.add(root);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  board.name = "fixture-identity";
  board.position.set(-2, 3, boardZ);
  if (boardZ > 0) board.rotation.y = Math.PI;
  board.userData.gteki_identity = {};
  root.add(board); scene.updateMatrixWorld(true);
  // Private runtime fields/methods are intentionally accessed only by this stand-in.
  const e = Object.create(Explorer.prototype) as any;
  Object.assign(e, {
    scene, stationScene: { root }, identityBoards: collectIdentityBoards(root), identityPlaced: false,
    pos: new THREE.Vector3(), lastAvatarPos: new THREE.Vector3(), yaw: 0, pitch: -0.12, bodyYaw: 0,
    mode: "overview", camera: new THREE.PerspectiveCamera(50, 9 / 19.5, 0.05, 100),
    cameraTargets: [], skyTargets: [], ray: new THREE.Raycaster(), occluders: [], proxies: new Set(), signMeshes: new Set(), cameraCut: new CameraCut(),
    labelSweep: new OcclusionSweep(), labelSweepDoneAt: -Infinity, labelCamPos: new THREE.Vector3(Infinity, 0, 0), labelCamQuat: new THREE.Quaternion(), labelAt: new THREE.Vector3(), quality: "low",
    guideAllStops: [], groundAt: vi.fn(() => 0), setMode: vi.fn((mode: string) => { e.mode = mode; }),
    host: { getBoundingClientRect: () => ({ left: 10, top: 20 }) }, viewSize: { w: 390, h: 845 }, poiLabels: [],
  });
  return { e, board, root };
}

describe("initial identity placement", () => {
  it("applies once per open, never on later walkFrom, overview re-entry or seek", () => {
    const { e } = runtime();
    expect(e.walkFrom({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(e.yaw).toBeGreaterThan(0.05);
    expect(e.snapCamera).toBe(true);
    e.walkFrom({ x: 0, y: 0, z: 0 }, 30);
    expect(e.yaw).toBeCloseTo(-Math.PI / 6);
    e.mode = "overview";
    e.walkFrom({ x: 0, y: 0, z: 0 }, 60);
    expect(e.yaw).toBeCloseTo(-Math.PI / 3);
    e.startGuide([{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 15, z: 0, stepIndex: 0 }]);
    e.seekGuide(2);
    expect(e.yaw).toBeCloseTo(0);
    // clearStation resets this field at each open; simulate the remaining fresh attach here.
    e.identityPlaced = false;
    e.walkFrom({ x: 0, y: 0, z: 0 });
    expect(e.yaw).toBeGreaterThan(0.05);
  });
  it("does not consume the opportunity on a failed ground placement", () => {
    const { e } = runtime(); e.groundAt.mockReturnValueOnce(null);
    expect(e.walkFrom({ x: 0, y: 0, z: 0 })).toBe(false);
    expect(e.identityPlaced).toBe(false);
  });
  it("consumes the first placement even when no board qualifies", () => {
    const { e } = runtime(); e.identityBoards = [];
    e.walkFrom({ x: 0, y: 0, z: 0 });
    expect(e.identityPlaced).toBe(true);
  });
  it("clearStation removes the boards and resets framing for the next open", () => {
    const { e, root } = runtime();
    e.walkFrom({ x: 0, y: 0, z: 0 });
    Object.assign(e, {
      street: { restore: vi.fn(), attach: vi.fn() }, streetProbe: { at: new THREE.Vector3() },
      overviewLook: { set: vi.fn() }, world: new THREE.Group(), graph: null,
    });
    e.stationScene.dispose = vi.fn();
    for (const method of ["disconnectStationAudio", "clearRoute", "clearPois", "resetSun", "applyLighting"]) e[method] = vi.fn();
    e.clearStation();
    expect(e.identityBoards).toEqual([]);
    expect(e.identityPlaced).toBe(false);
    e.stationScene = { root }; e.identityBoards = collectIdentityBoards(root);
    e.walkFrom({ x: 0, y: 0, z: 0 });
    expect(e.yaw).toBeGreaterThan(0.05);
  });
  it.each([false, true])("guide start changes only camera look and keeps route body heading (reduced motion %s)", (reduced) => {
    const { e } = runtime(); e.reducedMotion = reduced;
    e.startGuide([{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 15, z: 0, stepIndex: 0 }]);
    expect(e.yaw).toBeGreaterThan(0.05);
    expect(e.bodyYaw).toBeCloseTo(0);
    expect(e.pos.length()).toBe(0);
  });
  it("skips a guide board more than 90 degrees away", () => {
    const { e } = runtime(10);
    e.startGuide([{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 15, z: 0, stepIndex: 0 }]);
    expect(e.yaw).toBeCloseTo(0); expect(e.bodyYaw).toBeCloseTo(0);
  });
  it("head sight is blocked by geometry but never by sign-role targets", () => {
    for (const role of ["wall", "sign"]) {
      const { e, root } = runtime();
      const blocker = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      blocker.position.set(0, 2, -5); blocker.userData.gteki_role = role;
      root.add(blocker); root.updateMatrixWorld(true); e.cameraTargets = [blocker];
      e.walkFrom({ x: 0, y: 0, z: 0 });
      expect(e.yaw > 0.05).toBe(role === "sign");
    }
  });
});

describe("identity QA and chip integration", () => {
  it("reports actual chip coverage and does not report a hidden or detached board in frame", () => {
    const { e, board, root } = runtime();
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const rect = e.identity()[0].nameRect;
    const domRect = { left: rect.x0 + 2, top: rect.y0 + 2, right: rect.x1 - 2, bottom: rect.y1 - 2, width: rect.x1 - rect.x0 - 4, height: rect.y1 - rect.y0 - 4 };
    const obj = { visible: true, element: { style: {}, getBoundingClientRect: () => domRect } };
    e.poiLabels = [{ obj }];
    expect(e.identity()[0].coveredByChip).toBe(true);
    obj.visible = false;
    expect(e.identity()[0].coveredByChip).toBe(false);
    board.visible = false;
    expect(e.identity()[0]).toMatchObject({ inFrame: false, nameRect: null, nameHeightPx: 0 });
    board.visible = true; root.remove(board);
    expect(e.identity()[0].inFrame).toBe(false);
  });
  it.each([false, true])("excludes the identity board itself from solid/sign occlusion (sign %s)", (sign) => {
    const { e, board, root } = runtime();
    // Looking directly at the name from the front, without a renderer.
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    if (sign) e.signMeshes.add(board);
    e.buildOccluders(root); e.refreshOccluders();
    expect(e.identity()[0]).toMatchObject({ id: "fixture-identity", inFrame: true, frontFacing: true, coveredByChip: false, occluded: "none" });
    expect(e.identity()[0].nameRect.x0).toBeGreaterThanOrEqual(10);
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    blocker.position.set(-2, 2, -5); root.add(blocker); root.updateMatrixWorld(true);
    e.occluders = []; e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe("geometry");
    e.signMeshes.add(blocker);
    expect(e.identity()[0].occluded).toBe("sign");
  });
  it("hides unselected overlap in labelInfo, offsets endpoints and resets on overview", () => {
    const { e, board } = runtime();
    e.mode = "walk";
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const r = e.identity()[0].nameRect;
    const label = (selected: boolean) => {
      const obj = new THREE.Object3D() as THREE.Object3D & { element: unknown };
      obj.position.copy(board.position); obj.updateMatrixWorld(true);
      obj.element = { isConnected: true, offsetWidth: 100, offsetHeight: 26, textContent: "Name", style: {}, classList: { toggle: vi.fn() } };
      return { selected, obj, groundY: 0, occluded: "none", size: null, measureTries: 0, identityHidden: false, identityOffsetY: 0, state: "shown", decluttered: false };
    };
    const plain = label(false), endpoint = label(true); e.poiLabels = [plain, endpoint];
    e.updateLabels();
    expect(plain.identityHidden).toBe(true); expect(endpoint.identityHidden).toBe(false);
    expect(endpoint.identityOffsetY).toBeLessThan(0);
    expect(e.labelInfo()).toMatchObject({ hidden: 1, shown: 1 });
    const chip = { x0: 10 + 195 - 50, x1: 10 + 195 + 50, y0: 20 + 422.5 - 13 + endpoint.identityOffsetY, y1: 20 + 422.5 + 13 + endpoint.identityOffsetY };
    expect(intersectsRect(chip, r)).toBe(false);
    const protect = vi.spyOn(e, "updateIdentityLabels");
    e.updateLabels();
    expect(protect).not.toHaveBeenCalled(); // still camera: reuse the last region check
    e.identityLabelsDirty = true; // setPois invalidates protection even with a still camera
    e.updateLabels();
    expect(protect).toHaveBeenCalledOnce();
    e.mode = "overview"; e.updateIdentityLabels();
    expect(plain.identityHidden).toBe(false); expect(endpoint.identityOffsetY).toBe(0);
    expect((endpoint.obj.element as { style: unknown }).style).toMatchObject({ translate: "" });
  });
});
