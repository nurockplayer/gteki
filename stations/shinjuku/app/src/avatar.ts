import type * as THREE from "three";
import { ANKLE, BONE, buildCharacter, HAIR, HEIGHTS, HIP, OUTFITS, SHIN, THIGH } from "./characters/mesh.ts";
import { runningBlend, sampleFoot, strideLength, type FootPose } from "./characters/gait.ts";

export interface Avatar {
  object: THREE.Group;
  update(dt: number, speedMps: number, opts?: { onStairs?: boolean; climbing?: number }): void;
  setColorway(i: number): void;
  /** Distance from the viewer in metres. Hysteresis keeps the 25 m LOD stable. */
  setDistance(distanceM: number): void;
  dispose(): void;
}

function buildCache(T: typeof THREE) {
  return { references: 0, geometries: new Map<string, THREE.BufferGeometry>(),
    material: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.83, metalness: 0 }) };
}
const CACHES = new WeakMap<typeof THREE, ReturnType<typeof buildCache>>();

/** One original, smoothly skinned, vertex-coloured humanoid; one main-pass draw.
 * Geometry/material are shared by outfit; skeleton and animation belong to its owner. */
export function createAvatar(T: typeof THREE, colorway = 0): Avatar {
  let cache = CACHES.get(T);
  if (!cache) { cache = buildCache(T); CACHES.set(T, cache); }
  const shared = cache;
  shared.references++;
  const object = new T.Group();
  object.name = "CommuterAvatar";
  let index = 0, far = false, distance = 0, disposed = false;
  function geometry(): THREE.BufferGeometry {
    const key = `${index}/${far}`;
    let result = shared.geometries.get(key);
    if (!result) { result = buildCharacter(T, index, far); shared.geometries.set(key, result); }
    return result;
  }
  const mesh = new T.SkinnedMesh(geometry(), shared.material);
  mesh.name = "Procedural commuter";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Conservative animated bound: avoids per-frame vertex scans and hand/foot culling.
  mesh.boundingSphere = new T.Sphere(new T.Vector3(0, 0.88, 0), 1.18);
  object.add(mesh);
  const bones: THREE.Bone[] = [];
  function joint(parent: THREE.Object3D, name: keyof typeof BONE, x = 0, y = 0): THREE.Bone {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(x, y, 0);
    bones[BONE[name]] = bone;
    parent.add(bone);
    return bone;
  }
  const pelvis = joint(mesh, "pelvis", 0, HIP);
  const body = joint(pelvis, "spine");
  const head = joint(body, "head", 0, 0.7);
  const leftShoulder = joint(body, "leftShoulder", -0.213, 0.47);
  const leftElbow = joint(leftShoulder, "leftElbow", 0, -0.26);
  const rightShoulder = joint(body, "rightShoulder", 0.213, 0.47);
  const rightElbow = joint(rightShoulder, "rightElbow", 0, -0.26);
  function leg(left: boolean) {
    const hip = joint(pelvis, left ? "leftHip" : "rightHip", left ? -0.092 : 0.092);
    hip.rotation.order = "ZXY";
    const knee = joint(hip, left ? "leftKnee" : "rightKnee", 0, -THIGH);
    const ankle = joint(knee, left ? "leftAnkle" : "rightAnkle", 0, -SHIN);
    return { hip, knee, ankle };
  }
  const left = leg(true), right = leg(false);
  object.updateMatrixWorld(true);
  const skeleton = new T.Skeleton(bones);
  mesh.bind(skeleton);
  function describe(): void {
    object.userData.outfit = OUTFITS[index];
    object.userData.hair = HAIR[index];
    object.userData.lod = far ? "far" : "near";
    object.userData.triangles = mesh.geometry.index!.count / 3;
  }
  function setColorway(i: number): void {
    if (disposed) return;
    index = Number.isFinite(i) ? ((Math.trunc(i) % 8) + 8) % 8 : 0;
    mesh.geometry = geometry();
    object.scale.setScalar(HEIGHTS[index]!);
    describe();
  }
  function setDistance(m: number): void {
    if (disposed || !Number.isFinite(m)) return;
    distance = Math.max(0, m);
    const next = far ? distance > 23 : distance > 27;
    if (next !== far) {
      far = next;
      mesh.geometry = geometry();
      describe();
    }
  }
  setColorway(colorway);
  let cycle = 0, idlePhase = 0, breathPhase = 0, speed = 0, movement = 0, running = 0, stairs = 0, climb = 0;
  const inversePelvis = new T.Quaternion(), footRotation = new T.Quaternion(), pitchRotation = new T.Quaternion();
  const target = new T.Vector3(), axisX = new T.Vector3(1, 0, 0);
  const foot: FootPose = { z: 0, lift: 0, pitch: 0, planted: false };
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  function poseLeg(rig: typeof left, phase: number, stride: number, stance: number): void {
    sampleFoot(phase, stride, stance, running, stairs, climb, foot);
    foot.z *= movement;
    foot.lift *= movement;
    foot.pitch *= movement;
    // Solve in the rotated pelvis frame so hip sway never drags a planted foot.
    target.set(rig.hip.position.x - pelvis.position.x, ANKLE + foot.lift - pelvis.position.y, foot.z);
    target.applyQuaternion(inversePelvis).sub(rig.hip.position);
    const down = Math.hypot(target.y, target.x);
    const reach = Math.max(0.001, Math.min(THIGH + SHIN - 0.0001, Math.hypot(down, target.z)));
    const upper = Math.atan2(-target.z, down) + Math.acos(clamp((THIGH ** 2 + reach ** 2 - SHIN ** 2) / (2 * THIGH * reach)));
    const bend = Math.acos(clamp((reach ** 2 - THIGH ** 2 - SHIN ** 2) / (2 * THIGH * SHIN)));
    rig.hip.rotation.set(upper, 0, Math.atan2(target.x, -target.y));
    rig.knee.rotation.x = -bend;
    // Keep the sole level in world space through the body's counter-rotation.
    footRotation.copy(pelvis.quaternion).multiply(rig.hip.quaternion).multiply(rig.knee.quaternion).invert();
    pitchRotation.setFromAxisAngle(axisX, foot.pitch);
    rig.ankle.quaternion.copy(footRotation).multiply(pitchRotation);
  }
  function update(dt: number, speedMps: number, opts?: { onStairs?: boolean; climbing?: number }): void {
    if (disposed || distance > 60 || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1), blend = 1 - Math.exp(-step * 12);
    const input = Number.isFinite(speedMps) ? Math.max(0, Math.min(6, speedMps)) : 0;
    speed += (input - speed) * blend;
    movement += ((input >= 0.08 ? 1 : 0) - movement) * blend;
    running += (runningBlend(input) - running) * blend;
    stairs += ((opts?.onStairs ? 1 : 0) - stairs) * blend;
    climb += ((Number.isFinite(opts?.climbing) ? clamp(opts!.climbing!) : 0) - climb) * blend;
    const scale = object.scale.y;
    const stride = strideLength(running) * (1 - stairs * 0.25);
    cycle = (cycle + step * speed / (stride * scale)) % 1;
    breathPhase = (breathPhase + step * 2.05) % (Math.PI * 2);
    idlePhase = (idlePhase + step * 0.7) % (Math.PI * 2);
    const phase = cycle * Math.PI * 2, swing = Math.cos(phase), idle = 1 - movement;
    pelvis.position.y = HIP - movement * (0.095 + running * 0.05 + (1 - Math.cos(phase * 2)) * 0.006);
    pelvis.position.x = movement * Math.sin(phase) * 0.009 + idle * Math.sin(idlePhase) * 0.003;
    pelvis.rotation.set(0, movement * Math.sin(phase) * 0.045, movement * swing * 0.012);
    inversePelvis.copy(pelvis.quaternion).invert();
    body.rotation.set(-movement * (0.025 + running * 0.13 + climb * 0.05),
      -pelvis.rotation.y * 1.45 + idle * Math.sin(idlePhase) * 0.009, -pelvis.rotation.z * 0.7);
    body.scale.y = 1 + Math.sin(breathPhase) * 0.0025;
    head.rotation.x = -body.rotation.x * 0.65;
    head.rotation.y = idle * Math.sin(idlePhase + 0.8) * 0.025;
    const stance = 0.6 - running * 0.2;
    poseLeg(left, cycle, stride, stance);
    poseLeg(right, (cycle + 0.5) % 1, stride, stance);
    // Arm swing follows actual leg progression and bends the elbow in running.
    const arms = movement * (0.3 + running * 0.48);
    const armSwing = Math.cos(phase);
    leftShoulder.rotation.set(-armSwing * arms - 0.025, 0, -0.035 - running * 0.05);
    rightShoulder.rotation.set(armSwing * arms - 0.025, 0, 0.035 + running * 0.05);
    leftElbow.rotation.x = 0.11 + movement * (0.08 + running * 1.05 + (1 - swing) * 0.045);
    rightElbow.rotation.x = 0.11 + movement * (0.08 + running * 1.05 + (1 + swing) * 0.045);
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    skeleton.dispose();
    if (--shared.references === 0) {
      for (const geometry of shared.geometries.values()) geometry.dispose();
      shared.material.dispose();
      CACHES.delete(T);
    }
    object.clear();
  }
  return { object, update, setColorway, setDistance, dispose };
}
