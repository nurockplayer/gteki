/** Shared graph and physical-scene partition for memory-bounded offline runs. */
import * as THREE from "three";
import { nodeDisplayZ } from "@gteki/navigation";
import type { StationBundle } from "@gteki/schema";
import type { StationScene } from "@gteki/scene-api";
import { castTargets } from "../../../apps/web/src/explorer/raycast.ts";

export function parseFloors(value: string): string[] {
  const ids = value.split(",").map(id => id.trim());
  if (ids.some(id => !id || id.startsWith("--"))) throw new Error("--floors requires comma-separated floor IDs");
  return [...new Set(ids)].sort();
}

export function splitFloors(bundle: StationBundle, floorIds?: readonly string[]) {
  if (!floorIds) return { bundle, outOfSplit: [] as string[] };
  if (!floorIds.length) throw new Error("--floors requires at least one floor ID");
  const selected = new Set(floorIds), known = new Set(bundle.floors.map(f => f.id));
  for (const id of selected) if (!known.has(id)) throw new Error(`unknown floor: ${id}`);
  const nodes = bundle.nodes.filter(n => selected.has(n.floorId)), ids = new Set(nodes.map(n => n.id));
  const outOfSplit = bundle.edges.filter(e => ids.has(e.from) !== ids.has(e.to)).map(e => e.id);
  const pois = bundle.pois.filter(p => p.floorId === null ? p.connectorNodeIds.some(id => ids.has(id)) : selected.has(p.floorId))
    .map(p => ({ ...p, connectorNodeIds: p.connectorNodeIds.filter(id => ids.has(id)) }));
  return { bundle: { ...bundle, floors: bundle.floors.filter(f => selected.has(f.id)), nodes,
    edges: bundle.edges.filter(e => ids.has(e.from) && ids.has(e.to)), pois,
    ...(bundle.spawnNodeIds ? { spawnNodeIds: bundle.spawnNodeIds.filter(id => ids.has(id)) } : {}),
    ...(bundle.spawnHeadings ? { spawnHeadings: Object.fromEntries(Object.entries(bundle.spawnHeadings).filter(([id]) => ids.has(id))) } : {}),
  }, outOfSplit };
}

/** Keep intersecting triangles, including headroom and sloping landings. Meshes may span many floors.
 * Floor IDs have no scene tags, so use each selected floor's displayed node-height range plus its slab.
 * Boundary triangles are retained whole; no new cut surface can become a walkable floor.
 */
