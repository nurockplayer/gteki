// CPU recognition and rhythm proxies, not a five-second human recognition claim.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildWorld } from "../pipeline/walker_replay.ts";
import { edgeBearing, nameVisibility, spawnCamera } from "../pipeline/identity_camera.ts";
import { IDENTITY_RANGE_M, MAX_NAME_HEIGHT_NDC, identityFraming, type FramingBoard, type FramingRig, type NdcRect } from "../../../apps/web/src/explorer/identityFraming.ts";
import { identityFront, identityNameCentre, identityNameCorners, parseIdentityBoard, withinObject } from "../../../apps/web/src/explorer/identityBoards.ts";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";
import { FOLLOW, FOLLOW_CAT, FOV, catShoulder, followPose, solveRaisedBoom } from "../../../apps/web/src/explorer/followCamera.ts";
import { CAT_AVATAR_HEIGHT_M } from "../../../apps/web/src/explorer/avatarSelection.ts";
import { freeArea } from "../../../apps/web/src/explorer/overviewFraming.ts";
import { buildSigns, identityArt, identityTypography, IDENTITY_TYPE, LOW_TEXEL_SCALE, type IdentityBoard, type SignSpec } from "./signs.ts";
import identity from "./identity.json";
import signage from "./signage.json";

const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const boards = identity.boards as IdentityBoard[];
const station = json("../gteki/station.json");
const graph = json("../gteki/graph.json");
const sceneSource = readFileSync(new URL("./scene.ts", import.meta.url), "utf8");
const nodes = new Map<string, { position: { x: number; y: number; z: number } }>(graph.nodes.map((n: { id: string }) => [n.id, n]));
const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const signs = signage.signs as SignSpec[];
const evidence: Record<string, unknown> = {};
const paintedText: { text: string; font: string }[] = [];
afterAll(() => writeFileSync("/tmp/gteki-identity-evidence.json", JSON.stringify(evidence, null, 2)+"\n"));

