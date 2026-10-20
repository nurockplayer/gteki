/**
 * Three.js scene for Toei Oedo Shinjuku (E27), built from the renderer-neutral layout.
 * Frame: ENU (x east, y north, z up) → Three (X = x, Y = z, Z = -y).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import { createRouter } from "@gteki/navigation";
import { buildLayout, centroid, pointInRings, soffitHeight, STREET_PAD, WalkWorld, type Layout, type Plan, type Run, type Soffit, type WallSeg, type XY, type XYZ } from "./layout.ts";
import { ceilingTexture, signTexture, tactileTexture, tileTextures, wallTexture, type SignIcon } from "./textures.ts";

export const OEDO_MAGENTA = "#b6007a"; // public line colour of the Oedo Line

const v3 = (p: XYZ) => new THREE.Vector3(p.x, p.z, -p.y);

export interface BuiltStation {
  root: THREE.Group;
  layout: Layout;
  world: WalkWorld;
  /** Extra collision walls created by props (gate machines, platform doors). */
  propWalls: WallSeg[];
  escalators: { run: Run; steps: THREE.InstancedMesh; speed: number }[];
  signs: THREE.Object3D[];
  levelGroups: Map<string, THREE.Group>;
  update(dt: number, t: number): void;
  /** QA readout of the decorative train cycle per platform track. */
  trainStatus(): { tt: number; present: boolean; doorsOpen: boolean }[];
  dispose(): void;
}

export interface BuildOptions {
  quality: "low" | "high";
}

// ---------------------------------------------------------------- helpers
function shapeFromRings(rings: XY[][]): THREE.Shape {
  const shape = new THREE.Shape(rings[0]!.map((p) => new THREE.Vector2(p.x, p.y)));
  for (let i = 1; i < rings.length; i++) shape.holes.push(new THREE.Path(rings[i]!.map((p) => new THREE.Vector2(p.x, p.y))));
  return shape;
}

/** Horizontal polygon at height z, world-planar UVs scaled by `uvScale` metres per texture repeat. */
export function slabGeometry(rings: XY[][], z: number, uvScale: number, facingDown = false): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeFromRings(rings));
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, x / uvScale, y / uvScale);
    pos.setXYZ(i, x, z, -y);
  }
  if (facingDown) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** The renderer uses the same affine roof that the head-clearance checks inspect. */
export function soffitGeometry(s: Soffit): THREE.BufferGeometry {
  const g = slabGeometry(s.rings, s.z, 2.4, true);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) pos.setY(i, soffitHeight(s, { x: pos.getX(i), y: -pos.getZ(i) }));
  g.computeVertexNormals();
  return g;
}

