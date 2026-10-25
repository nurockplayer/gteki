import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { collectIdentityBoards, identityNameCentre, intersectsRect } from "./identityBoards.ts";
import { OcclusionSweep } from "./labelVisibility.ts";
import { CameraCut } from "./cameraCut.ts";
import { FOLLOW, followPose } from "./followCamera.ts";

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
    guide: null, guideAllStops: [], guideIdentityHoldS: 0, guideIdentityCentre: new THREE.Vector3(), guideIdentityOffset: { yaw: 0, pitch: 0 }, identityHead: new THREE.Vector3(), identityToward: new THREE.Vector3(), tier: "run", events: {}, groundAt: vi.fn(() => 0),
    input: { consumeLook: vi.fn(() => ({ dx: 0, dy: 0, zoom: 0 })), move: vi.fn(() => ({ x: 0, y: 0, run: false })) },
    orbit: { target: new THREE.Vector3() }, avatar: new THREE.Group(), routeGroup: new THREE.Group(), routeMarkersVisible: true, world: root, overviewLook: { set: vi.fn() },
    street: { restore: vi.fn() }, setFov: vi.fn(), camDistance: 4,
    host: { getBoundingClientRect: () => ({ left: 10, top: 20 }) }, viewSize: { w: 390, h: 845 }, poiLabels: [],
  });
  return { e, board, root };
}

function labelAt(board: THREE.Object3D, selected: boolean) {
  let translate = "";
  const obj = Object.assign(new THREE.Object3D(), {
    element: {
      isConnected: true, get offsetWidth() { return 100; }, get offsetHeight() { return 26; },
      textContent: "Name", style: { get translate() { return translate; }, set translate(value: string) { translate = value; } }, classList: { toggle: vi.fn() },
    },
  });
  obj.position.copy(board.position); obj.updateMatrixWorld(true);
  return { selected, obj, groundY: 0, occluded: "none", size: null, measureTries: 0, identityHidden: false, identityOffsetY: 0, state: "shown", decluttered: false };
}