function stubDocument() {
  return { createElement: () => {
    const state: Record<string, unknown> = { font: "16px sans" };
    const ctx = new Proxy(state, {
      get(t, k: string) {
        if (k === "fillText") return (text: string) => paintedText.push({ text, font: String(t.font) });
        if (k === "measureText") return (text: string) => ({ width: [...text].reduce((w, ch) => w +
          (ch.charCodeAt(0) > 0x2e7f ? 1 : /\d/.test(ch) ? 0.6 : 0.56), 0) * Number(/([\d.]+)px/.exec(String(t.font))?.[1] ?? 16) });
        return k in t ? t[k] : () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    });
    return { width: 0, height: 0, getContext: () => ctx };
  } };
}
beforeEach(() => { paintedText.length = 0; vi.stubGlobal("document", stubDocument()); });
afterEach(() => vi.unstubAllGlobals());
const build = (extra = boards, tier = LOW_TEXEL_SCALE) => buildSigns(THREE, signs, toRenderer, 1, tier, 4096, undefined, extra);

/** One board's name-region and text projection from a camera: the recognition proxy used by both spawn tests. */
function projectBoard(built: ReturnType<typeof build>, b: IdentityBoard, camera: THREE.PerspectiveCamera, h: number) {
  const proxy = built.group.getObjectByName(b.id)!;
  proxy.updateMatrixWorld(true);
  const type = identityTypography(b);
  const region = proxy.userData.gteki_identity.regions[0];
  const corners: THREE.Vector3[] = [];
  for (const x of [region.min[0], region.max[0]]) for (const y of [region.min[1], region.max[1]]) for (const z of [region.min[2], region.max[2]]) {
    corners.push(new THREE.Vector3(x, y, z).applyMatrix4(proxy.matrixWorld).project(camera));
  }
  const projected = (emM: number, centerY: number, x: number) => {
    if (corners.some((p) => p.z < -1 || p.z > 1)) return null;
    const cap = emM*IDENTITY_TYPE.cap;
    const points = [-1, 1].map((side) => new THREE.Vector3((x-0.5)*b.widthM, (0.5-centerY)*b.heightM+side*cap/2, 0.042).applyMatrix4(proxy.matrixWorld));
    if (points.some((p) => p.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near)) return null;
    points.forEach((p) => p.project(camera));
    return Math.abs(points[0]!.y-points[1]!.y)*h/2;
  };
  const jp = projected(type.jaM, type.jaY, type.jaX), en = projected(type.enM, type.enY, type.enX);
  const result = nameVisibility(corners, jp, en);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(proxy.matrixWorld);
  const frontFacing = normal.dot(camera.position.clone().sub(proxy.getWorldPosition(new THREE.Vector3()))) > 0;
  if (!frontFacing) { result.reasons.push("back face"); result.pass = false; }
  const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  const edgeOut = Math.max(0, maxX-1, -1-minX, maxY-1, -1-minY);
  return { proxy, type, region, corners, jp, en, result, frontFacing, edgeOut };
}

it("declares identity provenance equally, without changing routes or station-code schema", () => {
  const src = json("../data/graph.src.json");
  expect(station.sources).toEqual(src.sources);
  expect(station.dataFiles).toEqual(src.dataFiles);
  expect(boards.length).toBeLessThanOrEqual(10);
  expect(new Set(boards.map((b) => b.id)).size).toBe(boards.length);
  const sourceIds = new Set(station.sources.map((s: { id: string }) => s.id));
  for (const b of boards) {
    for (const id of b.sourceIds) expect(sourceIds.has(id), `${b.id}: ${id}`).toBe(true);
    const edges = graph.edges.filter((e: { from: string; to: string; id: string }) => b.anchor.nodeId ?
      e.from === b.anchor.nodeId || e.to === b.anchor.nodeId : e.id === b.anchor.edgeId);
    expect(edges.some((e: { verification: string }) => e.verification === "verified"), b.id).toBe(true);
    expect(JSON.stringify(b.text)).not.toMatch(/UNVERIFIED|draft|logo|owl/i);
    expect(b).not.toHaveProperty("verification");
    expect(b).not.toHaveProperty("utilityLights");
    expect(b).not.toHaveProperty("equipmentNote");
    expect(b.placement).toBe("GTEki-authored, not a surveyed sign location");
    expect(b.textVerification).toBe(b.kind === "station-name" ? "VERIFIED" : "APPROXIMATE");
  }
  expect(station.station.codes).toEqual([
    { operatorId: "tokyometro", code: "M25" }, { operatorId: "tokyometro", code: "Y09" },
    { operatorId: "tokyometro", code: "F09" }, { operatorId: "jreast", code: "JY13" },
  ]);
  const osm = station.sources.find((s: { id: string }) => s.id === "osm-ikebukuro-station-refs-2026-10");
  expect(osm).toMatchObject({ license: { name: "ODbL 1.0" }, attribution: "© OpenStreetMap contributors", navigation_use: "NOT_FOR_ROUTING" });
  for (const id of ["2558121915 v35", "9240336 v13", "9240281 v12", "7967610 v17"]) expect(osm.derivation).toContain(id);
  for (const fact of ["1972920 v130 (2026-10-08)", "1972960 v134", "21361895 v7 (2026-10-05)", "4684034 v138 (2026-10-10)", "retrieved 2026-10-24"]) expect(osm.derivation).toContain(fact);
  for (const b of boards.filter((b) => b.kind === "station-name")) expect(b.text).toEqual({
    ja: "池袋", kana: "いけぶくろ", en: "Ikebukuro",
    transfer: "JR 山手線 Yamanote JY13 · 埼京線 Saikyo JA12 · 湘南新宿ライン Shonan-Shinjuku JS21 · 丸ノ内線 Marunouchi M25 · 有楽町線 Yurakucho Y09 · 副都心線 Fukutoshin F09",
  });
  const meeting = boards.find((b) => b.kind === "meeting-point")!;
  expect(meeting.textVerification).toBe("APPROXIMATE");
  expect(meeting.text.ja).toBe("いけふくろう");
  expect(meeting.text.status).toContain("Approximate");
});

it("provides a tight name region on metadata-only objects with zero draw calls and no collision role", () => {
  const built = build();
  for (const b of boards) {
    const proxy = built.group.getObjectByName(b.id)!;
    expect(proxy).toBeInstanceOf(THREE.Object3D);
    expect(proxy).not.toBeInstanceOf(THREE.Mesh);
    expect(proxy.children).toEqual([]);
    expect(proxy.userData.gteki_role).toBe("sign");
    expect(proxy.userData.gteki_identity.front).toEqual([0, 0, 1]);
    const r = proxy.userData.gteki_identity.regions[0];
    expect(r.kind).toBe("name");
    expect(r.max[0]-r.min[0]).toBeLessThan(b.widthM);
    expect(r.max[1]-r.min[1]).toBeLessThan(b.heightM*0.8);
    expect(r.min[2]).toBeGreaterThan(0);
    // The name box ends above the first transfer row, which is anchored to the canvas bottom: a 0.0027 m
    // bottom margin plus a 0.13 em (0.54 m base) cap. Compact names use the taller 0.82 m canvas.
    if (b.kind === "station-name") {
      const artH = identityArt(b).heightM;
      expect(r.min[1]).toBeGreaterThan((0.0027 + 0.13*0.54 - 0.5*artH)*identityTypography(b).artScale);
    }
  }
  const meshes: THREE.Object3D[] = [];
  built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
  expect(meshes.length).toBe(built.pages.length+2);
  expect(built.group.getObjectByName("identity-faces")).toBeInstanceOf(THREE.Mesh);
  // Collision is assembled exclusively from GLB meshes + fences/bridges before signs are added.
  expect(sceneSource.indexOf("assembleCollision(THREE, gltf.scene")).toBeLessThan(sceneSource.indexOf("root.add(signs.group)"));
  expect(sceneSource).toContain("(identity as { boards: IdentityBoard[] }).boards");
  built.dispose();
});

it("tracks Explorer's north-facing spawn path, rather than the scene's unused suggested headings", () => {
  const explorer = readFileSync(new URL("../../../apps/web/src/explorer/explorer.ts", import.meta.url), "utf8");
  expect(explorer).toContain("headingDeg = 0");
  expect(explorer).toContain("return this.walkFrom({ x: n.position.x, y: n.position.y, z }, headingDeg);");
  expect(explorer).toContain("private pitch = -0.12;");
  expect(explorer).toContain("private firstPerson = false;");
  expect(explorer).not.toContain(".spawnPoints");
});

it("rejects cut, offscreen, behind-camera, avatar-covered and undersized names", () => {
  const corners = (x0: number, y0: number, x1: number, y1: number, z = 0) =>
    [new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y1, z)];
  expect(nameVisibility(corners(-0.5, 0, 0.5, 0.5), 18, 12).pass).toBe(true);
  expect(nameVisibility(corners(-0.5, 0, 1.01, 0.5), 18, 12)).toMatchObject({ fullyInFrame: false, pass: false, reasons: ["cut by screen edge"] });
  expect(nameVisibility(corners(1.1, 0, 1.5, 0.5), 18, 12).reasons).toContain("not in frame");
  expect(nameVisibility(corners(-0.5, 0, 0.5, 0.5, 2), null, null).pass).toBe(false);
  expect(nameVisibility(corners(-0.1, -0.6, 0.1, -0.4), 18, 12)).toMatchObject({ fullyInFrame: true, avatarOverlap: true, pass: false });
  expect(nameVisibility(corners(-0.5, 0, 0.5, 0.5), 17.99, 12).pass).toBe(false);
  expect(nameVisibility(corners(-0.5, 0, 0.5, 0.5), 18, 11.99).pass).toBe(false);
});

