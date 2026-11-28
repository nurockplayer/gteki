import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { RailLane } from "@gteki/scene-api/rail-registry";
import type { Mesh, Object3D, Vector3 } from "three";
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
  const rail = new THREE.MeshBasicMaterial({ color: 0x686b69 });
  const ballast = new THREE.MeshBasicMaterial({ color: 0x383937 });
  const canopy = new THREE.MeshBasicMaterial({ color: 0xc6c9c4 });
  const platform5 = lane.platforms.find(platform => platform.number === 5)!;
  const platform6 = lane.platforms.find(platform => platform.number === 6)!;
  const [[westFace, south], [, north]] = platform5.centerline!;
  const [[eastFace]] = platform6.centerline!;
  const height = bundle.floors.find(floor => floor.id === platform5.level)!.renderElevationM;
  const centerX = (westFace + eastFace) / 2;
  const left = centerX - platform5.width_m!;
  const right = centerX + platform6.width_m!;
  const nodes = new Map(bundle.nodes.map(node => [node.id, node.position]));
  const flights = [1, 2].map(gate => ({
    start: nodes.get(`jr-central-${gate}-paid`)!,
    end: nodes.get(`jr-central-${gate}-landing`)!,
    approach: nodes.get(`g_jr_c${gate}`)!,
  }));
  const stairWidth = 2.6;
  const cuts: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const gateBarriers = new Set(["access_fences", "access_fences_collider", "portal_beyond"]);
  const targets = (scene.colliders ?? []).filter(object => gateBarriers.has(object.userData.gteki_role));
  scene.root.traverse(object => {
    if (gateBarriers.has(object.userData.gteki_role)) targets.push(object);
  });
  const cutBox = (min: Vector3, max: Vector3) => ({
    key: {}, bounds: new THREE.Box3(min, max), clip: null, accepts: () => true,
    planes: [
      (p: Vector3) => p.x - min.x, (p: Vector3) => max.x - p.x,
      (p: Vector3) => p.y - min.y, (p: Vector3) => max.y - p.y,
      (p: Vector3) => p.z - min.z, (p: Vector3) => max.z - p.z,
    ],
  });
  cutRegions(targets, flights.map(({ start, approach }) => {
    const min = new THREE.Vector3(Math.min(start.x, approach.x) - stairWidth / 2, start.z! - 0.05, -Math.max(start.y, approach.y) - 0.1);
    const max = new THREE.Vector3(Math.max(start.x, approach.x) + stairWidth / 2, start.z! + 2.6, -Math.min(start.y, approach.y) + 0.1);
    return cutBox(min, max);
  }), cuts);
  prepareRayTrees([...cuts.originals.keys()]);

  const box = (x0: number, x1: number, y0: number, y1: number, top: number, depth: number, material: typeof deck, floor = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, depth, y1 - y0), material);
    mesh.position.set(...ctx.enuToRenderer({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: top - depth / 2 }));
    root.add(mesh);
    if (floor) walkable.push(mesh);
    return mesh;
  };

  let x = left;
  for (const { start, end, approach } of flights) {
    const inner = start.x - stairWidth / 2, outer = start.x + stairWidth / 2;
    const low = Math.min(start.y, end.y), high = Math.max(start.y, end.y);
    box(x, inner, south, north, height, 0.28, deck, true);
    box(inner, outer, south, low, height, 0.28, deck, true);
    box(inner, outer, high, north, height, 0.28, deck, true);
    x = outer;

    for (const side of [inner, outer]) {
      colliders.push(box(side - 0.04, side + 0.04, low, high, height + 0.95, 0.95, rail));
    }
    const closedEnd = start.y;
    colliders.push(box(inner, outer, closedEnd - 0.04, closedEnd + 0.04, height + 0.95, 0.95, rail));

    box(inner, outer, Math.min(start.y, approach.y) - 0.12, Math.max(start.y, approach.y) + 0.12,
      start.z!, 0.15, steps, true);
    const count = 24;
    const rise = (end.z! - start.z!) / count;
    const run = (end.y - start.y) / count;
    const stairs = new THREE.InstancedMesh(new THREE.BoxGeometry(stairWidth, rise + 0.02, Math.abs(run)), steps, count);
    for (let i = 0; i < count; i++) {
      stairs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...ctx.enuToRenderer({
        x: start.x, y: start.y + (i + 0.5) * run, z: start.z! + (i + 0.5) * rise - 0.01,
      })));
    }
    root.add(stairs);
    walkable.push(stairs);
  }
  box(x, right, south, north, height, 0.28, deck, true);

  const sleeperCount = 56;
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 0.1, 0.24), steps, sleeperCount * 2);
  for (const [trackIndex, edge] of [left, right].entries()) {
    const direction = edge === left ? -1 : 1;
    const beside = (a: number, b: number, z: number, depth: number, material: typeof deck) =>
      box(Math.min(edge + a * direction, edge + b * direction), Math.max(edge + a * direction, edge + b * direction),
        south, north, z, depth, material);
    beside(-0.55, -0.25, height + 0.012, 0.02, yellow);
    beside(0, 3.2, height - 0.95, 0.3, ballast);
    beside(0.8, 0.88, height - 0.75, 0.16, rail);
    beside(2.235, 2.315, height - 0.75, 0.16, rail);
    for (let i = 0; i < sleeperCount; i++) {
      sleepers.setMatrixAt(trackIndex * sleeperCount + i, new THREE.Matrix4().makeTranslation(...ctx.enuToRenderer({
        x: edge + direction * 1.58, y: south + (i + 0.5) * (north - south) / sleeperCount, z: height - 0.9,
      })));
    }
  }
  root.add(sleepers);

  const roof = height + 3.65;
  const signY = 80.5;
  const signOffsetX = -0.65;
  // The street proxy overlaps the representative rail bed within this footprint.
  root.userData.cutStreetContext = (context: Object3D, blockers: Object3D[]) => {
    cutRegions([context, ...blockers], [cutBox(
      new THREE.Vector3(left - 3.2, height - 1.3, -north),
      new THREE.Vector3(right + 3.2, roof + 0.2, -south),
    )], cuts);
    prepareRayTrees(blockers);
  };
  box(left + 0.65, right - 0.65, south + 1, north - 1, roof, 0.24, canopy);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1, 0.22), canopy, 6);
  const matrix = new THREE.Matrix4();
  for (const [i, y] of [38, 53, 85, 100].entries()) {
    posts.setMatrixAt(i, matrix.makeScale(1, roof - height, 1).setPosition(...ctx.enuToRenderer({
      x: centerX - 1.2, y, z: (height + roof) / 2,
    })));
  }
  for (const [i, x] of [westFace, eastFace].entries()) {
    posts.setMatrixAt(i + 4, matrix.makeScale(0.6, 1, 0.6).setPosition(...ctx.enuToRenderer({
      x: x + signOffsetX, y: signY, z: height + 2.95,
    })));
  }
  root.add(posts);
  colliders.push(posts);

  for (const platform of [platform5, platform6]) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ink = canvas.getContext("2d")!;
    ink.fillStyle = "#25332d";
    ink.fillRect(0, 0, 512, 128);
    ink.fillStyle = "#91c934";
    ink.fillRect(0, 0, 108, 128);
    ink.fillStyle = "#172511";
    ink.font = "bold 88px sans-serif";
    ink.fillText(String(platform.number), 27, 95);
    ink.fillStyle = "#fff";
    ink.font = "bold 42px sans-serif";
    ink.fillText("池袋　山手線", 127, 59);
    ink.font = "28px sans-serif";
    ink.fillText("Ikebukuro · Yamanote Line", 127, 102);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 0.06), new THREE.MeshBasicMaterial({ map: texture }));
    sign.position.set(...ctx.enuToRenderer({ x: platform.centerline![0][0] + signOffsetX, y: signY, z: height + 2.1 }));
    root.add(sign);
  }
  return {
    root, walkable, colliders,
    dispose() {
      disposePortalCuts(cuts);
      root.removeFromParent();
      const materials = new Set<typeof deck>();
      for (const object of root.children) {
        const mesh = object as Mesh<import("three").BufferGeometry, typeof deck>;
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
