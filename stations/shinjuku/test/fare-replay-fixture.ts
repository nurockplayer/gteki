/** Deliberately synthetic regression fixture, never used by station rendering or routing. */
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { slabGeometry, type BuiltStation } from "../scene/build.ts";
import { WalkWorld, type Layout, type Plan, type XY } from "../scene/layout.ts";
import type { Fence } from "../scene/fare-fence.ts";
export function accessFixture(width: number, publicBeyond: boolean, restricted = false) {
  const rect = (x0: number, x1: number): XY[][] => [[{ x: x0, y: -3 }, { x: x1, y: -3 }, { x: x1, y: 3 }, { x: x0, y: 3 }]];
  const corners = rect(-3, 3)[0]!;
  const perimeter = corners.map((a, i) => ({ a, b: corners[(i + 1) % 4]!, zMin: -.05, zMax: 2.8, kind: "wall" as const, side: 1 as const }));
  const fence: Fence = { id: "synthetic-access", reason: "access", level: "fixture", a: { x: 0, y: -3 }, b: { x: 0, y: 3 }, zMin: -.05, zMax: 1.15, kind: "wall", side: 1 };
  const layout = { levels: [{ label: "fixture", floorId: "fixture", z: 0, slabs: [{ rings: rect(-3, 3), z: 0 }], walls: perimeter, railings: [] }],
    pads: [], linkStrips: [], streetPads: [], runs: [], runWalls: [], gates: [], nodeZ: new Map() } as unknown as Layout;
  const space = (id: string, x0: number, x1: number, limited = false) => ({ id, category: "synthetic", restricted: limited, toll: "free" as const, rings: rect(x0, x1) });
  const plan = { levels: [{ label: "fixture", floorId: "fixture", ordinal: 0, renderElevationM: 0, outline: [], facilities: [],
    spaces: [space("verified-left", -3, 0), ...(publicBeyond ? [space("verified-right", width, 3)] : []), ...(restricted ? [space("restricted-pocket", 0, width, true)] : [])] }], nodeRenderZ: {}, attribution: [] } as Plan;
  const world = new WalkWorld(layout); world.addWalls([fence]);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false });
  // An intentional bad backing floor lets the negative control admit unknown positions.
  // The shipped station instead clips this floor out; this fixture tests the rejection logic.
  const floor = new THREE.Mesh(slabGeometry(rect(-3, 3), 0, 1), material);
  const walls = [...perimeter, fence], vertices: number[] = [], indices: number[] = [];
  for (const w of walls) {
    const i = vertices.length / 3;
    vertices.push(w.a.x, w.zMin, -w.a.y, w.b.x, w.zMin, -w.b.y, w.b.x, w.zMax, -w.b.y, w.a.x, w.zMax, -w.a.y);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
  const wall = new THREE.Mesh(geometry, material); wall.name = "wall collider (invisible)";
  const root = new THREE.Group(); root.add(floor, wall); root.updateMatrixWorld(true);
  const scene = { root, walkable: [floor], colliders: [wall], walls, dispose() {} } as StationScene;
  const built = { root, world, layout, propWalls: [fence] } as BuiltStation;
  return { scene, built, plan, fence, dispose() { floor.geometry.dispose(); geometry.dispose(); material.dispose(); } };
}