it("matches spec 13's edge order, verified preference and node-oriented 2 m bearing", () => {
  const p = (x: number, y: number) => ({ x, y, z: 0 });
  const local = new Map([["a", { position: p(0, 0) }], ["b", { position: p(0, 10) }]]);
  const edges = [
    { id: "draft", from: "a", to: "b", verification: "draft" },
    { id: "verified", from: "b", to: "a", verification: "verified", geometry: [p(0, 10), p(3, 0), p(0, 0)] },
  ];
  expect(edgeBearing("a", local, edges)).toEqual({ heading: 90, edge: "verified" });
  expect(edgeBearing("a", local, edges.slice(0, 1))).toEqual({ heading: 0, edge: "draft" });
});

it("reports real third-person opening failures and spec-13 +0 without recentering boards", async () => {
  const world = await buildWorld();
  const built = build();
  const rows = [];
  const poses = [];
  const openingFailures = [];
  for (const view of ["opening", "spec13+0"] as const) for (const nid of station.spawnNodeIds as string[]) {
    const b = boards.find((b) => b.anchor.nodeId === nid)!;
    expect(b, nid).toBeDefined();
    const edge = edgeBearing(nid, nodes, graph.edges);
    const heading = view === "opening" ? 0 : edge.heading;
    const row: Record<string, unknown> = { spawn: nid, view, heading, board: b.id, edge: edge.edge };
    for (const [label, w, h] of [["phone", 390, 844], ["desktop", 1280, 720]] as const) {
      const pose = spawnCamera(world, nodes.get(nid)!.position, w, h, heading);
      const { camera, ...metrics } = pose;
      if (label === "phone") {
        poses.push({ spawn: nid, view, ...metrics, position: camera.position.toArray(), fov: camera.fov });
        row.distanceM = camera.position.distanceTo(toRenderer(b.position.x, b.position.y, b.position.z));
      }
      const { jp, en, result, frontFacing, type } = projectBoard(built, b, camera, h);
      row[label] = { jp, en, ...result, frontFacing };
      expect(result.pass).toBe(result.fullyInFrame && !result.avatarOverlap && frontFacing && jp !== null && jp >= 18 && en !== null && en >= 12);
      if (label === "phone") {
        if (view === "opening" && !result.pass) openingFailures.push(nid);
        const face = built.group.userData.faces.find((f: { id: string }) => f.id === b.id)!;
        const art = built.identityArt.find((a) => a.canvasPx.w === face.canvasPx.w)!;
        const texelCap = type.jaM/type.artScale/art.heightM*art.canvasPx.h*IDENTITY_TYPE.cap;
        row.jpTexelsPerCssPx = jp === null ? null : texelCap/jp;
      }
    }
    rows.push(row);
  }
  console.log("recognition proxy (actual third-person camera, conservative 0.7 em caps)", JSON.stringify(rows));
  evidence.recognitionProxy = rows;
  evidence.cameraPoses = poses;
  expect(openingFailures).toEqual(station.spawnNodeIds);
  built.dispose();
}, 30_000);

