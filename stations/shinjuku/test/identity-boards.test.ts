import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { pointInRings, soffitHeight, type Plan } from "../scene/layout.ts";
import { buildIdentityBoards, IDENTITY_GENERATED, IDENTITY_SIZE, identityGlyphBox, type LocalBox } from "../scene/identity.ts";
import { stationSpawn } from "../scene/spawn.ts";
import { followCameraEnvironment, LANE_CAMERA, spawnView } from "../app/src/spawn-view.ts";
import { Player } from "../app/src/player.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { textureBudget } from "./helpers/texture-memory.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const corners = (box: LocalBox) => [box.min[0], box.max[0]].flatMap((x) =>
  [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z) => new THREE.Vector3(x, y, z))));
const worldFront = (board: THREE.Object3D) =>
  new THREE.Vector3(...board.userData.gteki_identity.front as [number, number, number]).transformDirection(board.matrixWorld);

describe("#342 original Shinjuku identity recognition proxy (CPU only)", () => {
  let station: BuiltStation;
  beforeAll(() => {
    station = withCanvasStub(() => buildStation(bundle, plan, { quality: "high" }));
    station.root.updateMatrixWorld(true);
  }, 60_000);
  afterAll(() => station?.dispose());

  it("tags both readable faces of every spawn/gate board with valid local name boxes", () => {
    const boards = station.identityBoards;
    expect(station.signs.every((o) => o.name.startsWith("sign:") && !o.userData.gteki_identity)).toBe(true);
    expect(boards.every((o) => !station.signs.includes(o))).toBe(true);
    expect(boards.map((o) => o.name)).toEqual(["identity:spawn", ...bundle.pois.filter((p) => p.category === "ticket_gate").map((p) => `identity:gate:${p.id}`)]);
    const tagged: THREE.Object3D[] = [];
    station.root.traverse((o) => { if (o.userData.gteki_identity) tagged.push(o); });
    expect(tagged).toHaveLength(boards.length * 2);
    for (const board of tagged) {
      expect(board.userData.generated).toBe(IDENTITY_GENERATED);
      const tag = board.userData.gteki_identity;
      expect(tag.front).toHaveLength(3);
      expect(tag.front.every(Number.isFinite)).toBe(true);
      expect(new THREE.Vector3(...tag.front as [number, number, number]).length()).toBeCloseTo(1);
      expect(tag.regions).toHaveLength(1);
      for (const region of tag.regions) {
        expect(region.kind).toBe("name");
        expect(region.min).toHaveLength(3);
        expect(region.max).toHaveLength(3);
        for (let axis = 0; axis < 3; axis++) {
          expect(Number.isFinite(region.min[axis]) && Number.isFinite(region.max[axis])).toBe(true);
          expect(region.min[axis]).toBeLessThan(region.max[axis]);
        }
        expect(Math.max(Math.abs(region.min[0]), Math.abs(region.max[0]))).toBeLessThanOrEqual(IDENTITY_SIZE.width / 2);
        expect(Math.max(Math.abs(region.min[1]), Math.abs(region.max[1]))).toBeLessThanOrEqual(IDENTITY_SIZE.height / 2);
      }
    }
  });

  it("keeps every pair of identity board centres more than 1 m apart", () => {
    const boards = station.identityBoards;
    const distances: { a: string; b: string; metres: number }[] = [];
    for (let i = 0; i < boards.length; i++) for (let j = i + 1; j < boards.length; j++) {
      const a = boards[i]!, b = boards[j]!;
      const metres = a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
      distances.push({ a: a.name, b: b.name, metres });
      expect(metres, `${a.name} / ${b.name}`).toBeGreaterThan(1);
    }
    console.log(JSON.stringify({ identityBoardDistances: distances }));
  });

  it("faces within 20 degrees of each matched gate line normal or its reverse", () => {
    const findings = bundle.pois.filter((p) => p.category === "ticket_gate").map((poi) => {
      const board = station.identityBoards.find((o) => o.name === `identity:gate:${poi.id}`)!;
      expect(board, poi.id).toBeDefined();
      const z = station.layout.nodeZ.get(poi.connectorNodeIds[0]!)!;
      const gate = station.layout.gates.filter((g) => Math.abs(g.center.z - z) < 0.3)
        .sort((a, b) => Math.hypot(a.center.x - poi.displayPosition!.x, a.center.y - poi.displayPosition!.y)
          - Math.hypot(b.center.x - poi.displayPosition!.x, b.center.y - poi.displayPosition!.y))[0]!;
      expect(gate, poi.id).toBeDefined();
      // GateLine.dir is the passenger-flow axis, perpendicular to the physical gate line.
      // ENU (east, north, up) maps to Three (east, up, -north).
      const normal = new THREE.Vector3(gate.dir.x, 0, -gate.dir.y).normalize();
      const degrees = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(worldFront(board).dot(normal)))));
      return { board: board.name, gateEdgeId: gate.edgeId, degrees };
    });
    console.log(JSON.stringify({ identityGateAngles: findings }));
    for (const finding of findings) {
      expect(finding.degrees, `${finding.board} / ${finding.gateEdgeId}: ${finding.degrees} degrees`).toBeLessThanOrEqual(20);
    }
  });

  it("gives every back face the opposite world front and an unmirrored name box", () => {
    for (const board of station.identityBoards) {
      const back = board.children.find((o) => o.name === `${board.name}:back`)!;
      expect(back, board.name).toBeDefined();
      const normal = worldFront(back);
      expect(normal.dot(worldFront(board)), board.name).toBeCloseTo(-1, 10);
      const center = back.getWorldPosition(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(LANE_CAMERA.fov, 1, LANE_CAMERA.near, 400);
      camera.position.copy(center).addScaledVector(normal, 4);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);
      const box = back.userData.gteki_identity.regions[0] as LocalBox;
      const left = back.localToWorld(new THREE.Vector3(...box.min)).project(camera);
      const right = back.localToWorld(new THREE.Vector3(box.max[0], box.min[1], box.min[2])).project(camera);
      expect(left.x, board.name).toBeLessThan(right.x);
      for (const p of [left, right]) {
        expect(Math.abs(p.x), board.name).toBeLessThan(1);
        expect(p.z, board.name).toBeGreaterThan(-1);
        expect(p.z, board.name).toBeLessThan(1);
      }
    }
  });

  it("bakes faces/cases/rods in root-local space and returns current back world matrices", () => {
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(value: T) => { disposables.push(value); return value; };
    const build = (transformed: boolean) => {
      const root = new THREE.Group();
      if (transformed) {
        root.position.set(11, -7, 23);
        root.rotation.set(0.1, 0.6, -0.2);
        root.scale.set(1.2, 0.9, 1.1);
      }
      root.updateMatrixWorld(true);
      const cases: THREE.BufferGeometry[] = [], rods: THREE.BufferGeometry[] = [];
      const boards = withCanvasStub(() => buildIdentityBoards(bundle, station.layout, station.world, root, track, "low", cases, rods));
      disposables.push(...cases, ...rods);
      const faces = (root.getObjectByName("identity-faces") as THREE.Mesh).geometry;
      return { root, boards, geometries: [faces, ...cases, ...rods] };
    };
    try {
      const plain = build(false), transformed = build(true);
      expect(transformed.geometries).toHaveLength(plain.geometries.length);
      transformed.geometries.forEach((geometry, i) => {
        const expected = plain.geometries[i]!;
        for (const name of ["position", "normal", "uv"]) {
          expect(Array.from(geometry.getAttribute(name).array), `${i} ${name}`).toEqual(Array.from(expected.getAttribute(name).array));
        }
        expect(Array.from(geometry.index!.array)).toEqual(Array.from(expected.index!.array));
      });
      for (const board of transformed.boards) {
        const back = board.children.find((o) => o.name === `${board.name}:back`)!;
        // Do not refresh the hierarchy here: buildIdentityBoards must return current matrices.
        const expected = transformed.root.matrixWorld.clone().multiply(board.matrix).multiply(back.matrix);
        expect(back.matrixWorld.elements, board.name).toEqual(expected.elements);
      }
    } finally {
      disposables.forEach((value) => value.dispose());
    }
  });

  it("keeps every casing clear of walls/ceilings with at least 2.1 m headroom", () => {
    const roofs = [...station.layout.levels.flatMap((lv) => lv.ceilings), ...station.layout.soffits];
    for (const board of station.identityBoards) {
      const nodeZ = station.layout.nodeZ.get(board.userData.nodeId)!;
      const bottom = board.position.y - IDENTITY_SIZE.height / 2 - 0.02;
      expect(bottom - nodeZ, board.name).toBeGreaterThanOrEqual(2.1 - 1e-9);
      for (const y of [-IDENTITY_SIZE.height / 2 - 0.02, 0, IDENTITY_SIZE.height / 2 + 0.02]) {
        const edges: THREE.Vector3[] = [];
        for (const [x, z] of [[-0.9, -0.06], [0.9, -0.06], [0.9, 0.06], [-0.9, 0.06]]) {
          edges.push(board.localToWorld(new THREE.Vector3(x, y, z)));
        }
        for (let i = 0; i < edges.length; i++) {
          const a = edges[i]!, b = edges[(i + 1) % edges.length]!;
          expect(station.world.firstWallHit({ x: a.x, y: -a.z }, { x: b.x, y: -b.z }, a.y), board.name).toBe(1);
        }
      }
      // Sample the full upper casing plane, including the thin front/back clearance.
      for (let i = 0; i <= 10; i++) for (const z of [-0.06, 0, 0.06]) {
        const p = board.localToWorld(new THREE.Vector3(-0.9 + 1.8 * i / 10, IDENTITY_SIZE.height / 2 + 0.02, z));
        const enu = { x: p.x, y: -p.z };
        for (const roof of roofs) {
          const h = soffitHeight(roof, enu);
          if (pointInRings(enu, roof.rings) && h > nodeZ + 1.8) expect(h - p.y, board.name).toBeGreaterThanOrEqual(0.08);
        }
      }
    }
  });

  it("has a direct static-geometry sightline to the spawn name block", () => {
    const spawn = stationSpawn(bundle, station.layout.nodeZ, station.world);
    const { eye } = spawnView(spawn.position, spawn.heading, followCameraEnvironment(station.layout, station.propWalls));
    const origin = new THREE.Vector3(eye.x, eye.z, -eye.y);
    const board = station.root.getObjectByName("identity:spawn")!;
    const meshes: THREE.Mesh[] = [];
    station.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      if (materials.some((material) => material.visible && !material.transparent)) meshes.push(m);
    });
    const ray = new THREE.Raycaster();
    for (const kind of ["ja", "en"] as const) {
      const box = identityGlyphBox(kind);
      for (const x of [box.min[0], (box.min[0] + box.max[0]) / 2, box.max[0]]) {
        for (const y of [box.min[1], box.max[1]]) {
          const target = board.localToWorld(new THREE.Vector3(x, y, IDENTITY_SIZE.depth / 2 + 0.002));
          const delta = target.clone().sub(origin);
          ray.set(origin, delta.clone().normalize());
          ray.far = delta.length() + 0.005;
          expect(ray.intersectObjects(meshes, false)[0]?.object.name, `${kind} ${x},${y}`).toBe("identity-faces");
        }
      }
    }
  });

  for (const [width, height] of [[393, 852], [412, 915], [1440, 900], [960, 600]]) {
    it(`projects actual assumed ink/cap heights at normal spawn into ${width}x${height} CSS pixels`, () => {
      const spawn = stationSpawn(bundle, station.layout.nodeZ, station.world);
      const player = new Player(station.world, spawn.position);
      player.heading = spawn.heading;
      const { eye, look } = spawnView({ x: player.x, y: player.y, z: player.z }, player.heading, followCameraEnvironment(station.layout, station.propWalls));
      const camera = new THREE.PerspectiveCamera(LANE_CAMERA.fov, width! / height!, LANE_CAMERA.near, 400);
      camera.position.set(eye.x, eye.z, -eye.y);
      camera.lookAt(look.x, look.z, -look.y);
      camera.updateMatrixWorld(true);
      const board = station.root.getObjectByName("identity:spawn")!;
      const normal = new THREE.Vector3(...board.userData.gteki_identity.front as [number, number, number]).transformDirection(board.matrixWorld);
      expect(normal.dot(camera.position.clone().sub(board.position).normalize())).toBeGreaterThan(0.8);
      const project = (box: LocalBox) => corners(box).map((p) => board.localToWorld(p).project(camera));
      const name = project(board.userData.gteki_identity.regions[0]);
      for (const p of name) {
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
        expect(p.z).toBeGreaterThan(-1);
        expect(p.z).toBeLessThan(1);
      }
      // Same-z vertical edges, so a tilted board's depth/width cannot inflate glyph height.
      const capHeight = (box: LocalBox) => Math.min(...[box.min[0], box.max[0]].flatMap((x) =>
        [box.min[2], box.max[2]].map((z) => {
          const a = board.localToWorld(new THREE.Vector3(x, box.min[1], z)).project(camera);
          const b = board.localToWorld(new THREE.Vector3(x, box.max[1], z)).project(camera);
          return Math.abs(b.y - a.y) * height! / 2;
        })));
      const ja = capHeight(identityGlyphBox("ja")), en = capHeight(identityGlyphBox("en"));
      console.log(JSON.stringify({ viewport: `${width}x${height}`, jaCssPx: ja, enCssPx: en, nameNdc: { left: Math.min(...name.map((p) => p.x)), right: Math.max(...name.map((p) => p.x)), bottom: Math.min(...name.map((p) => p.y)), top: Math.max(...name.map((p) => p.y)) } }));
      expect(ja).toBeGreaterThanOrEqual(18);
      expect(en).toBeGreaterThanOrEqual(12);
    });
  }

  for (const quality of ["low", "high"] as const) {
    it(`reports the shared ${quality} identity texture and one added face draw`, () => {
      const built = quality === "high" ? station : withCanvasStub(() => buildStation(bundle, plan, { quality }));
      try {
        const budget = textureBudget(built.root);
        const entries = budget.entries.filter((e) => e.meshes.includes("identity-faces"));
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.category).toBe("signage");
        expect([entry.width, entry.height]).toEqual(quality === "high" ? [1024, 512] : [512, 256]);
        const faces = built.root.getObjectByName("identity-faces") as THREE.Mesh;
        expect(faces.userData.faceCount).toBe(8);
        expect(faces.geometry.index!.count / 3).toBe(16);
        let draws = 0;
        built.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) draws += Array.isArray(m.material) ? m.material.length : 1; });
        console.log(JSON.stringify({ quality, identityTexture: entry, totalTextureBytes: budget.totalBytes, meshMaterialDraws: draws }));
      } finally { if (built !== station) built.dispose(); }
    }, 60_000);
  }
});