/** Vertical quad strip for a wall segment, UV u = metres/2.4, v = height/3.2. */
function wallQuad(a: XY, b: XY, z0: number, z1: number, uOff = 0): THREE.BufferGeometry {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x, z0, -a.y, b.x, z0, -b.y, b.x, z1, -b.y, a.x, z1, -a.y], 3));
  const vTop = (z1 - z0) / 3.2;
  g.setAttribute("uv", new THREE.Float32BufferAttribute([uOff / 2.4, 0, (uOff + L) / 2.4, 0, (uOff + L) / 2.4, vTop, uOff / 2.4, vTop], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function enclosureWallGeometry(w: WallSeg): THREE.BufferGeometry {
  const g = wallQuad(w.a, w.b, w.zMin, w.zMax, w.a.x + w.a.y);
  if (!w.profile) return g;
  const p = g.attributes.position!, uv = g.attributes.uv!;
  const heights = [w.profile.bottomA, w.profile.bottomB, w.profile.topB, w.profile.topA];
  for (let i = 0; i < 4; i++) {
    p.setY(i, heights[i]!);
    uv.setY(i, (heights[i]! - (w.surfaceBase ? i === 0 || i === 3 ? w.surfaceBase.a : w.surfaceBase.b : 0)) / 3.2);
  }
  g.computeVertexNormals();
  return g;
}

function runPanel(w: WallSeg, r: Run): WallSeg {
  const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, l2 = dx * dx + dy * dy;
  const zAt = (p: XY) => r.a.z + (r.b.z - r.a.z) * ((p.x - r.a.x) * dx + (p.y - r.a.y) * dy) / l2;
  const a = zAt(w.a), b = zAt(w.b);
  return { ...w, surfaceBase: { a, b }, profile: { bottomA: a - 0.12, bottomB: b - 0.12, topA: a + 0.9, topB: b + 0.9 } };
}

function merged(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  for (const g of geos) {
    if (!g.index) g.setIndex([...Array(g.attributes.position!.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  }
  const m = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return m;
}

function boxAlong(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.BoxGeometry(w, h, L);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  if (Math.abs(d.clone().normalize().y) > 0.999) m.lookAt(a, b, new THREE.Vector3(1, 0, 0));
  g.applyMatrix4(m);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function cylAlong(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// ---------------------------------------------------------------- main
export function buildStation(bundle: StationBundle, plan: Plan, opts: BuildOptions): BuiltStation {
  const layout = buildLayout(bundle, plan);
  const root = new THREE.Group();
  root.name = "shinjuku-e27";
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const aniso = opts.quality === "high" ? 8 : 4;

  // ---- materials
  const concourseTiles = tileTextures({ base: "#c9c4ba", grout: "rgba(90,86,80,0.55)", n: 4, seed: 11 });
  const paidTiles = tileTextures({ base: "#bfbcb6", grout: "rgba(80,80,80,0.55)", n: 4, seed: 23 });
  const platformTiles = tileTextures({ base: "#8e8c88", grout: "rgba(40,40,40,0.6)", n: 4, seed: 37, speckle: 0.09 });
  const wallMaps = wallTexture(OEDO_MAGENTA), ceilingMaps = ceilingTexture();
  for (const t of [concourseTiles, paidTiles, platformTiles, wallMaps, ceilingMaps]) for (const tex of Object.values(t)) (tex.anisotropy = aniso), track(tex);
  const mat = {
    floor: track(new THREE.MeshStandardMaterial({ ...concourseTiles, bumpScale: 0.012, roughness: 0.72, metalness: 0.0, envMapIntensity: 0.9 })),
    floorPaid: track(new THREE.MeshStandardMaterial({ ...paidTiles, bumpScale: 0.012, roughness: 0.68, metalness: 0.0, envMapIntensity: 0.9 })),
    floorPlatform: track(new THREE.MeshStandardMaterial({ ...platformTiles, bumpScale: 0.016, roughness: 0.82, metalness: 0.0 })),
    wall: track(new THREE.MeshStandardMaterial({ ...wallMaps, bumpScale: 0.009, roughness: 0.66, metalness: 0.05, side: THREE.DoubleSide })),
    wallRoom: track(new THREE.MeshStandardMaterial({ color: "#d8d5ce", roughness: 0.7, side: THREE.DoubleSide })),
    ceiling: track(new THREE.MeshStandardMaterial({ ...ceilingMaps, color: "#e2e3de", bumpScale: 0.008, emissive: "#bdc7ce", emissiveIntensity: 0.065, roughness: 0.96, side: THREE.DoubleSide })),
    light: track(new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#fff6e8", emissiveIntensity: 3.2, roughness: 0.4 })),
    lightHousing: track(new THREE.MeshStandardMaterial({ color: "#9a9ea2", roughness: 0.35, metalness: 0.6 })),
    tactile: track(new THREE.MeshStandardMaterial({ map: track(tactileTexture()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })),
    steel: track(new THREE.MeshStandardMaterial({ color: "#c7ccd1", roughness: 0.28, metalness: 0.85, side: THREE.DoubleSide })),
    darkSteel: track(new THREE.MeshStandardMaterial({ color: "#3b3f44", roughness: 0.45, metalness: 0.6 })),
    rubber: track(new THREE.MeshStandardMaterial({ color: "#121314", roughness: 0.55 })),
    // Tinted reflective glass without a transmission scene pass (also coherent on low quality).
    glass: track(new THREE.MeshStandardMaterial({ color: "#b4ccd1", roughness: 0.18, metalness: 0.25, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true })),
    stair: track(new THREE.MeshStandardMaterial({ color: "#b9b4aa", roughness: 0.6 })),
    nosing: track(new THREE.MeshStandardMaterial({ color: "#3a3a3a", roughness: 0.7 })),
    escStep: track(new THREE.MeshStandardMaterial({ color: "#6d7177", roughness: 0.4, metalness: 0.7 })),
    escStepEdge: track(new THREE.MeshStandardMaterial({ color: "#f2c21b", roughness: 0.5 })),
    gateBody: track(new THREE.MeshStandardMaterial({ color: "#e9ebec", roughness: 0.35, metalness: 0.15 })),
    gateTop: track(new THREE.MeshStandardMaterial({ color: "#1b1d20", roughness: 0.3, metalness: 0.3 })),
    gateIc: track(new THREE.MeshStandardMaterial({ color: "#2a7fff", emissive: "#2a7fff", emissiveIntensity: 1.6 })),
    gateOk: track(new THREE.MeshStandardMaterial({ color: "#2bd46b", emissive: "#2bd46b", emissiveIntensity: 1.4 })),
    flap: track(new THREE.MeshStandardMaterial({ color: "#e64060", roughness: 0.4, transparent: true, opacity: 0.85 })),
    psd: track(new THREE.MeshStandardMaterial({ color: "#d4d8dc", roughness: 0.3, metalness: 0.5 })),
    trackBed: track(new THREE.MeshStandardMaterial({ color: "#2a2826", roughness: 0.95 })),
    rail: track(new THREE.MeshStandardMaterial({ color: "#8d8f92", roughness: 0.3, metalness: 0.9 })),
    accent: track(new THREE.MeshStandardMaterial({ color: OEDO_MAGENTA, roughness: 0.4, emissive: OEDO_MAGENTA, emissiveIntensity: 0.15 })),
    portal: track(new THREE.MeshBasicMaterial({ color: "#7fd3ff", transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })),
    sidewalk: track(new THREE.MeshStandardMaterial({ color: "#a39e96", roughness: 0.9 })),
    tunnel: track(new THREE.MeshStandardMaterial({ color: "#3a3b3d", roughness: 0.95, side: THREE.DoubleSide })),
    psdLeaf: track(new THREE.MeshStandardMaterial({ color: "#c9d6dd", roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85 })),
    trainBody: track(new THREE.MeshStandardMaterial({ color: "#d9dcde", roughness: 0.3, metalness: 0.75 })),
    trainWindow: track(new THREE.MeshStandardMaterial({ color: "#1c232a", roughness: 0.08, metalness: 0.2, emissive: "#fff2d6", emissiveIntensity: 0.35 })),
    trainDoor: track(new THREE.MeshStandardMaterial({ color: "#b8bdc1", roughness: 0.25, metalness: 0.8 })),
  };
  for (const m of [mat.floor, mat.floorPaid, mat.floorPlatform]) {
    m.map!.repeat.set(1, 1);
  }

  const levelGroups = new Map<string, THREE.Group>();
  const propWalls: WallSeg[] = [];
  const platformTracks: {
    at: (s: number, off: number) => XY;
    tangentAt: (s: number) => XY;
    z: number;
    trackOff: number;
    stopS: number;
    dirSign: number;
    cars: THREE.Group[];
    leafMesh: THREE.InstancedMesh;
    leaves: { s: number; dir: number }[];
    phase: number;
    far: number;
  }[] = [];

  const fasciaGeos: THREE.BufferGeometry[] = [];
  // ---- per level: slabs, ceilings, walls, railings, lights
  for (const lv of layout.levels) {
    const g = new THREE.Group();
    g.name = `level-${lv.label}`;
    levelGroups.set(lv.floorId, g);
    root.add(g);
    const isPlatform = lv.label === "B6";

    const floorFree: THREE.BufferGeometry[] = [];
    const floorPaid: THREE.BufferGeometry[] = [];
    for (const s of lv.slabs) (s.fare === "paid" ? floorPaid : floorFree).push(slabGeometry(s.rings, s.z, 2.4));
    for (const [geos, m] of [
      [floorFree, isPlatform ? mat.floorPlatform : mat.floor],
      [floorPaid, isPlatform ? mat.floorPlatform : mat.floorPaid],
    ] as const) {
      const geo = merged(geos);
      if (!geo) continue;
      const mesh = new THREE.Mesh(track(geo), m);
      mesh.receiveShadow = true;
      mesh.name = "walkable";
      g.add(mesh);
    }
    const ceil = merged([...lv.ceilings.map((s) => slabGeometry(s.rings, s.z, 2.4, true)), ...layout.soffits.filter((s) => s.floorId === lv.floorId).map(soffitGeometry)]);
    if (ceil) g.add(new THREE.Mesh(track(ceil), mat.ceiling));

    // walls (u continuous along each segment)
    const wallGeos: THREE.BufferGeometry[] = [];
    const roomGeos: THREE.BufferGeometry[] = [];
    for (const w of lv.walls) {
      if (w.kind === "trackside") continue;
      if (w.finish) {
        (w.finish === "fascia" ? fasciaGeos : wallGeos).push(enclosureWallGeometry(w));
        continue;
      }
      (w.kind === "wall" || w.kind === "elevator" ? wallGeos : roomGeos).push(wallQuad(w.a, w.b, w.zMin, w.zMax, w.a.x + w.a.y));
    }
    // public-facing "room" walls use the station cladding as well; plain material only for very short jogs
    const wg = merged([...wallGeos, ...roomGeos]);
    if (wg) {
      const m = new THREE.Mesh(track(wg), mat.wall);
      m.receiveShadow = true;
      g.add(m);
    }

    // railings (glass + steel top rail)
    const glassGeos: THREE.BufferGeometry[] = [];
    const railGeos: THREE.BufferGeometry[] = [];
    for (const r of lv.railings) {
      glassGeos.push(wallQuad(r.a, r.b, r.z + 0.08, r.z + 1.05));
      railGeos.push(boxAlong(v3({ ...r.a, z: r.z + 1.08 }), v3({ ...r.b, z: r.z + 1.08 }), 0.06, 0.05));
    }
    const gg = merged(glassGeos);
    if (gg) g.add(new THREE.Mesh(track(gg), mat.glass));
    const rg = merged(railGeos);
    if (rg) g.add(new THREE.Mesh(track(rg), mat.steel));

    // platform: platform doors along trackside walls + track bed beyond
    if (isPlatform) buildPlatformEdge(lv.walls.filter((w) => w.kind === "trackside"), lv.z, g);
  }
  // Fascia joins the existing stair-concrete batch below; shaft cladding is merged with the
  // source walls per level. No extra wall material draw is needed for the new enclosure.

  // ---- underground fixtures, kept in a separate helper for the surface lane's hook
  buildUndergroundLighting(bundle, layout, levelGroups, root, track);

  // ---- existing surface ceiling lights (street scene is owned by W2)
  {
    const lightGeos: THREE.BufferGeometry[] = [];
    const housingGeos: THREE.BufferGeometry[] = [];
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    for (const e of bundle.edges) {
      if (e.mode !== "walk" && e.mode !== "gate" && e.mode !== "ramp") continue;
      const A = nodeById.get(e.from)!;
      const B = nodeById.get(e.to)!;
      if ((layout.nodeZ.get(A.id) ?? 0) < -0.5) continue;
      if (A.floorId !== B.floorId || A.inOut === "outside") continue;
      const lv = layout.levels.find((l) => l.floorId === A.floorId) ?? layout.levels.find((l) => Math.abs(l.z - (layout.nodeZ.get(A.id) ?? 0)) < 0.5);
      if (!lv) continue;
      const L = Math.hypot(B.position.x - A.position.x, B.position.y - A.position.y);
      if (L < 2.5) continue;
      const z = lv.ceilingZ - 0.03;
      const shrink = 0.6 / L;
      const a = { x: A.position.x + (B.position.x - A.position.x) * shrink, y: A.position.y + (B.position.y - A.position.y) * shrink, z };
      const b = { x: B.position.x - (B.position.x - A.position.x) * shrink, y: B.position.y - (B.position.y - A.position.y) * shrink, z };
      lightGeos.push(boxAlong(v3(a), v3(b), 0.14, 0.03));
      housingGeos.push(boxAlong(v3({ ...a, z: z + 0.015 }), v3({ ...b, z: z + 0.015 }), 0.22, 0.03));
    }
    const lg = merged(lightGeos);
    if (lg) root.add(new THREE.Mesh(track(lg), mat.light));
    const hg = merged(housingGeos);
    if (hg) root.add(new THREE.Mesh(track(hg), mat.lightHousing));
  }

  // ---- landing pads
  {
    const pg = merged([...layout.pads.map((p) => slabGeometry(p.rings, p.z + 0.002, 2.4)), ...layout.linkStrips.filter((s) => s.z < -0.5).map((s) => slabGeometry(s.rings, s.z - 0.006, 2.4))]);
    if (pg) {
      const m = new THREE.Mesh(track(pg), mat.floor);
      m.name = "walkable";
      root.add(m);
    }
  }

  // ---- tactile paving
  {
    const tg: THREE.BufferGeometry[] = [];
    for (const t of layout.tactile) {
      for (let i = 1; i < t.pts.length; i++) {
        const a = t.pts[i - 1]!;
        const b = t.pts[i]!;
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 0.05) continue;
        const dx = (b.x - a.x) / L;
        const dy = (b.y - a.y) / L;
        const nx = -dy * 0.15;
        const ny = dx * 0.15;
        const z = a.z + 0.006;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute([a.x + nx, z, -(a.y + ny), b.x + nx, z, -(b.y + ny), b.x - nx, z, -(b.y - ny), a.x - nx, z, -(a.y - ny)], 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, L / 0.3, 0, L / 0.3, 1, 0, 1], 2));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        geo.setIndex([0, 2, 1, 0, 3, 2]);
        tg.push(geo);
      }
    }
    const geo = merged(tg);
    if (geo) {
      (mat.tactile.map as THREE.Texture).rotation = Math.PI / 2;
      root.add(new THREE.Mesh(track(geo), mat.tactile));
    }
  }

  // ---- stairs & escalators
  const escalators: BuiltStation["escalators"] = [];
  {
    const stairGeos: THREE.BufferGeometry[] = [...fasciaGeos];
    const nosingGeos: THREE.BufferGeometry[] = [];
    const sideGeos: THREE.BufferGeometry[] = [];
    const balustradeGeos: THREE.BufferGeometry[] = [];
    const handGeos: THREE.BufferGeometry[] = [];
    const rubberGeos: THREE.BufferGeometry[] = [];
    const steelGeos: THREE.BufferGeometry[] = [];
    for (const r of layout.runs) {
      const lo = r.a.z <= r.b.z ? r.a : r.b;
      const hi = r.a.z <= r.b.z ? r.b : r.a;
      const dz = hi.z - lo.z;
      const dx = hi.x - lo.x;
      const dy = hi.y - lo.y;
      const L = Math.hypot(dx, dy) || 1;
      const u = { x: dx / L, y: dy / L };
      const n = { x: -u.y, y: u.x };
      const hw = r.width / 2;
      // rotation about Three Y so local +X maps to the run direction: (x, z, -y) ⇒ θ = atan2(u.y, u.x)
      const yaw = Math.atan2(u.y, u.x);
      if (r.mode === "stairs") {
        if (dz < 0.05) {
          // flat stair link (landing) — draw as floor strip
          stairGeos.push(boxAlong(v3({ ...lo, z: lo.z - 0.05 }), v3({ ...hi, z: hi.z - 0.05 }), r.width, 0.1));
        } else {
          const steps = Math.max(2, Math.round(dz / 0.165));
          const rise = dz / steps;
          const run = L / steps;
          for (let i = 0; i < steps; i++) {
            const cx = lo.x + u.x * run * (i + 0.5);
            const cy = lo.y + u.y * run * (i + 0.5);
            const top = lo.z + rise * (i + 1);
            const box = new THREE.BoxGeometry(run + 0.02, rise + 0.18, r.width);
            box.rotateY(yaw);
            box.translate(cx, top - (rise + 0.18) / 2, -cy);
            stairGeos.push(box);
            const ex = lo.x + u.x * run * i;
            const ey = lo.y + u.y * run * i;
            const nose = new THREE.BoxGeometry(0.05, 0.012, r.width - 0.06);
            nose.rotateY(yaw);
            nose.translate(ex + u.x * 0.03, top + 0.006, -(ey + u.y * 0.03));
            nosingGeos.push(nose);
          }
        }
      } else {
        // escalator truss + balustrades
        const truss = boxAlong(v3({ ...lo, z: lo.z - 0.55 }), v3({ ...hi, z: hi.z - 0.55 }), r.width + 0.3, 0.9);
        steelGeos.push(truss);
        // animated steps
        const L3 = Math.hypot(L, dz);
        const stepLen = 0.4;
        const count = Math.ceil(L3 / stepLen);
        const stepGeo = track(new THREE.BoxGeometry(stepLen * 0.96, 0.06, r.width - 0.1));
        const steps = new THREE.InstancedMesh(stepGeo, mat.escStep, count);
        steps.name = `escalator-steps:${r.edgeId}`;
        steps.userData = { lo, hi, yaw, count, L3, stepLen };
        root.add(steps);
        escalators.push({ run: r, steps, speed: 0.5 * (r.travel === 0 ? 0 : (r.a.z <= r.b.z ? 1 : -1) * r.travel) });
        // entry/exit indicators: green arrow where you board, red bar where you must not
        const board = r.travel >= 0 ? r.a : r.b;
        const alight = r.travel >= 0 ? r.b : r.a;
        for (const [p, ok] of [
          [board, true],
          [alight, false],
        ] as const) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02), ok ? mat.gateOk : mat.flap);
          const into = p === lo ? -1 : 1;
          lamp.position.copy(v3({ x: p.x + u.x * 0.65 * into + n.x * (hw + 0.07), y: p.y + u.y * 0.65 * into + n.y * (hw + 0.07), z: p.z + 0.9 }));
          lamp.rotation.y = yaw + Math.PI / 2;
          track(lamp.geometry);
          root.add(lamp);
        }
      }
    }
    // Draw exactly the retained collision pieces: a cross-link opens both the visible
    // balustrade and its collider, including the handrail and escalator skirt.
    const runsById = new Map(layout.runs.map((r) => [r.edgeId, r]));
    for (const w of layout.runWalls) {
      const r = runsById.get(w.runEdgeId!)!;
      const d = { x: r.b.x - r.a.x, y: r.b.y - r.a.y };
      const l2 = d.x * d.x + d.y * d.y;
      const zAt = (p: XY) => r.a.z + (r.b.z - r.a.z) * ((p.x - r.a.x) * d.x + (p.y - r.a.y) * d.y) / l2;
      const za = zAt(w.a), zb = zAt(w.b);
      (r.mode === "stairs" ? sideGeos : balustradeGeos).push(enclosureWallGeometry(runPanel(w, r)));
      const a = v3({ ...w.a, z: za + 0.96 }), b = v3({ ...w.b, z: zb + 0.96 });
      if (r.mode === "stairs") {
        handGeos.push(cylAlong(a, b, 0.026));
      } else {
        rubberGeos.push(boxAlong(a, b, 0.09, 0.07));
        steelGeos.push(enclosureWallGeometry({ ...w, profile: { bottomA: za - 0.12, bottomB: zb - 0.12, topA: za + 0.22, topB: zb + 0.22 } }));
        steelGeos.push(boxAlong(v3({ ...w.a, z: za + 0.88 }), v3({ ...w.b, z: zb + 0.88 }), 0.025, 0.025));
      }
    }
    const add = (geos: THREE.BufferGeometry[], m: THREE.Material, name?: string) => {
      const geo = merged(geos);
      if (!geo) return;
      const mesh = new THREE.Mesh(track(geo), m);
      if (name) mesh.name = name;
      root.add(mesh);
    };
    add(stairGeos, mat.stair, "walkable");
    add(nosingGeos, mat.nosing);
    add(sideGeos, mat.wall);
    add(balustradeGeos, mat.glass);
    add(handGeos, mat.steel);
    add(rubberGeos, mat.rubber);
    add(steelGeos, mat.steel);
  }

  // ---- ticket gates (machines across the corridor; count/width is a visual simplification)
  {
    const bodyGeos: THREE.BufferGeometry[] = [];
    const topGeos: THREE.BufferGeometry[] = [];
    const icGeos: THREE.BufferGeometry[] = [];
    const okGeos: THREE.BufferGeometry[] = [];
    for (const gl of layout.gates) {
      const lv = layout.levels.reduce((best, l) => (Math.abs(l.z - gl.center.z) < Math.abs(best.z - gl.center.z) ? l : best));
      const perp = { x: -gl.dir.y, y: gl.dir.x };
      // extend to nearest walls on each side (max 6 m)
      const reach = (s: number) => {
        let best = 6;
        for (const w of lv.walls) {
          if (gl.center.z + 0.6 < w.zMin || gl.center.z + 0.6 > w.zMax) continue;
          const hit = raySeg(gl.center, { x: perp.x * s, y: perp.y * s }, w.a, w.b);
          if (hit !== null && hit < best) best = hit;
        }
        return best;
      };
      const left = reach(1);
      const right = reach(-1);
      const span = left + right;
      const n = Math.max(2, Math.min(10, Math.round(span / 0.92) + 1));
      const yaw = Math.atan2(gl.dir.y, gl.dir.x);
      for (let i = 0; i < n; i++) {
        const o = -right + (span * i) / (n - 1);
        const c = { x: gl.center.x + perp.x * o, y: gl.center.y + perp.y * o };
        const body = new THREE.BoxGeometry(1.5, 0.95, 0.2);
        body.rotateY(yaw);
        body.translate(c.x, gl.center.z + 0.475, -c.y);
        bodyGeos.push(body);
        const top = new THREE.BoxGeometry(1.52, 0.04, 0.22);
        top.rotateY(yaw);
        top.translate(c.x, gl.center.z + 0.97, -c.y);
        topGeos.push(top);
        for (const end of [-1, 1]) {
          const ic = new THREE.BoxGeometry(0.16, 0.012, 0.16);
          ic.rotateY(yaw);
          ic.translate(c.x + gl.dir.x * 0.55 * end, gl.center.z + 0.995, -(c.y + gl.dir.y * 0.55 * end));
          (end > 0 ? icGeos : okGeos).push(ic);
        }
        propWalls.push({ a: { x: c.x - gl.dir.x * 0.75, y: c.y - gl.dir.y * 0.75 }, b: { x: c.x + gl.dir.x * 0.75, y: c.y + gl.dir.y * 0.75 }, zMin: gl.center.z - 0.1, zMax: gl.center.z + 1.0, side: 1, kind: "wall", bodyMin: gl.center.z - 0.5 });
      }
    }
    for (const [geos, m] of [
      [bodyGeos, mat.gateBody],
      [topGeos, mat.gateTop],
      [icGeos, mat.gateIc],
      [okGeos, mat.gateOk],
    ] as const) {
      const geo = merged(geos);
      if (geo) root.add(new THREE.Mesh(track(geo), m));
    }
  }

  // ---- coverage portals at dataset dead-ends (honest boundary)
  {
    const degree = new Map<string, number>();
    for (const e of bundle.edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const portalTex = signTexture([{ icon: "nomap", ja: "この先 データ未収録", en: "Not mapped beyond this point", tone: "warn" }], 1024);
    track(portalTex.texture);
    const signMat = track(new THREE.MeshBasicMaterial({ map: portalTex.texture, side: THREE.DoubleSide, transparent: true }));
    for (const node of bundle.nodes) {
      if (degree.get(node.id) !== 1 || node.inOut !== "inside") continue;
      if (node.kind !== "junction" && node.kind !== "exit") continue;
      const e = bundle.edges.find((x) => x.from === node.id || x.to === node.id)!;
      const other = nodeById.get(e.from === node.id ? e.to : e.from)!;
      const d = { x: node.position.x - other.position.x, y: node.position.y - other.position.y };
      const L = Math.hypot(d.x, d.y) || 1;
      const u = { x: d.x / L, y: d.y / L };
      const z = layout.nodeZ.get(node.id) ?? 0;
      const c = { x: node.position.x + u.x * 1.2, y: node.position.y + u.y * 1.2 };
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(3.2, 2.6)), mat.portal);
      plane.position.copy(v3({ ...c, z: z + 1.3 }));
      plane.lookAt(v3({ x: c.x - u.x, y: c.y - u.y, z: z + 1.3 }));
      root.add(plane);
      const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(1.6, 1.6 / portalTex.aspect)), signMat);
      sign.position.copy(v3({ ...c, z: z + 2.0 }));
      sign.lookAt(v3({ x: c.x - u.x, y: c.y - u.y, z: z + 2.0 }));
      root.add(sign);
      propWalls.push({ a: { x: c.x + -u.y * 1.6, y: c.y + u.x * 1.6 }, b: { x: c.x - -u.y * 1.6, y: c.y - u.x * 1.6 }, zMin: z - 0.2, zMax: z + 2.6, side: 1, kind: "wall", bodyMin: z - 0.5 });
    }
  }

  // ---- street level around surface exits (minimal, non-authoritative)
  {
    const geos: THREE.BufferGeometry[] = [];
    for (const sp of layout.streetPads) {
      const c = sp.rings[0]!;
      const pad = new THREE.BoxGeometry(STREET_PAD, 0.2, STREET_PAD);
      pad.translate((c[0]!.x + c[2]!.x) / 2, sp.z - 0.1 - 0.01, -(c[0]!.y + c[2]!.y) / 2);
      geos.push(pad);
    }
    const geo = merged(geos);
    if (geo) {
      const m = new THREE.Mesh(track(geo), mat.sidewalk);
      m.name = "walkable";
      root.add(m);
    }
  }

  // ---- wayfinding signs from the verified graph
  const signs = buildSigns(bundle, layout, root, track);

  // ---- collision world
  const world = new WalkWorld(layout);
  world.addWalls(propWalls);

  // ---- platform edge helper
  function buildPlatformEdge(walls: WallSeg[], z: number, g: THREE.Group) {
    // Group trackside walls into platform edges by outward (track-facing) normal.
    type Grp = { out: XY; walls: WallSeg[]; len: number };
    const groups: Grp[] = [];
    for (const w of walls) {
      const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (L < 0.3) continue;
      const out = { x: ((w.b.y - w.a.y) / L) * w.side, y: (-(w.b.x - w.a.x) / L) * w.side };
      const grp = groups.find((q) => q.out.x * out.x + q.out.y * out.y > 0.7);
      if (grp) (grp.walls.push(w), (grp.len += L));
      else groups.push({ out, walls: [w], len: L });
    }
    const EXT = 200;
    groups
      .filter((grp) => grp.len > 20)
      .forEach((grp, gi) => {
        // The platform edge is curved: follow it with a smoothed polyline instead of a straight fit.
        const u0 = { x: -grp.out.y, y: grp.out.x };
        const o = grp.walls[0]!.a;
        const pts = grp.walls
          .flatMap((w) => [w.a, w.b])
          .map((p) => ({ p, s: (p.x - o.x) * u0.x + (p.y - o.y) * u0.y }))
          .sort((a, b) => a.s - b.s);
        const s0 = pts[0]!.s;
        const s1 = pts[pts.length - 1]!.s;
        const edge: XY[] = [];
        for (let si = s0; ; si += 4) {
          const ss = Math.min(si, s1);
          let ax = 0;
          let ay = 0;
          let n = 0;
          for (const q of pts)
            if (Math.abs(q.s - ss) < 3) (ax += q.p.x), (ay += q.p.y), n++;
          if (n) edge.push({ x: ax / n, y: ay / n });
          if (ss >= s1) break;
        }
        if (edge.length < 2) return;
        const dirAt = (a: XY, b: XY) => {
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
        };
        const t0 = dirAt(edge[0]!, edge[1]!);
        const tn = dirAt(edge[edge.length - 2]!, edge[edge.length - 1]!);
        const line = [{ x: edge[0]!.x - t0.x * EXT, y: edge[0]!.y - t0.y * EXT }, ...edge, { x: edge[edge.length - 1]!.x + tn.x * EXT, y: edge[edge.length - 1]!.y + tn.y * EXT }];
        const cum = [0];
        for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y));
        const total = cum[cum.length - 1]!;
        const platA = cum[1]!;
        const platB = cum[cum.length - 2]!;
        const sgn = (() => {
          const t = dirAt(line[0]!, line[1]!);
          return t.y * grp.out.x - t.x * grp.out.y > 0 ? 1 : -1;
        })();
        /** tangent at arc-length s (extrapolates beyond the ends) */
        const tangentAt = (s: number): XY => {
          let i = 1;
          while (i < line.length - 1 && cum[i]! < s) i++;
          return dirAt(line[i - 1]!, line[i]!);
        };
        /** point at arc-length s, offset `off` metres toward the track */
        const at = (s: number, off: number): XY => {
          let i = 1;
          while (i < line.length - 1 && cum[i]! < s) i++;
          const a = line[i - 1]!;
          const t = dirAt(a, line[i]!);
          const d = s - cum[i - 1]!;
          return { x: a.x + t.x * d + t.y * sgn * off, y: a.y + t.y * d - t.x * sgn * off };
        };
        const add = (geo: THREE.BufferGeometry | null, m: THREE.Material) => {
          if (!geo) return;
          g.add(new THREE.Mesh(track(geo), m));
        };
        const trackOff = 1.6;
        const bed: THREE.BufferGeometry[] = [];
        const rails: THREE.BufferGeometry[] = [];
        const tunnel: THREE.BufferGeometry[] = [];
        const lamps: THREE.BufferGeometry[] = [];
        const P = (xy: XY, zz: number) => v3({ ...xy, z: zz });
        for (let i = 1; i < line.length; i++) {
          const sa = cum[i - 1]!;
          const sb = cum[i]!;
          // overlap slightly so segment joints at kinks stay closed
          const ea = Math.max(0, sa - 0.15);
          const eb = Math.min(total, sb + 0.15);
          bed.push(boxAlong(P(at(ea, trackOff), z - 1.2), P(at(eb, trackOff), z - 1.2), 3.4, 0.1));
          for (const off of [trackOff - 0.72, trackOff + 0.72]) rails.push(boxAlong(P(at(ea, off), z - 1.08), P(at(eb, off), z - 1.08), 0.07, 0.14));
          // linear-motor reaction plate between the rails (small-profile linear-motor metro)
          rails.push(boxAlong(P(at(ea, trackOff), z - 1.11), P(at(eb, trackOff), z - 1.11), 0.32, 0.03));
          tunnel.push(wallQuad(at(sa, trackOff + 1.75), at(sb, trackOff + 1.75), z - 1.25, z + 3.9));
          tunnel.push(slabGeometry([[at(sa, 0), at(sb, 0), at(sb, trackOff + 1.8), at(sa, trackOff + 1.8)]], z + 3.9, 4, true));
          // beyond the platform the near side is tunnel wall too
          if (i === 1 || i === line.length - 1) tunnel.push(wallQuad(at(sa, 0.02), at(sb, 0.02), z - 1.25, z + 3.9));
        }
        for (let s = 0; s < total; s += 0.9) bed.push(boxAlong(P(at(s, trackOff - 1.1), z - 1.13), P(at(s, trackOff + 1.1), z - 1.13), 0.22, 0.05));
        for (let s = 6; s < total; s += 12) {
          if (s > platA - 2 && s < platB + 2) continue;
          const p = at(s, trackOff + 1.7);
          const b = new THREE.BoxGeometry(0.3, 0.12, 0.1);
          b.translate(p.x, z + 2.6, -p.y);
          lamps.push(b);
        }
        add(merged(bed), mat.trackBed);
        add(merged(rails), mat.rail);
        add(merged(tunnel), mat.tunnel);
        add(merged(lamps), mat.light);

        // Platform screen doors: 5.6 m modules (fixed panel + bi-parting leaves). Generic simplified design.
        const panels: THREE.BufferGeometry[] = [];
        const caps: THREE.BufferGeometry[] = [];
        const leaves: { s: number; dir: number }[] = [];
        const module = 5.6;
        const doorW = 2.4;
        for (let s = platA + 0.3; s + module <= platB + 0.01; s += module) {
          const p1 = s + module - doorW;
          panels.push(boxAlong(P(at(s, 0.06), z + 0.65), P(at(p1, 0.06), z + 0.65), 0.16, 1.3));
          caps.push(boxAlong(P(at(s, 0.06), z + 1.31), P(at(p1, 0.06), z + 1.31), 0.2, 0.04));
          leaves.push({ s: p1 + doorW * 0.25, dir: -1 }, { s: p1 + doorW * 0.75, dir: 1 });
          propWalls.push({ a: at(s, 0.02), b: at(s + module, 0.02), zMin: z - 0.1, zMax: z + 1.35, side: 1, kind: "wall", bodyMin: z - 0.5 });
        }
        add(merged(panels), mat.psd);
        add(merged(caps), mat.accent);
        const leafMesh = new THREE.InstancedMesh(track(new THREE.BoxGeometry(doorW / 2 - 0.04, 1.2, 0.06)), mat.psdLeaf, Math.max(1, leaves.length));
        leafMesh.count = leaves.length;
        g.add(leafMesh);

        // Train: 8 small-profile cars (generic original design; line-colour accent only).
        const cars = buildTrain(8);
        for (const c of cars) g.add(c);
        platformTracks.push({ at, tangentAt, z, trackOff, stopS: (platA + platB) / 2, dirSign: gi % 2 === 0 ? 1 : -1, cars, leafMesh, leaves, phase: gi * 55, far: EXT + 60 });
      });
  }

  function buildTrain(n: number) {
    const train: THREE.Group[] = [];
    const carLen = 16.3;
    const shape = new THREE.Shape();
    const w = 2.48;
    const h = 3.05;
    const r = 0.45;
    shape.moveTo(-w / 2, 0.25);
    shape.lineTo(w / 2, 0.25);
    shape.lineTo(w / 2, h - r);
    shape.quadraticCurveTo(w / 2, h, w / 2 - r, h);
    shape.lineTo(-w / 2 + r, h);
    shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
    shape.closePath();
    const body = track(new THREE.ExtrudeGeometry(shape, { depth: carLen, bevelEnabled: false, curveSegments: 6 }));
    body.translate(0, 0, -carLen / 2);
    const windowBand = track(new THREE.BoxGeometry(w + 0.02, 0.85, carLen - 1.2));
    windowBand.translate(0, 1.75, 0);
    const stripe = track(new THREE.BoxGeometry(w + 0.03, 0.12, carLen - 0.4));
    stripe.translate(0, 1.18, 0);
    const doorGeo = track(merged([-5.2, 0, 5.2].map((z) => new THREE.BoxGeometry(w + 0.025, 1.85, 1.3).translate(0, 1.18, z)))!);
    const skirt = track(new THREE.BoxGeometry(w - 0.1, 0.45, carLen - 0.6));
    skirt.translate(0, 0.2, 0);
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      car.add(new THREE.Mesh(body, mat.trainBody));
      car.add(new THREE.Mesh(windowBand, mat.trainWindow));
      car.add(new THREE.Mesh(stripe, mat.accent));
      car.add(new THREE.Mesh(skirt, mat.darkSteel));
      car.add(new THREE.Mesh(doorGeo, mat.trainDoor));
      car.visible = false;
      train.push(car);
    }
    return train;
  }
  // ---- animation
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const tmpP = new THREE.Vector3();
  const tmpE = new THREE.Euler();
  /** Train cycle (s): 0–14 arrive (decelerate), 14–40 dwell (doors 16–37), 40–54 depart, 54–110 empty. */
  const CYCLE = 110;
  let trainClock = 0;
  /** QA: phase of each platform's train cycle (s) and whether a train is in. */
  const trainStatus = () => platformTracks.map((tr) => {
    const tt = (trainClock + tr.phase) % CYCLE;
    return { tt: Math.round(tt), present: trainS(tt, tr) !== null, doorsOpen: tt > 16 && tt < 37 };
  });
  function trainS(tt: number, tr: (typeof platformTracks)[number]) {
    if (tt < 14) return tr.stopS - tr.dirSign * tr.far * (1 - tt / 14) ** 2; // decelerate in
    if (tt < 40) return tr.stopS;
    if (tt < 54) return tr.stopS + tr.dirSign * tr.far * ((tt - 40) / 14) ** 2; // accelerate out
    return null;
  }
  function update(_dt: number, t: number) {
    trainClock = t;
    for (const tr of platformTracks) {
      const tt = (t + tr.phase) % CYCLE;
      const s = trainS(tt, tr);
      const n = tr.cars.length;
      tr.cars.forEach((car, i) => {
        car.visible = s !== null;
        if (s === null) return;
        const sc = s + (i - (n - 1) / 2) * 16.6;
        const p = tr.at(sc, tr.trackOff);
        const tg = tr.tangentAt(sc);
        car.position.set(p.x, tr.z - 1.1, -p.y);
        car.rotation.y = Math.atan2(tg.x, -tg.y);
      });
      const open = tt > 16 && tt < 37 ? Math.min(1, (tt - 16) / 2, (37 - tt) / 2) : 0;
      tr.leaves.forEach((lf, i) => {
        const ls = lf.s + lf.dir * open * 1.1;
        const p = tr.at(ls, 0.17);
        const tg = tr.tangentAt(ls);
        tmpP.set(p.x, tr.z + 0.62, -p.y);
        tmpQ.setFromEuler(tmpE.set(0, Math.atan2(tg.y, tg.x), 0));
        tmpM.compose(tmpP, tmpQ, tmpS);
        tr.leafMesh.setMatrixAt(i, tmpM);
      });
      tr.leafMesh.instanceMatrix.needsUpdate = true;
    }
    for (const esc of escalators) {
      const { lo, hi, yaw, count, L3, stepLen } = esc.steps.userData as { lo: XYZ; hi: XYZ; yaw: number; count: number; L3: number; stepLen: number };
      const pitch = Math.atan2(hi.z - lo.z, Math.hypot(hi.x - lo.x, hi.y - lo.y));
      tmpQ.setFromEuler(new THREE.Euler(0, yaw, pitch, "YXZ"));
      const phase = (((t * esc.speed) % stepLen) + stepLen) % stepLen;
      for (let i = 0; i < count; i++) {
        let s = i * stepLen + phase;
        if (s > L3) s -= L3;
        const f = s / L3;
        tmpP.set(lo.x + (hi.x - lo.x) * f, lo.z + (hi.z - lo.z) * f - 0.03, -(lo.y + (hi.y - lo.y) * f));
        tmpM.compose(tmpP, tmpQ, tmpS);
        esc.steps.setMatrixAt(i, tmpM);
      }
      esc.steps.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0);

  return {
    root,
    layout,
    world,
    propWalls,
    escalators,
    signs,
    levelGroups,
    update,
    trainStatus,
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose(); // frees instance buffers
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    },
  };
}

