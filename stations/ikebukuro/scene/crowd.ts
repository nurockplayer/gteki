// Ambient pedestrians for immersion. They walk only along verified graph edge polylines
// (with a small lateral offset), so the crowd never suggests a route the data lacks.
// Two instanced meshes (body, head); no per-agent objects, no physics.
import type * as THREE_NS from "three";

interface P3 { x: number; y: number; z: number | null }
interface Edge { id: string; from: string; to: string; verification: string; geometry: P3[] }

interface Path { pts: THREE_NS.Vector3[]; cum: number[]; length: number; from: string; to: string; lane?: Lane }
/** Safe lateral extent (m) every stepM along an edge, from pipeline/build_station.py. */
export interface Lane { stepM: number; left: number[]; right: number[] }
interface Agent { path: number; forward: boolean; s: number; speed: number; offset: number; phase: number }

const COAT = [0x1e2229, 0x2b2f36, 0x3a3f47, 0x4a4036, 0x1f2a3a, 0x5b5f66, 0x6d5a48, 0x2c3b2f, 0x7a1f24, 0xb8b2a6, 0x24324a];
const SKIN = [0xe0bfa3, 0xd5ad8c, 0xc99b7a, 0xe8cdb5];
const HAIR = [0x16130f, 0x221b15, 0x3a2b1f, 0x5a4636, 0x9a9a9a];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildCrowd(
  THREE: typeof THREE_NS,
  edges: Edge[],
  toRenderer: (x: number, y: number, z: number) => THREE_NS.Vector3,
  count: number,
  envMap: THREE_NS.Texture,
  lanes: Record<string, Lane> = {},
) {
  const paths: Path[] = [];
  for (const e of edges) {
    if (e.verification !== "verified" || e.geometry.some((p) => p.z === null)) continue;
    const pts = e.geometry.map((p) => toRenderer(p.x, p.y, p.z as number));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    if (cum[cum.length - 1] > 1) paths.push({ pts, cum, length: cum[cum.length - 1], from: e.from, to: e.to, lane: lanes[e.id] });
  }
  const byNode = new Map<string, number[]>();
  paths.forEach((p, i) => {
    for (const n of [p.from, p.to]) byNode.set(n, [...(byNode.get(n) ?? []), i]);
  });

  // Ends of the graph (exits): where people enter and leave.
  const deadEnds: { path: number; forward: boolean }[] = [];
  paths.forEach((p, i) => {
    if (byNode.get(p.from)?.length === 1) deadEnds.push({ path: i, forward: true });
    if (byNode.get(p.to)?.length === 1) deadEnds.push({ path: i, forward: false });
  });
  const rand = rng(7);
  const total = paths.reduce((s, p) => s + p.length, 0);
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    // place proportionally to path length
    let r = rand() * total, k = 0;
    while (k < paths.length - 1 && r > paths[k].length) r -= paths[k++].length;
    agents.push({ path: k, forward: rand() < 0.5, s: r, speed: 1.15 + rand() * 0.5, offset: (rand() * 2 - 1) * 0.9, phase: rand() * 6.28 });
  }

  // Articulated low-poly pedestrian: parts pivot at hip/shoulder; local +Z is forward.
  const geo = {
    torso: new THREE.CapsuleGeometry(0.185, 0.4, 4, 10).scale(1, 1, 0.7).translate(0, 1.2, 0),
    head: new THREE.SphereGeometry(0.105, 12, 8).translate(0, 1.66, 0.01),
    hair: new THREE.SphereGeometry(0.112, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.675, -0.012),
    leg: new THREE.CapsuleGeometry(0.082, 0.7, 3, 8).translate(0, -0.43, 0),
    arm: new THREE.CapsuleGeometry(0.056, 0.54, 3, 8).translate(0, -0.33, 0),
    backpack: new THREE.BoxGeometry(0.3, 0.38, 0.14).translate(0, 1.22, -0.2),
    shoulderBag: new THREE.BoxGeometry(0.08, 0.26, 0.3).translate(0.27, 0.98, 0.02),
  };
  const mat = (rough: number) => new THREE.MeshStandardMaterial({ roughness: rough, envMap, envMapIntensity: 1.1 });
  const materials = [mat(0.85), mat(0.55), mat(0.7)];
  const parts = [
    { key: "torso", g: geo.torso, m: materials[0], pivot: [0, 0, 0], swing: 0 },
    { key: "head", g: geo.head, m: materials[1], pivot: [0, 0, 0], swing: 0 },
    { key: "hair", g: geo.hair, m: materials[2], pivot: [0, 0, 0], swing: 0 },
    { key: "legL", g: geo.leg, m: materials[0], pivot: [0.095, 0.9, 0], swing: 0.42 },
    { key: "legR", g: geo.leg, m: materials[0], pivot: [-0.095, 0.9, 0], swing: -0.42 },
    { key: "armL", g: geo.arm, m: materials[0], pivot: [0.235, 1.44, 0], swing: -0.32 },
    { key: "armR", g: geo.arm, m: materials[0], pivot: [-0.235, 1.44, 0], swing: 0.32 },
    { key: "backpack", g: geo.backpack, m: materials[2], pivot: [0, 0, 0], swing: 0 },
    { key: "shoulderBag", g: geo.shoulderBag, m: materials[2], pivot: [0, 0, 0], swing: 0 },
  ].map((p) => ({ ...p, mesh: new THREE.InstancedMesh(p.g, p.m, count) }));
  const group = new THREE.Group();
  group.name = "ikebukuro_crowd";
  const c = new THREE.Color();
  const carries: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    carries.push(r < 0.3 ? "backpack" : r < 0.55 ? "shoulderBag" : null);
    const coat = COAT[Math.floor(rand() * COAT.length)];
    const trousers = rand() < 0.6 ? 0x1b1d22 : rand() < 0.5 ? 0x2c3442 : 0x5e5649;
    const skin = SKIN[Math.floor(rand() * SKIN.length)];
    const hair = HAIR[Math.floor(rand() * HAIR.length)];
    for (const p of parts) {
      const bag = rand() < 0.5 ? 0x15171a : 0x3d2f25;
      const hex = p.key === "head" ? skin : p.key === "hair" ? hair : p.key.startsWith("leg") ? trousers : p.key.endsWith("ack") || p.key.endsWith("Bag") ? bag : coat;
      p.mesh.setColorAt(i, c.setHex(hex));
    }
  }
  for (const p of parts) {
    p.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p.mesh.frustumCulled = false;
    p.mesh.userData.gteki_role = "ambient_crowd";
    group.add(p.mesh);
  }

  const pos = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
  const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), base = new THREE.Matrix4();
  const local = new THREE.Matrix4(), rot = new THREE.Matrix4(), out = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  // Camera position as last rendered (onBeforeRender gives the camera without any API change);
  // pedestrians that would fill the lens are hidden instead of blocking the view.
  const cam = new THREE.Vector3(1e9, 0, 0);
  parts[0].mesh.onBeforeRender = (_r, _s, camera) => { cam.setFromMatrixPosition(camera.matrixWorld); };
  const NEAR_CAM_M = 1.2;
  const up = new THREE.Vector3(0, 1, 0);

  function sample(p: Path, s: number) {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const t = (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1]);
    pos.lerpVectors(p.pts[i - 1], p.pts[i], Math.min(1, Math.max(0, t)));
    dir.subVectors(p.pts[i], p.pts[i - 1]).setY(0).normalize();
  }

  let nearby = 0;
  function update(dt: number, _elapsed: number) {
    let near = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      let p = paths[a.path];
      a.s += (a.forward ? 1 : -1) * a.speed * dt;
      a.phase += (a.speed * dt * Math.PI * 2) / 1.45; // one gait cycle per ~1.45 m
      if (a.s > p.length || a.s < 0) {
        const node = a.s > p.length ? p.to : p.from;
        const options = (byNode.get(node) ?? []).filter((j) => j !== a.path);
        const next = options.length ? options[Math.floor(rand() * options.length)] : a.path;
        if (next === a.path && !deadEnds.length) {
          a.forward = !a.forward;
          a.s = Math.min(p.length, Math.max(0, a.s));
        } else if (next === a.path) {
          // Dead end = an exit stair top: this person leaves; someone else enters at another exit.
          const enter = deadEnds[Math.floor(rand() * deadEnds.length)];
          a.path = enter.path;
          p = paths[enter.path];
          a.forward = enter.forward;
          a.s = a.forward ? 0 : p.length;
        } else {
          a.path = next;
          p = paths[next];
          a.forward = p.from === node;
          a.s = a.forward ? 0 : p.length;
        }
      }
      sample(p, a.s);
      if (!a.forward) dir.negate();
      side.crossVectors(dir, up);
      // keep to the left like Tokyo pedestrians tend to, plus personal offset, clamped to the
      // surveyed walkable lane so nobody stands in a wall or off the floor.
      let off = -0.3 + a.offset * 0.4;
      if (p.lane) {
        const k = Math.min(p.lane.left.length - 1, Math.max(0, Math.round(a.s / p.lane.stepM)));
        const k2 = Math.min(p.lane.left.length - 1, k + 1);
        // lanes are measured to walkable-cell centres; keep shoulders (~0.3 m) off the walls
        const left = Math.max(0, Math.min(p.lane.left[k], p.lane.left[k2]) - 0.2);
        const right = Math.max(0, Math.min(p.lane.right[k], p.lane.right[k2]) - 0.2);
        const edgeOff = a.forward ? off : -off; // edge frame: + = right of from->to
        off = (a.forward ? 1 : -1) * Math.min(right, Math.max(-left, edgeOff));
      } else {
        off = 0;
      }
      pos.addScaledVector(side, off);
      const sw = Math.sin(a.phase);
      pos.y += Math.abs(Math.cos(a.phase)) * 0.025;
      q.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
      base.compose(pos, q, one);
      const dx = pos.x - cam.x, dz = pos.z - cam.z, dy = pos.y + 1.1 - cam.y;
      if (dx * dx + dz * dz + dy * dy < 64) near++;
      if (dx * dx + dz * dz + dy * dy < NEAR_CAM_M * NEAR_CAM_M) {
        for (const part of parts) part.mesh.setMatrixAt(i, hidden);
        continue;
      }
      for (const part of parts) {
        if (part.key === "backpack" || part.key === "shoulderBag") {
          part.mesh.setMatrixAt(i, carries[i] === part.key ? base : hidden);
          continue;
        }
        if (part.swing === 0) {
          part.mesh.setMatrixAt(i, base);
          continue;
        }
        local.makeTranslation(part.pivot[0], part.pivot[1], part.pivot[2]).multiply(rot.makeRotationX(part.swing * sw));
        part.mesh.setMatrixAt(i, out.multiplyMatrices(base, local));
      }
    }
    for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;
    nearby = near;
  }
  update(0, 0);

  return {
    group,
    update,
    /** Pedestrians within 8 m of the last rendered camera (for ambience). */
    nearby: () => nearby,
    dispose() {
      Object.values(geo).forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      parts.forEach((p) => p.mesh.dispose());
    },
  };
}
