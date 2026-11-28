import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { RailLane } from "@gteki/scene-api/rail-registry";
import type { BufferGeometry, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cutRegions, disposePortalCuts, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import { prepareRayTrees } from "../../../../apps/web/src/explorer/meshBvh.ts";

export default function buildJr(ctx: SceneContext, lane: RailLane, scene: StationScene) {
  const { THREE, bundle } = ctx;
  const root = new THREE.Group();
  root.name = "jr-platform-preview";
  const walkable: Object3D[] = [];
  const colliders: Object3D[] = [];
  const deck = new THREE.MeshBasicMaterial({ color: 0xb6b1a2 });
  const steps = new THREE.MeshBasicMaterial({ color: 0x887f73 });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xe5b33c });
  const steel = new THREE.MeshBasicMaterial({ color: 0x686b69 });
  const ballast = new THREE.MeshBasicMaterial({ color: 0x383937 });
  const canopy = new THREE.MeshBasicMaterial({ color: 0xc6c9c4 });
  const escalator = new THREE.MeshBasicMaterial({ color: 0x484b4c });
  const batches = new Map<MeshBasicMaterial, Map<"ground" | "wall" | "detail", BufferGeometry[]>>();
  const boxGeometry = new THREE.BoxGeometry();
  const add = (material: MeshBasicMaterial, role: "ground" | "wall" | "detail", geometry: BufferGeometry) => {
    const groups = batches.get(material) ?? new Map();
    batches.set(material, groups);
    const batch = groups.get(role) ?? [];
    groups.set(role, batch);
    batch.push(geometry);
  };
  const box = (x0: number, x1: number, y0: number, y1: number, top: number, depth: number,
    material: MeshBasicMaterial, role: "ground" | "wall" | "detail" = "detail") => {
    add(material, role, boxGeometry.clone().scale(x1 - x0, depth, y1 - y0)
      .translate(...ctx.enuToRenderer({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: top - depth / 2 })));
  };
  const beam = (a: Vector3, b: Vector3, width: number, depth: number, material: MeshBasicMaterial, role: "ground" | "wall") => {
    const delta = b.clone().sub(a);
    const length = Math.hypot(delta.x, delta.z);
    const geometry = boxGeometry.clone().scale(Math.hypot(length, delta.y) + 0.24, depth, width);
    geometry.translate(0, -depth / 2, 0).rotateZ(Math.atan2(delta.y, length)).rotateY(Math.atan2(-delta.z, delta.x));
    const mid = a.clone().lerp(b, 0.5);
    add(material, role, geometry.translate(mid.x, mid.y, mid.z));
  };
  const edges = bundle.edges.filter(edge => edge.id.startsWith("rail:jr:"));
  const liftHalf = 1.15;
  const liftEdges = edges.filter(edge => edge.mode === "elevator");
  const liftStops = new Set(liftEdges.flatMap(edge => [edge.from, edge.to]));
  const flights = edges.filter(edge => edge.mode === "stairs" || edge.mode === "escalator").map(edge => {
    const [a, b] = [edge.geometry[0]!, edge.geometry.at(-1)!];
    const [low, high] = a.z! < b.z! ? [a, b] : [b, a];
    const width = edge.mode === "escalator" ? 1.9 : 2.6;
    return { low, high, width, material: edge.mode === "escalator" ? escalator : steps };
  });
  const point = (p: { x: number; y: number; z: number | null }) => new THREE.Vector3(...ctx.enuToRenderer({ ...p, z: p.z! }));
  const cuts: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const cutBox = (min: Vector3, max: Vector3) => ({
    key: {}, bounds: new THREE.Box3(min, max), clip: null, accepts: () => true,
    planes: [
      (p: Vector3) => p.x - min.x, (p: Vector3) => max.x - p.x,
      (p: Vector3) => p.y - min.y, (p: Vector3) => max.y - p.y,
      (p: Vector3) => p.z - min.z, (p: Vector3) => max.z - p.z,
    ],
  });
  const barriers = new Set(["access_fences", "portal_beyond", "wall", "barriers", "ceiling", "transport"]);
  const targets = [...(scene.colliders ?? [])];
  scene.root.traverse(object => {
    if (barriers.has(object.userData.gteki_role)) targets.push(object);
  });
  const openings = [];
  for (const edge of edges) {
    if (edge.mode !== "walk" && edge.mode !== "gate") continue;
    for (let i = 1; i < edge.geometry.length; i++) {
      const a = point(edge.geometry[i - 1]!), b = point(edge.geometry[i]!);
      const axis = b.clone().sub(a).normalize().multiplyScalar(liftHalf + 0.08);
      if (i === 1 && liftStops.has(edge.from)) a.add(axis);
      if (i === edge.geometry.length - 1 && liftStops.has(edge.to)) b.sub(axis);
      if (edge.attributes?.deferredScene !== false) beam(a, b, 2.6, 0.16, deck, "ground");
      if (Math.min(a.y, b.y) > 30) continue;
      const min = a.clone().min(b).add(new THREE.Vector3(-1.3, 0.03, -1.3));
      const max = a.clone().max(b).add(new THREE.Vector3(1.3, 2.65, 1.3));
      openings.push(cutBox(min, max));
    }
  }
  for (const { low, high, width, material } of flights) {
    const start = point(low), end = point(high);
    const count = Math.ceil((end.y - start.y) / 0.18);
    const dy = (end.y - start.y) / count;
    const dz = (end.z - start.z) / count;
    for (let i = 0; i < count; i++) {
      const tread = start.z + dz * i;
      box(low.x - width / 2, low.x + width / 2, -Math.max(tread, tread + dz), -Math.min(tread, tread + dz),
        start.y + dy * (i + 1), dy + 0.1, material, "ground");
    }
    for (const offset of [-width / 2, width / 2]) {
      const side = new THREE.Vector3(offset, 0.9, 0);
      const inset = 1.5 / Math.abs(end.z - start.z);
      beam(start.clone().lerp(end, inset).add(side), end.clone().add(side), 0.08, 0.9, steel, "wall");
    }
    if (start.y < 30) {
      const min = start.clone().min(end).add(new THREE.Vector3(-width / 2, 0.03, -0.16));
      const max = start.clone().max(end).add(new THREE.Vector3(width / 2, 2.65, 0.16));
      openings.push(cutBox(min, max));
    }
  }
  const sign = (number: string, ja: string, en: string, accent: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ink = canvas.getContext("2d")!;
    ink.fillStyle = "#25332d";
    ink.fillRect(0, 0, 512, 128);
    ink.fillStyle = accent;
    ink.fillRect(0, 0, 108, 128);
    ink.fillStyle = "#172511";
    ink.font = "bold 88px sans-serif";
    ink.fillText(number, 24, 95, 70);
    ink.fillStyle = "#fff";
    ink.font = "bold 42px sans-serif";
    ink.fillText(ja, 127, 59, 365);
    ink.font = "28px sans-serif";
    ink.fillText(en, 127, 102, 365);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 0.06), new THREE.MeshBasicMaterial({ map: texture }));
    root.add(board);
    return board;
  };
  for (const [id, ja, en, facing] of [
    ["jr-north-public", "北改札", "North Gate", 1],
    ["jr-metropolitan-public", "メトロポリタン改札", "Metropolitan Gate", -1],
  ] as const) {
    const [x, y, z] = lane.gates.find(gate => gate.id === id)!.position!;
    const threshold = x - 3 * facing;
    const board = sign("JR", ja, en, "#91c934");
    board.rotation.y = facing * Math.PI / 2;
    board.position.set(...ctx.enuToRenderer({ x: threshold, y, z: z + 2.45 }));
    for (const side of [y - 1.6, y + 1.6]) {
      box(threshold - 0.18, threshold + 0.18, side - 0.16, side + 0.16, z + 2.1, 2.1, steel, "wall");
    }
  }
  const height = bundle.floors.find(floor => floor.id === "jr-1f")!.renderElevationM;
  const roof = height + 3.65;
  const labels = (lane as RailLane & { serviceNames: Record<string, RailLane["line"]> }).serviceNames;
  const accent: Record<string, string> = { JA: "#69c4ab", JS: "#f39b73", JY: "#91c934" };
  const streetBounds = new THREE.Box3();
  for (let i = 0; i < lane.platforms.length; i += 2) {
    const [west, east] = [lane.platforms[i]!, lane.platforms[i + 1]!];
    const [[westFace, south], [, north]] = west.centerline!;
    const [[eastFace]] = east.centerline!;
    const center = (westFace + eastFace) / 2;
    const left = center - west.width_m!, right = center + east.width_m!;
    const wells = flights.filter(({ low, high }) => low.x > left && low.x < right && low.z! < height && high.z === height
      && Math.max(low.y, high.y) > south && Math.min(low.y, high.y) < north);
    const spans = wells.map(({ low, high, width }) => {
      const x0 = low.x - width / 2, x1 = low.x + width / 2;
      if (low.y > south && low.y < north) {
        box(x0, x1, low.y - 0.05, low.y + 0.05, height + 0.95, 0.95, steel, "wall");
      }
      return { x0, x1, y0: Math.max(south, Math.min(low.y, high.y)), y1: Math.min(north, Math.max(low.y, high.y)) };
    });
    const columns = [...new Set([left, right, ...spans.flatMap(span => [span.x0, span.x1])])].sort((a, b) => a - b);
    for (let j = 1; j < columns.length; j++) {
      const x0 = columns[j - 1]!, x1 = columns[j]!;
      let y = south;
      for (const span of spans.filter(s => s.x0 < x1 && s.x1 > x0).sort((a, b) => a.y0 - b.y0)) {
        if (span.y0 > y) box(x0, x1, y, span.y0, height, 0.28, deck, "ground");
        y = Math.max(y, span.y1);
      }
      if (y < north) box(x0, x1, y, north, height, 0.28, deck, "ground");
    }

    for (const [edge, direction] of [[left, -1], [right, 1]] as const) {
      const beside = (a: number, b: number, z: number, depth: number, material: MeshBasicMaterial, end = north) =>
        box(Math.min(edge + a * direction, edge + b * direction), Math.max(edge + a * direction, edge + b * direction),
          south, end, z, depth, material);
      beside(-0.55, -0.25, height + 0.012, 0.02, yellow);
      beside(0, 3.2, height - 0.88, 0.3, ballast);
      beside(0.68, 0.78, height - 0.62, 0.16, steel);
      beside(2.115, 2.215, height - 0.62, 0.16, steel);
      for (let y = south + 0.5; y < north; y += 1.2) {
        const a = edge + 0.35 * direction, b = edge + 2.48 * direction;
        box(Math.min(a, b), Math.max(a, b), y, y + 0.24, height - 0.76, 0.1, steps);
      }
    }
    box(left + 0.65, right - 0.65, south + 1, north - 1, roof, 0.24, canopy);
    for (const y of [47, 58, 82, 90]) {
      box(center + 1.28, center + 1.52, y - 0.12, y + 0.12, roof, roof - height, canopy, "wall");
    }
    for (const platform of [west, east]) {
      const face = platform.centerline![0][0];
      const x = face + Math.sign(face - center);
      const service = platform.services[0]!;
      const name = labels[service]!;
      const y = 73.5;
      const board = sign(String(platform.number), `池袋　${name.ja}`, `Ikebukuro · ${name.en}`, accent[service]!);
      board.scale.x = 0.86;
      board.position.set(...ctx.enuToRenderer({ x, y, z: height + 2.1 }));
      box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, roof, roof - height - 2.5, canopy);
    }
    streetBounds.expandByPoint(new THREE.Vector3(left - 3.2, height - 1.3, -north));
    streetBounds.expandByPoint(new THREE.Vector3(right + 3.2, roof + 0.2, -south));
  }
  openings.push(cutBox(
    new THREE.Vector3(streetBounds.min.x, height - 0.03, streetBounds.min.z),
    new THREE.Vector3(streetBounds.max.x, streetBounds.max.y, streetBounds.max.z),
  ));
  cutRegions(targets, openings, cuts);
  prepareRayTrees([...cuts.originals.keys()]);

  root.userData.cutStreetContext = (context: Object3D, blockers: Object3D[]) => {
    const southernAccess = cutBox(new THREE.Vector3(-107, 30.8, -35), new THREE.Vector3(10, 39.8, 9));
    cutRegions([context, ...blockers], [cutBox(streetBounds.min, streetBounds.max), southernAccess], cuts);
    prepareRayTrees(blockers);
  };

  const liftSign = sign("EV", "エレベーター", "Lift", "#e5b33c");
  root.remove(liftSign);
  const liftBoards = new THREE.InstancedMesh(liftSign.geometry, liftSign.material, liftEdges.length * 2);
  root.add(liftBoards);
  const cars = liftEdges.map((edge, i) => {
    const [low, high] = [point(edge.geometry[0]!), point(edge.geometry.at(-1)!)];
    const half = liftHalf;
    const car = new THREE.Mesh(new THREE.BoxGeometry(2 * half, 0.16, 2 * half).translate(0, -0.08, 0), canopy);
    car.position.copy(low);
    root.add(car);
    walkable.push(car);
    for (const x of [low.x - half, low.x + half]) {
      box(x - 0.06, x + 0.06, -low.z - half, -low.z + half, high.y + 2.4, high.y + 2.4 - low.y, steel, "wall");
    }
    box(low.x - half, low.x + half, -low.z + half, -low.z + half + 0.08, low.y + 2.6, 2.6, steel, "wall");
    box(low.x - half, low.x + half, -low.z - half - 0.08, -low.z - half, high.y + 2.6, 2.6, steel, "wall");
    for (const [stop, floor] of [low, high].entries()) {
      const signMatrix = new THREE.Matrix4().makeScale(0.65, 0.65, 0.65)
        .setPosition(floor.x, floor.y + 2.2, floor.z + (stop === 0 ? half : -half));
      liftBoards.setMatrixAt(i * 2 + stop, signMatrix);
    }
    return { car, low, high, target: low.y, riding: false, boarded: false, dwell: 0 };
  });
  for (const [material, groups] of batches) for (const [role, geometries] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries)!, material);
    root.add(mesh);
    if (role === "ground") walkable.push(mesh);
    if (role === "wall") colliders.push(mesh);
    for (const geometry of geometries) geometry.dispose();
  }
  boxGeometry.dispose();

  return {
    root, walkable, colliders,
    carryWalker(position: Vector3, dt: number, guided = false) {
      let riding = false;
      for (const lift of cars) {
        const { car, low, high } = lift;
        const dx = Math.abs(position.x - low.x), dz = position.z - low.z;
        if (guided) {
          lift.riding = false;
          if (Math.hypot(dx, dz) < 0.06 && position.y >= low.y && position.y <= high.y) {
            lift.target = car.position.y = position.y;
            car.updateMatrixWorld();
          }
          continue;
        }
        const near = dx < 1.05 && Math.abs(dz) < 2.5;
        const inCar = dx < 0.85 && Math.abs(dz) < 1;
        if (!inCar) {
          lift.riding = false;
          lift.boarded = false;
          lift.dwell = 0;
        }
        if (!lift.riding && near && !lift.boarded) {
          const lowerDoor = dz > 0 && Math.abs(position.y - low.y) < 0.34;
          const upperDoor = dz < 0 && Math.abs(position.y - high.y) < 0.34;
          if (lowerDoor || upperDoor) lift.target = lowerDoor ? low.y : high.y;
          if (inCar && Math.abs(position.y - car.position.y) < 0.12 && Math.hypot(dx, dz) < 0.33) {
            lift.dwell += dt;
            if (lift.dwell >= 0.22) {
              lift.riding = true;
              lift.boarded = true;
              lift.target = car.position.y === low.y ? high.y : low.y;
              position.x = low.x;
              position.z = low.z;
            }
          }
        }
        const remaining = lift.target - car.position.y;
        if (remaining !== 0) {
          car.position.y = Math.abs(remaining) <= 1.6 * dt
            ? lift.target : car.position.y + Math.sign(remaining) * 1.6 * dt;
          car.updateMatrixWorld();
        }
        if (lift.riding) {
          position.y = car.position.y;
          riding = true;
          lift.riding = car.position.y !== lift.target;
        }
      }
      return riding;
    },
    dispose() {
      disposePortalCuts(cuts);
      root.removeFromParent();
      liftBoards.dispose();
      const materials = new Set<MeshBasicMaterial>();
      for (const object of root.children) {
        const mesh = object as import("three").Mesh<BufferGeometry, MeshBasicMaterial>;
        mesh.geometry.dispose();
        materials.add(mesh.material);
      }
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}