it("reports the cat camera's identity baseline at rest, spawn x view x project (#342)", async () => {
  const world = await buildWorld();
  const built = build();
  const rows = [];
  const pitchSearch = [];
  for (const view of ["opening", "spec13+0"] as const) for (const nid of station.spawnNodeIds as string[]) {
    const anchored = boards.find((b) => b.anchor.nodeId === nid)!;
    const edge = edgeBearing(nid, nodes, graph.edges);
    const heading = view === "opening" ? 0 : edge.heading;
    for (const [project, w, h] of [["phone", 390, 844], ["desktop", 1280, 720]] as const) {
      const { camera, ...metrics } = spawnCamera(world, nodes.get(nid)!.position, w, h, heading, "cat");
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const candidates = [];
      for (const b of boards) {
        const centre = toRenderer(b.position.x, b.position.y, b.position.z);
        const distance = camera.position.distanceTo(centre);
        if (distance > IDENTITY_RANGE_M) continue;
        const { jp, en, result, frontFacing, edgeOut } = projectBoard(built, b, camera, h);
        const dir = centre.clone().sub(camera.position).normalize();
        candidates.push({ board: b.id, distance, edgeOut,
          bearingDeg: THREE.MathUtils.radToDeg(Math.atan2(dir.dot(right), dir.dot(forward))),
          elevationDeg: THREE.MathUtils.radToDeg(Math.atan2(dir.y, Math.hypot(dir.x, dir.z))),
          jp, en, ...result, frontFacing });
      }
      const ranked = candidates.slice().sort((a, b) => (a.pass === b.pass ? (a.edgeOut === b.edgeOut ? a.distance-b.distance : a.edgeOut-b.edgeOut) : a.pass ? -1 : 1));
      const best = ranked[0] ?? null;
      rows.push({ spawn: nid, view, project, heightM: metrics.height, lookPitchDeg: THREE.MathUtils.radToDeg(metrics.lookPitch),
        boomRaiseDeg: THREE.MathUtils.radToDeg(metrics.raise), boardsInRange: candidates.length, boards: candidates, best });
      if (project === "phone") {
        // Smallest upward rotation (deg about the camera's right axis, 0-30 in 0.5 steps) that brings the
        // spawn's anchored board fully in frame. Position, FOV and boom stay at rest: only the look rotates.
        let found: { pitchUpDeg: number; lookPitchDeg: number; angleFromForwardDeg: number } | null = null;
        for (let pitchUpDeg = 0; pitchUpDeg <= 30; pitchUpDeg += 0.5) {
          const rotated = camera.clone();
          rotated.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(right, THREE.MathUtils.degToRad(pitchUpDeg)));
          rotated.updateMatrixWorld(true);
          const { result } = projectBoard(built, anchored, rotated, h);
          if (!result.pass) continue;
          const dir = toRenderer(anchored.position.x, anchored.position.y, anchored.position.z).sub(rotated.position).normalize();
          const view2 = rotated.getWorldDirection(new THREE.Vector3());
          found = { pitchUpDeg, lookPitchDeg: THREE.MathUtils.radToDeg(metrics.lookPitch)+pitchUpDeg,
            angleFromForwardDeg: THREE.MathUtils.radToDeg(Math.acos(dir.dot(view2))) };
          break;
        }
        pitchSearch.push({ spawn: nid, view, board: anchored.id, ...found });
      }
    }
  }
  console.log("cat identity proxy", JSON.stringify(rows));
  console.log("cat identity pitch search", JSON.stringify(pitchSearch));
  evidence.catRecognitionProxy = rows;
  evidence.catPitchSearch = pitchSearch;
  // Today's baseline: recorded as observed, so any camera/board change shows up as a diff here.
  expect(rows).toHaveLength(station.spawnNodeIds.length*4);
  expect(rows.filter((r) => r.best?.pass).map((r) => `${r.spawn} ${r.view} ${r.project} ${r.best?.board}`)).toEqual([
    "w_c opening desktop identity-w_c",
    "sw_h spec13+0 desktop identity-sw_h",
  ]);
  // Rotating the cat camera up 0-30 degrees alone fixes no anchored board on the phone: the misses are lateral.
  expect(pitchSearch.map((r) => [r.spawn, r.view, r.pitchUpDeg ?? null])).toEqual([
    ["c_mid", "opening", null], ["c_e2", "opening", null], ["n_h", "opening", null],
    ["sp_e", "opening", null], ["w_c", "opening", null], ["sw_h", "opening", null],
    ["c_mid", "spec13+0", null], ["c_e2", "spec13+0", null], ["n_h", "spec13+0", null],
    ["sp_e", "spec13+0", null], ["w_c", "spec13+0", null], ["sw_h", "spec13+0", null],
  ]);
  built.dispose();
}, 30_000);