/** Instanced linear luminaires follow both the corridor axes and the roof pitch of each run. */
function buildUndergroundLighting(
  bundle: StationBundle,
  layout: Layout,
  groups: Map<string, THREE.Group>,
  root: THREE.Group,
  track: <T extends { dispose(): void }>(x: T) => T,
) {
  type Fixture = { a: XYZ; b: XYZ };
  const batches = new Map<string, Fixture[]>();
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const roofs = [...layout.levels.flatMap((lv) => lv.ceilings.map((s) => ({ ...s, floorId: lv.floorId }))), ...layout.soffits];
  const ceilingAt = (p: XYZ) => {
    let best: { z: number; floorId: string } | null = null;
    for (const s of roofs) {
      const z = soffitHeight(s, p);
      if (z < p.z + 2.5 || z > p.z + 4.2 || (best && best.z <= z) || !pointInRings(p, s.rings)) continue;
      best = { z, floorId: s.floorId };
    }
    return best;
  };
  const seen = new Set<string>();
  for (const e of bundle.edges) {
    if (e.mode === "elevator") continue;
    const a = nodes.get(e.from)!, b = nodes.get(e.to)!;
    const za = layout.nodeZ.get(a.id) ?? 0, zb = layout.nodeZ.get(b.id) ?? 0;
    if (Math.min(za, zb) >= -0.5) continue;
    const length = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    const count = Math.floor(length / 3.2);
    for (let i = 0; i < count; i++) {
      const t0 = (i + 0.18) / count, t1 = (i + 0.82) / count;
      const at = (t: number): XYZ => ({ x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t, z: za + (zb - za) * t });
      const p = at(t0), q = at(t1), m = at((t0 + t1) / 2);
      const rp = ceilingAt(p), rq = ceilingAt(q), rm = ceilingAt(m);
      if (!rp || !rq || !rm || Math.abs(rm.z - (rp.z + rq.z) / 2) > 0.15) continue;
      // Undirected duplicate links must not double the fixtures.
      const key = `${m.x.toFixed(1)},${m.y.toFixed(1)},${rm.z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fixtures = batches.get(rm.floorId) ?? [];
      fixtures.push({ a: { ...p, z: rp.z - 0.065 }, b: { ...q, z: rq.z - 0.065 } });
      batches.set(rm.floorId, fixtures);
    }
  }
  const fixtures = [...batches].flatMap(([floorId, entries]) => {
    const lv = layout.levels.find((l) => l.floorId === floorId)!;
    const color = new THREE.Color(lv.label === "B1" || lv.label === "B5" ? "#fff0d3" : "#e7f4ff").multiplyScalar(1.7);
    return entries.map((entry) => ({ ...entry, color }));
  });
  if (fixtures.length) {
    const strip = new THREE.BoxGeometry(0.16, 0.035, 1);
    const casing = new THREE.BoxGeometry(0.25, 0.045, 1.04).translate(0, 0.035, 0);
    for (const [geo, color] of [[strip, new THREE.Color("#ffffff")], [casing, new THREE.Color("#4d5358")]] as const) {
      const colors = new Float32Array(geo.attributes.position!.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    // One repeatable luminaire (recessed painted casing + HDR diffuser), one draw. Both
    // vertex colour and instance colour survive so levels keep their warm/cool variation.
    const box = track(mergeGeometries([strip, casing], false)!);
    strip.dispose();
    casing.dispose();
    const material = track(new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true }));
    const strips = new THREE.InstancedMesh(box, material, fixtures.length);
    strips.name = "linear-light:underground";
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), center = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const [i, f] of fixtures.entries()) {
      const a = v3(f.a), b = v3(f.b), d = b.clone().sub(a);
      rotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
      center.copy(a).add(b).multiplyScalar(0.5);
      scale.set(1, 1, d.length());
      matrix.compose(center, rotation, scale);
      strips.setMatrixAt(i, matrix);
      strips.setColorAt(i, f.color);
    }
    strips.computeBoundingSphere();
    root.add(strips);
  }

  // Bounded, non-shadowing local fill: three gate clusters plus one head/hall anchor per
  // underground level. Most of the perceived illumination remains emissive fixtures + IBL.
  const anchors: XYZ[] = [];
  for (const g of layout.gates) {
    if (g.center.z >= -0.5 || anchors.some((p) => Math.abs(p.z - g.center.z) < 1 && Math.hypot(p.x - g.center.x, p.y - g.center.y) < 12)) continue;
    anchors.push(g.center);
  }
  for (const lv of layout.levels.filter((l) => l.z < -0.5)) {
    const candidates = bundle.nodes.filter((n) => n.floorId === lv.floorId && n.inOut === "inside" && n.kind !== "elevator" && Math.abs((layout.nodeZ.get(n.id) ?? 0) - lv.z) < 0.1);
    const junctions = candidates.filter((n) => bundle.edges.filter((e) => e.from === n.id || e.to === n.id).length >= 3);
    const sameLevel = anchors.filter((p) => Math.abs(p.z - lv.z) < 0.3);
    const score = (n: (typeof candidates)[number]) => sameLevel.length ? Math.min(...sameLevel.map((p) => Math.hypot(p.x - n.position.x, p.y - n.position.y))) : 0;
    const n = (junctions.length ? junctions : candidates).sort((a, b) => score(b) - score(a))[0];
    if (n) anchors.push({ ...n.position, z: lv.z });
  }
  for (const p of anchors.slice(0, 8)) {
    const roof = ceilingAt(p);
    if (!roof) continue;
    const lv = layout.levels.find((l) => l.floorId === roof.floorId)!;
    const light = new THREE.PointLight(lv.label === "B1" || lv.label === "B5" ? "#fff0dc" : "#e0efff", 3.5, 12, 2);
    light.position.copy(v3({ ...p, z: roof.z - 0.22 }));
    light.castShadow = false;
    groups.get(lv.floorId)!.add(light);
    track(light);
  }
}

/** Distance along ray (origin o, unit dir d) to segment ab, or null. */
function raySeg(o: XY, d: XY, a: XY, b: XY): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const s = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return t > 0.05 && s >= 0 && s <= 1 ? t : null;
}

// ---------------------------------------------------------------- signs
function buildSigns(bundle: StationBundle, layout: Layout, root: THREE.Group, track: <T extends { dispose(): void }>(x: T) => T): THREE.Object3D[] {
  const router = createRouter(bundle);
  const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of bundle.edges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const exits = bundle.pois.filter((p) => p.category === "exit").flatMap((p) => p.connectorNodeIds);
  const platform = bundle.pois.find((p) => p.category === "platform")?.connectorNodeIds ?? [];
  const gates = bundle.pois.filter((p) => p.category === "ticket_gate").flatMap((p) => p.connectorNodeIds);
  const elevs = bundle.edges.filter((e) => e.mode === "elevator").flatMap((e) => [e.from, e.to]);

  const out: THREE.Object3D[] = [];
  const placed: XYZ[] = [];
  const candidates = bundle.nodes.filter((n) => (adj.get(n.id)?.length ?? 0) >= 3 && n.inOut === "inside" && n.kind !== "elevator");
  // prefer nodes with more connections
  candidates.sort((a, b) => (adj.get(b.id)!.length - adj.get(a.id)!.length) || a.id.localeCompare(b.id));
  for (const n of candidates) {
    const z = layout.nodeZ.get(n.id) ?? 0;
    const lv = layout.levels.find((l) => Math.abs(l.z - z) < 0.3);
    if (!lv) continue;
    if (placed.some((p) => Math.abs(p.z - z) < 1 && Math.hypot(p.x - n.position.x, p.y - n.position.y) < 14)) continue;
    // main corridor axis = longest incident walk edge
    const inc = bundle.edges.filter((e) => (e.from === n.id || e.to === n.id) && (e.mode === "walk" || e.mode === "gate"));
    if (!inc.length) continue;
    let axis = { x: 1, y: 0 };
    let best = -1;
    for (const e of inc) {
      const o = nodeById.get(e.from === n.id ? e.to : e.from)!.position;
      const L = Math.hypot(o.x - n.position.x, o.y - n.position.y);
      if (L > best) (best = L), (axis = { x: (o.x - n.position.x) / L, y: (o.y - n.position.y) / L });
    }
    const isPaid = inc.some((e) => e.paid === true);
    type Row = { target: string[]; icon: SignIcon; ja: string; en: string; tone: "exit" | "dark" | "line" };
    const rows: Row[] = [];
    if (exits.length) rows.push({ target: exits, icon: "exit", ja: "出口", en: "Exit", tone: "exit" });
    if (isPaid && platform.length) rows.push({ target: platform, icon: "train", ja: "大江戸線 のりば", en: "Oedo Line Platform", tone: "line" });
    if (!isPaid && gates.length) rows.push({ target: gates, icon: "gate", ja: "改札", en: "Ticket Gates", tone: "dark" });
    if (elevs.length && rows.length < 3) rows.push({ target: elevs, icon: "elevator", ja: "エレベーター", en: "Elevator", tone: "dark" });
    const dirs = rows.map((r) => {
      const res = router.route(n.id, r.target, { fare: "ticketed", stepFree: false });
      if (!res.ok) return null;
      // initial direction of the route: towards the first route node ≥ 2 m along it (a chord across
      // later turns would point the wrong way at the sign)
      let acc = 0;
      let p = n.position;
      let prev = n.position;
      for (const id of res.nodeIds.slice(1)) {
        const q = nodeById.get(id)!.position;
        acc += Math.hypot(q.x - prev.x, q.y - prev.y);
        prev = q;
        p = q;
        if (acc >= 2) break;
      }
      const d = { x: p.x - n.position.x, y: p.y - n.position.y };
      const L = Math.hypot(d.x, d.y);
      return L < 0.5 ? null : { x: d.x / L, y: d.y / L };
    });
    const valid = rows.map((r, i) => ({ r, d: dirs[i] })).filter((x) => x.d);
    if (!valid.length) continue;
    const makeFace = (facing: XY) =>
      valid.map(({ r, d }) => {
        const cross = facing.x * d!.y - facing.y * d!.x;
        const dot = facing.x * d!.x + facing.y * d!.y;
        const ang = Math.atan2(cross, dot); // + = left
        const arrow = Math.abs(ang) < 0.6 ? "up" : Math.abs(ang) > 2.5 ? "down" : ang > 0 ? (ang < 1.2 ? "upLeft" : "left") : ang > -1.2 ? "upRight" : "right";
        return { arrow: arrow as "up", icon: r.icon, ja: r.ja, en: r.en, tone: r.tone };
      });
    const group = new THREE.Group();
    const center = { x: n.position.x, y: n.position.y, z: lv.ceilingZ - 0.55 };
    for (const facing of [axis, { x: -axis.x, y: -axis.y }]) {
      const { texture, aspect } = signTexture(makeFace({ x: -facing.x, y: -facing.y }));
      track(texture);
      const w = 1.9;
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(w, w / aspect)), track(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: "#ffffff", emissiveIntensity: 0.55, roughness: 0.5 })));
      // plane faces +facing (viewer looks along -facing towards it)
      plane.position.copy(v3({ x: center.x + facing.x * 0.04, y: center.y + facing.y * 0.04, z: center.z }));
      plane.lookAt(v3({ x: center.x + facing.x, y: center.y + facing.y, z: center.z }));
      group.add(plane);
    }
    const box = new THREE.Mesh(track(new THREE.BoxGeometry(1.96, (1.9 / 8) * valid.length + 0.06, 0.07)), track(new THREE.MeshStandardMaterial({ color: "#2b2d30", roughness: 0.5, metalness: 0.4 })));
    box.position.copy(v3(center));
    box.rotation.y = Math.atan2(axis.y, axis.x) + Math.PI / 2;
    group.add(box);
    for (const s of [-0.7, 0.7]) {
      const rod = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 6)), track(new THREE.MeshStandardMaterial({ color: "#888", metalness: 0.8, roughness: 0.3 })));
      const off = { x: -axis.y * s, y: axis.x * s };
      rod.position.copy(v3({ x: center.x + off.x, y: center.y + off.y, z: center.z + 0.45 }));
      group.add(rod);
    }
    group.userData = { nodeId: n.id, generated: "GTEki wayfinding from verified graph (not operator signage)" };
    root.add(group);
    out.push(group);
    placed.push({ x: n.position.x, y: n.position.y, z });
  }
  // keep centroid helper referenced for tree-shaking clarity
  void centroid;
  return out;
}