export function floorScene(scene: StationScene, bundle: StationBundle, floorIds?: readonly string[]): StationScene {
  if (!floorIds) return scene;
  const selected = new Set(floorIds);
  const bands = bundle.floors.filter(f => selected.has(f.id)).map(f => {
    const heights = bundle.nodes.filter(n => n.floorId === f.id).map(n => nodeDisplayZ(n, f).z);
    const z = f.elevationM ?? f.renderElevationM;
    return { min: Math.min(z, ...heights) - 0.3, max: Math.max(z, ...heights) + 2.4 };
  });
  const overlaps = (min: number, max: number) => bands.some(b => max >= b.min && min <= b.max);
  const root = new THREE.Group(), owned: THREE.BufferGeometry[] = [];
  const mapped = new Map<THREE.Object3D, THREE.Mesh | null>();
  const select = (objects: THREE.Object3D[], others: THREE.Object3D[]) => castTargets(objects, others).flatMap(object => {
    if (!mapped.has(object)) {
      const mesh = object as THREE.Mesh, attr = mesh.geometry?.getAttribute("position"), index = mesh.geometry?.index;
      const positions: number[] = [], gates: number[] = [], groups: { start: number; count: number; materialIndex: number }[] = [], oldGates = new Set<number>(mesh.userData.gtekiGateTriangles ?? []);
      const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
      const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const instanced = mesh as THREE.InstancedMesh;
      for (let n = 0; attr && n < (instanced.isInstancedMesh ? instanced.count : 1); n++) {
        if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance); else instance.identity();
        world.multiplyMatrices(mesh.matrixWorld, instance);
        for (let i = 0; i + 2 < (index?.count ?? attr.count); i += 3) {
          points.forEach((p, k) => p.fromBufferAttribute(attr, index ? index.getX(i+k) : i+k).applyMatrix4(world));
          if (!overlaps(Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.y)))) continue;
          if (Array.isArray(mesh.material)) {
            const group = mesh.geometry.groups.find(g => i >= g.start && i < g.start + g.count);
            if (group) groups.push({ start: positions.length/3, count: 3, materialIndex: group.materialIndex ?? 0 });
          }
          if (oldGates.has(i/3)) gates.push(positions.length/9);
          for (const p of points) positions.push(p.x, p.y, p.z);
        }
      }
      let copy: THREE.Mesh | null = null;
      if (positions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);
        owned.push(geometry);
        copy = new THREE.Mesh(geometry, mesh.material); copy.name = mesh.name;
        Object.defineProperties(copy.userData, Object.getOwnPropertyDescriptors(mesh.userData));
        if (oldGates.size) copy.userData.gtekiGateTriangles = gates;
        root.add(copy);
      }
      mapped.set(object, copy);
    }
    const copy = mapped.get(object); return copy ? [copy] : [];
  });
  const walkable = select(scene.walkable, scene.colliders ?? []);
  const colliders = select(scene.colliders ?? [], scene.walkable);
  const cameraBlockers = select(scene.cameraBlockers ?? [], []);
  root.updateMatrixWorld(true);
  return { ...scene, root, walkable, colliders, cameraBlockers,
    walls: scene.walls?.filter(w => overlaps(w.zMin, w.zMax)),
    dispose() { for (const g of owned) g.dispose(); scene.dispose(); },
  };
}

/** Greedily join the strongest vertical neighbours under a three-way node budget.
 * An indivisible floor larger than the budget remains alone. No scene or bake is loaded.
 */
export function floorSplitPlan(bundle: StationBundle) {
  const nodes = new Map(bundle.nodes.map(n => [n.id, n]));
  const groups = bundle.floors.map(f => ({ floors: [f.id], nodes: bundle.nodes.filter(n => n.floorId === f.id).length }));
  const budget = Math.max(1, Math.ceil(bundle.nodes.length/3), ...groups.map(g => g.nodes));
  const vertical = bundle.edges.filter(e => ["stairs", "escalator", "elevator"].includes(e.mode));
  while (true) {
    let best: [number, number] | undefined, weight = 0;
    for (let a = 0; a < groups.length; a++) for (let b = a+1; b < groups.length; b++) {
      const x = groups[a]!, y = groups[b]!;
      if (x.nodes + y.nodes > budget) continue;
      const count = vertical.filter(e => {
        const from = nodes.get(e.from)!.floorId, to = nodes.get(e.to)!.floorId;
        return (x.floors.includes(from) && y.floors.includes(to)) || (y.floors.includes(from) && x.floors.includes(to));
      }).length;
      if (count > weight) { best = [a,b]; weight = count; }
    }
    if (!best) break;
    const [a,b] = best; groups[a]!.floors.push(...groups[b]!.floors); groups[a]!.nodes += groups[b]!.nodes; groups.splice(b,1);
  }
  return groups.map(g => {
    const split = splitFloors(bundle, g.floors);
    let cells = 0;
    for (const id of g.floors) {
      const points = split.bundle.nodes.filter(n => n.floorId === id).map(n => n.position);
      if (points.length) cells += (Math.max(...points.map(p => p.x))-Math.min(...points.map(p => p.x))+2) * (Math.max(...points.map(p => p.y))-Math.min(...points.map(p => p.y))+2) / 0.15**2;
    }
    return { floors: g.floors.sort(), nodes: g.nodes, edges: split.bundle.edges.length, outOfSplit: split.outOfSplit.length,
      estimatedBakeMiB: Math.ceil(cells*64/1024**2) };
  });
}