it("replays Explorer's initial identity framing for the cat and reports why it finds no look (#342)", async () => {
  const world = await buildWorld();
  const built = build();
  built.group.updateMatrixWorld(true);
  const targets = [...world.ground, ...world.collider];
  const sceneBoards = boards.map((b) => ({ id: b.id, spec: b, board: parseIdentityBoard(built.group.getObjectByName(b.id)!)! }));
  // Explorer's ndcFree comes from freeRect() (explorer.ts). On a phone in walk the search panel is folded
  // (app.ts PanelFold.fold for max-width 720), the route sheet only counts in overview (sheetInset), and the
  // credit line is 38 px tall at that width (.app.has-credit inside @media max-width 720, styles.css:300);
  // safe-area inset is 0 in a browser. The top-right walk minimap is also visible then, but its rect needs a
  // layout pass this node test does not have, so it is not subtracted here.
  const phoneFree = freeArea({ w: 390, h: 844 }, null, 38, null);
  const phoneNdc = { x0: 2*phoneFree.x/390-1, x1: 2*(phoneFree.x+phoneFree.w)/390-1,
    y0: 1-2*(phoneFree.y+phoneFree.h)/844, y1: 1-2*phoneFree.y/844 };
  // The walk minimap IS visible on a phone (Minimap.refresh shows it in every non-overview mode): 190 px wide,
  // 16 px from the right, top 60 px (styles.css .minimap). Its height needs layout (map 190x190 + two 28 px
  // control rows + 4 px gaps + 6 px padding + border); 260 px is the estimate used here, so this rect is
  // approximate while the credit-only one above is read off the CSS.
  const minimapFree = freeArea({ w: 390, h: 844 }, null, 38, { x: 390-16-190, y: 60, w: 190, h: 260 });
  const minimapNdc = { x0: 2*minimapFree.x/390-1, x1: 2*(minimapFree.x+minimapFree.w)/390-1,
    y0: 1-2*(minimapFree.y+minimapFree.h)/844, y1: 1-2*minimapFree.y/844 };
  const rows = [];
  for (const view of ["opening", "spec13+0"] as const) for (const nid of station.spawnNodeIds as string[]) {
    const edge = edgeBearing(nid, nodes, graph.edges);
    const heading = view === "opening" ? 0 : edge.heading;
    for (const [project, w, h] of [["phone", 390, 844], ["desktop", 1280, 720]] as const) {
      const rest = spawnCamera(world, nodes.get(nid)!.position, w, h, heading, "cat");
      const spawnRenderer = toRenderer(nodes.get(nid)!.position.x, nodes.get(nid)!.position.y, nodes.get(nid)!.position.z);
      const feet = new THREE.Vector3(spawnRenderer.x, rest.ground, spawnRenderer.z);
      const head = feet.clone().add(new THREE.Vector3(0, FOLLOW_CAT.pivotY, 0));
      const ray = new THREE.Raycaster();
      // Explorer.frameInitialIdentity's board list: cameraTargets minus signs (this world carries none) and
      // minus anything inside the board's own object.
      const framing: (FramingBoard & { id: string })[] = sceneBoards.map(({ spec, board }) => {
        const centre = identityNameCentre(board);
        const boardTargets = targets.filter((o) => !withinObject(o, board.object));
        const visible = (from: THREE.Vector3, to: THREE.Vector3) => {
          const direction = to.clone().sub(from);
          ray.set(from, direction.clone().normalize());
          ray.near = 0;
          ray.far = Math.max(0, direction.length()-0.05);
          return castAll(ray, boardTargets).length === 0;
        };
        return { id: spec.id, centre, front: identityFront(board), nameCorners: identityNameCorners(board),
          blocked: head.distanceTo(centre) > IDENTITY_RANGE_M || !visible(head, centre), visible };
      });
      // The same cat rig frameInitialIdentity builds; cameraSides is empty (the CPU world has no blockers).
      const top = feet.clone().add(new THREE.Vector3(0, CAT_AVATAR_HEIGHT_M, 0));
      const rig: FramingRig = {
        shoulder: catShoulder(w/h), lift: FOLLOW_CAT.lift, drop: FOLLOW_CAT.drop, distance: FOLLOW_CAT.distance,
        body: [feet, top],
        clear: (cameraPos, pivot) => {
          const cast = (back: THREE.Vector3) => {
            ray.set(pivot, back);
            ray.near = 0;
            ray.far = FOLLOW_CAT.distance+FOLLOW.clearance;
            return castAll(ray, targets).map((hit) => ({ distance: hit.distance, cameraOnly: false }));
          };
          const solved = solveRaisedBoom(FOLLOW_CAT.distance, cameraPos.clone().sub(pivot).normalize(), cast, 0, 0, true);
          if (solved.distance < FOLLOW.comfortDistance) return false;
          const settled = pivot.clone().addScaledVector(solved.back, solved.distance);
          const direction = feet.clone().lerp(top, 0.5).sub(settled);
          ray.set(settled, direction.clone().normalize());
          ray.near = 0;
          ray.far = Math.max(0, direction.length()-0.05);
          return castAll(ray, targets).length === 0;
        },
      };
      for (const [freeLabel, free] of [["full", { x0: -1, y0: -1, x1: 1, y1: 1 }], ...(project === "phone" ? [["phone-walk", phoneNdc], ["phone-walk+minimap", minimapNdc]] as const : [])] as [string, NdcRect][]) {
        const look = identityFraming(head, rest.yaw, rest.pitch, framing, w/h, FOV.follow, undefined, free, rig);
        // Copy of identityFraming's per-board gates, in its order (diagnosis only; the call above decides).
        const tanV = Math.tan(THREE.MathUtils.degToRad(FOV.follow/2)), tanH = tanV*(w/h);
        const left = Math.max(-1, free.x0), right = Math.min(1, free.x1);
        const freeBottom = Math.max(-1, free.y0), freeTop = Math.min(1, free.y1);
        const bottom = Math.max(-0.4, freeBottom), topBand = Math.min(0.7, freeTop);
        const minX = left+(right-left)*0.2, maxX = right-(right-left)*0.2;
        const targetX = (minX+maxX)/2, targetY = THREE.MathUtils.clamp(0.25, bottom+(topBand-bottom)*0.2, topBand-(topBand-bottom)*0.2);
        const rejections = framing.slice().sort((a, b) => head.distanceToSquared(a.centre)-head.distanceToSquared(b.centre)).map((board) => {
          const toward = board.centre.clone().sub(head), distance = toward.length();
          if (board.blocked) return { board: board.id, reason: distance > IDENTITY_RANGE_M ? "blocked: out of range" : "blocked: occluded from head" };
          if (distance < 0.1) return { board: board.id, reason: "too close" };
          if (board.front.dot(toward.clone().negate().normalize()) <= 0.2) return { board: board.id, reason: "back face at spawn" };
          const camera = new THREE.PerspectiveCamera(FOV.follow, w/h, 0.05, 100);
          let y = Math.atan2(-toward.x, -toward.z);
          let p = THREE.MathUtils.clamp(Math.atan2(toward.y, Math.hypot(toward.x, toward.z)), -1.1, 0.5);
          const project = () => {
            const pose = followPose(head, y, p, rig.shoulder, rig.lift, rig.drop);
            camera.position.copy(pose.pivot).addScaledVector(pose.back, rig.distance);
            camera.lookAt(pose.target);
            camera.updateMatrixWorld(true);
            return board.centre.clone().project(camera);
          };
          for (let i = 0; i < 8; i++) {
            const ndc = project();
            y -= Math.atan((ndc.x-targetX)*tanH);
            p = THREE.MathUtils.clamp(p+Math.atan((ndc.y-targetY)*tanV), -1.1, 0.5);
          }
          const ndc = project();
          if (ndc.x < minX || ndc.x > maxX || ndc.y < bottom || ndc.y > topBand || Math.abs(ndc.z) > 1) return { board: board.id, reason: "centre outside free band" };
          const name = board.nameCorners.map((c) => c.clone().project(camera));
          if (!name.length || name.some((c) => Math.abs(c.z) > 1)) return { board: board.id, reason: "name behind camera" };
          const box = new THREE.Box3().setFromPoints(name);
          if (box.max.y-box.min.y > MAX_NAME_HEIGHT_NDC || box.min.x < left || box.max.x > right || box.min.y < freeBottom || box.max.y > freeTop) return { board: board.id, reason: "name box outside free area" };
          if (rig.body!.some((point) => {
            const c = point.clone().project(camera);
            return Math.abs(c.z) > 1 || c.x < left || c.x > right || c.y < freeBottom || c.y > freeTop;
          })) return { board: board.id, reason: "cat body outside free area" };
          if (rig.clear && !rig.clear(camera.position.clone(), followPose(head, y, p, rig.shoulder, rig.lift, rig.drop).pivot)) return { board: board.id, reason: "boom cannot clear" };
          if (board.front.dot(camera.position.clone().sub(board.centre).normalize()) <= 0.2) return { board: board.id, reason: "back face at look" };
          if (board.visible && !board.visible(camera.position.clone(), board.centre.clone())) return { board: board.id, reason: "not visible from camera" };
          return { board: board.id, reason: "accepted" };
        });
        const chosenBoard = look ? framing.find((b) => b.centre.distanceTo(look.centre) < 1e-9)! : null;
        const applied = look && chosenBoard ? (() => {
          const spec = sceneBoards.find((s) => s.id === chosenBoard.id)!.spec;
          const moved = spawnCamera(world, nodes.get(nid)!.position, w, h, 0, "cat", { yaw: look.yaw, pitch: look.pitch });
          const { jp, en, result } = projectBoard(built, spec, moved.camera, h);
          return { pass: result.pass, reasons: result.reasons, jp, en,
            distanceM: moved.camera.position.distanceTo(toRenderer(spec.position.x, spec.position.y, spec.position.z)),
            cameraHeightM: moved.height, lookPitchDeg: THREE.MathUtils.radToDeg(moved.lookPitch), boomRaiseDeg: THREE.MathUtils.radToDeg(moved.raise), boomM: moved.distance };
        })() : null;
        rows.push({ spawn: nid, view, project, ndcFree: freeLabel, found: Boolean(look), chosen: chosenBoard?.id ?? null,
          lookYawDeg: look ? THREE.MathUtils.radToDeg(look.yaw) : null, lookPitchDeg: look ? THREE.MathUtils.radToDeg(look.pitch) : null,
          applied, rejections });
      }
    }
  }
  console.log("cat identity framing", JSON.stringify(rows));
  evidence.catIdentityFraming = rows;
  // Observed baseline (2026-11-08 JST), pinned so any framing or camera change shows as a diff.
  expect(rows).toHaveLength(station.spawnNodeIds.length*2*4);
  expect(rows.filter((r) => !r.found).map((r) => `${r.spawn} ${r.view} ${r.project} ${r.ndcFree}`)).toEqual([
    "n_h opening phone phone-walk+minimap",
    "n_h spec13+0 phone phone-walk+minimap",
  ]);
  // Every look that is found chooses the board anchored at that spawn.
  expect(rows.filter((r) => r.found && r.chosen !== `identity-${r.spawn}`)).toEqual([]);
  // Applying the look: every phone rect clears the 0.7 em text-size proxy for c_mid, c_e2, sp_e, w_c and
  // sw_h; desktop only for w_c and sw_h (c_mid desktop is 17.6 px, a 0.4 px gap the GPU OCR run decides).
  expect(rows.filter((r) => r.applied?.pass).map((r) => `${r.spawn} ${r.view} ${r.project} ${r.ndcFree}`)).toEqual([
    "c_mid opening phone full",
    "c_mid opening phone phone-walk",
    "c_mid opening phone phone-walk+minimap",
    "c_e2 opening phone full",
    "c_e2 opening phone phone-walk",
    "c_e2 opening phone phone-walk+minimap",
    "sp_e opening phone full",
    "sp_e opening phone phone-walk",
    "sp_e opening phone phone-walk+minimap",
    "w_c opening phone full",
    "w_c opening phone phone-walk",
    "w_c opening phone phone-walk+minimap",
    "w_c opening desktop full",
    "sw_h opening phone full",
    "sw_h opening phone phone-walk",
    "sw_h opening phone phone-walk+minimap",
    "sw_h opening desktop full",
    "c_mid spec13+0 phone full",
    "c_mid spec13+0 phone phone-walk",
    "c_mid spec13+0 phone phone-walk+minimap",
    "c_e2 spec13+0 phone full",
    "c_e2 spec13+0 phone phone-walk",
    "c_e2 spec13+0 phone phone-walk+minimap",
    "sp_e spec13+0 phone full",
    "sp_e spec13+0 phone phone-walk",
    "sp_e spec13+0 phone phone-walk+minimap",
    "w_c spec13+0 phone full",
    "w_c spec13+0 phone phone-walk",
    "w_c spec13+0 phone phone-walk+minimap",
    "w_c spec13+0 desktop full",
    "sw_h spec13+0 phone full",
    "sw_h spec13+0 phone phone-walk",
    "sw_h spec13+0 phone phone-walk+minimap",
    "sw_h spec13+0 desktop full",
  ]);
  built.dispose();
}, 30_000);

