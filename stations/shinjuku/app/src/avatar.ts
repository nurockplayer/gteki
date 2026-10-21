import type * as THREE from "three";

export interface Avatar {
  object: THREE.Group;
  update(dt: number, speedMps: number, opts?: { onStairs?: boolean; climbing?: number }): void;
  setColorway(i: number): void;
  dispose(): void;
}

// Jacket, trousers, shirt, shoes, skin, hair, bag. Materials belong to an avatar.
const PALETTES = [
  [0x293f59, 0x555b65, 0xe9e6dc, 0x30343b, 0xd9a581, 0x302925, 0xb49a72],
  [0x4a4c53, 0x30343b, 0xd9dfe3, 0x24262b, 0xe3b593, 0x28262a, 0x595b51],
  [0xb6a38a, 0x504b44, 0xeee8dd, 0x4b3830, 0xc58f70, 0x34302b, 0x777263],
  [0xe3e1d7, 0x25282e, 0xf4f0e6, 0x3b3c3a, 0xe8bea0, 0x45372e, 0x777e83],
  [0x292e35, 0x272a30, 0xd9e2e8, 0x202327, 0xcf9a7b, 0x242428, 0x525965],
  [0x6e786d, 0x3e4849, 0xe5e1d3, 0x3f3933, 0xb88063, 0x2b2927, 0x7c7766],
  [0x795a60, 0x3d3e47, 0xeae1dc, 0x393338, 0xd9ab8d, 0x37302e, 0x74665e],
  [0x6b798b, 0x414a55, 0xe0e5e5, 0x30373e, 0xe1b18d, 0x4c433a, 0x797a70],
] as const;
const HEIGHT_SCALES = [1, 1.04, 1.025, 1.055, 1.015, 0.97, 0.945, 0.99] as const;

// A cache per injected Three namespace avoids mixing implementations. All eight
// outfits share it, including hidden accessories. Only the last live avatar
// disposes the cache; changing outfits never creates or destroys geometry.
const GEOMETRY_CACHES = new WeakMap<typeof THREE, ReturnType<typeof buildGeometries>>();

