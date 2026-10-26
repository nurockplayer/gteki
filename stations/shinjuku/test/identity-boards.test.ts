import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import stationJson from "../gteki/station.json" with { type: "json" };
import { PLATFORM_IDENTITY_SLOT, platformIdentityCandidate } from "../scene/identity-placement.ts";
import { identityHardwareBoxes, identityObstacles, searchPlatformIdentityPlacement } from "./helpers/identity-placement.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildStation, type BuiltStation } from "../scene/build.ts";
import { pointInRings, soffitHeight, type Plan } from "../scene/layout.ts";
import { buildIdentityBoards, IDENTITY_GENERATED, IDENTITY_SIZE, identityGlyphBox, type LocalBox } from "../scene/identity.ts";
import { IDENTITY_FADE_NEAR, IDENTITY_FADE_FAR, IDENTITY_FADE_FRAGMENT, identityFadeCoverage, identityDitherVisible } from "../scene/identity-fade.ts";
import { stationSpawn } from "../scene/spawn.ts";
import { followCameraEnvironment, LANE_CAMERA, spawnView } from "../app/src/spawn-view.ts";
import { Player } from "../app/src/player.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";
import { textureBudget } from "./helpers/texture-memory.ts";

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;
const corners = (box: LocalBox) => [box.min[0], box.max[0]].flatMap((x) =>
  [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z) => new THREE.Vector3(x, y, z))));
// Only this station's own (Toei E27) ticket gates get identity boards; other operators' gate POIs in the shared data are out of scope.
const e27Gates = bundle.pois.filter((p) => p.category === "ticket_gate" && p.id.startsWith("poi:gate:"));
const worldFront = (board: THREE.Object3D) =>
  new THREE.Vector3(...board.userData.gteki_identity.front as [number, number, number]).transformDirection(board.matrixWorld);