it("isolates identity within 2 MiB low including mipmaps and preserves round-0 shared atlas sizes", () => {
  const rows = [];
  for (const [tier, scale] of [["low", LOW_TEXEL_SCALE], ["high", 1]] as const) {
    const before = build([], scale), after = build(boards, scale);
    const mib = (pages: { w: number; h: number }[]) => pages.reduce((sum, p) => sum+p.w*p.h*4*4/3/1024**2, 0);
    expect(after.pages).toEqual(before.pages);
    expect(after.pages).toEqual(tier === "low" ? [{ w: 4096, h: 2048 }, { w: 4096, h: 512 }] : [{ w: 4096, h: 4096 }, { w: 4096, h: 4096 }]);
    expect(before.identityPages).toEqual([]);
    expect(after.identityPages).toHaveLength(1);
    expect(after.identityArt).toHaveLength(3);
    expect(after.identityArt.flatMap((a) => a.transferCapM)).toHaveLength(tier === "low" ? 0 : 4);
    if (tier === "high") evidence.transferCaps = boards.filter((b) => b.kind === "station-name").map((b) => {
      const face = after.group.userData.faces.find((f: { id: string }) => f.id === b.id)!;
      const art = after.identityArt.find((a) => a.canvasPx.w === face.canvasPx.w)!;
      return { board: b.id, cm: art.transferCapM.map((m) => m*identityTypography(b).artScale*100) };
    });
    rows.push({ tier, before: before.pages, after: after.pages, identity: after.identityPages,
      beforeMiB: mib(before.pages), sharedMiB: mib(after.pages), identityMiB: mib(after.identityPages),
      afterMiB: mib(after.pages)+mib(after.identityPages) });
    if (tier === "low") {
      expect(mib(after.identityPages)).toBeLessThanOrEqual(2);
    }
    before.dispose(); after.dispose();
  }
  console.log("Atlas delta (CPU estimated glyph widths; RGBA8 + mipmaps MiB)", JSON.stringify(rows));
  evidence.atlas = rows;
});