function buildGeometries(T: typeof THREE) {
  const geometries = new Set<THREE.BufferGeometry>();
  function keep<G extends THREE.BufferGeometry>(geometry: G): G {
    geometries.add(geometry);
    return geometry;
  }
  function oval(x: number, y: number, z: number, px = 0, py = 0, pz = 0) {
    return new T.SphereGeometry(1, 20, 14).scale(x, y, z).translate(px, py, pz);
  }
  // Bake small details into a single smooth mesh with one material/draw call.
  // Inputs are temporary; the resulting position/normal buffers are shared.
  function combine(parts: THREE.BufferGeometry[]) {
    const flat = parts.map((part) => part.index ? part.toNonIndexed() : part);
    const count = flat.reduce((sum, part) => sum + part.getAttribute("position").count, 0);
    const geometry = new T.BufferGeometry();
    for (const name of ["position", "normal"] as const) {
      const values = new Float32Array(count * 3);
      let offset = 0;
      for (const part of flat) {
        const attribute = part.getAttribute(name);
        values.set(attribute.array, offset);
        offset += attribute.count * 3;
      }
      geometry.setAttribute(name, new T.BufferAttribute(values, 3));
    }
    for (let i = 0; i < parts.length; i++) {
      if (flat[i] !== parts[i]) flat[i]!.dispose();
      parts[i]!.dispose();
    }
    return keep(geometry);
  }
  function tailoring(coat: boolean) {
    // Rounded shoulders, a fitted waist and a gently flared, closed hem.
    const profile = coat
      ? [[0, -0.18], [0.19, -0.18], [0.207, -0.16], [0.2, -0.08], [0.16, 0.18],
        [0.165, 0.32], [0.195, 0.4], [0.19, 0.445], [0.145, 0.495], [0.065, 0.515], [0, 0.515]]
      : [[0, -0.038], [0.155, -0.038], [0.17, -0.02], [0.168, 0.04], [0.145, 0.18],
        [0.158, 0.32], [0.195, 0.4], [0.19, 0.445], [0.145, 0.495], [0.065, 0.515], [0, 0.515]];
    return keep(new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r!, y!)), 24).scale(1, 1, 0.65));
  }
  function strap(points: number[][], radius = 0.009) {
    return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(([x, y, z]) => new T.Vector3(x!, y!, z!))), 24, radius, 6, false);
  }

  const jacket = tailoring(false);
  const coat = tailoring(true);
  const shirt = combine([
    oval(0.048, 0.075, 0.012, 0, 0.442, -0.122),
    oval(0.028, 0.038, 0.009).rotateZ(-0.35).translate(-0.031, 0.475, -0.117),
    oval(0.028, 0.038, 0.009).rotateZ(0.35).translate(0.031, 0.475, -0.117),
  ]);
  const head = combine([
    oval(0.093, 0.116, 0.092),
    oval(0.014, 0.023, 0.014, -0.092, -0.009),
    oval(0.014, 0.023, 0.014, 0.092, -0.009),
    oval(0.013, 0.02, 0.024, 0, -0.013, -0.087),
    new T.CapsuleGeometry(0.041, 0.047, 5, 12).translate(0, -0.141, 0),
  ]);
  const hair = new T.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const hairPositions = hair.getAttribute("position");
  for (let i = 0; i < hairPositions.count; i++) {
    const x = hairPositions.getX(i);
    const z = hairPositions.getZ(i);
    const phi = Math.atan2(z, x);
    // Higher at the forehead (-Z), down over the nape (+Z). A small side
    // part breaks symmetry, while every vertex stays on the oval skull.
    const theta = Math.acos(Math.max(-1, Math.min(1, hairPositions.getY(i)))) / (Math.PI / 2)
      * (1.57 + Math.sin(phi) * 0.37 + Math.cos(phi) * 0.07);
    hairPositions.setXYZ(i, Math.sin(theta) * Math.cos(phi) * 0.097,
      Math.cos(theta) * 0.12 + 0.002, Math.sin(theta) * Math.sin(phi) * 0.096);
  }
  hair.computeVertexNormals();
  keep(hair);
  const face = combine([
    oval(0.006, 0.004, 0.003, -0.034, 0.018, -0.085),
    oval(0.006, 0.004, 0.003, 0.034, 0.018, -0.085),
    oval(0.014, 0.0025, 0.002, -0.034, 0.036, -0.081),
    oval(0.014, 0.0025, 0.002, 0.034, 0.036, -0.081),
    oval(0.014, 0.0018, 0.002, 0, -0.05, -0.083),
  ]);
  const upperArm = keep(new T.CapsuleGeometry(0.061, 0.145, 6, 12).scale(1, 1, 0.95));
  const forearm = keep(new T.CapsuleGeometry(0.046, 0.15, 6, 12));
  const hand = keep(oval(0.035, 0.054, 0.028));
  const thigh = keep(new T.CapsuleGeometry(0.077, 0.266, 6, 12).scale(0.91, 1, 1));
  const shin = keep(new T.CapsuleGeometry(0.055, 0.32, 6, 12).scale(0.94, 1, 1));
  // A soft leather upper with a flattened bottom, extending toward local -Z.
  const shoe = oval(0.064, 0.055, 0.142, 0, -0.055, -0.045);
  const shoePositions = shoe.getAttribute("position");
  for (let i = 0; i < shoePositions.count; i++) {
    shoePositions.setY(i, Math.max(-0.1, shoePositions.getY(i)));
  }
  shoe.computeVertexNormals();
  keep(shoe);
  const backpack = combine([
    new T.CapsuleGeometry(0.12, 0.15, 6, 16).scale(1, 1, 0.58).translate(0, 0.27, 0.17),
    oval(0.091, 0.067, 0.025, 0, 0.21, 0.239),
    ...[-1, 1].map((side) => strap([
      [side * 0.105, 0.37, 0.2], [side * 0.147, 0.49, 0.04],
      [side * 0.15, 0.4, -0.108], [side * 0.155, 0.17, -0.095], [side * 0.105, 0.14, 0.17],
    ], 0.012)),
  ]);
  const tote = combine([
    new T.CapsuleGeometry(0.105, 0.13, 6, 16).scale(0.55, 1, 1.1).translate(0.235, -0.015, 0.035),
    strap([[0.235, 0.08, -0.055], [0.242, 0.24, -0.075], [0.22, 0.465, 0],
      [0.242, 0.24, 0.11], [0.235, 0.08, 0.125]]),
  ]);
  const shoulderBag = combine([
    oval(0.065, 0.108, 0.13, 0.228, -0.04, 0.025),
    strap([[0.228, 0.02, -0.055], [0.1, 0.21, -0.115], [-0.16, 0.48, -0.055],
      [-0.17, 0.49, 0.025], [0.08, 0.23, 0.13], [0.228, 0.02, 0.105]]),
  ]);
  return { references: 0, geometries, jacket, coat, shirt, head, hair, face,
    upperArm, forearm, hand, thigh, shin, shoe, backpack, tote, shoulderBag };
}

