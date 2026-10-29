/** Offline public Ikebukuro navmesh experiment. Coordinates are in the renderer frame. */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { enuToRenderer } from "@gteki/geo";
import { createRouter, DEFAULT_PROFILE, nodeDisplayZ } from "@gteki/navigation";
import { parseStationFiles } from "@gteki/schema";
import { buildGreybox } from "../../../apps/web/src/explorer/greybox.ts";
import { greyboxSceneProbes } from "../../../apps/web/src/explorer/greyboxScene.ts";
import { floorProbe } from "../../../apps/web/src/explorer/routeGaps.ts";
import { wallToRenderer } from "../../../apps/web/src/explorer/walker.ts";
import { loadScene, sceneProbe } from "./route-clip-audit.ts";
import { init, NavMeshQuery, exportNavMesh } from "recast-navigation";
import { generateTiledNavMesh } from "recast-navigation/generators";
import { WALKER_BODY } from "@gteki/scene-api";

/** Positions are renderer coordinates; triangle indices must have upward-facing floors. */
export async function bakeNavmesh(positions: readonly number[], indices: readonly number[]) {
  await init();
  const cs = 0.15, ch = 0.1;
  return generateTiledNavMesh(positions, indices, {
    cs, ch, tileSize: 64,
    walkableRadius: Math.ceil(WALKER_BODY.radiusM / cs - 1e-6),
    walkableHeight: Math.ceil(1.7 / ch),
    walkableClimb: Math.floor(0.3 / ch + 1e-6),
    walkableSlopeAngle: 40,
  });
}

/** Detour may return a partial path as success; accept only paths reaching the snapped end. */
export function completePath(query: NavMeshQuery, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
  const extents = { x: 1, y: 1, z: 1 };
  const start = query.findClosestPoint(from, { halfExtents: extents });
  const end = query.findClosestPoint(to, { halfExtents: extents });
  if (!start.success || !start.polyRef || !end.success || !end.polyRef) return null;
  const result = query.computePath(start.point, end.point, { halfExtents: extents });
  const last = result.path.at(-1);
  if (!result.success || !last || Math.hypot(last.x - end.point.x, last.y - end.point.y, last.z - end.point.z) > 0.01) return null;
  return result.path;
}

/** Transform indexed or non-indexed meshes (including instances) into Recast triangles. */
function appendMeshes(objects: readonly THREE.Object3D[], positions: number[], indices: number[], obstacle: boolean) {
  const v = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (const object of objects) {
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry, attr = geometry?.getAttribute("position");
    if (!attr) continue;
    const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    for (let n = 0; n < count; n++) {
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).getMatrixAt(n, instance);
      else instance.identity();
      world.multiplyMatrices(mesh.matrixWorld, instance);
      const base = positions.length / 3;
      for (let i = 0; i < attr.count; i++) {
        v.fromBufferAttribute(attr, i).applyMatrix4(world);
        positions.push(v.x, v.y, v.z);
      }
      const index = geometry.index, length = index?.count ?? attr.count;
      for (let i = 0; i + 2 < length; i += 3) {
        let a = base + (index ? index.getX(i) : i), b = base + (index ? index.getX(i + 1) : i + 1), c = base + (index ? index.getX(i + 2) : i + 2);
        // Obstacle triangles rasterize but must not turn their upward-facing tops into floors.
        const ax = positions[3*a]!, az = positions[3*a+2]!;
        const bx = positions[3*b]!, bz = positions[3*b+2]!, cx = positions[3*c]!, cz = positions[3*c+2]!;
        const normalY = (bz-az)*(cx-ax) - (bx-ax)*(cz-az);
        if (obstacle && normalY > 0) [b, c] = [c, b];
        indices.push(a, b, c);
      }
    }
  }
}