describe("#342 original Shinjuku identity recognition proxy (CPU only)", () => {
  let station: BuiltStation;
  beforeAll(() => {
    station = withCanvasStub(() => buildStation(bundle, plan, { quality: "high" }));
    station.root.updateMatrixWorld(true);
  }, 60_000);
  afterAll(() => station?.dispose());

  it("patches both opaque identity materials using the active camera, with distinct compile keys", () => {
    const meshes = ["identity-faces", "identity-cases-rods"].map((name) => station.root.getObjectByName(name) as THREE.Mesh);
    const keys: string[] = [];
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      const source = material.type === "MeshBasicMaterial" ? THREE.ShaderLib.basic : THREE.ShaderLib.standard;
      const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader, uniforms: THREE.UniformsUtils.clone(source.uniforms) };
      material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
      expect(material.transparent, mesh.name).toBe(false);
      expect(material.depthWrite, mesh.name).toBe(true);
      expect(material.opacity, mesh.name).toBe(1);
      expect(material.defines?.GTEKI_IDENTITY_NEAR_FADE).toBe(1);
      expect(shader.uniforms.gtekiIdentityNear?.value).toBe(IDENTITY_FADE_NEAR);
      expect(shader.uniforms.gtekiIdentityFar?.value).toBe(IDENTITY_FADE_FAR);
      expect(shader.vertexShader).toContain("#include <project_vertex>\nvGtekiIdentityViewPosition = mvPosition.xyz;");
      expect(shader.fragmentShader).toContain(IDENTITY_FADE_FRAGMENT);
      expect(shader.fragmentShader).toContain("smoothstep(gtekiIdentityNear, gtekiIdentityFar, length(vGtekiIdentityViewPosition))");
      expect(shader.fragmentShader).toContain("if (gtekiIdentityCoverage < gtekiIdentityThreshold(gl_FragCoord.xy)) discard;");
      const plain = material.type === "MeshBasicMaterial" ? new THREE.MeshBasicMaterial() : new THREE.MeshStandardMaterial();
      expect(material.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
      plain.dispose();
      expect(material.customProgramCacheKey()).toContain("gteki-identity-near-fade-v1");
      keys.push(material.customProgramCacheKey());
      if (mesh.name === "identity-cases-rods") {
        expect(shader.vertexShader).toContain("vIdentityMetalness = identityMetalness;");
        expect(shader.fragmentShader).toContain("metalnessFactor *= vIdentityMetalness;");
        expect((material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
        expect(new Set(Array.from(mesh.geometry.getAttribute("identityMetalness").array)).size).toBe(2);
        expect(mesh.geometry.getAttribute("color").count).toBe(mesh.geometry.getAttribute("position").count);
      }
    }
    expect(new Set(keys).size).toBe(2);
    const cases = station.root.getObjectByName("sign-cases") as THREE.Mesh;
    expect((cases.material as THREE.MeshStandardMaterial).defines?.GTEKI_IDENTITY_NEAR_FADE).toBeUndefined();
    expect(cases.geometry.index!.count / 3).toBe(station.signs.length * 12);
  });

  it("hides/shows the complete dither tile at near/far and covers half at 2.3 m", () => {
    const tile = (distance: number) => Array.from({ length: 16 }, (_, i) => identityDitherVisible(distance, i % 4, Math.floor(i / 4)));
    for (const distance of [1.0, IDENTITY_FADE_NEAR]) {
      expect(identityFadeCoverage(distance)).toBe(0);
      expect(tile(distance).filter(Boolean)).toHaveLength(0);
    }
    expect(identityFadeCoverage(2.3)).toBeCloseTo(0.5, 12);
    expect(tile(2.3)).toEqual([true, false, true, false, false, true, false, true, true, false, true, false, false, true, false, true]);
    for (const distance of [IDENTITY_FADE_FAR, 3.5]) {
      expect(identityFadeCoverage(distance)).toBe(1);
      expect(tile(distance).filter(Boolean)).toHaveLength(16);
    }
    for (let y = -4; y < 4; y++) for (let x = -4; x < 4; x++) {
      expect(identityDitherVisible(2.3, x, y)).toBe(identityDitherVisible(2.3, x + 4, y + 4));
    }
  });

  it("tags both readable faces of every spawn/gate/platform board with valid local name boxes", () => {
    const boards = station.identityBoards;
    expect(station.signs.every((o) => o.name.startsWith("sign:") && !o.userData.gteki_identity)).toBe(true);
    expect(boards.every((o) => !station.signs.includes(o))).toBe(true);
    expect(boards.map((o) => o.name)).toEqual(["identity:spawn", ...e27Gates.map((p) => `identity:gate:${p.id}`), "identity:platform:poi:platform:oedo"]);
    const tagged: THREE.Object3D[] = [];
    station.root.traverse((o) => { if (o.userData.gteki_identity) tagged.push(o); });
    expect(tagged).toHaveLength(boards.length * 2);
    for (const board of tagged) {
      expect(board.userData.generated).toBe(IDENTITY_GENERATED);
      expect(board.userData.placement).toMatch(/^GTEki (?:wayfinding )?placement/);
      expect(board.userData.placement).toContain("not surveyed");
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

  it("places the platform board across the track at the first qualifying chip-2 candidate", () => {
    const board = station.root.getObjectByName("identity:platform:poi:platform:oedo")!;
    const poi = bundle.pois.find(p => p.id === "poi:platform:oedo")!;
    const node = bundle.nodes.find(n => n.id === poi.connectorNodeIds[0])!;
    expect(node.id).toBe(stationJson.spawnNodeIds[1]);
    expect(board.userData.nodeId).toBe(node.id);
    expect(board.userData.placement).toBe("GTEki wayfinding placement; not surveyed, not a replica of the on-site sign");
    expect(board.children[0]!.userData.placement).toBe(board.userData.placement);
    const floor = station.layout.nodeZ.get(node.id)!;
    const eye = new THREE.Vector3(node.position.x, floor + 1.6, -node.position.y);
    const region = board.userData.gteki_identity.regions[0] as LocalBox;
    const target = board.localToWorld(new THREE.Vector3(...region.min).add(new THREE.Vector3(...region.max)).multiplyScalar(0.5));
    const delta = target.clone().sub(eye);
    const facing = worldFront(board).dot(delta.clone().negate().normalize());
    expect(delta.length()).toBeCloseTo(8.119919707321568, 10);
    expect(facing).toBeCloseTo(0.9852314171021372, 10);
    expect((Math.atan2(delta.x, -delta.z) * 180 / Math.PI + 360) % 360).toBeCloseTo(160.72154431381705, 10);
    expect(delta.length()).toBeGreaterThanOrEqual(4);
    expect(delta.length()).toBeLessThanOrEqual(20);
    expect(facing).toBeGreaterThanOrEqual(0.5);
    const meshes: THREE.Mesh[] = [];
    station.root.traverseVisible(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.name.startsWith("identity") && [mesh.material].flat().some(m => m.visible && !m.transparent)) meshes.push(mesh);
    });
    const ray = new THREE.Raycaster(eye, delta.clone().normalize(), 0, delta.length() - 0.001);
    expect(ray.intersectObjects(meshes, false)).toHaveLength(0);
    const level = station.layout.levels.find(l => l.floorId === poi.floorId)!;
    const top = board.position.y + IDENTITY_SIZE.height / 2;
    expect(board.position.y - IDENTITY_SIZE.height / 2 - 0.02 - floor).toBeGreaterThanOrEqual(2.3);
    expect(top + 0.02).toBeLessThanOrEqual(level.ceilingZ - 0.12);
    expect(identityObstacles(station.root).hardwareBlocker(board, identityHardwareBoxes(IDENTITY_SIZE, level.ceilingZ - top))).toBeNull();
    // Re-run the full ordered search against the completed scene, including sign hardware.
    const chosen = searchPlatformIdentityPlacement(bundle, station.layout, station.world, station.root, IDENTITY_SIZE, region);
    expect(chosen.attempts).toHaveLength(22);
    expect(chosen.attempts.slice(0, -1).every(c => c.direction === "toward midpoint" && !c.pass)).toBe(true);
    expect(chosen.attempts.slice(0, -1).map(c => c.offsetM)).toEqual(Array.from({ length: 21 }, (_, i) => 8 + i * 0.5));
    const accepted = chosen.attempts.at(-1)!;
    expect({ direction: accepted.direction, offsetM: accepted.offsetM }).toEqual(PLATFORM_IDENTITY_SLOT);
    const slab = level.slabs.find(s => s.category === "B029" && pointInRings(node.position, s.rings))!;
    expect(accepted.ringVertexCount).toBe(slab.rings[0]!.length);
    expect(chosen.level).toBe(level);
    expect(accepted).toMatchObject({ pass: true,
      blockedBy: null, wallsClear: true, roofClear: true, footprintInside: true, geometryBlocker: null });
    expect(board.position.x).toBeCloseTo(chosen.center.x, 10);
    expect(-board.position.z).toBeCloseTo(chosen.center.y, 10);
    expect(board.position.y).toBeCloseTo(chosen.top - IDENTITY_SIZE.height / 2, 10);
    // Normal along the slab's derived long axis: the board plane hangs across it.
    expect(worldFront(board).dot(new THREE.Vector3(chosen.facing.x, 0, -chosen.facing.y))).toBeCloseTo(1, 10);
    console.log(JSON.stringify({ platformIdentity: { ...accepted, nameCenterEnu: { x: target.x, y: -target.z, z: target.y },
      readableFace: "front", ceilingClearance: level.ceilingZ - top - 0.02, attempts: chosen.attempts } }));
  });

  it("skips an invalid platform slot without throwing, preserves other boards and warns once", () => {
    const missingConnector = { ...bundle, pois: bundle.pois.map(p => p.id === "poi:platform:oedo"
      ? { ...p, connectorNodeIds: ["missing-platform-identity-connector"] } : p) };
    const platformPoi = bundle.pois.find(p => p.id === "poi:platform:oedo")!;
    const insufficientHeadroom = { ...station.layout, levels: station.layout.levels.map(level => level.floorId === platformPoi.floorId
      ? { ...level, ceilingZ: level.z + 2.5 } : level) };
    const node = bundle.nodes.find(n => n.id === platformPoi.connectorNodeIds[0])!;
    const level = station.layout.levels.find(l => l.floorId === platformPoi.floorId)!;
    const slab = level.slabs.find(s => s.category === "B029" && pointInRings(node.position, s.rings))!;
    const withRings = (rings: typeof slab.rings) => ({ ...station.layout, levels: station.layout.levels.map(l => l === level
      ? { ...l, slabs: l.slabs.map(s => s === slab ? { ...s, rings } : s) } : l) });
    // An empty hole preserves connector containment but makes polygon-clipping throw.
    const throwingPolygon = withRings([...slab.rings, []]);
    const region = station.root.getObjectByName("identity:platform:poi:platform:oedo")!.userData.gteki_identity.regions[0] as LocalBox;
    expect(() => platformIdentityCandidate(bundle, throwingPolygon, station.world, IDENTITY_SIZE, region, PLATFORM_IDENTITY_SLOT))
      .toThrow("Input geometry is not a valid Polygon or MultiPolygon");
    const paddedRing = (count: number) => [...slab.rings[0]!, ...Array.from({ length: count - slab.rings[0]!.length }, () => ({ ...slab.rings[0]![0]! }))];
    const atLimit = withRings([paddedRing(256), ...slab.rings.slice(1)]);
    const overLimit = withRings([paddedRing(257), ...slab.rings.slice(1)]);
    expect(platformIdentityCandidate(bundle, atLimit, station.world, IDENTITY_SIZE, region, PLATFORM_IDENTITY_SLOT)?.checks)
      .toMatchObject({ pass: true, ringVertexCount: 256 });
    expect(platformIdentityCandidate(bundle, overLimit, station.world, IDENTITY_SIZE, region, PLATFORM_IDENTITY_SLOT)).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(value: T) => { disposables.push(value); return value; };
    try {
      // Cheap failure, missing data, an actual clipping exception and the axis-cost guard share one warning.
      for (const [input, layout] of [[bundle, insufficientHeadroom], [missingConnector, station.layout],
        [bundle, throwingPolygon], [bundle, overLimit]] as const) {
        const root = new THREE.Group();
        let boards: THREE.Object3D[] = [];
        expect(() => { boards = withCanvasStub(() => buildIdentityBoards(input, layout, station.world, root, track, "low")); }).not.toThrow();
        expect(boards.map(board => board.name)).toEqual(station.identityBoards.filter(board => !board.name.startsWith("identity:platform:")).map(board => board.name));
        expect(root.getObjectByName("identity:platform:poi:platform:oedo")).toBeUndefined();
        const faces = root.getObjectByName("identity-faces") as THREE.Mesh;
        expect(faces.userData.faceCount).toBe(8);
      }
      expect(warn).toHaveBeenCalledExactlyOnceWith("Skipping GTEki platform identity board: missing placement data or failed clearance checks");
    } finally {
      warn.mockRestore();
      disposables.forEach(value => value.dispose());
    }
  });

  it("builds the fixed platform without raycasts and retains its validated level among equal elevations", () => {
    const poi = bundle.pois.find(p => p.id === "poi:platform:oedo")!;
    const level = station.layout.levels.find(l => l.floorId === poi.floorId)!;
    const layout = { ...station.layout, levels: [{ ...level, floorId: "unrelated-same-elevation", ceilingZ: level.ceilingZ + 5 }, ...station.layout.levels] };
    const root = new THREE.Group(), fixture = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    fixture.raycast = vi.fn(() => { throw new Error("Runtime identity placement must not raycast geometry"); });
    root.add(fixture);
    const disposables: { dispose(): void }[] = [fixture.geometry, fixture.material];
    const track = <T extends { dispose(): void }>(value: T) => { disposables.push(value); return value; };
    try {
      const boards = withCanvasStub(() => buildIdentityBoards(bundle, layout, station.world, root, track, "low"));
      expect(fixture.raycast).not.toHaveBeenCalled();
      expect(boards.map(board => board.name)).toEqual(station.identityBoards.map(board => board.name));
      for (const name of ["identity-faces", "identity-cases-rods"]) {
        const actual = (root.getObjectByName(name) as THREE.Mesh).geometry;
        const expected = (station.root.getObjectByName(name) as THREE.Mesh).geometry;
        for (const attribute of Object.keys(expected.attributes))
          expect(Array.from(actual.getAttribute(attribute).array), `${name} ${attribute}`).toEqual(Array.from(expected.getAttribute(attribute).array));
        expect(Array.from(actual.index!.array)).toEqual(Array.from(expected.index!.array));
      }
    } finally { disposables.forEach(value => value.dispose()); }
  });

  it("rejects opaque and glass fixture intersections, including transformed instances", () => {
    const root = new THREE.Group(), board = new THREE.Object3D();
    root.position.set(7, 2, -3);
    root.rotation.y = 0.4;
    board.position.set(3, 1, 2);
    board.updateMatrix();
    const geometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3 });
    const fixture = new THREE.InstancedMesh(geometry, material, 1);
    fixture.name = "ceiling fixture";
    const boxes = identityHardwareBoxes(IDENTITY_SIZE, 0.4);
    root.add(fixture);
    try {
      for (const local of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(IDENTITY_SIZE.width * 0.35, 0.6, 0)]) {
        const center = local.applyMatrix4(board.matrix);
        fixture.setMatrixAt(0, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
        expect(identityObstacles(root).hardwareBlocker(board, boxes)).toBe("ceiling fixture");
        material.transparent = false;
        expect(identityObstacles(root).hardwareBlocker(board, boxes)).toBe("ceiling fixture");
        material.transparent = true;
      }
      fixture.setMatrixAt(0, new THREE.Matrix4().makeTranslation(50, 50, 50));
      expect(identityObstacles(root).hardwareBlocker(board, boxes)).toBeNull();
    } finally { fixture.dispose(); geometry.dispose(); material.dispose(); }
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
    const findings = e27Gates.map((poi) => {
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
      const boards = withCanvasStub(() => buildIdentityBoards(bundle, station.layout, station.world, root, track, "low"));
      const geometries = ["identity-faces", "identity-cases-rods"].map((name) => (root.getObjectByName(name) as THREE.Mesh).geometry);
      return { root, boards, geometries };
    };
    try {
      const plain = build(false), transformed = build(true);
      expect(transformed.geometries).toHaveLength(plain.geometries.length);
      transformed.geometries.forEach((geometry, i) => {
        const expected = plain.geometries[i]!;
        for (const name of Object.keys(expected.attributes)) {
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
      const nameDistances = station.identityBoards.flatMap((front) => [front, ...front.children]).map((face) => {
        const region = face.userData.gteki_identity.regions[0] as LocalBox;
        const box = new THREE.Box3(new THREE.Vector3(...region.min), new THREE.Vector3(...region.max));
        const nearest = box.clampPoint(face.worldToLocal(camera.position.clone()), new THREE.Vector3());
        return { board: face.name, metres: face.localToWorld(nearest).distanceTo(camera.position) };
      });
      const nearestNameMetres = Math.min(...nameDistances.map((d) => d.metres));
      expect(nearestNameMetres, "every name box stays beyond the fade at normal spawn").toBeGreaterThan(IDENTITY_FADE_FAR);
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
      console.log(JSON.stringify({ viewport: `${width}x${height}`, nearestNameMetres, nameDistances, jaCssPx: ja, enCssPx: en, nameNdc: { left: Math.min(...name.map((p) => p.x)), right: Math.max(...name.map((p) => p.x)), bottom: Math.min(...name.map((p) => p.y)), top: Math.max(...name.map((p) => p.y)) } }));
      expect(ja).toBeGreaterThanOrEqual(18);
      expect(en).toBeGreaterThanOrEqual(12);
    });
  }

  for (const quality of ["low", "high"] as const) {
    it(`reports the shared ${quality} identity texture and two identity draws`, () => {
      const built = quality === "high" ? station : withCanvasStub(() => buildStation(bundle, plan, { quality }));
      try {
        const budget = textureBudget(built.root);
        const entries = budget.entries.filter((e) => e.meshes.includes("identity-faces"));
        expect(entries).toHaveLength(1);
        const entry = entries[0]!;
        expect(entry.category).toBe("signage");
        expect([entry.width, entry.height]).toEqual(quality === "high" ? [1024, 512] : [512, 256]);
        const faces = built.root.getObjectByName("identity-faces") as THREE.Mesh;
        expect(faces.userData.faceCount).toBe(10);
        expect(faces.geometry.index!.count / 3).toBe(20);
        const hardware = built.root.getObjectByName("identity-cases-rods") as THREE.Mesh;
        expect(hardware.geometry.index!.count / 3).toBe(300);
        expect(hardware.geometry.groups).toHaveLength(0);
        expect(Array.isArray(hardware.material)).toBe(false);
        let draws = 0;
        built.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) draws += Array.isArray(m.material) ? m.material.length : 1; });
        expect(draws).toBe(143); // 139 before the fade; the hardware draw is new; #221 adds 3 room-floor meshes.
        console.log(JSON.stringify({ quality, identityTexture: entry, totalTextureBytes: budget.totalBytes, meshMaterialDraws: draws }));
      } finally { if (built !== station) built.dispose(); }
    }, 60_000);
  }
});
