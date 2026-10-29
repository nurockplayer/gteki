/** Offline public Ikebukuro navmesh experiment. Coordinates are in the renderer frame. */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { enuToRenderer } from "@gteki/geo";
import { createRouter, DEFAULT_PROFILE, nodeDisplayZ } from "@gteki/navigation";
import { navmeshBundle } from "./navmesh-input.ts";
import type { Box } from "../../../apps/web/src/explorer/greybox.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { loadScene, sceneProbe } from "./route-clip-audit.ts";
import { init, NavMeshQuery, exportNavMesh } from "recast-navigation";
import { generateTiledNavMesh } from "recast-navigation/generators";
import { WALKER_BODY } from "@gteki/scene-api";

/** Positions are renderer coordinates; triangle indices must have upward-facing floors. */
export async function bakeNavmesh(positions: readonly number[], indices: readonly number[], options: { radiusM?: number; rounding?: "up" | "down" } = {}) {
  const cs = 0.15, ch = 0.1;
  const radius = options.radiusM ?? WALKER_BODY.radiusM;
  const radiusCells = options.rounding === "down" ? Math.floor(radius / cs + 1e-6) : Math.ceil(radius / cs - 1e-6);
  if (!Number.isFinite(radius) || radius <= 0 || radiusCells < 1) throw new Error("radius must produce at least one cell of erosion");
  await init();
  return generateTiledNavMesh(positions, indices, {
    cs, ch, tileSize: 64,
    walkableRadius: radiusCells,
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

/** Subtract one oriented portal volume from a triangle without dropping surrounding wall. */
function cutPortal(poly: THREE.Vector3[], box: Box): THREE.Vector3[][] {
  const axes = [box.across, box.along, new THREE.Vector3(0,1,0)];
  const centers = [box.center, box.center, box.center.clone().add(new THREE.Vector3(0,box.height/2,0))];
  const half = [box.width/2, box.depth/2, box.height/2];
  // A quick separating-axis test avoids fragmenting triangles outside this portal.
  for (let k=0; k<3; k++) {
    const values=poly.map(p => p.clone().sub(centers[k]!).dot(axes[k]!));
    if (Math.min(...values)>half[k]! || Math.max(...values)<-half[k]!) return [poly];
  }
  let inside = poly; const outside: THREE.Vector3[][] = [];
  for (let k=0; k<3; k++) for (const side of [-1,1]) {
    if (!inside.length) return outside;
    const signed = (p: THREE.Vector3) => half[k]! - side * p.clone().sub(centers[k]!).dot(axes[k]!);
    const clip = (keepInside: boolean) => {
      const result: THREE.Vector3[] = [];
      for (let i=0; i<inside.length; i++) {
        const a=inside[i]!, b=inside[(i+1)%inside.length]!, da=signed(a), db=signed(b);
        const aKeep=keepInside ? da>=0 : da<0, bKeep=keepInside ? db>=0 : db<0;
        if (aKeep) result.push(a);
        if (aKeep !== bKeep) result.push(a.clone().lerp(b, da/(da-db)));
      }
      return result;
    };
    const part = clip(false); if (part.length>=3) outside.push(part);
    inside=clip(true);
  }
  return outside;
}

export const triangleKey = (numbers: readonly number[]) => numbers.map(n => Math.fround(n)).join(",");

/** Transform indexed or non-indexed meshes (including instances) into Recast triangles. */
export function appendMeshes(objects: readonly THREE.Object3D[], positions: number[], indices: number[], obstacle: boolean, portals = new Map<THREE.Object3D, Box[]>(), skip = new Set<string>(), excludeGateTriangles = false) {
  const v = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (const object of objects) {
    const mesh = object as THREE.Mesh;
    const gateTriangles = new Set<number>(excludeGateTriangles ? mesh.userData.gtekiGateTriangles ?? [] : []);
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
        if (gateTriangles.has(i / 3)) continue;
        let a = base + (index ? index.getX(i) : i), b = base + (index ? index.getX(i + 1) : i + 1), c = base + (index ? index.getX(i + 2) : i + 2);
        // Obstacle triangles rasterize but must not turn their upward-facing tops into floors.
        const ax = positions[3*a]!, az = positions[3*a+2]!;
        const bx = positions[3*b]!, bz = positions[3*b+2]!, cx = positions[3*c]!, cz = positions[3*c+2]!;
        const normalY = (bz-az)*(cx-ax) - (bx-ax)*(cz-az);
        const at = (i: number) => new THREE.Vector3(positions[3*i]!, positions[3*i+1]!, positions[3*i+2]!);
        const av=at(a), bv=at(b), cv=at(c);
        if (skip.has(triangleKey([...av.toArray(), ...bv.toArray(), ...cv.toArray()]))) continue;
        const normal = bv.clone().sub(av).cross(cv.clone().sub(av));
        const cuts = obstacle && normal.length() && Math.abs(normal.y/normal.length()) <= 0.5 ? portals.get(object) : undefined;
        if (cuts?.length) {
          let parts = [[av,bv,cv]];
          for (const box of cuts) parts = parts.flatMap(part => cutPortal(part, box));
          for (const part of parts) for (let k=1; k+1<part.length; k++) {
            const tri = [part[0]!, part[k]!, part[k+1]!];
            if (obstacle && normalY > 0) [tri[1],tri[2]] = [tri[2]!,tri[1]!];
            const first=positions.length/3; for (const v of tri) positions.push(v.x,v.y,v.z);
            indices.push(first,first+1,first+2);
          }
        } else {
          if (obstacle && normalY > 0) [b, c] = [c, b];
          indices.push(a, b, c);
        }
      }
    }
  }
}

async function main() {
  let station = "", out = "", withGreybox = false, radiusM: number = WALKER_BODY.radiusM, rounding: "up" | "down" = "up", ignoreGates = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--out" && args[i+1]) out = args[++i]!;
    else if (args[i] === "--with-greybox") withGreybox = true;
    else if (args[i] === "--agent-radius" && args[i+1]) radiusM = Number(args[++i]);
    else if (args[i] === "--radius-rounding" && (args[i+1] === "up" || args[i+1] === "down")) rounding = args[++i] as "up" | "down";
    else if (args[i] === "--ignore-gate-obstacles") ignoreGates = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error("radius must be positive");
  if (!out) throw new Error("use --station <station> --out <directory>");
  const output = path.resolve(out), qa = path.resolve(".qa");
  if (output !== qa && !output.startsWith(qa + path.sep)) throw new Error("output must be under .qa/");
  const { bundle, privateBuild } = await navmeshBundle(station);
  const scene = await loadScene(station, bundle);
  const probe = sceneProbe(scene);
  const grey = withGreybox ? makeGreybox(bundle, scene, privateBuild) : null;
  const ground = [...(grey?.targets.ground ?? probe.ground)], collider = [...(grey?.targets.collider ?? probe.collider)];
  let walls = [...probe.walls], greyboxRuns: number | null = null;
  const positions: number[] = [], indices: number[] = [];
  appendMeshes(ground, positions, indices, false);
  const groundSet = new Set(ground), shared = collider.filter(o => groundSet.has(o));
  if (shared.length) throw new Error(`${shared.length} meshes are both walkable and colliders; surface classification is ambiguous`);
  if (ignoreGates && withGreybox) throw new Error("gate experiment is only available without --with-greybox");
  appendMeshes(collider, positions, indices, true, grey?.portals, new Set(), ignoreGates);
  if (grey) {
    greyboxRuns = grey.grey.stats.runs; walls = grey.walls;
    const data = grey.grey.navFloors ?? [], keys = new Set<string>();
    for (let i=0; i+8<data.length; i+=9) keys.add(triangleKey(data.slice(i,i+9)));
    if (data.length) {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(data,3));
      const mesh = new THREE.Mesh(geometry); mesh.updateMatrixWorld(true);
      appendMeshes([mesh], positions, indices, false); geometry.dispose();
    }
    appendMeshes(grey.grey.colliders, positions, indices, true, new Map(), keys);
  }
  const gateWallCount = walls.filter(w => "gtekiGate" in w && w.gtekiGate === true).length;
  const activeGateWalls = walls.filter(w => "gtekiGate" in w && w.gtekiGate === true && w.zMax > w.zMin).length;
  for (const wall of walls) {
    if (ignoreGates && "gtekiGate" in wall && wall.gtekiGate === true) continue;
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
  const result = await bakeNavmesh(positions, indices, { radiusM, rounding });
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
  const effectiveRadiusCells = rounding === "down" ? Math.floor(radiusM / 0.15 + 1e-6) : Math.ceil(radiusM / 0.15 - 1e-6);
  const gateTriangles = collider.reduce((n, mesh) => n + (mesh.userData.gtekiGateTriangles?.length ?? 0), 0);
  const metrics = { station, withGreybox, privateBuild, meshSha256: createHash("sha256").update(bytes).digest("hex"), radiusM, rounding, effectiveRadiusCells, effectiveRadiusM: effectiveRadiusCells * 0.15, ignoreGates, gateWallCount, activeGateWalls, gateTriangles, excludedActiveGateWalls: ignoreGates ? activeGateWalls : 0, excludedGateTriangles: ignoreGates ? gateTriangles : 0, bakeMs, rawBytes: bytes.length, gzipBytes: gz.length, tiles, polygons, peakRssKiB: process.resourceUsage().maxRSS, greyboxRuns, vertical };
  fs.writeFileSync(path.join(out, `${station}-bake.json`), JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify(metrics, null, 2));
  query.destroy(); nav.destroy(); scene.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