async function main() {
  let station = "", out = "", withGreybox = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--out" && args[i+1]) out = args[++i]!;
    else if (args[i] === "--with-greybox") withGreybox = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (station !== "ikebukuro" || !out) throw new Error("use --station ikebukuro --out <directory>");
  const dir = path.join(process.cwd(), "stations", station, "gteki");
  const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const parsed = parseStationFiles(read("station.json"), read("graph.json"), read("pois.json"), read("tenants.json"));
  if (!parsed.ok) throw new Error(`public bundle invalid: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
  const bundle = parsed.bundle;
  const scene = await loadScene(station, bundle);
  const probe = sceneProbe(scene);
  const ground = [...probe.ground], collider = [...probe.collider], walls = [...probe.walls];
  let greyboxRuns: number | null = null;
  if (withGreybox) {
    const router = createRouter(bundle);
    const wallSegments = walls.map(wallToRenderer);
    const grey = buildGreybox(bundle, e => router.isTraversable(e, DEFAULT_PROFILE), floorProbe(new THREE.Raycaster(), probe.ground), greyboxSceneProbes(probe.collider, wallSegments), "low");
    grey.root.updateMatrixWorld(true);
    ground.push(...grey.walkable); collider.push(...grey.colliders);
    greyboxRuns = grey.stats.runs;
    // This flag is an exploratory stub: portal clipping is not yet applied to mesh colliders.
    if (greyboxRuns) throw new Error("--with-greybox found passages; portal-safe bake is not implemented");
  }
  const positions: number[] = [], indices: number[] = [];
  appendMeshes(ground, positions, indices, false);
  const groundSet = new Set(ground);
  const shared = collider.filter(o => groundSet.has(o));
  if (shared.length) throw new Error(`${shared.length} meshes are both walkable and colliders; surface classification is ambiguous`);
  appendMeshes(collider, positions, indices, true);
  for (const wall of walls) {
    const dx = wall.b.x-wall.a.x, dz = -(wall.b.y-wall.a.y), len = Math.hypot(dx,dz), h = wall.zMax-wall.zMin;
    if (!len || h <= 0) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.05));
    mesh.position.set((wall.a.x+wall.b.x)/2, (wall.zMin+wall.zMax)/2, -(wall.a.y+wall.b.y)/2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.updateMatrixWorld(true);
    appendMeshes([mesh], positions, indices, true);
    mesh.geometry.dispose();
  }
  console.log(`scene input: ${ground.length} ground meshes, ${collider.length} collider meshes, ${walls.length} wall segments, ${indices.length/3} triangles; greybox runs ${greyboxRuns ?? "not measured"}`);
  const start = performance.now();
  const result = await bakeNavmesh(positions, indices);
  const bakeMs = performance.now() - start;
  if (!result.success) throw new Error(`bake failed: ${result.error}`);
  const nav = result.navMesh;
  let tiles = 0, polygons = 0;
  for (let i = 0; i < nav.getMaxTiles(); i++) {
    const header = nav.getTile(i).header();
    if (header) { tiles++; polygons += header.polyCount(); }
  }
  const query = new NavMeshQuery(nav);
  const nodes = new Map(bundle.nodes.map(n => [n.id, n]));
  const floors = new Map(bundle.floors.map(f => [f.id, f]));
  const vertical: Record<string, { total: number; endpointsWithinHalfM: number; connected: number; localCandidate: number; needsInvestigation: number }> = {};
  const point = (n: typeof bundle.nodes[number]) => {
    const [x,y,z] = enuToRenderer({ x: n.position.x, y: n.position.y, z: nodeDisplayZ(n, floors.get(n.floorId)).z });
    return { x,y,z };
  };
  for (const edge of bundle.edges) {
    if (!["stairs", "escalator", "elevator"].includes(edge.mode)) continue;
    const a = nodes.get(edge.from), b = nodes.get(edge.to);
    const stats = vertical[edge.mode] ??= { total: 0, endpointsWithinHalfM: 0, connected: 0, localCandidate: 0, needsInvestigation: 0 };
    stats.total++;
    if (!a || !b) { stats.needsInvestigation++; continue; }
    const pa = point(a), pb = point(b), extent = { x: 0.5, y: 0.5, z: 0.5 };
    const na = query.findClosestPoint(pa, { halfExtents: extent }), nb = query.findClosestPoint(pb, { halfExtents: extent });
    const dist = (p: typeof pa, q: typeof pa) => Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z);
    const near = na.success && nb.success && !!na.polyRef && !!nb.polyRef && dist(pa,na.point) <= 0.5 && dist(pb,nb.point) <= 0.5;
    if (near) stats.endpointsWithinHalfM++;
    const path = near ? completePath(query, na.point, nb.point) : null;
    if (path) stats.connected++;
    // Reject long detours as evidence that this particular connector is traversable.
    // This is only a proximity heuristic; it does not prove a path uses the authored stair.
    const line = edge.geometry?.length ? edge.geometry.map(p => ({ x: p.x, z: -p.y })) : [pa, pb];
    const distanceToLine = (p: { x: number; z: number }) => {
      let best = Infinity;
      for (let i = 1; i < line.length; i++) {
        const u = line[i-1]!, v = line[i]!, dx = v.x-u.x, dz = v.z-u.z;
        const t = Math.max(0, Math.min(1, ((p.x-u.x)*dx + (p.z-u.z)*dz)/(dx*dx+dz*dz || 1)));
        best = Math.min(best, Math.hypot(p.x-u.x-t*dx,p.z-u.z-t*dz));
      }
      return best;
    };
    let local = !!path && line.length >= 2;
    if (path) for (let i = 1; i < path.length; i++) {
      const a = path[i-1]!, b = path[i]!, samples = Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/0.5));
      for (let k = 0; k <= samples; k++) if (distanceToLine({ x: a.x+(b.x-a.x)*k/samples, z: a.z+(b.z-a.z)*k/samples }) > 2) local = false;
    }
    if (local) stats.localCandidate++; else stats.needsInvestigation++;
  }
  const bytes = exportNavMesh(nav), gz = gzipSync(bytes);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${station}.bin`), bytes);
  const metrics = { station, bakeMs, rawBytes: bytes.length, gzipBytes: gz.length, tiles, polygons, peakRssKiB: process.resourceUsage().maxRSS, greyboxRuns, vertical };
  fs.writeFileSync(path.join(out, `${station}-bake.json`), JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify(metrics, null, 2));
  query.destroy(); nav.destroy(); scene.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
