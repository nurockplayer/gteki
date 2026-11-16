// CPU replay of production methods; rendering/UI callbacks alone are omitted (2026-11-17 JST).
import fs from "node:fs";
import ts from "typescript";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { WALKER_BODY, WALKER_SPEED, glbPrimitivePlugin } from "@gteki/scene-api";
import * as follow from "../followCamera.ts";
import * as walker from "../walker.ts";
import * as body from "../bodyCollision.ts";
import { LOOK_PITCH } from "../identityFraming.ts";
import { insideGreyboxOpening } from "../greyboxScene.ts";
import { castAll, castCamera, portalWallNormal } from "../raycast.ts";
import { buildWorld, nearby } from "../../../../../stations/ikebukuro/pipeline/walker_replay.ts";
import { loadKit, type KitGraph, type KitManifest } from "../../../../../stations/ikebukuro/scene/kit.ts";
import { solveRaisedBoom as beforeSolver } from "./gateCameraBefore.ts";

export async function gateCameraReplay() {
  const json = (path: string) => JSON.parse(fs.readFileSync(path, "utf8"));
  const graph = json("stations/ikebukuro/gteki/graph.json");
  const node = graph.nodes.find((n: { id: string }) => n.id === "g_jr_s");
  const centre = new THREE.Vector3(node.position.x, node.position.z, -node.position.y);
  const world = nearby(await buildWorld(), centre, 16);
  const targets = [...world.ground, ...world.collider], sides = new Set(targets);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(glbPrimitivePlugin)
    .register(() => ({ name: "CPU_OMIT_TEXTURES", loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const kit = await loadKit(THREE, {
    assetUrl: (uri) => uri,
    loadGlb: async (uri) => {
      const data = fs.readFileSync(`stations/ikebukuro/gteki/${uri}`);
      return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
    },
  }, json("stations/ikebukuro/scene/kit/kit.json") as KitManifest,
  json("stations/ikebukuro/scene/access_fences.json").marks, false, graph as KitGraph);
  const built = kit.build(THREE, new THREE.Texture(), (x, y, z) => new THREE.Vector3(x, z, -y));
  // Extract the named methods exactly, including current body sliding, casts and final smoothing.
  const source = ts.createSourceFile("explorer.ts", fs.readFileSync(new URL("../explorer.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const explorer = source.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === "Explorer")!;
  const names = ["walkFrom", "stepWalk", "placeCamera", "followHead", "groundAt", "colliderCast", "blockedByColliders", "setFov", "applyAvatarFade"];
  const methods = explorer.members.filter((m) => m.name && names.includes(m.name.getText(source))).map((m) => m.getText(source)).join("\n");
  const code = ts.transpileModule(`class CpuExplorer { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = { THREE, ...follow, ...walker, ...body, WALKER_BODY, LOOK_PITCH, insideGreyboxOpening, castAll, castCamera, portalWallNormal,
    R: (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y), EYE: WALKER_BODY.eyeM, RADIUS: WALKER_BODY.radiusM,
    WALK: WALKER_SPEED.walkMps, RUN: WALKER_SPEED.runMps,
    STAIR_POSE: { lift: 0.218, desktop: { distance: 2.25, lens: 55 }, phone: { distance: 2.4, lens: 65 } } };
  function run(heading: number, walking: boolean, before = false, away = false) {
    const deps = { ...dependencies, solveRaisedBoom: before ? beforeSolver : follow.solveRaisedBoom };
    const Cpu = new Function(...Object.keys(deps), `${code}; return CpuExplorer;`)(...Object.values(deps));
    const e = new Cpu();
    Object.assign(e, {
      camera: new THREE.PerspectiveCamera(60, 1024 / 640, .05, 1000), pos: centre.clone(), ray: new THREE.Raycaster(),
      stationScene: { cameraGateAisles: before ? [] : built.cameraGateAisles },
      cameraTargets: targets, cameraSides: sides, blockerTargets: new Set(), groundTargets: world.ground, colliderTargets: world.collider,
      walkable: world.ground, colliders: world.collider, walls: [], greyboxOpenings: [], sceneColliderTargets: new Set(), portalExemptions: 0,
      catAvatar: true, previewNext: false, firstPerson: false, mode: "walk", guide: null, qaCamera: {}, qaCameraSnap: false,
      openingState: "waiting", openingRelease: null, arrivalState: "waiting", arrivalElapsed: 0, arrivalRearm: false, arrivalStart: {},
      slope: { speed: 0, velocity: 0, on: false, level: 0 }, slopeY: centre.y, descentDrop: 0, escalatorProgress: 0, escalatorWeight: 0,
      stairsFraming: { progress: 0, weight: 0 }, bodyRaiseHold: { seconds: 0, target: 0 }, camDistance: 2.4, pitch: 0, yaw: -heading * Math.PI / 180,
      boomRaise: 0, boomActual: 0, squeezed: false, reducedMotion: false, cameraFade: 1, fadeStale: false, qaAvatarFade: null,
      events: {}, moving: false, lastAvatarPos: centre.clone(), bodyYaw: 0,
      input: { consumeLook: () => ({ dx: 0, dy: 0, zoom: 0 }), move: () => ({ x: 0, y: e.forward ? 1 : 0, run: false }) },
      interactionController: { update: () => ({}) }, publishInteraction() {}, setCameraFocus() {}, stopGuide() {}, setMode() {}, frameInitialIdentity() {},
    });
    if (!e.walkFrom(node.position, heading)) throw new Error("g_jr_s has no ground");
    if (away) e.pos.x += 10;
    const frames = [];
    for (let frame = 0; frame <= 132; frame++) {
      if (frame && walking) { e.forward = true; e.stepWalk(1 / 60); }
      e.placeCamera(frame ? 1 / 60 : 0, frame === 0);
      e.camera.updateMatrixWorld(true);
      const gate = built.cameraGateAisles.find((g) => g.node === "g_jr_s")!;
      const local = e.camera.position.clone().applyMatrix4(gate.worldToLocal);
      const probes = [.08, .22, .42].map((y) => e.pos.clone().add(new THREE.Vector3(0, y, 0)).project(e.camera));
      const nearCorners = [-1, 1].flatMap((x) => [-1, 1].map((y) => new THREE.Vector3(x, y, -1).unproject(e.camera).applyMatrix4(gate.worldToLocal)));
      frames.push({ camera: e.camera.position.toArray(), quaternion: e.camera.quaternion.toArray(), fov: e.camera.fov,
        raise: e.boomRaise, probes, inside: gate.cabinets.some((box) => box.containsPoint(local)),
        nearInside: gate.cabinets.some((box) => nearCorners.some((point) => box.containsPoint(point))),
      });
    }
    return frames;
  }
  return { run, built, targets, kit };
}