describe("initial identity placement", () => {
  it("applies once per open, never on later walkFrom, overview re-entry or seek", () => {
    const { e } = runtime();
    expect(e.walkFrom({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(e.yaw).toBeGreaterThan(0.05);
    expect(e.teleported).toBe(true);
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
  it("rejects geometry blocking only the modelled camera-to-name sight", () => {
    const { e, root } = runtime();
    const blocker = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    // Behind the head, but between the default follow camera and the name.
    blocker.position.set(0, 2, 1); root.add(blocker); root.updateMatrixWorld(true);
    e.cameraTargets = [blocker];
    e.walkFrom({ x: 0, y: 0, z: 0 });
    expect(e.yaw).toBeCloseTo(0);
  });

  it.each([{ w: 1280, h: 720, panelW: 415, panelH: 720 }, { w: 390, h: 845, panelW: 390, panelH: 300 }])("uses the canvas free area for walk and guide at $w x $h", ({ w, h, panelW, panelH }) => {
    for (const mode of ["walk", "guide"]) {
      const { e } = runtime();
      e.viewSize = { w, h }; e.camera.aspect = w / h; e.camera.updateProjectionMatrix();
      e.panelEl = { getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 10, top: 20, width: panelW, height: panelH }) };
      if (mode === "walk") e.walkFrom({ x: 0, y: 0, z: 0 });
      else e.startGuide([{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 15, z: 0, stepIndex: 0 }]);
      expect(e.yaw).not.toBe(0);
      const pose = followPose(new THREE.Vector3(0, 1.62, 0), e.yaw, e.pitch);
      e.camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
      e.camera.lookAt(pose.target); e.camera.updateMatrixWorld(true);
      const p = identityNameCentre(e.identityBoards[0]).project(e.camera);
      const free = e.freeRect();
      const x = (p.x + 1) * w / 2, y = (1 - p.y) * h / 2;
      expect(x).toBeGreaterThanOrEqual(free.x + free.w * 0.2);
      expect(x).toBeLessThanOrEqual(free.x + free.w * 0.8);
      expect(y).toBeGreaterThanOrEqual(free.y);
      expect(y).toBeLessThanOrEqual(free.y + free.h);
    }
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

describe("guide identity steering hold", () => {
  const route = [{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 100, z: 0, stepIndex: 0 }];

  /** Yaw that keeps the board framed: its bearing from the head plus the framed offset (the hold's own aim). */
  const aimOf = (e: any) => {
    const head = e.pos.clone().add(new THREE.Vector3(0, 1.62, 0));
    const toward = e.guideIdentityCentre.clone().sub(head);
    return Math.atan2(-toward.x, -toward.z) + e.guideIdentityOffset.yaw;
  };

  it("tracks the framed board for four seconds while advancing along the route, then resumes steering", () => {
    const { e } = runtime(-25);
    e.startGuide(route);
    expect(e.guideIdentityHoldS).toBe(4);
    for (let i = 0; i < 16; i++) {
      e.stepGuide(0.25);
      expect(e.yaw).toBeCloseTo(aimOf(e), 6);
    }
    expect(e.pos.z).toBeLessThan(-10);
    expect(e.guideIdentityHoldS).toBe(0);
    const yaw = e.yaw;
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(yaw / 2);
  });

  it("steers only for the portion of a frame after the hold expires", () => {
    const { e } = runtime(-25);
    e.startGuide(route);
    for (let i = 0; i < 15; i++) e.stepGuide(0.25);
    e.stepGuide(0.375);
    expect(e.yaw).toBeCloseTo(aimOf(e) / 2, 6);
  });

  it("keeps a board 18 m ahead and 3 m to the side in view at every frame of a 3 s run-tier walk", () => {
    const { e } = runtime(-18);
    e.pos.set(0, 0, 0);
    e.startGuide(route);
    const start = e.pos.z;
    const centre = e.guideIdentityCentre.clone();
    expect(e.guideIdentityHoldS).toBe(4);
    for (let i = 0; i < 180; i++) {
      e.stepGuide(1 / 60);
      const pose = followPose(e.pos.clone().add(new THREE.Vector3(0, 1.62, 0)), e.yaw, e.pitch);
      e.camera.position.copy(pose.pivot).addScaledVector(pose.back, FOLLOW.defaultDistance);
      e.camera.lookAt(pose.target); e.camera.updateMatrixWorld(true);
      const ndc = centre.clone().project(e.camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(ndc.z).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(e.pos.z - start)).toBeGreaterThan(9);
  });

  it("a route that turns away from the board ends the hold early and steering resumes smoothly", () => {
    const { e } = runtime(-18);
    // Out 5 m toward the board, then straight back: the look would have to turn well over 100 degrees.
    e.startGuide([{ x: 0, y: 0, z: 0, stepIndex: 0 }, { x: 0, y: 5, z: 0, stepIndex: 0 }, { x: 0, y: 0, z: 0, stepIndex: 0 }]);
    expect(e.guideIdentityHoldS).toBe(4);
    for (let i = 0; i < 200 && e.guideIdentityHoldS > 0; i++) e.stepGuide(1 / 60);
    expect(e.guideIdentityHoldS).toBe(0);
    const turnYaw = Math.PI;
    expect(e.pos.z).toBeGreaterThan(-5.5);
    let previous = e.yaw;
    for (let i = 0; i < 30; i++) {
      e.stepGuide(1 / 60);
      expect(Math.abs(e.yaw - previous)).toBeLessThan(0.2);
      previous = e.yaw;
    }
    expect(Math.abs(Math.atan2(Math.sin(e.yaw - turnYaw), Math.cos(e.yaw - turnYaw)))).toBeLessThan(1.2);
  });

  it.each([{ dx: 10, dy: 0, zoom: 0 }, { dx: 0, dy: 10, zoom: 0 }, { dx: 0, dy: 0, zoom: 10 }])("look input %j ends the hold immediately", (look) => {
    const { e } = runtime();
    e.startGuide(route);
    const yaw = e.yaw;
    e.input.consumeLook.mockReturnValueOnce(look);
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(yaw / 2 - look.dx * 0.0042);
    const afterInput = e.yaw;
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(afterInput / 2);
  });

  it("move input ends the hold and hands over to walking", () => {
    const { e } = runtime();
    e.startGuide(route);
    e.input.move.mockReturnValueOnce({ x: 0, y: 1, run: false });
    e.stepGuide(0.125);
    expect(e.mode).toBe("walk");
    expect(e.guide).toBeNull();
    expect(e.guideIdentityHoldS).toBe(0);
  });

  it.each(["seek", "stop", "mode"])("%s ends the hold without restoring it on guide re-entry", (action) => {
    const { e } = runtime();
    e.startGuide(route);
    expect(e.guideIdentityHoldS).toBe(4);
    if (action === "seek") e.seekGuide(2);
    else if (action === "stop") e.stopGuide();
    else e.setMode("overview");
    expect(e.guideIdentityHoldS).toBe(0);
    if (action === "stop") e.startGuide(route);
    else e.setMode("guide");
    e.yaw = 0.6;
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(0.3);
  });

  it("does not hold when no board qualifies for framing", () => {
    const { e } = runtime(10);
    e.startGuide(route);
    expect(e.guideIdentityHoldS).toBe(0);
    e.yaw = 0.6;
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(0.3);
  });

  it("walk spawn leaves input in control and does not arm a guide hold", () => {
    const { e } = runtime();
    e.walkFrom({ x: 0, y: 0, z: 0 });
    expect(e.guideIdentityHoldS).toBe(0);
    const yaw = e.yaw;
    e.stepWalk(0.25);
    expect(e.yaw).toBe(yaw);
    e.input.consumeLook.mockReturnValueOnce({ dx: 10, dy: 0, zoom: 0 });
    e.stepWalk(0.25);
    expect(e.yaw).toBeCloseTo(yaw - 0.042);
    e.startGuide(route);
    e.yaw = 0.6;
    e.stepGuide(0.125);
    expect(e.yaw).toBeCloseTo(0.3);
  });
});

describe("identity QA and chip integration", () => {
  it("batches initial measurements before writes and reuses sizes without redundant translate writes", () => {
    const { e, board } = runtime();
    e.mode = "walk";
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const labels = [labelAt(board, true), labelAt(board, true)];
    e.poiLabels = labels;
    const events: string[] = [];
    const spies = labels.map((l, i) => ({
      width: vi.spyOn(l.obj.element, "offsetWidth", "get").mockImplementation(() => { events.push(`width${i}`); return 100; }),
      height: vi.spyOn(l.obj.element, "offsetHeight", "get").mockImplementation(() => { events.push(`height${i}`); return 26; }),
      translate: vi.spyOn(l.obj.element.style, "translate", "set").mockImplementation(() => { events.push(`write${i}`); }),
    }));
    e.updateIdentityLabels();
    expect(events).toEqual(["width0", "height0", "width1", "height1", "write0", "write1"]);
    for (const l of labels) expect(l.size).toEqual({ w: 100, h: 26 });
    for (const s of spies) { s.width.mockClear(); s.height.mockClear(); s.translate.mockClear(); }
    for (let i = 0; i < 5; i++) e.updateIdentityLabels();
    for (const s of spies) {
      expect(s.width).not.toHaveBeenCalled();
      expect(s.height).not.toHaveBeenCalled();
      expect(s.translate).not.toHaveBeenCalled();
    }
    // #400: overview protects the same name, so the mode change neither resets nor rewrites the offset.
    e.mode = "overview";
    e.updateIdentityLabels();
    for (const s of spies) expect(s.translate).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) e.updateIdentityLabels();
    for (const s of spies) {
      expect(s.width).not.toHaveBeenCalled();
      expect(s.height).not.toHaveBeenCalled();
      expect(s.translate).not.toHaveBeenCalled();
    }
  });

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
    expect(e.identity()[0]).toMatchObject({ inFrame: false, nameRect: null, nameHeightPx: null });
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
  it.each(["overlap", "sibling-back"])("ignores the other tagged face of a physical board (%s)", (kind) => {
    const { e, board, root } = runtime();
    board.name = "identity:fixture";
    const back = board.clone(); back.name = kind === "sibling-back" ? "identity:fixture:back" : "other-face";
    // A separated face plane uses the sibling naming fallback; overlapping boxes use structure alone.
    if (kind === "sibling-back") back.position.z += 0.02;
    else { back.geometry = new THREE.BoxGeometry(4, 1, 0.04); }
    root.add(back); root.updateMatrixWorld(true);
    e.identityBoards = collectIdentityBoards(root);
    e.signMeshes = new Set([board, back]);
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    e.buildOccluders(root);
    expect(e.identity().map((b: { occluded: string }) => b.occluded)).toEqual(["none", "none"]);
  });

  it.each([false, true])("keeps an overlapping tagged board under a different parent as an occluder (sign %s)", (sign) => {
    const { e, board, root } = runtime();
    const farParent = new THREE.Group(), nearParent = new THREE.Group();
    root.add(farParent, nearParent); farParent.add(board);
    board.rotation.y = Math.PI / 4;
    const near = board.clone();
    // Even matching face names cannot make independently parented boards one physical board.
    near.name = `${board.name}:back`;
    near.position.z += 1;
    near.rotation.y = -Math.PI / 4;
    nearParent.add(near); root.updateMatrixWorld(true);
    expect(board.parent).not.toBe(near.parent);
    expect(new THREE.Box3().setFromObject(board).intersectsBox(new THREE.Box3().setFromObject(near))).toBe(true);
    e.identityBoards = collectIdentityBoards(root);
    if (sign) e.signMeshes = new Set([board, near]);
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    e.buildOccluders(root);
    expect(e.identity().find((b: { id: string }) => b.id === board.name)).toMatchObject({
      inFrame: true, frontFacing: true, occluded: sign ? "sign" : "geometry",
    });
  });

  it.each([[0.1, "sign"], [5, "sign"], [-0.1, "none"]])("identity sign %s m toward the camera reports %s", (offset, expected) => {
    const { e, board, root } = runtime();
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    sign.position.copy(board.position); sign.position.z += Number(offset);
    root.add(sign); root.updateMatrixWorld(true); e.signMeshes.add(sign); e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe(expected);
    if (Number(offset) < 0) {
      // Ordinary POI labels retain their backdrop behavior.
      expect(e.labelOccluded({ obj: board, occluded: "none" })).toBe("sign");
    }
  });

  // Both stations tag a metadata-only proxy/group and draw the plate itself in a merged sign batch beside
  // it (Ikebukuro signs.ts, Shinjuku identity.ts), so the plate is never inside the tagged subtree.
  it.each([["ikebukuro", 0.002, 0.001], ["shinjuku", 0.045, 0.037]])("does not count the board's own plate from a merged sign batch (%s)", (_, halfDepth, plateFront) => {
    const { e, board, root } = runtime();
    root.remove(board);
    const proxy = new THREE.Object3D();
    proxy.name = "identity:fixture";
    proxy.position.set(-2, 3, -10);
    proxy.userData.gteki_identity = { front: [0, 0, 1], regions: [{ kind: "name", min: [-0.8, -0.2, -halfDepth], max: [0.8, 0.2, halfDepth] }] };
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    plate.name = "identity-faces"; plate.position.set(-2, 3, -10 + plateFront);
    root.add(proxy, plate); root.updateMatrixWorld(true);
    e.identityBoards = collectIdentityBoards(root);
    e.signMeshes = new Set([plate]);
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(proxy.position); e.camera.updateMatrixWorld(true);
    e.buildOccluders(root);
    expect(e.identity()[0]).toMatchObject({ id: "identity:fixture", frontFacing: true, occluded: "none" });
    // A sign genuinely in front of the name still reads as a sign occluder.
    const ahead = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    ahead.position.set(-2, 3, -9); root.add(ahead); root.updateMatrixWorld(true);
    e.signMeshes.add(ahead); e.occluders = []; e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe("sign");
  });

  it("reports no name rect or height for a board behind the camera or off to the side", () => {
    const { e, board } = runtime();
    e.camera.position.set(-2, 3, -11); e.camera.lookAt(-2, 3, -20); e.camera.updateMatrixWorld(true);
    expect(e.identity()[0]).toMatchObject({ inFrame: false, nameRect: null, nameHeightPx: null });
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(0, 3, -6); e.camera.updateMatrixWorld(true); // ~18° off-axis
    expect(e.identity()[0]).toMatchObject({ inFrame: false, nameRect: null, nameHeightPx: null });
    e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const frame = e.identity()[0];
    expect(frame.inFrame).toBe(true);
    expect(frame.nameHeightPx).toBeGreaterThan(0);
  });

  it("only counts an occluder that reaches the name rect, not the rest of the board", () => {
    const { e, board, root } = runtime();
    board.userData.gteki_identity = { regions: [{ kind: "name", min: [-0.8, -0.2, 0], max: [0.8, 0.2, 0] }] };
    e.identityBoards = collectIdentityBoards(root);
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    edge.position.set(-3.5, 3, -9.5); root.add(edge); root.updateMatrixWorld(true);
    e.signMeshes = new Set([edge]);
    e.buildOccluders(root);
    // The board is 4 m wide; the name rect (inset 10 %) spans -2.72 … -1.28, so this leaves it clear.
    expect(e.identity()[0]).toMatchObject({ frontFacing: true, occluded: "none" });
    edge.position.x = -2; edge.geometry = new THREE.PlaneGeometry(2, 1); root.updateMatrixWorld(true);
    e.occluders = []; e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe("sign");
  });

  it("ignores a sign-role child of the board itself", () => {
    const { e, board, root } = runtime();
    const text = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    text.position.z = 0.01; board.add(text); root.updateMatrixWorld(true);
    e.signMeshes = new Set([text]);
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe("none");
  });

  it("never counts route markers as occluders", () => {
    const { e, root } = runtime();
    e.trackOverlay = (m: THREE.MeshBasicMaterial) => m;
    e.routeGroup.add(e.beacon(new THREE.Vector3(-2, 0.5, -5), 0x7dffa0, 5));
    e.camera.position.set(-2, 3, 0); e.camera.lookAt(e.identityBoards[0]!.object.position); e.camera.updateMatrixWorld(true);
    e.buildOccluders(root);
    expect(e.identity()[0].occluded).toBe("none");
  });

  it("setRouteMarkersVisible hides beacons across a route recompute and restores them", () => {
    const { e } = runtime();
    e.trackOverlay = (m: THREE.MeshBasicMaterial) => m;
    const build = () => {
      const beacons = [e.beacon(new THREE.Vector3(0, 0, 0), 0x7dffa0, 2.2), e.beacon(new THREE.Vector3(0, 0, 9), 0xffc857, 5)];
      e.routeGroup.add(...beacons);
      return beacons;
    };
    const first = build();
    expect(first.map((g: THREE.Group) => g.visible)).toEqual([true, true]);
    e.setRouteMarkersVisible(false);
    expect(first.map((g: THREE.Group) => g.visible)).toEqual([false, false]);
    const second = build(); // a recomputed route rebuilds them through the same path
    expect(second.map((g: THREE.Group) => g.visible)).toEqual([false, false]);
    e.setRouteMarkersVisible(true);
    expect([...first, ...second].map((g: THREE.Group) => g.visible)).toEqual([true, true, true, true]);
  });

  it("hides unselected overlap in labelInfo, offsets endpoints and keeps protecting in overview", () => {
    const { e, board } = runtime();
    e.mode = "walk";
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const r = e.identity()[0].nameRect;
    const plain = labelAt(board, false), endpoint = labelAt(board, true); e.poiLabels = [plain, endpoint];
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
    // #400: overview is protected too — a chip is never drawn over a readable name in any mode.
    e.mode = "overview"; e.updateIdentityLabels();
    expect(plain.identityHidden).toBe(true); expect(endpoint.identityOffsetY).toBeLessThan(0);
  });

  it("declutters an overview chip where its identity nudge actually draws it (#400)", () => {
    const { e, board } = runtime();
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const a = { ...labelAt(board, false), poiId: "poi:a", klass: 3, routable: true };
    const b = { ...labelAt(board, false), poiId: "poi:b", klass: 3, routable: true };
    b.obj.position.y -= 0.7; b.obj.updateMatrixWorld(true);
    e.poiLabels = [a, b];
    const screenY = (l: typeof a) => (-l.obj.getWorldPosition(new THREE.Vector3()).project(e.camera).y * 0.5 + 0.5) * e.viewSize.h;
    const [ya, yb] = [screenY(a), screenY(b)];
    // Far enough apart to coexist (26 px box plus the 3 px pad and 4 px hold), so nothing is hidden yet.
    expect(Math.abs(ya - yb)).toBeGreaterThan(40);
    e.declutterDirty = true; e.declutterAt = -Infinity;
    e.updateDeclutter(0);
    expect([a.decluttered, b.decluttered]).toEqual([false, false]);
    // The identity pass nudges a onto b; declutter must hide one where a is now drawn, not at its anchor.
    a.identityOffsetY = yb - ya;
    e.declutterDirty = true;
    e.updateDeclutter(1000);
    expect([a.decluttered, b.decluttered].filter(Boolean)).toHaveLength(1);
  });

  it("protects chips only for identity boards the camera can actually see (#342)", () => {
    const { e, board, root } = runtime();
    e.mode = "walk";
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    const chip = labelAt(board, false); e.poiLabels = [chip];
    e.updateIdentityLabels();
    expect(chip.identityHidden).toBe(true);
    // A wall between the camera and the board hides the board: its screen rect must not displace a chip.
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.set(-2, 2, -5); root.add(wall); root.updateMatrixWorld(true);
    e.buildOccluders(root); e.refreshOccluders();
    e.updateIdentityLabels();
    expect(chip.identityHidden).toBe(false);
  });

  it("does not push chips for a name that faces away or sits behind the camera (#400)", () => {
    const { e, board } = runtime();
    e.mode = "walk";
    const chip = labelAt(board, false); e.poiLabels = [chip];
    // The board's face is +Z; a camera on its back side still projects a rect, but the name is unreadable.
    e.camera.position.set(board.position.x, board.position.y, board.position.z - 10);
    e.camera.lookAt(board.position); e.camera.updateMatrixWorld(true);
    e.updateIdentityLabels();
    expect(chip.identityHidden).toBe(false);
    // Facing the board but with the board behind the camera: nothing to protect either.
    e.camera.position.set(-2, 2, 0); e.camera.lookAt(-2, 2, 10); e.camera.updateMatrixWorld(true);
    e.updateIdentityLabels();
    expect(chip.identityHidden).toBe(false);
  });
});
