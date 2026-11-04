/** #826: which wall still splits these two landings, and does the planned walk reach the rail set at all? */
import * as THREE from "three";
import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { navmeshBundle } from "../../packages/godot/src/navmesh-input.ts";
import { planBundle } from "../../stations/shinjuku/gteki/scene.ts";
import { loadScene } from "../../packages/godot/src/route-clip-audit.ts";
import { makeGreybox } from "../../packages/godot/src/navmesh-greybox.ts";
import { plannedWalks, stairwellWells, wellRails, type StairwellWell } from "../../apps/web/src/explorer/stairwellCut.ts";

/** The two walls the probe found crossing the walk lines, in renderer plan coordinates (x, z = -north). */
const rails = [
  { name: "82c9a2c2", a: new THREE.Vector3(-47.7012, 0, -145.2151), b: new THREE.Vector3(-47.2458, 0, -145.4017), y: -1.8988 },
  { name: "6ac033af", a: new THREE.Vector3(-48.6257, 0, -145.9702), b: new THREE.Vector3(-48.1719, 0, -146.1533), y: -6.4575 },
];

const plan = (x: number, z: number) => ({ x, y: -z });
const distanceTo = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
  const ab = b.clone().sub(a).setY(0), ap = p.clone().sub(a).setY(0), t = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1)));
  return ap.sub(ab.multiplyScalar(t)).length();
};
const midOf = (rail: (typeof rails)[number]) => rail.a.clone().add(rail.b).multiplyScalar(0.5);

const { bundle } = await navmeshBundle("shinjuku");
const router = createRouter(bundle, { allowUnverified: false });
const traversable = (edge: (typeof bundle.edges)[number]) => router.isTraversable(edge, DEFAULT_PROFILE);
const walks = plannedWalks(bundle, traversable);
const wells = stairwellWells(bundle, traversable);
console.log(`walks ${walks.length}, wells ${wells.length}`);

for (const rail of rails) {
  console.log(`\n== wall ${rail.name} y=${rail.y}`);
  const hitWalks = walks.filter((walk) => distanceTo(new THREE.Vector3(walk.from.x, 0, walk.from.z), rail.a, rail.b) < 3
    || distanceTo(new THREE.Vector3(walk.to.x, 0, walk.to.z), rail.a, rail.b) < 3);
  for (const walk of hitWalks) console.log(`  walk ${JSON.stringify(walk.from)} -> ${JSON.stringify(walk.to)} hw=${walk.halfWidth}`);
  console.log(`  walks near: ${hitWalks.length}`);
  const near = wells.filter((well: StairwellWell) => well.rects.some((rect) => distanceTo(rect.center, rail.a, rail.b) < 4));
  console.log(`  wells near: ${near.length}`);
  for (const well of near) {
    const crossing = (rs: [THREE.Vector3, THREE.Vector3][]) => rs.filter(([a, b]) => distanceTo(midOf(rail), a, b) < 0.6);
    const plain = crossing(wellRails(well, well.rects));
    const withWalks = crossing(wellRails(well, well.rects, undefined, [], walks));
    console.log(`    well ${well.edgeId} ${well.mode} upperY=${well.upperY.toFixed(3)} rects=${well.rects.length}`
      + ` railsNear=${plain.length} withWalks=${withWalks.length}`);
  }
}

// The walls the live scene (and so the bake) actually carries: everything inside a 1.5 m band round each wall.
const scene = await loadScene("shinjuku", planBundle(bundle));
const grey = makeGreybox(bundle, scene, false);
console.log(`\nlive walls ${grey.walls.length}, cut rails ${grey.stairwellCut.walls.length}`);
for (const rail of rails) {
  const centre = plan(midOf(rail).x, midOf(rail).z);
  const hit = grey.walls.filter((w) => {
    const a = new THREE.Vector3(w.a.x, 0, -w.a.y), b = new THREE.Vector3(w.b.x, 0, -w.b.y);
    return distanceTo(new THREE.Vector3(centre.x, 0, -centre.y), a, b) < 1.5;
  });
  console.log(`\n== live near ${rail.name}: ${hit.length}`);
  for (const w of hit.slice(0, 12)) {
    console.log(`  z ${w.zMin.toFixed(3)}..${w.zMax.toFixed(3)} source=${w.source} role=${w.role}`
      + ` ${w.a.x.toFixed(2)},${w.a.y.toFixed(2)} -> ${w.b.x.toFixed(2)},${w.b.y.toFixed(2)}`);
  }
}
