/** Offline public Ikebukuro navmesh experiment. Coordinates are in the renderer frame. */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { enuToRenderer } from "@gteki/geo";
import { createRouter, DEFAULT_PROFILE, nodeDisplayZ, routePolyline, type RouteResult } from "@gteki/navigation";
import { navmeshBundle } from "./navmesh-input.ts";
import type { Box } from "../../../apps/web/src/explorer/greybox.ts";
import { makeGreybox } from "./navmesh-greybox.ts";
import { auditPolyline, loadScene, sceneProbe } from "./route-clip-audit.ts";
import { init, NavMeshQuery, exportNavMesh, type OffMeshConnectionParams } from "recast-navigation";
import { generateTiledNavMesh } from "recast-navigation/generators";
import { WALKER_BODY } from "@gteki/scene-api";
import { qaDirectory, qaFile } from "./navmesh-qa-path.ts";
import { bridgeGapGeometry, bridgeFloorTriangles, linkPadGeometry, linkStripGeometry, type BridgeGeometry } from "./navmesh-bridge.ts";
import { dataWidth, diagnoseGaps } from "./navmesh-gaps.ts";
import { validateLinkSnap, verticalLinkCandidates } from "./navmesh-links.ts";

/** Positions are renderer coordinates; triangle indices must have upward-facing floors. */
export async function bakeNavmesh(positions: readonly number[], indices: readonly number[], options: { radiusM?: number; rounding?: "up" | "down"; cellSizeM?: number; climbM?: number; tileSize?: number; offMeshConnections?: OffMeshConnectionParams[] } = {}) {
  const cs = options.cellSizeM ?? 0.15, ch = 0.1, climb = options.climbM ?? 0.3;
  if (!Number.isFinite(cs) || cs <= 0 || !Number.isFinite(climb) || climb < 0) throw new Error("cell size must be positive and climb must be non-negative");
  const radius = options.radiusM ?? WALKER_BODY.radiusM;
  const radiusCells = options.rounding === "down" ? Math.floor(radius / cs + 1e-6) : Math.ceil(radius / cs - 1e-6);
  if (!Number.isFinite(radius) || radius <= 0 || radiusCells < 1) throw new Error("radius must produce at least one cell of erosion");
  await init();
  return generateTiledNavMesh(positions, indices, {
    cs, ch, tileSize: options.tileSize ?? 64,
    walkableRadius: radiusCells,
    walkableHeight: Math.ceil(1.7 / ch),
    walkableClimb: Math.floor(climb / ch + 1e-6),
    walkableSlopeAngle: 40,
    offMeshConnections: options.offMeshConnections,
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

/** Exempt only triangle fragments within bridge volumes, then append the bridge floor and ceiling. */
export function applyBridgeGeometry(positions:number[],indices:number[],bridge:BridgeGeometry) {
  const boxes=bridge.openings.map(box=>({box,x:Math.abs(box.along.x)*box.depth/2+Math.abs(box.across.x)*box.width/2,z:Math.abs(box.along.z)*box.depth/2+Math.abs(box.across.z)*box.width/2}));
  const output:number[]=[];
  const vertex=(index:number)=>new THREE.Vector3(positions[3*index]!,positions[3*index+1]!,positions[3*index+2]!);
  for(let i=0;i+2<indices.length;i+=3) {
    const ids=[indices[i]!,indices[i+1]!,indices[i+2]!], tri=ids.map(vertex);
    const minX=Math.min(...tri.map(v=>v.x)),maxX=Math.max(...tri.map(v=>v.x)),minY=Math.min(...tri.map(v=>v.y)),maxY=Math.max(...tri.map(v=>v.y)),minZ=Math.min(...tri.map(v=>v.z)),maxZ=Math.max(...tri.map(v=>v.z));
    const overlapping=boxes.filter(({box,x,z})=>maxX>=box.center.x-x && minX<=box.center.x+x && maxZ>=box.center.z-z && minZ<=box.center.z+z && maxY>=box.center.y && minY<=box.center.y+box.height);
    if(!overlapping.length) { output.push(...ids); continue; }
    let parts=[tri]; for(const {box} of overlapping) parts=parts.flatMap(part=>cutPortal(part,box));
    for(const part of parts) for(let k=1;k+1<part.length;k++) { const base=positions.length/3; for(const p of [part[0]!,part[k]!,part[k+1]!]) positions.push(p.x,p.y,p.z); output.push(base,base+1,base+2); }
  }
  const base=positions.length/3; for (const n of bridge.positions) positions.push(n); for (const i of bridge.indices) output.push(i+base);
  indices.length=0; for (const i of output) indices.push(i);
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
  let station = "", out = "", withGreybox = false, snapFallback = false, bridgeGaps = false, radiusM: number = WALKER_BODY.radiusM, cellSizeM = 0.15, climbM = 0.3, tileSize = 256, rounding: "up" | "down" = "up", ignoreGates = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--station" && args[i+1]) station = args[++i]!;
    else if (args[i] === "--out" && args[i+1]) out = args[++i]!;
    else if (args[i] === "--with-greybox") withGreybox = true;
    else if (args[i] === "--snap-fallback") snapFallback = true;
    else if (args[i] === "--bridge-gaps") bridgeGaps = true;
    else if (args[i] === "--agent-radius" && args[i+1]) radiusM = Number(args[++i]);
    else if (args[i] === "--cell-size" && args[i+1]) cellSizeM = Number(args[++i]);
    else if (args[i] === "--walkable-climb" && args[i+1]) climbM = Number(args[++i]);
    else if (args[i] === "--tile-size" && args[i+1]) tileSize = Number(args[++i]);
    else if (args[i] === "--radius-rounding" && (args[i+1] === "up" || args[i+1] === "down")) rounding = args[++i] as "up" | "down";
    else if (args[i] === "--ignore-gate-obstacles") ignoreGates = true;
    else throw new Error(`unknown or incomplete argument: ${args[i]}`);
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error("radius must be positive");
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0 || !Number.isFinite(climbM) || climbM < 0) throw new Error("cell size must be positive and climb must be non-negative");
  if (!Number.isInteger(tileSize) || tileSize < 1 || tileSize > 256) throw new Error("tile size must be an integer between 1 and 256");
  if (!out) throw new Error("use --station <station> --out <directory>");
  // Bridge openings currently lose the identity of the source collider before
  // subtraction. Refuse to emit a mesh that can silently pass through walls.
  if (bridgeGaps) throw new Error("--bridge-gaps is disabled: collider-aware wall-safe exemptions are not implemented");
  const output = qaDirectory(out);
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
  let result = await bakeNavmesh(positions, indices, { radiusM, rounding, cellSizeM, climbM, tileSize });
  if (!result.success) throw new Error(`bake failed: ${result.error}`);
  const nodes = new Map(bundle.nodes.map(n => [n.id, n]));
  const floors = new Map(bundle.floors.map(f => [f.id, f]));
  const point = (n: typeof bundle.nodes[number]) => {
    const [x,y,z] = enuToRenderer({ x: n.position.x, y: n.position.y, z: nodeDisplayZ(n, floors.get(n.floorId)).z });
    return { x,y,z };
  };
  let initialQuery = new NavMeshQuery(result.navMesh);
  const router = createRouter(bundle, { allowUnverified: privateBuild });
  const originalProbeForLinks=()=>grey?.probe ?? probe;
  const bridge:BridgeGeometry={positions:[],indices:[],openings:[]};
  let bridgedGaps=0, unbridgeableGaps=0, linkPads=0, linkPadsWithoutNearbyPoly=0, linkPadsBlocked=0, linkPadsSteep=0;
  const mergeBridge=(part:BridgeGeometry) => { const base=bridge.positions.length/3; for (const n of part.positions) bridge.positions.push(n); for (const i of part.indices) bridge.indices.push(i+base); bridge.openings.push(...part.openings); };
  if (bridgeGaps) {
    for (const edge of bundle.edges) {
      if (["stairs","escalator","elevator"].includes(edge.mode) || !router.isTraversable(edge,DEFAULT_PROFILE)) continue;
      const a=nodes.get(edge.from), b=nodes.get(edge.to); if (!a || !b) continue;
      const step={edgeId:edge.id,fromNodeId:edge.from,toNodeId:edge.to,reversed:false,mode:edge.mode,lengthM:edge.lengthM ?? 0,fromFloorId:a.floorId,toFloorId:b.floorId};
      const line=routePolyline(bundle,{nodeIds:[edge.from,edge.to],steps:[step]} as RouteResult), width=dataWidth(edge);
      const gaps=diagnoseGaps(initialQuery,grey?.probe ?? probe,line,width,climbM,{radius:radiusM,cell:cellSizeM});
      const wanted=gaps.filter(g=>g.class!=="narrow");
      for (const gap of wanted) { const part=bridgeGapGeometry(line,[gap],width); if (!part.indices.length) {unbridgeableGaps++;continue;} mergeBridge(part); bridgedGaps++; }
    }
    const visited=new Set<string>();
    for (const edge of bundle.edges) {
      if (!["stairs","escalator","elevator"].includes(edge.mode) || !router.isTraversable(edge,DEFAULT_PROFILE)) continue;
      for (const id of [edge.from,edge.to]) {
        if (visited.has(id)) continue; visited.add(id);
        const node=nodes.get(id); if (!node) continue;
        const p=point(node), near=initialQuery.findClosestPoint(p,{halfExtents:{x:0.6,y:0.6,z:0.6}});
        if (near.success && near.polyRef && Math.abs(near.point.y-p.y)<=0.6 && Math.hypot(near.point.x-p.x,near.point.z-p.z)<=0.6) continue;
        mergeBridge(linkPadGeometry(p)); linkPads++;
        const hit=initialQuery.findClosestPoint(p,{halfExtents:{x:3,y:0.6,z:3}});
        if (!hit.success || !hit.polyRef || Math.abs(hit.point.y-p.y)>0.6 || Math.hypot(hit.point.x-p.x,hit.point.z-p.z)>3) {linkPadsWithoutNearbyPoly++;continue;}
        const a={x:p.x,y:-p.z,z:p.y,zKnown:true,floorId:node.floorId,stepIndex:0},b={...a,x:hit.point.x,y:-hit.point.z,z:hit.point.y};
        const strip=linkStripGeometry(originalProbeForLinks(),a,b,auditPolyline);
        if (strip.reason==="wall") linkPadsBlocked++;
        if (strip.reason==="steep") linkPadsSteep++;
        if (strip.geometry) mergeBridge(strip.geometry);
      }
    }
    if (bridge.indices.length) {
      applyBridgeGeometry(positions,indices,bridge);
      initialQuery.destroy(); result.navMesh.destroy();
      result=await bakeNavmesh(positions,indices,{radiusM,rounding,cellSizeM,climbM,tileSize});
      if (!result.success) throw new Error(`bridge bake failed: ${result.error}`);
      initialQuery=new NavMeshQuery(result.navMesh);
    }
  }
  const bridgeFloorData=bridgeFloorTriangles(bridge);
  const bridgeFloorGeometry=new THREE.BufferGeometry(); bridgeFloorGeometry.setAttribute("position",new THREE.Float32BufferAttribute(bridgeFloorData,3));
  const bridgeFloor=new THREE.Mesh(bridgeFloorGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); bridgeFloor.userData.greybox=true; bridgeFloor.updateMatrixWorld(true);
  const originalProbe=grey?.probe ?? probe, bridgeProbe={...originalProbe,ground:[...originalProbe.ground,...(bridgeFloorData.length ? [bridgeFloor] : [])]};
  const snapRejections = { floor:0, wall:0 };
  const fallback = (id:string, node:{x:number;y:number;z:number}) => {
    const here=nodes.get(id); if (!here) return null;
    const candidates=bundle.edges.filter(e=>e.mode!=="stairs" && e.mode!=="escalator" && e.mode!=="elevator" && e.direction==="both" && (e.from===id || e.to===id) && router.isTraversable(e,DEFAULT_PROFILE)).sort((a,b)=>a.id.localeCompare(b.id));
    for (const edge of candidates) {
      const neighborId=edge.from===id ? edge.to : edge.from, neighbor=nodes.get(neighborId);
      if (!neighbor || neighbor.floorId!==here.floorId) continue;
      const source=point(neighbor), hit=initialQuery.findClosestPoint(source,{halfExtents:{x:1.5,y:0.6,z:1.5}});
      if (!hit.success || !hit.polyRef || Math.abs(hit.point.y-source.y)>0.6 || validateLinkSnap(grey?.probe ?? probe,source,hit.point)) continue;
      const step={edgeId:edge.id,fromNodeId:neighborId,toNodeId:id,reversed:edge.to===neighborId,mode:edge.mode,lengthM:edge.lengthM ?? 0,fromFloorId:neighbor.floorId,toFloorId:here.floorId};
      const line=routePolyline(bundle,{nodeIds:[neighborId,id],steps:[step]} as RouteResult);
      const distance=line.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-line[i]!.x,p.y-line[i]!.y,p.z-line[i]!.z),Math.hypot(hit.point.x-source.x,hit.point.y-source.y,hit.point.z-source.z));
      if (distance>3) continue;
      const audit=auditPolyline(grey?.probe ?? probe,line);
      if (audit.wallHits || audit.noFloor || audit.offFloor || validateLinkSnap(grey?.probe ?? probe,node,{x:node.x,y:node.y,z:node.z})) continue;
      return {point:hit.point,neighborId,edgeId:edge.id};
    }
    return null;
  };
  const links = verticalLinkCandidates(bundle.edges.filter(e => router.isTraversable(e, DEFAULT_PROFILE)), id => { const n=nodes.get(id); return n ? point(n) : undefined; }, initialQuery,
    (_id, a, b) => { const reason=validateLinkSnap(bridgeProbe, a, b); if (reason) snapRejections[reason]++; return !reason; }, snapFallback ? fallback : undefined);
  initialQuery.destroy(); result.navMesh.destroy();
  const linked = await bakeNavmesh(positions, indices, { radiusM, rounding, cellSizeM, climbM, tileSize, offMeshConnections:links.candidates.map(c => c.connection) });
  if (!linked.success) throw new Error(`linked bake failed: ${linked.error}`);
  const bakeMs = performance.now() - start;
  const nav = linked.navMesh;
  let tiles = 0, polygons = 0;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  const emittedLinkIds = new Set<number>(), attachedLinkIds = new Set<number>();
  const linkEnds = new Map<number,Set<number>>();
  for (let i = 0; i < nav.getMaxTiles(); i++) {
    const tile = nav.getTile(i), header = tile.header();
    if (header) {
      tiles++; polygons += header.polyCount();
      minX=Math.min(minX,header.bmin(0)); maxX=Math.max(maxX,header.bmax(0));
      minZ=Math.min(minZ,header.bmin(2)); maxZ=Math.max(maxZ,header.bmax(2));
      for (let j=0;j<header.offMeshConCount();j++) {
        const connection=tile.offMeshCons(j), id=connection.userId(); emittedLinkIds.add(id);
        const ends=new Set<number>(); let next=tile.polys(connection.poly()).firstLink(), guard=0;
        while (next !== 0xffffffff && guard++ < header.maxLinkCount()) { const link=tile.links(next); if (link.ref()) ends.add(link.edge()); next=link.next(); }
        linkEnds.set(id,ends);
        if (ends.has(0) && ends.has(1)) attachedLinkIds.add(id);
      }
    }
  }
  // Report outside the bounds of all emitted tiles; other missing emissions remain unknown.
  const linkAttachmentDiagnosis = { noPolyStart:links.noPolyStart,noPolyEnd:links.noPolyEnd,tileOutsideBounds:0,unemittedUnknown:0,unsafeSnap:links.failed.filter(f=>f.reason==="unsafe_snap").length,missingNode:links.failed.filter(f=>f.reason==="missing_node").length };
  for (const candidate of links.candidates) {
    const id=candidate.connection.userId!, ends=linkEnds.get(id);
    if (ends) { if (!ends.has(0)) linkAttachmentDiagnosis.noPolyStart++; if (!ends.has(1)) linkAttachmentDiagnosis.noPolyEnd++; }
    else { const p=candidate.connection.startPosition; if (p.x<minX || p.x>maxX || p.z<minZ || p.z>maxZ) linkAttachmentDiagnosis.tileOutsideBounds++; else linkAttachmentDiagnosis.unemittedUnknown++; }
  }
  const query = new NavMeshQuery(nav);
  const vertical: Record<string, { total: number; endpointsWithinHalfM: number; connected: number; localCandidate: number; needsInvestigation: number }> = {};
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
  fs.writeFileSync(qaFile(path.join(output, `${station}.bin`)), bytes);
  const effectiveRadiusCells = rounding === "down" ? Math.floor(radiusM / cellSizeM + 1e-6) : Math.ceil(radiusM / cellSizeM - 1e-6);
  const gateTriangles = collider.reduce((n, mesh) => n + (mesh.userData.gtekiGateTriangles?.length ?? 0), 0);
  const metrics = { station, withGreybox, privateBuild, snapFallback, bridgeGaps, bridgedGaps, unbridgeableGaps, linkPads, linkPadsWithoutNearbyPoly, linkPadsBlocked, linkPadsSteep, bridgeOpenings:bridge.openings, bridgeFloorTriangles:bridgeFloorData, bundleSha256:createHash("sha256").update(JSON.stringify(bundle)).digest("hex"), meshSha256: createHash("sha256").update(bytes).digest("hex"), radiusM, rounding, cellSizeM, climbM, tileSize, effectiveClimbM: Math.floor(climbM / 0.1 + 1e-6) * 0.1, effectiveRadiusCells, effectiveRadiusM: effectiveRadiusCells * cellSizeM, ignoreGates, gateWallCount, activeGateWalls, gateTriangles, excludedActiveGateWalls: ignoreGates ? activeGateWalls : 0, excludedGateTriangles: ignoreGates ? gateTriangles : 0, bakeMs, rawBytes: bytes.length, gzipBytes: gz.length, tiles, polygons, peakRssKiB: process.resourceUsage().maxRSS, greyboxRuns, greyboxLandingPads:grey?.grey.stats.landingPads ?? null, vertical, links, emittedLinkIds:[...emittedLinkIds].sort((a,b)=>a-b), attachedLinkIds:[...attachedLinkIds].sort((a,b)=>a-b), linkAttachmentDiagnosis, fallbackRecovered:links.candidates.filter(c=>c.fallback && attachedLinkIds.has(c.connection.userId!)).length, snapRejections };
  fs.writeFileSync(qaFile(path.join(output, `${station}-bake.json`)), JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify({station,withGreybox,snapFallback,bridgeGaps,bridgedGaps,unbridgeableGaps,linkPads,linkPadsWithoutNearbyPoly,linkPadsBlocked,linkPadsSteep,bakeMs,rawBytes:bytes.length,gzipBytes:gz.length,tiles,polygons,landingPads:metrics.greyboxLandingPads,linksAttached:attachedLinkIds.size,fallbackAttached:metrics.fallbackRecovered,linkAttachmentDiagnosis,snapRejections,peakRssKiB:metrics.peakRssKiB}));
  query.destroy(); nav.destroy(); bridgeFloorGeometry.dispose(); (bridgeFloor.material as THREE.Material).dispose(); scene.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