it("omits only low-tier transfer text while preserving name fonts, world positions and regions", () => {
  const low = build();
  const lowNames = paintedText.filter((r) => ["池袋", "いけぶくろ", "Ikebukuro"].includes(r.text));
  expect(lowNames).toHaveLength(6);
  expect(paintedText.some((r) => /Yamanote|Marunouchi/.test(r.text))).toBe(false);
  paintedText.length = 0;
  const high = build(boards, 1);
  expect(paintedText.filter((r) => ["池袋", "いけぶくろ", "Ikebukuro"].includes(r.text))).toEqual(lowNames);
  expect(paintedText.filter((r) => /Yamanote|Marunouchi/.test(r.text))).toHaveLength(4);
  for (const b of boards) {
    const l = low.group.getObjectByName(b.id)!, h = high.group.getObjectByName(b.id)!;
    expect(l.matrix).toEqual(h.matrix);
    expect(l.userData.gteki_identity).toEqual(h.userData.gteki_identity);
  }
  // The top of each cropped artwork stays fixed, preserving the painted names' world coordinates.
  for (const [i, art] of low.identityArt.entries()) {
    const full = high.identityArt[i]!;
    expect(art.centerY+art.heightM/2).toBeCloseTo(full.heightM/2, 12);
    expect(art.canvasPx.h/art.heightM).toBeCloseTo(Math.round(full.heightM*art.canvasPx.w/art.widthM)/full.heightM, 10);
  }
  low.dispose(); high.dispose();
});

