import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { RailLane } from "@gteki/scene-api/rail-registry";
import type { Mesh, Object3D } from "three";
import { cutRegions, disposePortalCuts, type PortalCutResources } from "../../../../apps/web/src/explorer/portalCut.ts";
import { prepareRayTrees } from "../../../../apps/web/src/explorer/meshBvh.ts";

export default function buildYamanote(ctx: SceneContext, lane: RailLane, scene: StationScene) {
  const { THREE, bundle } = ctx;
  const root = new THREE.Group();
  root.name = "jr-yamanote-platform-preview";
  const walkable: Object3D[] = [];
  const deck = new THREE.MeshBasicMaterial({ color: 0xb6b1a2 });
  const steps = new THREE.MeshBasicMaterial({ color: 0x9e988d });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xe5b33c });
  const rail = new THREE.MeshBasicMaterial({ color: 0x686b69 });
  const ballast = new THREE.MeshBasicMaterial({ color: 0x383937 });
  const platform = lane.platforms[0]!;
  const [[centerX, south], [, north]] = platform.centerline!;
  const height = bundle.floors.find(floor => floor.id === platform.level)!.renderElevationM;
  const left = centerX - platform.width_m! / 2;
  const right = centerX + platform.width_m! / 2;
  const nodes = new Map(bundle.nodes.map(node => [node.id, node.position]));
  const flights = [1, 2].map(gate => ({
    start: nodes.get(`jr-yamanote-central-${gate}-paid`)!,
    end: nodes.get(`jr-yamanote-central-${gate}-landing`)!,
    approach: nodes.get(`g_jr_c${gate}`)!,
  }));
  const stairWidth = 2.6;
  const cuts: PortalCutResources = { geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [] };
  const gateBarriers = new Set(["access_fences", "access_fences_collider", "portal_beyond"]);
  const targets = (scene.colliders ?? []).filter(object => gateBarriers.has(object.userData.gteki_role));
  scene.root.traverse(object => {
    if (gateBarriers.has(object.userData.gteki_role)) targets.push(object);
  });
  cutRegions(targets, flights.map(({ start, approach }) => {
    const min = new THREE.Vector3(Math.min(start.x, approach.x) - stairWidth / 2, start.z! - 0.05, -Math.max(start.y, approach.y) - 0.1);
    const max = new THREE.Vector3(Math.max(start.x, approach.x) + stairWidth / 2, start.z! + 2.6, -Math.min(start.y, approach.y) + 0.1);
    return { key: {}, bounds: new THREE.Box3(min, max), clip: null, accepts: () => true,
      planes: [p => p.x - min.x, p => max.x - p.x, p => p.y - min.y, p => max.y - p.y, p => p.z - min.z, p => max.z - p.z] };
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

  for (const edge of [left, right]) {
    const direction = edge === left ? -1 : 1;
    const beside = (a: number, b: number, z: number, depth: number, material: typeof deck) =>
      box(Math.min(edge + a * direction, edge + b * direction), Math.max(edge + a * direction, edge + b * direction),
        south, north, z, depth, material);
    beside(-0.55, -0.25, height + 0.012, 0.02, yellow);
    beside(0, 3.2, height - 0.95, 0.3, ballast);
    beside(0.8, 0.88, height - 0.75, 0.16, rail);
    beside(2.235, 2.315, height - 0.75, 0.16, rail);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ink = canvas.getContext("2d")!;
  ink.fillStyle = "#25332d";
  ink.fillRect(0, 0, 512, 128);
  ink.fillStyle = "#91c934";
  ink.fillRect(0, 0, 512, 9);
  ink.fillStyle = "#fff";
  ink.font = "bold 44px sans-serif";
  ink.fillText("池袋  山手線", 20, 62);
  ink.font = "24px sans-serif";
  ink.fillText("Ikebukuro · Yamanote Line · Preview", 20, 103);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  sign.position.set(...ctx.enuToRenderer({ x: centerX, y: (south + north) / 2 + 5, z: height + 1.9 }));
  root.add(sign);
  return {
    root, walkable,
    dispose() {
      disposePortalCuts(cuts);
      root.removeFromParent();
      const materials = new Set<typeof deck>();
      for (const object of root.children) {
        const mesh = object as Mesh<import("three").BufferGeometry, typeof deck>;
        mesh.geometry.dispose();
        materials.add(mesh.material);
      }
      for (const material of materials) material.dispose();
      texture.dispose();
    },
  };
}
