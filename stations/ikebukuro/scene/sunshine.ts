// Sunshine City street preview, 2026-11-26 JST.
// Exit 35 and Sunshine 60 Street: https://sunshinecity.jp/en/information/access.html
// West plaza, ALPA west entrance, Sunshine 60 lobby and World Import Mart north-side entrance:
// https://sunshinecity.jp/information/floor_map/1f.html
// Authored walk centreline and doorway offsets, aligned to the pinned PLATEAU roads/buildings
// (53394577). Grades are simplified to join the modeled exit and the existing street backing.
import type { BuildScene, SceneContext } from "@gteki/scene-api";
import type { Edge, Node, Poi, StationBundle } from "@gteki/schema";
import type { BufferGeometry, Mesh, MeshBasicMaterial, Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createContextMaterial } from "./context.ts";
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
    addPath(entrancePlaza, [["sunshine-tower-apron", [589, -23]], [tower.id, doorPoint(tower, 1)]]),
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
  return { ...bundle, nodes: [...bundle.nodes, ...nodes], edges: [...bundle.edges, ...edges], pois: [...pois, ...stops] };
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
  const scene = await base({ ...ctx, loadGlb: async uri => {
    const loaded = await ctx.loadGlb(uri);
    if (uri === "assets/ikebukuro_landmarks_next.glb") landmarks = loaded.scene;
    return loaded;
  } });
  const merged = landmarks.getObjectByName("ctx_bldg_landmark_sunshine") as Mesh;
  const original = merged.geometry.getAttribute("position");
  const towerVertices: number[] = [], neighbours: number[] = [];
  for (let i = 0; i < original.count; i += 3) {
    const x = (original.getX(i) + original.getX(i + 1) + original.getX(i + 2)) / 3 - 592;
    const z = (original.getZ(i) + original.getZ(i + 1) + original.getZ(i + 2)) / 3 + 19;
    const u = -0.55 * x + 0.835 * z, v = 0.835 * x + 0.55 * z;
    const highest = Math.max(original.getY(i), original.getY(i + 1), original.getY(i + 2));
    const target = u > 0 && u < 58 && v > 0 && v < 86 && highest > 53 ? towerVertices
      : v > 228 || (u < -36 && v > 87 && v < 161) ? neighbours : null;
    if (target) for (let j = i; j < i + 3; j++) target.push(original.getX(j), original.getY(j), original.getZ(j));
  }
  const triangles = (vertices: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
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
    g.fillStyle = LANDMARK_SIGN.band;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#445761";
    for (let x = 18; x < 480; x += 120) g.fillRect(x, 91, 113, 163);
    g.textAlign = "center";
    g.fillStyle = LANDMARK_SIGN.letters;
    g.font = '600 38px "GTEki Sign JP", sans-serif';
    g.fillText(store.en, 256, 62, 476);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: texture, fog: false }));
    overlay.name = `sunshine-door:${store.id}`;
    const [x, z] = doorPoint(store, 0.025);
    overlay.position.set(x, grade + 2, z);
    overlay.rotation.y = Math.atan2(store.outward[0], store.outward[1]);
    return overlay;
  });
  group.add(street, ...facades, ...overlays);
  landmarks.add(group);
  return {
    ...scene,
    walkable: [...scene.walkable, street],
    colliders: [...(scene.colliders ?? []), ...facades],
    dispose() {
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
