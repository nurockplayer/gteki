// Sunshine City street preview, 2026-11-26 JST.
// Exit 35 and Sunshine 60 Street: https://sunshinecity.jp/en/information/access.html
// West plaza, ALPA west entrance, Sunshine 60 lobby and World Import Mart north-side entrance:
// https://sunshinecity.jp/information/floor_map/1f.html
// Authored walk centreline and doorway offsets, aligned to the pinned PLATEAU roads/buildings
// (53394577). Grades are simplified to join the modeled exit and the existing street backing.
import type { BuildScene, InteractableSpec, SceneContext } from "@gteki/scene-api";
import type { Edge, Node, Poi, StationBundle } from "@gteki/schema";
import type { BufferGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import floorData from "../data/depato-floors.json";
import { createContextMaterial } from "./context.ts";
import { buildDepatoInterior } from "./depato/interior.ts";
import { depatoBundle, depatoLayout, type DepatoInput, type PlanPoint } from "./depato/layout.ts";
import { LANDMARK_FACADE, LANDMARK_SIGN } from "./landmark-style.ts";

type Point = readonly [number, number];
const grade = 31.6;
// Local plan axes: u along the west frontage, v into the site, in metres.
const point = (u: number, v: number): Point => [592 - 0.55 * u + 0.835 * v, -19 + 0.835 * u + 0.55 * v];
const stores = [
  {
    id: "sunshine-city-60", ja: "サンシャイン60", en: "Sunshine 60",
    footprint: [[0, 0], [57, 0], [57, 84], [0, 84]],
    entrance: [15, 0], outward: [-0.835, -0.55], height: 21, color: LANDMARK_FACADE.F3_coolGrey,
  },
  {
    id: "sunshine-city-alpa", ja: "専門店街アルパ", en: "ALPA",
    footprint: [[-34, 12], [-5, 12], [-5, 88], [64, 88], [64, 163], [-36, 163], [-36, 72], [-34, 72]],
    entrance: [-17, 12], outward: [-0.835, -0.55], height: 16, color: LANDMARK_FACADE.F1_stoneBeige,
  },
  {
    id: "sunshine-city-world-import-mart", ja: "ワールドインポートマート", en: "World Import Mart",
    footprint: [[-79, 163], [-7, 163], [-7, 222], [-79, 222]],
    entrance: [-79, 204], outward: [0.55, -0.835], height: 48, color: LANDMARK_FACADE.F2_warmGrey,
  },
] as const;

const doorPoint = (store: typeof stores[number], distance: number): Point => {
  const [u, v] = store.entrance;
  const [x, z] = point(u, v);
  return [x + store.outward[0] * distance, z + store.outward[1] * distance];
};

const directory = "https://sunshinecity.jp/information/floor_map/";
const aquarium = "https://sunshinecity.jp/en/aquarium/access/";
const planetarium = "https://sunshinecity.jp/file/official/barrierfree/facility/manten.html";
const skyRestaurants = "https://sunshinecity.jp/en/facility/sky-restaurant.html";
const observatory = "https://sunshinecity.jp/observatory/access/";
const towerOffices = "https://co.sunshinecity.co.jp/file/pdf/about/ssc_katsuyo_book.pdf";

const escalators = (...landings: string[]): NonNullable<DepatoInput["flights"]> =>
  Object.fromEntries(landings.map(level => [level, "escalator"]));
const transferFloor = (level: string, source: string) => ({
  level, category: "other", label: { ja: "乗継フロア", en: "Transfer landing" },
  tenants: [], source, read: "2026-11-26",
});

// Public stops come from the recorded floor directory. The landings used solely
// to connect the published escalator runs do not get search entries.
const interiorSites: {
  site: typeof stores[number]; aisleX: number; from: number;
  flights: NonNullable<DepatoInput["flights"]>; transfer: string[];
  elevations: Record<string, number>;
  lifts: [string, string, number, string, string, string][];
}[] = [
  {
    site: stores[0], aisleX: 598, from: 4, transfer: ["2F"],
    flights: escalators("B1", "1F", "2F", "3F", "4F"),
    elevations: { "36F": 164, "58F": 242.9, "59F": 247, "60F": 251 },
    lifts: [
      ["4F", "5F", -4, "低層階", "Low-rise lift", directory],
      ["4F", "7F", 0, "低層階", "Low-rise lift", directory],
      ["4F", "8F", 4, "低層階", "Low-rise lift", directory],
      ["1F", "36F", 0, "オフィス", "Office lift", towerOffices],
      ["B1", "58F", -4, "スカイレストラン", "Sky restaurant lift", skyRestaurants],
      ["B1", "59F", 0, "スカイレストラン", "Sky restaurant lift", skyRestaurants],
      ["58F", "59F", 4, "スカイレストラン", "Sky restaurant lift", skyRestaurants],
      ["B1", "60F", 4, "展望台", "Observatory lift", observatory],
    ],
  },
  {
    site: stores[1], aisleX: 633, from: -20, transfer: [], elevations: {},
    flights: escalators("1F", "2F", "3F"), lifts: [],
  },
  {
    site: stores[2], aisleX: 786, from: 38, transfer: ["7F", "8F"],
    flights: { ...escalators("1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F", "9F"), "10F": "stairs" },
    elevations: { "5F": grade + 19.3, "6F": grade + 25.1, "7F": grade + 31, "8F": grade + 36.8, "9F": grade + 42.6, "10F": grade + 48 },
    lifts: [
      ["1F", "9F", -5, "館内", "Building lift", directory],
      ["1F", "10F", 9, "水族館", "Aquarium lift", aquarium],
      ["B1", "10F", 3, "プラネタリウム", "Planetarium lift", planetarium],
    ],
  },
];

function sunshineLayouts() {
  return interiorSites.map(({ site, aisleX, from, flights, elevations, transfer, lifts }) => {
    const store = floorData.stores.find(row => row.id === site.id)!;
    const roof = store.floors.find(floor => floor.level === "RF");
    const floors = store.floors.filter(floor => floor !== roof).map(floor => ({
      ...floor, tenants: floor.tenants.slice(0, 24),
    }));
    floors.push(...transfer.map(level => ({ ...transferFloor(level, roof ? aquarium : directory), order: Number(level.slice(0, -1)) })));
    const plan = depatoLayout({
      store: { ...store, floors },
      footprint: site.footprint.map(([u, v]) => [...point(u, v)] as PlanPoint),
      poiId: site.id, sourceId: "sunshine-city-en-access-2026-11", elevations: { "1F": grade, ...elevations },
      flights, lifts: lifts.map(([fromLevel, to, dx, ja, en, source]) =>
        ({ from: fromLevel, to, x: aisleX + dx, z: from + 18, label: { ja, en }, source })),
      ...(roof && { roof: { level: "10F", edgeX: aisleX + 6, label: { ja: `RF ${roof.label.ja}`, en: `RF ${roof.label.en}` } } }),
      circulation: { aisleX, from, to: from + 12 },
      entrances: [{ level: "1F", point: [...doorPoint(site, 0)], outsideNode: site.id, inward: [-site.outward[0], -site.outward[1]] }],
    });
    // Furnish the public concourse around the escalator without filling the entire building mass.
    plan.counters = plan.counters.filter(([x, z]) => Math.abs(x - aisleX) < 11 && z > from - 12 && z < from + 28 &&
      (lifts.length === 0 || z < from + 12 || z > from + 23));
    return plan;
  });
}

const westCorner = "sunshine-city-west-corner";
const plaza = "sunshine-city-west-plaza";
const approach: [string, Point, number?][] = [
  ["sunshine-exit-apron", [161, -13], 31.35],
  ["sunshine-green-street", [195, 12]],
  ["sunshine-green-street-turn", [218, 27]],
  ["sunshine-60-street", [231, 24]],
  ["sunshine-60-street-mid", [351, -11]],
  ["sunshine-expressway-west", [470, -53]],
  ["sunshine-expressway-east", [509, -66]],
  ["sunshine-crossing-north", [512, 25]],
  ["sunshine-crossing-west", [528, 24]],
  ["sunshine-crossing-east", [547, 35]],
  [westCorner, [590, -33]],
  [plaza, [599, -26]],
];
const northSide: [string, Point][] = [
  ["sunshine-west-side", [606, -57]],
  ["sunshine-north-corner", [631, -96]],
  ["sunshine-north-side", [674, -71]],
  ["sunshine-prince-crossing", [719, -41]],
  ["sunshine-import-mart-side", [760, -14]],
  ["sunshine-import-mart-apron", [809, 19]],
];

const sourceIds = ["sunshine-city-en-access-2026-11", "plateau-13116-tran-53394577", "plateau-13116-bldg-53394577"];
const evidence = {
  sourceIds, checkedDate: "2026-11-26",
  method: "Authored exterior preview aligned to PLATEAU streets and building masses; entrance identities from Sunshine City's official 1F map.",
};

export function sunshineBundle(bundle: StationBundle): StationBundle {
  const street = bundle.nodes.find(n => n.id === "x35")!;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  function addPath(start: Node, points: readonly [string, Point, number?][]) {
    let from = start;
    for (const [id, [x, z], y = grade] of points) {
      const to: Node = { id, floorId: "street", position: { x, y: -z, z: y }, kind: "junction", inOut: "outside", sourceRefs: [] };
      nodes.push(to);
      edges.push({
        id: `${from.id}__${id}`, from: from.id, to: id, direction: "both", mode: "walk",
        geometry: [from.position, to.position],
        lengthM: Math.hypot(x - from.position.x, -z - from.position.y, y - from.position.z!),
        paid: false, crossesFareBoundary: false, wheelchair: null, steps: false, closed: false, hours: null,
        verification: "verified", geometryEvidence: evidence, accessEvidence: evidence,
      });
      from = to;
    }
    return from;
  }
  const entrancePlaza = addPath(street, approach);
  const corner = nodes.find(n => n.id === westCorner)!;
  const [tower, alpa, mart] = stores;
  const doors = [
    addPath(entrancePlaza, [["sunshine-tower-apron", doorPoint(tower, 12)], [tower.id, doorPoint(tower, 1)]]),
    addPath(entrancePlaza, [[alpa.id, doorPoint(alpa, 1)]]),
    addPath(corner, [...northSide, [mart.id, doorPoint(mart, 1)]]),
  ];
  const stops: Poi[] = stores.map((store, i) => ({
    id: store.id, category: "shop", names: [{ lang: "ja", text: store.ja }, { lang: "en", text: store.en }],
    aliases: [], floorId: "street", displayPosition: doors[i]!.position, connectorNodeIds: [store.id],
    paid: false, evidence,
  }));
  const pois = bundle.pois.map(p => p.id !== "landmark-sunshine-city" ? p : {
    ...p, displayPosition: entrancePlaza.position, connectorNodeIds: [plaza], aliases: [], evidence, notes: [],
  });
  return sunshineLayouts().reduce((current, plan) => {
    const interior = depatoBundle(current, plan);
    const store = plan.input.store;
    const floors: Poi[] = floorData.stores.find(row => row.id === store.id)!.floors.map(floor => {
      const destination = floor.level === "RF" ? "10F-roof" : `${floor.level}-aisle`;
      const goal = interior.nodes.find(n => n.id === `depato-${store.id}-${destination}`)!;
      return {
        id: `${store.id}-${floor.level}`, category: "shop", floorId: goal.floorId,
        names: [{ lang: "ja", text: `${store.name.ja} ${floor.level}` }, { lang: "en", text: `${store.name.en} ${floor.level}` }],
        aliases: [{ lang: "ja", text: floor.label.ja }, { lang: "en", text: floor.label.en }],
        displayPosition: goal.position, connectorNodeIds: [goal.id], paid: false,
        evidence: { ...evidence, method: `Public floor and vertical-link type from the Sunshine City directory; interior geometry is illustrative. ${floor.source}` },
      };
    });
    // The original search entries still end outside. Only floor-specific searches route inside.
    return { ...interior, pois: [...current.pois, ...floors] };
  }, { ...bundle, nodes: [...bundle.nodes, ...nodes], edges: [...bundle.edges, ...edges], pois: [...pois, ...stops] });
}

function streetSurface(ctx: SceneContext) {
  const { THREE } = ctx;
  const vertices: number[] = [];
  const append = (a: number[], b: number[], c: number[]) => vertices.push(...a, ...b, ...c);
  const render = (p: Node["position"]) => ctx.enuToRenderer({ ...p, z: p.z! });
  for (const edge of ctx.bundle.edges) {
    if (!edge.to.startsWith("sunshine-")) continue;
    const [a, b] = edge.geometry!.map(render);
    const dx = b![0] - a![0], dz = b![2] - a![2];
    const length = Math.hypot(dx, dz);
    const first = edge.from === "x35";
    // Meet the open stair lip at its own width. Overlap adjoining slabs at street corners.
    const end = (p: readonly number[], shift: number, width: number, side: number) =>
      [p[0]! + (dx * shift + dz * width * side) / length, p[1]!, p[2]! + (dz * shift - dx * width * side) / length];
    const a0 = end(a!, first ? -0.12 : -2.1, first ? 0.9 : 2.1, -1);
    const a1 = end(a!, first ? -0.12 : -2.1, first ? 0.9 : 2.1, 1);
    const b0 = end(b!, 2.1, 2.1, -1), b1 = end(b!, 2.1, 2.1, 1);
    append(a0, b0, a1);
    append(a1, b0, b1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ color: 0x777874, side: THREE.DoubleSide, fog: false });
  const street = new THREE.Mesh(geometry, material);
  street.name = "sunshine-city-walkable-street";
  return street;
}

export async function buildSunshineScene(ctx: SceneContext, base: BuildScene) {
  const { THREE } = ctx;
  let landmarks!: Object3D;
  const towerVertices: number[] = [], neighbours: number[] = [];
  const triangles = (vertices: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri !== "assets/ikebukuro_landmarks_next.glb") return loaded;
    landmarks = loaded.scene;
    const backing = landmarks.getObjectByName("sunshine") as Mesh;
    const original = backing.geometry.getAttribute("position");
    for (let i = 0; i < original.count; i += 3) {
      const x = (original.getX(i) + original.getX(i + 1) + original.getX(i + 2)) / 3 - 592;
      const z = (original.getZ(i) + original.getZ(i + 1) + original.getZ(i + 2)) / 3 + 19;
      const u = -0.55 * x + 0.835 * z, v = 0.835 * x + 0.55 * z;
      const highest = Math.max(original.getY(i), original.getY(i + 1), original.getY(i + 2));
      const target = u > 0 && u < 58 && v > 0 && v < 86 && highest > 53 ? towerVertices
        : v > 228 || (u < -36 && v > 87 && v < 161) ? neighbours : null;
      if (target) for (let j = i; j < i + 3; j++) target.push(original.getX(j), original.getY(j), original.getZ(j));
    }
    // Clear the replaced podium before the base scene copies the backing into camera blockers.
    backing.geometry.dispose();
    backing.geometry = triangles([...towerVertices, ...neighbours]);
    return loaded;
  } });
  const merged = landmarks.getObjectByName("ctx_bldg_landmark_sunshine") as Mesh;
  merged.geometry.dispose();
  merged.geometry = triangles(neighbours);
  merged.name = "ctx_bldg_sunshine_neighbours";

  const group = new THREE.Group();
  group.name = "sunshine-city-exteriors";
  const street = streetSurface(ctx);
  const facades: Mesh<BufferGeometry, MeshBasicMaterial>[] = [];
  const overlays = stores.map(store => {
    const footprint = new THREE.Shape(store.footprint.map(([u, v]) => {
      const [x, z] = point(u, v);
      return new THREE.Vector2(x, -z);
    }));
    let mass: BufferGeometry = new THREE.ExtrudeGeometry(footprint, { depth: store.height, bevelEnabled: false });
    mass.rotateX(-Math.PI / 2);
    mass.translate(0, grade - 0.35, 0);
    // Keep the PLATEAU tower and its aligned upper sign in the existing skyline view.
    if (store.id === stores[0].id) {
      const shaft = triangles(towerVertices);
      const combined = mergeGeometries([mass.deleteAttribute("uv"), shaft])!;
      mass.dispose();
      shaft.dispose();
      mass = combined;
    }
    mass.clearGroups();
    const material = createContextMaterial(THREE, { color: new THREE.Color(store.color).getHex(), streetY: grade, facade: true });
    material.fog = false;
    const facade = new THREE.Mesh(mass, material);
    facade.name = `sunshine-facade:${store.id}`;
    facades.push(facade);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const g = canvas.getContext("2d")!;
    const alpa = store.id === "sunshine-city-alpa";
    const width = alpa ? 8 : 10;
    const height = alpa ? 4 : 4.65;
    if (alpa) {
      g.fillStyle = LANDMARK_SIGN.band;
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = "#445761";
      for (let x = 18; x < 480; x += 120) g.fillRect(x, 91, 113, 163);
    } else {
      const tower = store.id === "sunshine-city-60";
      g.fillStyle = store.color;
      g.fillRect(0, 0, 512, 256);
      for (const x of [12, 384]) {
        g.fillStyle = "#445761";
        g.fillRect(x, 105, 116, 144);
        g.fillStyle = "#667983";
        g.fillRect(x, 105, 116, 39);
        g.fillStyle = store.color;
        g.fillRect(x + 56, 105, 4, 144);
      }
      g.fillStyle = tower ? "#3F484E" : LANDMARK_SIGN.band;
      g.fillRect(74, 15, 364, 79);
      g.fillRect(121, 94, 270, 17);
      for (const x of [124, 359]) {
        g.fillRect(x, 111, 29, 145);
        g.fillStyle = tower ? "#7C8C95" : "#B79E80";
        g.fillRect(x + 3, 113, 23, 141);
        g.fillStyle = "#445761";
        g.fillRect(x + 7, 120, 15, 116);
        g.fillStyle = LANDMARK_SIGN.letters;
        g.fillRect(x + 12, 188, 5, 15);
        g.fillStyle = tower ? "#3F484E" : LANDMARK_SIGN.band;
      }
    }
    g.textAlign = "center";
    g.fillStyle = LANDMARK_SIGN.letters;
    g.font = '600 38px "GTEki Sign JP", sans-serif';
    g.fillText(store.en, 256, 62, alpa ? 476 : 342);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, fog: false }));
    overlay.name = `sunshine-door:${store.id}`;
    // The signed street front sits ahead of the interior wall and bronze door frame.
    const [x, z] = doorPoint(store, alpa ? 0.025 : 0.17);
    overlay.position.set(x, grade + height / 2, z);
    overlay.rotation.y = Math.atan2(store.outward[0], store.outward[1]);
    return overlay;
  });
  group.add(street, ...facades, ...overlays);
  landmarks.add(group);
  group.updateWorldMatrix(true, true);
  const layouts = sunshineLayouts();
  const resources: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  layouts.forEach((plan, i) => {
    const site = stores[i]!;
    const [x, z] = doorPoint(site, 0), [nx, nz] = site.outward;
    const across = (p: Vector3) => (p.x - x) * nz - (p.z - z) * nx;
    const depth = (p: Vector3) => (p.x - x) * nx + (p.z - z) * nz;
    const opening: CutRegion = {
      key: {}, clip: null, accepts: normal => Math.abs(normal.y) < 0.5,
      bounds: new THREE.Box3(new THREE.Vector3(x - 2.1, grade - 0.1, z - 2.1), new THREE.Vector3(x + 2.1, grade + 2.8, z + 2.1)),
      planes: [p => 2 + across(p), p => 2 - across(p), p => 0.2 + depth(p), p => 0.2 - depth(p), p => p.y - grade + 0.1, p => grade + 2.8 - p.y],
    };
    const { x: aisle, from, to, width } = plan.stair;
    const well: CutRegion = {
      key: {}, clip: null, accepts: normal => Math.abs(normal.y) > 0.9,
      bounds: new THREE.Box3(new THREE.Vector3(aisle - width / 2, grade - 0.4, from), new THREE.Vector3(aisle + width / 2, grade - 0.3, to)),
      planes: [p => p.x - aisle + width / 2, p => aisle + width / 2 - p.x, p => p.z - from, p => to - p.z, p => p.y - grade + 0.4, p => grade - 0.3 - p.y],
    };
    cutRegions([facades[i]!, overlays[i]!], [opening, well], resources);
  });
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(plan => plan.floors.flatMap(floor => [plan.input.store.name.ja, floor.label.ja, ...floor.tenants.map(tenant => tenant.ja)])).join(""));
  const interiors = layouts.map(plan => buildDepatoInterior(ctx, plan, scene.generatedMeshEnvMap));
  const lifts: InteractableSpec[] = layouts.flatMap(plan =>
    plan.input.lifts!.flatMap((lift, i) => ([[lift.from, lift.to], [lift.to, lift.from]] as const).map(([from, to]) => {
      const roof = plan.input.roof;
      const level = roof && to === roof.level && lift.x > roof.edgeX ? "RF" : to;
      return {
        id: `depato-${plan.input.store.id}-${from}-lift-${i}`, kind: "elevator",
        layer: "fictional", simulated: true, anchor: { x: lift.x, y: plan.height(from), z: lift.z },
        radiusM: 1.25, steps: [], lift: { level, arrival: { x: lift.x, y: plan.height(to), z: lift.z - 2.6 } },
      };
    })));
  scene.root.add(...interiors.flatMap(interior => [interior.root, interior.connectorRoot]));
  let avatar: { x: number; y: number; z: number } | undefined;
  const cameraPoint = new THREE.Vector3();
  return {
    ...scene,
    interactables: [...(scene.interactables ?? []), ...lifts],
    walkable: [...scene.walkable, street, ...interiors.flatMap(interior => interior.walkable)],
    colliders: [...(scene.colliders ?? []), ...facades, ...interiors.flatMap(interior => interior.colliders)],
    cameraBlockers: [...(scene.cameraBlockers ?? []), ...interiors.flatMap(interior => interior.cameraBlockers)],
    setCameraFocus(...args: Parameters<NonNullable<typeof scene.setCameraFocus>>) {
      scene.setCameraFocus?.(...args);
      avatar = args[3] ?? undefined;
      interiors.forEach(interior => interior.setAvatar(avatar ?? null));
    },
    update(dt: number, elapsed: number, camera?: import("three").Camera) {
      scene.update?.(dt, elapsed, camera);
      if (!camera) return;
      const cp = camera.getWorldPosition(cameraPoint);
      const p = avatar ?? { x: cp.x, y: cp.y - 2, z: cp.z };
      const distances = layouts.map(plan => {
        if (plan.contains([p.x, p.z]) && p.y >= plan.height(plan.floors[0]!.level) - 1 && p.y <= plan.height(plan.floors.at(-1)!.level) + 3.8) return 0;
        const [x, z] = plan.input.entrances[0]!.point;
        return Math.hypot(p.x - x, p.y - grade, p.z - z);
      });
      const active = distances.indexOf(Math.min(...distances));
      interiors.forEach((interior, i) => { if (i !== active) interior.update(camera, dt, elapsed, false); });
      interiors[active]!.update(camera, dt, elapsed);
    },
    dispose() {
      disposePortalCuts(resources);
      interiors.forEach(interior => interior.dispose());
      street.geometry.dispose();
      street.material.dispose();
      for (const facade of facades) {
        facade.geometry.dispose();
        facade.material.dispose();
      }
      for (const door of overlays) {
        door.geometry.dispose();
        door.material.map!.dispose();
        door.material.dispose();
      }
      group.removeFromParent();
      scene.dispose();
    },
  };
}