it("keeps art aspect, painted name bounds and metadata aligned at both tiers, and disposes texture/material", () => {
  const regions = [];
  for (const scale of [LOW_TEXEL_SCALE, 1]) {
    const built = build(boards, scale);
    const artFaces = built.group.userData.faces.filter((f: { id: string }) => boards.some((b) => b.id === f.id));
    expect(artFaces).toHaveLength(10);
    for (const b of boards) {
      const face = artFaces.find((f: { id: string }) => f.id === b.id)!;
      // Artwork is uniformly scaled, with solid margins on taller panels in the same merged batch.
      expect(face.widthM/face.heightM).toBeCloseTo(face.canvasPx.w/face.canvasPx.h, 1);
      expect(face.heightM).toBeLessThanOrEqual(b.heightM);
      const proxy = built.group.getObjectByName(b.id)!;
      const box = proxy.userData.gteki_identity.regions[0];
      if (b.kind === "station-name") {
        const t = identityTypography(b);
        expect(box.min[0]).toBeCloseTo((t.jaX-0.5)*b.widthM, 8);
        expect(box.max[0]).toBeCloseTo((t.enX-0.5)*b.widthM+9*0.56*t.enM, 8);
        expect(box.min[1]).toBeCloseTo(Math.min((0.5-t.jaY)*b.heightM-t.jaM/2, (0.5-t.enY)*b.heightM-t.enM/2), 8);
        expect(box.max[1]).toBeCloseTo(Math.max((0.5-t.jaY)*b.heightM+t.jaM/2, (0.5-t.kanaY)*b.heightM+t.kanaM/2), 8);
      }
      if (scale === LOW_TEXEL_SCALE) regions.push({ board: b.id, min: box.min, max: box.max });
    }
    const mesh = built.group.getObjectByName("identity-faces") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const textureDispose = vi.spyOn(mesh.material.map!, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    built.dispose();
    expect(textureDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
  }
  evidence.nameRegions = regions;
});

for (const script of ["build_identity.py", "check_identity_rhythm.py", "check_identity_equipment.py"]) it(`checks ${script}`, () => {
  // Outer allowed single-worker vitest owns the shared lock; never re-lock in a child.
  const args = ["-I", fileURLToPath(new URL(`../pipeline/${script}`, import.meta.url)), ...(script === "build_identity.py" ? ["--check"] : [])];
  const result = spawnSync("python3", args, { encoding: "utf8" });
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stdout+result.stderr).toBe(0);
  console.log(result.stdout);
  if (script === "check_identity_rhythm.py") evidence.rhythm = JSON.parse(result.stdout);
  if (script === "check_identity_equipment.py") {
    const rows: { spawn: string; count: number; status: string }[] = JSON.parse(result.stdout);
    expect(rows.map((r) => r.spawn)).toEqual(station.spawnNodeIds);
    for (const row of rows) {
      expect(row.status).toBe(row.count >= 2 ? "proxy met (equipment)" : "proxy not met (equipment)");
      if (["c_mid", "sw_h"].includes(row.spawn)) expect(row.count, row.spawn).toBeGreaterThanOrEqual(2);
      // w_c (heading 340, spawn eye) has no equipment centre inside the proxy's vertical cone: the ceiling
      // LED housings sit about 1.85 m above the eye and no sign is in view. Pinned at 0 so any change shows.
      if (row.spawn === "w_c") expect(row.count, row.spawn).toBe(0);
    }
    evidence.equipment = rows;
  }
}, 30_000);