export function createAvatar(THREE_: typeof THREE, colorway = 0): Avatar {
  let cached = GEOMETRY_CACHES.get(THREE_);
  if (!cached) {
    cached = buildGeometries(THREE_);
    GEOMETRY_CACHES.set(THREE_, cached);
  }
  const geometry = cached;
  geometry.references++;
  const materials = new Set<THREE.MeshStandardMaterial>();
  const tau = Math.PI * 2;
  const thighLength = 0.39;
  const shinLength = 0.41;
  const hipHeight = 0.9;
  const ankleHeight = 0.1;
  let disposed = false;

  function material(color: number, roughness: number): THREE.MeshStandardMaterial {
    const result = new THREE_.MeshStandardMaterial({ color, roughness, metalness: 0 });
    materials.add(result);
    return result;
  }
  function mesh(
    parent: THREE.Object3D,
    shape: THREE.BufferGeometry,
    surface: THREE.MeshStandardMaterial,
    x = 0, y = 0, z = 0,
  ): THREE.Mesh {
    const result = new THREE_.Mesh(shape, surface);
    result.position.set(x, y, z);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }
  function joint(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0): THREE.Group {
    const result = new THREE_.Group();
    result.name = name;
    result.position.set(x, y, z);
    parent.add(result);
    return result;
  }

  const jacket = material(0, 0.85);
  const trousers = material(0, 0.88);
  const shirt = material(0, 0.85);
  const skin = material(0, 0.55);
  const hair = material(0, 0.6);
  const shoes = material(0, 0.65);
  const face = material(0x49372f, 0.6);
  const bagCloth = material(0, 0.87);

  const object = new THREE_.Group();
  object.name = "CommuterAvatar";
  const pelvis = joint(object, "pelvis", 0, hipHeight);
  const body = joint(pelvis, "upperBody");
  const torso = mesh(body, geometry.jacket, jacket);
  torso.name = "tailoredTorso";
  mesh(body, geometry.shirt, shirt).name = "shirtCollar";
  // 1.704 m before colorway scaling; a 0.232 m oval head gives ~7.3 heads.
  const head = joint(body, "head", 0, 0.682);
  mesh(head, geometry.head, skin).name = "headSkin";
  mesh(head, geometry.hair, hair).name = "hairCap";
  mesh(head, geometry.face, face).name = "faceDetails";

  function arm(side: number, name: string) {
    const shoulder = joint(body, `${name}Shoulder`, side * 0.213, 0.447);
    shoulder.rotation.z = side * 0.075;
    mesh(shoulder, geometry.upperArm, jacket, 0, -0.1185);
    const elbow = joint(shoulder, `${name}Elbow`, 0, -0.237);
    mesh(elbow, geometry.forearm, jacket, 0, -0.111);
    mesh(elbow, geometry.hand, skin, 0, -0.276, -0.004);
    return { shoulder, elbow };
  }
  const leftArm = arm(-1, "left");
  const rightArm = arm(1, "right");

  function leg(side: number, name: string) {
    const hip = joint(pelvis, `${name}Hip`, side * 0.098);
    mesh(hip, geometry.thigh, trousers, 0, -thighLength / 2);
    const knee = joint(hip, `${name}Knee`, 0, -thighLength);
    mesh(knee, geometry.shin, trousers, 0, -shinLength / 2);
    const ankle = joint(knee, `${name}Ankle`, 0, -shinLength);
    mesh(ankle, geometry.shoe, shoes);
    return { hip, knee, ankle };
  }
  const leftLeg = leg(-1, "left");
  const rightLeg = leg(1, "right");

  // One accessory mesh, reparented on outfit changes: 18 meshes in total,
  // each with one material and no geometry groups (also 18 main-pass draws).
  const backpack = joint(body, "backpack");
  const shoulderBag = joint(body, "shoulderBag");
  const bag = mesh(backpack, geometry.backpack, bagCloth);
  function setColorway(i: number): void {
    if (disposed) return;
    const index = Number.isFinite(i) ? ((Math.trunc(i) % PALETTES.length) + PALETTES.length) % PALETTES.length : 0;
    const palette = PALETTES[index]!;
    jacket.color.setHex(palette[0]);
    trousers.color.setHex(palette[1]);
    shirt.color.setHex(palette[2]);
    shoes.color.setHex(palette[3]);
    skin.color.setHex(palette[4]);
    hair.color.setHex(palette[5]);
    bagCloth.color.setHex(palette[6]);
    object.scale.setScalar(HEIGHT_SCALES[index]!);
    torso.geometry = index === 2 || index === 7 ? geometry.coat : geometry.jacket;
    backpack.visible = index === 0;
    shoulderBag.visible = index === 2 || index === 5 || index === 6 || index === 7;
    bag.geometry = index === 0 ? geometry.backpack : index === 2 || index === 5 ? geometry.tote : geometry.shoulderBag;
    (index === 0 ? backpack : shoulderBag).add(bag);
  }
  setColorway(colorway);

  let phase = 0;
  let breathPhase = 0;
  let swayPhase = 0;
  let speed = 0;
  let movement = 0;
  let running = 0;
  let stairs = 0;
  let climb = 0;

  function clampUnit(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  // Two-bone IK: stance feet move backwards at the travel speed, then lift and
  // return during swing. All scratch values are scalars; updates allocate nothing.
  function poseLeg(rig: typeof leftLeg, cycle: number, stride: number, stance: number): void {
    let footZ: number;
    let lift = 0;
    let pitch = 0;
    const travel = stride * stance;
    if (cycle < stance) {
      footZ = travel * (cycle / stance - 0.5);
    } else {
      const swing = (cycle - stance) / (1 - stance);
      const ease = swing * swing * (3 - 2 * swing);
      footZ = travel * (0.5 - ease);
      const arc = Math.sin(Math.PI * swing);
      lift = arc * arc * (0.085 + running * 0.12 + stairs * 0.045 + Math.max(0, climb) * 0.13);
      pitch = Math.sin(tau * swing) * (0.1 + running * 0.2);
      // Clear the sole's toe/heel corners as the shoe pitches at takeoff/landing.
      lift += Math.max(0, (pitch >= 0 ? 0.1 : 0.195) * Math.abs(Math.sin(pitch))
        + ankleHeight * (Math.cos(pitch) - 1));
    }
    footZ *= movement;
    lift *= movement;
    const down = pelvis.position.y - ankleHeight - lift;
    const distance = Math.max(0.001, Math.min(thighLength + shinLength, Math.hypot(down, footZ)));
    const upper = Math.atan2(-footZ, down) + Math.acos(clampUnit(
      (thighLength * thighLength + distance * distance - shinLength * shinLength) / (2 * thighLength * distance),
    ));
    const bend = Math.acos(clampUnit(
      (distance * distance - thighLength * thighLength - shinLength * shinLength) / (2 * thighLength * shinLength),
    ));
    rig.hip.rotation.x = upper;
    rig.knee.rotation.x = -bend;
    rig.ankle.rotation.x = bend - upper + pitch * movement;
  }

  function update(dt: number, speedMps: number, opts?: { onStairs?: boolean; climbing?: number }): void {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return;
    // A resumed background tab must not jump straight to an unrelated pose.
    const step = Math.min(dt, 0.1);
    const inputSpeed = Number.isFinite(speedMps) ? Math.min(12, Math.max(0, speedMps)) : 0;
    const inputClimb = Number.isFinite(opts?.climbing) ? clampUnit(opts!.climbing!) : 0;
    const blend = 1 - Math.exp(-step * 10);
    speed += (inputSpeed - speed) * blend;
    movement += ((inputSpeed >= 0.1 ? 1 : 0) - movement) * blend;
    running += ((inputSpeed > 2.2 ? 1 : 0) - running) * blend;
    stairs += ((opts?.onStairs ? 1 : 0) - stairs) * blend;
    climb += (inputClimb - climb) * blend;

    // Distance per full left/right cycle: approximately 0.75 m walking, 1.4 m running.
    const stride = 0.75 + running * 0.65;
    phase = (phase + step * speed / stride * tau) % tau;
    breathPhase = (breathPhase + step * 2.1) % tau;
    swayPhase = (swayPhase + step * 0.8) % tau;
    const idle = 1 - movement;
    const swing = Math.cos(phase);
    const doubleBeat = Math.cos(phase * 2);
    const breathing = Math.sin(breathPhase);
    pelvis.position.y = hipHeight + idle * breathing * 0.0015
      - movement * (0.039 + running * 0.039 + (1 - doubleBeat) * 0.005);
    pelvis.rotation.y = movement * Math.sin(phase) * (0.035 + running * 0.025);
    pelvis.rotation.z = movement * swing * 0.012;
    body.rotation.x = -movement * (0.025 + running * 0.135 + Math.max(0, climb) * 0.055) - climb * 0.025;
    body.rotation.y = -pelvis.rotation.y * 0.65 + idle * Math.sin(swayPhase) * 0.008;
    body.rotation.z = -pelvis.rotation.z * 0.7 + idle * Math.sin(swayPhase) * 0.006;
    body.scale.y = 1 + idle * breathing * 0.004;
    head.rotation.x = -body.rotation.x * 0.45;
    head.rotation.y = idle * Math.sin(swayPhase + 0.8) * 0.018;

    const stance = 0.6 - running * 0.16;
    const cycle = phase / tau;
    poseLeg(leftLeg, cycle, stride, stance);
    poseLeg(rightLeg, (cycle + 0.5) % 1, stride, stance);

    const armAmplitude = movement * (0.32 + running * 0.48);
    const armIdle = idle * Math.sin(breathPhase + 0.5) * 0.014;
    leftArm.shoulder.rotation.x = -swing * armAmplitude - 0.035 + armIdle;
    rightArm.shoulder.rotation.x = swing * armAmplitude - 0.035 - armIdle;
    leftArm.shoulder.rotation.z = -0.075 - movement * running * 0.025;
    rightArm.shoulder.rotation.z = 0.075 + movement * running * 0.025;
    leftArm.elbow.rotation.x = 0.1 + movement * (0.09 + running * 0.9 + (1 - swing) * 0.06);
    rightArm.elbow.rotation.x = 0.1 + movement * (0.09 + running * 0.9 + (1 + swing) * 0.06);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (--geometry.references === 0) {
      for (const shared of geometry.geometries) shared.dispose();
      GEOMETRY_CACHES.delete(THREE_);
    }
    for (const surface of materials) surface.dispose();
    materials.clear();
    object.clear();
  }

  return { object, update, setColorway, dispose };
}
