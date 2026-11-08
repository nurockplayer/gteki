// CPU replay of Explorer.walkFromNode/placeCamera at rest, with the scene's real collision world.
import * as THREE from "three";
import { WALKER_BODY } from "@gteki/scene-api";
import { FOLLOW, FOLLOW_CAT, aimAtRaisedCat, catShoulder, constrainedPitch, followDistance, followPose, raisedBack, solveRaisedBoom, targetFov } from "../../../apps/web/src/explorer/followCamera.ts";
import { castAll } from "../../../apps/web/src/explorer/raycast.ts";
import { CAMERA_FAR_M } from "../../../apps/web/src/explorer/overviewFraming.ts";
import { ReplayWalker, type World } from "./walker_replay.ts";

type Point = { x: number; y: number; z: number };
type Edge = { id: string; from: string; to: string; verification: string; geometry?: Point[] };

/** Spec 13's +0 is an explicit turn after spawning, not Explorer's default spawn yaw. */
export function edgeBearing(id: string, nodes: Map<string, { position: Point }>, graphEdges: Edge[]) {
  const here = nodes.get(id)!.position;
  const edges = graphEdges.filter((e) => e.from === id || e.to === id);
  const edge = edges.find((e) => e.verification === "verified") ?? edges[0];
  if (!edge) return { heading: 0, edge: null };
  const other = nodes.get(edge.from === id ? edge.to : edge.from)!.position;
  let pts = edge.geometry && edge.geometry.length >= 2 ? edge.geometry : [here, other];
  const distance = (p: Point) => Math.hypot(p.x-here.x, p.y-here.y);
  if (distance(pts.at(-1)!) < distance(pts[0]!)) pts = [...pts].reverse();
  const target = pts.slice(1).find((p) => distance(p) >= 2) ?? pts.at(-1)!;
  return { heading: Math.round((Math.atan2(target.x-here.x, target.y-here.y)*180/Math.PI+360)%360), edge: edge.id };
}

export function spawnCamera(world: World, position: Point, w: number, h: number, heading = 0, avatar: "human" | "cat" = "human") {
  const walker = new ReplayWalker(world);
  if (!walker.spawn(position)) throw new Error("No spawn ground");
  const yaw = -heading*Math.PI/180, pitch = avatar === "cat" ? FOLLOW_CAT.pitch : -0.12;
  const head = walker.pos.clone().add(new THREE.Vector3(0, avatar === "cat" ? FOLLOW_CAT.pivotY : WALKER_BODY.eyeM, 0));
  // B1 context blockers are on OFF_LAYER. The scene files ceilings as ordinary colliders;
  // signs and column dressing never join Explorer's camera target set.
  const targets = [...world.ground, ...world.collider];
  const shoulderMax = avatar === "cat" ? catShoulder(w/h) : FOLLOW.shoulder;
  const ray = new THREE.Raycaster(head, new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), 0, shoulderMax+0.25);
  const side = castAll(ray, targets)[0];
  const shoulder = side ? Math.max(0, side.distance-0.25) : shoulderMax;
  const wanted = avatar === "cat" ? FOLLOW_CAT.distance : FOLLOW.defaultDistance;
  const pose = avatar === "cat"
    ? followPose(head, yaw, pitch, shoulder, FOLLOW_CAT.lift, FOLLOW_CAT.drop)
    : followPose(head, yaw, pitch, shoulder);
  const cast = (back: THREE.Vector3) => {
    ray.set(pose.pivot, back);
    ray.far = wanted+FOLLOW.clearance;
    return castAll(ray, targets).map((hit) => ({ distance: hit.distance, cameraOnly: false }));
  };
  let back = pose.back;
  let distance: number, raise: number;
  if (avatar === "cat") {
    // Explorer places the cat boom with a snap solve of the same raised-boom helper (explorer.ts placeCamera).
    const solved = solveRaisedBoom(wanted, back, cast, 0, 0, true);
    back = solved.back;
    distance = solved.distance;
    raise = solved.raise;
  } else {
    distance = followDistance(wanted, cast(back));
    raise = constrainedPitch(wanted, back, distance, cast, new THREE.Vector3());
    if (raise > 0) {
      back = raisedBack(back, raise, new THREE.Vector3());
      distance = followDistance(wanted, cast(back));
    }
  }
  const camera = new THREE.PerspectiveCamera(targetFov("walk", false, distance < FOLLOW.comfortDistance), w/h, 0.05, CAMERA_FAR_M);
  camera.position.copy(pose.pivot).addScaledVector(back, distance);
  camera.lookAt(pose.target);
  if (avatar === "cat") aimAtRaisedCat(pose.target, camera.position, walker.pos, raise, camera.fov, camera.aspect);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld(true);
  const aim = pose.target.clone().sub(camera.position);
  return { camera, ground: walker.pos.y, heading, yaw, pitch, shoulder, distance, raise,
    height: camera.position.y-walker.pos.y, lookPitch: Math.atan2(aim.y, Math.hypot(aim.x, aim.z)), target: pose.target.toArray() };
}

/** Whole name box, including its depth. NDC lower central third approximates the avatar silhouette. */
export function nameVisibility(corners: THREE.Vector3[], jp: number | null, en: number | null) {
  const inDepth = corners.every((p) => Number.isFinite(p.z) && p.z >= -1 && p.z <= 1);
  const minX = Math.min(...corners.map((p) => p.x)), maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y)), maxY = Math.max(...corners.map((p) => p.y));
  const intersects = inDepth && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1;
  const fullyInFrame = inDepth && minX >= -1 && maxX <= 1 && minY >= -1 && maxY <= 1;
  const avatarOverlap = intersects && maxX >= -1/3 && minX <= 1/3 && maxY >= -1 && minY <= -1/3;
  const reasons = [];
  if (!inDepth) reasons.push("behind camera or outside depth range");
  else if (!intersects) reasons.push("not in frame");
  else if (!fullyInFrame) reasons.push("cut by screen edge");
  if (avatarOverlap) reasons.push("avatar silhouette overlap");
  if (jp !== null && jp < 18) reasons.push("JP <18 px");
  if (en !== null && en < 12) reasons.push("EN <12 px");
  return { fullyInFrame, avatarOverlap, pass: fullyInFrame && !avatarOverlap && jp !== null && en !== null && jp >= 18 && en >= 12, reasons };
}
