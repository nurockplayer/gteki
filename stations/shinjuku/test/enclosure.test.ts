import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, clearSoffit, cutWallsByVoids, pointInRings, soffitHeight, type Plan, type SlabPoly, type Soffit, type WallSeg, type XYZ } from "../scene/layout.ts";
import { buildStation, cladWallGeometry, coalesceWallPanels, soffitGeometry, type BuiltStation } from "../scene/build.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as unknown as Plan);
const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
const distance = (a: XYZ, b: XYZ) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** Source edge polylines, including elevator shafts; no reliance on rounded lengthM. */
function edgeSamples(): { edge: string; p: XYZ }[] {
  return bundle.edges.flatMap((e) => {
    const za = layout.nodeZ.get(e.from)!, zb = layout.nodeZ.get(e.to)!;
    const points = e.geometry?.length ? e.geometry : [nodes.get(e.from)!.position, nodes.get(e.to)!.position];
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    const total = lengths.reduce((a, b) => a + b, 0);
    let acc = 0;
    const samples: { edge: string; p: XYZ }[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, length = lengths[i - 1]!;
      const z0 = za + (zb - za) * (total ? acc / total : 0);
      acc += length;
      const z1 = za + (zb - za) * (total ? acc / total : 1);
      const count = Math.max(1, Math.ceil(distance({ ...a, z: z0 }, { ...b, z: z1 }) / 0.25));
      for (let j = 0; j <= count; j++) {
        const t = j / count;
        samples.push({ edge: e.id, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: z0 + (z1 - z0) * t } });
      }
    }
    return samples;
  });
}

describe("underground enclosure", () => {
  it("keeps ceilings and soffits clear of the 2.1 m head band along every edge at <= 0.25 m intervals", () => {
    const roofs = [...layout.levels.filter((lv) => lv.z < -0.5).flatMap((lv) => lv.ceilings), ...layout.soffits].map((s) => {
      const pts = s.rings.flat();
      return { s, minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
    });
    const bad: string[] = [];
    const offsets = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.21, 0.21], [-0.21, 0.21], [0.21, -0.21], [-0.21, -0.21]];
    for (const { edge, p } of edgeSamples()) for (const [dx, dy] of offsets) {
      const q = { x: p.x + dx!, y: p.y + dy! };
      for (const { s, minX, maxX, minY, maxY } of roofs) {
        if (q.x < minX || q.x > maxX || q.y < minY || q.y > maxY) continue;
        const clear = soffitHeight(s, q) - p.z;
        if (clear > 0.025 && clear < 2.1 && pointInRings(q, s.rings)) bad.push(`${edge}: ${s.spaceId} clearance ${clear.toFixed(3)}`);
      }
    }
    expect(bad.slice(0, 30)).toEqual([]);
  });

  it("keeps every new body-height wall outside the swept walker on every graph edge", () => {
    const walls = layout.levels.flatMap((lv) => lv.walls.filter((w) => w.finish));
    expect(walls.length).toBeGreaterThan(0);
    const cells = new Map<string, typeof walls>();
    for (const w of walls) {
      for (let x = Math.floor((Math.min(w.a.x, w.b.x) - 0.31) / 2); x <= Math.floor((Math.max(w.a.x, w.b.x) + 0.31) / 2); x++)
        for (let y = Math.floor((Math.min(w.a.y, w.b.y) - 0.31) / 2); y <= Math.floor((Math.max(w.a.y, w.b.y) + 0.31) / 2); y++) {
          const key = `${x},${y}`;
          cells.set(key, [...(cells.get(key) ?? []), w]);
        }
    }
    const bad: string[] = [];
    for (const { edge, p } of edgeSamples()) for (const w of cells.get(`${Math.floor(p.x / 2)},${Math.floor(p.y / 2)}`) ?? []) {
      if (p.z + 1.7 < w.zMin || p.z + 0.3 > w.zMax) continue;
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(p.x - w.a.x - dx * t, p.y - w.a.y - dy * t) < 0.31) bad.push(`${edge}: ${w.finish}`);
    }
    expect(bad.slice(0, 30)).toEqual([]);
  });

  it("covers deep walking paths except required openings into street approach shafts", () => {
    const roofs = [...layout.levels.flatMap((lv) => lv.ceilings), ...layout.soffits];
    const elevators = new Set(bundle.edges.filter((e) => e.mode === "elevator").map((e) => e.id));
    const misses: string[] = [];
    for (const { edge, p } of edgeSamples()) {
      if (p.z > -4 || elevators.has(edge)) continue;
      // A source switchback can lie above a B1 route. Where that upper flight's head band
      // reaches street level, an underground lid would obstruct it. This is the explicit
      // surface handoff, not a missing roof in a deep shaft; W2 supplies the street context.
      const opensToStreet = layout.runs.some((r) => {
        const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, l2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((p.x - r.a.x) * dx + (p.y - r.a.y) * dy) / l2));
        return r.a.z + (r.b.z - r.a.z) * t + 2.4 > -0.5 && Math.hypot(p.x - r.a.x - dx * t, p.y - r.a.y - dy * t) < r.width / 2 + 0.6;
      });
      if (opensToStreet) continue;
      if (!roofs.some((s) => soffitHeight(s, p) > p.z + 2.1 && pointInRings(p, s.rings))) misses.push(`${edge}: (${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)})`);
    }
    expect(misses.slice(0, 20)).toEqual([]);
  });

  it("closes the visible side slots below both edges of every deep escalator", () => {
    const inverts = layout.soffits.filter((s) => s.spaceId.startsWith("shaft-invert:"));
    const runs = layout.runs.filter((r) => r.mode === "escalator" && Math.max(r.a.z, r.b.z) < -0.5);
    expect(runs.length).toBeGreaterThan(10);
    for (const r of runs) for (const side of [-1, 1]) {
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, length = Math.hypot(dx, dy);
      const offset = side * (r.width / 2 + 0.1);
      const p = { x: (r.a.x + r.b.x) / 2 - dy / length * offset, y: (r.a.y + r.b.y) / 2 + dx / length * offset };
      const floor = (r.a.z + r.b.z) / 2;
      expect(inverts.some((s) => pointInRings(p, s.rings) && soffitHeight(s, p) <= floor - 0.18), r.edgeId).toBe(true);
    }
  });

  it("roofs near-street stair landings through the street slab underside", () => {
    // These symbolic landings are too high for the old z + 3.2 < -0.5 sleeve rule,
    // but still need a roof before handing the ascending flight to its street canopy.
    const landings = bundle.nodes.filter((n) => {
      const z = layout.nodeZ.get(n.id)!;
      return z > -3.7 && z < -2.6 && n.kind !== "elevator";
    });
    expect(landings.length).toBeGreaterThan(0);
    for (const n of landings) for (const dx of [-0.3, 0, 0.3]) for (const dy of [-0.3, 0, 0.3]) {
      const p = { x: n.position.x + dx, y: n.position.y + dy };
      const roofs = layout.soffits.filter((s) => s.kind !== "slab" && pointInRings(p, s.rings));
      expect(roofs.some((s) => soffitHeight(s, p) >= layout.nodeZ.get(n.id)! + 2.1 && soffitHeight(s, p) <= -0.18 + 0.001), n.id).toBe(true);
    }
    expect(layout.levels.flatMap((lv) => lv.walls).some((w) => w.finish === "shaft" && Math.abs(w.zMax + 0.18) < 1e-6)).toBe(true);
  });

  it("caps the complete clearance opening above the B1 elevator hall", () => {
    const node = nodes.get("n:cbaeded02c114348a1bd8d0c0590584c")!;
    for (const dx of [-0.5, 0, 0.5]) for (const dy of [-0.5, 0, 0.5]) {
      const p = { x: node.position.x + dx, y: node.position.y + dy };
      const cap = layout.soffits.find((s) => s.spaceId.startsWith("elevator-cap:") && pointInRings(p, s.rings));
      expect(cap).toBeDefined();
      expect(soffitHeight(cap!, p) - layout.nodeZ.get(node.id)!).toBeGreaterThanOrEqual(2.3);
    }
  });

  it("opens ceilings across the full tread width of every run", () => {
    const roofs = [...layout.levels.filter((lv) => lv.z < -0.5).flatMap((lv) => lv.ceilings), ...layout.soffits];
    const bad: string[] = [];
    for (const r of layout.runs) {
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, length = Math.hypot(dx, dy);
      const count = Math.ceil(Math.hypot(length, r.b.z - r.a.z) / 0.25);
      for (let i = 0; i <= count; i++) for (const side of [-1, 1]) {
        const t = i / count, off = (r.width / 2 - 0.05) * side;
        const p = { x: r.a.x + dx * t - dy / length * off, y: r.a.y + dy * t + dx / length * off, z: r.a.z + (r.b.z - r.a.z) * t };
        for (const s of roofs) {
          const clear = soffitHeight(s, p) - p.z;
          if (clear > 0.025 && clear < 2.1 && pointInRings(p, s.rings)) bad.push(`${r.edgeId}: ${s.spaceId}`);
        }
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("adds pitched roofs for deep runs and finishes below the street slab", () => {
    const shafts = layout.soffits.filter((s) => s.kind === "shaft");
    expect(shafts.length).toBeGreaterThan(10);
    expect(layout.soffits.some((s) => s.kind === "landing")).toBe(true);
    expect(layout.soffits.some((s) => s.kind === "slab")).toBe(true);
    for (const s of layout.soffits.filter((s) => !s.spaceId.startsWith("elevator-cap:"))) for (const p of s.rings.flat()) expect(soffitHeight(s, p)).toBeLessThanOrEqual(-0.18 + 0.001);
    // The lift to street has a concealed hood above its highest (street) landing.
    for (const s of layout.soffits.filter((s) => s.spaceId.startsWith("elevator-cap:"))) expect(s.z).toBeLessThanOrEqual(2.6);
    for (const lv of layout.levels) for (const w of lv.walls.filter((w) => w.finish)) expect(w.zMax).toBeLessThanOrEqual(-0.18);
  });

  it("preserves a finished underside below the walker's own floor", () => {
    const s: SlabPoly = { spaceId: "floor-underside", z: -0.18, fare: null, category: "floor", rings: [[{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]] };
    expect(clearSoffit(s, [{ a: { x: -1, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }])).toEqual([s]);
  });

  it("cuts across a pitched roof for a crossing path, including a walker's radius", () => {
    const s: Soffit = { spaceId: "slope", floorId: "test", kind: "shaft", z: 3, origin: { x: 0, y: 0 }, slope: { x: 0.6, y: 0 }, fare: null, category: "ceiling", rings: [[{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }]] };
    const parts = clearSoffit(s, [{ a: { x: -3, y: 0, z: 1 }, b: { x: 3, y: 0, z: 1 } }]);
    expect(parts.some((s) => pointInRings({ x: 0, y: 0.3 }, s.rings))).toBe(false);
    expect(parts.some((s) => pointInRings({ x: 3.5, y: 3 }, s.rings))).toBe(true);
  });

  it("carves vertical elevator openings as an area instead of a zero-length rectangle", () => {
    const s: SlabPoly = { spaceId: "lift", z: 3, fare: null, category: "ceiling", rings: [[{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]] };
    const parts = clearSoffit(s, [{ a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 8 } }]);
    expect(parts.some((s) => pointInRings({ x: 0.3, y: 0.3 }, s.rings))).toBe(false);
    expect(parts.some((s) => pointInRings({ x: 1.5, y: 1.5 }, s.rings))).toBe(true);
  });

  it("renders the tested affine underside with downward normals and metric height", () => {
    const s: Soffit = { spaceId: "render", floorId: "test", kind: "shaft", z: -8, slope: { x: 0.5, y: 0.25 }, fare: null, category: "ceiling", rings: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]] };
    const geo = soffitGeometry(s);
    const pos = geo.attributes.position!, normal = geo.attributes.normal!;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(soffitHeight(s, { x: pos.getX(i), y: -pos.getZ(i) }), 5);
      expect(normal.getY(i)).toBeLessThan(0);
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const hits = new THREE.Raycaster(new THREE.Vector3(2, -10, -2), new THREE.Vector3(0, 1, 0)).intersectObject(mesh);
    expect(hits[0]!.point.y).toBeCloseTo(-6.5);
    geo.dispose();
    (mesh.material as THREE.Material).dispose();
  });

  it("preserves the pitched wall's UV datum when a crossing shaft splits its panels", () => {
    const wall: WallSeg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, zMin: 0, zMax: 8, side: 1, kind: "wall",
      profile: { bottomA: 0, bottomB: 5, topA: 3, topB: 8 }, surfaceBase: { a: 0, b: 5 } };
    const cut = cutWallsByVoids([wall], [{ rings: [[{ x: 3, y: -1 }, { x: 7, y: -1 }, { x: 7, y: 1 }, { x: 3, y: 1 }]], bottom: () => -1, top: () => 10 }]);
    expect(cut).toHaveLength(2);
    expect(cut.map((w) => [w.a.x, w.b.x, w.surfaceBase!.a, w.surfaceBase!.b])).toEqual([[0, 3, 0, 1.5], [7, 10, 3.5, 5]]);
    const untouched = cutWallsByVoids([wall], [{ rings: [[{ x: 3, y: 2 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 3, y: 3 }]], bottom: () => -1, top: () => 10 }]);
    expect(untouched).toEqual([wall]);
  });

  it("preserves the wall below a pitched void until the void actually reaches it", () => {
    const wall: WallSeg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, zMin: 0, zMax: 3, side: 1, kind: "wall" };
    const pieces = cutWallsByVoids([wall], [{ rings: [[{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 1 }, { x: -1, y: 1 }]], bottom: () => -1, top: (p) => p.x - 5 }]);
    // At x=2 the void is below the floor. At x=6 it removes only z <= 1.
    for (const [x, low] of [[2, 0], [6, 1]]) {
      const panel = pieces.find((w) => w.a.x <= x! && w.b.x >= x!)!;
      const t = (x! - panel.a.x) / (panel.b.x - panel.a.x);
      const bottom = panel.profile ? panel.profile.bottomA + (panel.profile.bottomB - panel.profile.bottomA) * t : panel.zMin;
      expect(bottom).toBeCloseTo(low!, 5);
    }
  });

  it("never leaves an inverted wedge when a shaft roof crosses a flat wall's top", () => {
    const wall: WallSeg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, zMin: 0, zMax: 3, side: 1, kind: "wall" };
    const cut = cutWallsByVoids([wall], [{ rings: [[{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 1 }, { x: -1, y: 1 }]], bottom: () => -1, top: (p) => p.x * 0.5 }]);
    expect(cut.length).toBeGreaterThan(0);
    for (const w of cut) {
      expect(w.profile!.topA).toBeGreaterThan(w.profile!.bottomA);
      expect(w.profile!.topB).toBeGreaterThan(w.profile!.bottomB);
    }
    expect(Math.max(...cut.map((w) => w.b.x))).toBeLessThan(6.01);
  });

  it("joins render panels without changing collision bands or bridging wall openings", () => {
    const walls: WallSeg[] = Array.from({ length: 4 }, (_, i) => ({
      a: { x: i, y: 0 }, b: { x: i + 1, y: 0 }, zMin: i / 2, zMax: (i + 1) / 2 + 3,
      side: 1, kind: "wall", finish: "shaft",
      profile: { bottomA: i / 2, bottomB: (i + 1) / 2, topA: i / 2 + 3, topB: (i + 1) / 2 + 3 },
      surfaceBase: { a: i / 2, b: (i + 1) / 2 },
    }));
    const original = structuredClone(walls);
    const joined = coalesceWallPanels(walls);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.profile).toEqual({ bottomA: 0, bottomB: 2, topA: 3, topB: 5 });
    expect(walls).toEqual(original);
    expect(coalesceWallPanels([walls[0]!, walls[2]!, walls[3]!])).toHaveLength(2);
    const stepped = { ...walls[1]!, profile: { ...walls[1]!.profile!, topB: 5 } };
    expect(coalesceWallPanels([walls[0]!, stepped])).toHaveLength(2);
  });

  it("renders overlapping room and shaft panels only once, without deleting either collision wall", () => {
    const walls: WallSeg[] = [
      { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, zMin: 0, zMax: 3, side: 1, kind: "room" },
      { a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, zMin: 0, zMax: 3, side: 1, kind: "wall", finish: "shaft" },
    ];
    const original = structuredClone(walls);
    const geometry = cladWallGeometry(walls)!, p = geometry.attributes.position!, idx = geometry.index!;
    let area = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(p, idx.getX(i + 2));
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    expect(area).toBeCloseTo(9);
    expect(walls).toEqual(original);
    geometry.dispose();
  });
});

describe("enclosure scene assembly (geometry only, no WebGL or raster validation)", () => {
  let station: BuiltStation;
  beforeAll(() => {
    // Texture painting is irrelevant to these collision/mesh checks. Keep the real Three.js
    // geometry, materials, instancing, placement and collision; stub only canvas drawing.
    const context = new Proxy({}, { get: (_target, key) => (key === "createLinearGradient" || key === "createRadialGradient") ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    station = buildStation(bundle, planJson as unknown as Plan, { quality: "high" });
  }, 60_000);
  afterAll(() => {
    station?.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps the lift interior hood out of exterior canopy views", () => {
    const hoods: THREE.InstancedMesh[] = [];
    station.root.traverse((o) => { if (o.name === "elevator-interior-hood") hoods.push(o as THREE.InstancedMesh); });
    expect(hoods.length).toBeGreaterThan(0);
    const camera = new THREE.PerspectiveCamera();
    station.root.updateMatrixWorld(true);
    for (const hood of hoods) {
      camera.position.set(0, 1.7, 0); camera.updateMatrixWorld(true);
      hood.onBeforeRender(null as never, new THREE.Scene(), camera, hood.geometry, hood.material as THREE.Material, null as never);
      expect(hood.count).toBe(0);
      camera.position.y = -6; camera.updateMatrixWorld(true);
      hood.onBeforeRender(null as never, new THREE.Scene(), camera, hood.geometry, hood.material as THREE.Material, null as never);
      expect(hood.count).toBe(1);
    }
  });

  it("uses instanced fixtures, bounds fill lights, and avoids glass transmission passes", () => {
    const lights: THREE.PointLight[] = [];
    const fixtures: THREE.InstancedMesh[] = [];
    const glass = new Set<THREE.Material>();
    station.root.traverse((o) => {
      if (o instanceof THREE.PointLight) lights.push(o);
      if (o instanceof THREE.InstancedMesh && o.name.startsWith("linear-light:")) fixtures.push(o);
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.transparent && m.opacity === 0.28) glass.add(m);
      }
    });
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(8);
    expect(lights.every((l) => !l.castShadow)).toBe(true);
    expect(fixtures.length).toBe(1);
    expect(fixtures.reduce((n, f) => n + f.count, 0)).toBeGreaterThan(100);
    expect(glass.size).toBe(1);
    for (const m of glass) expect(m).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it("keeps both sides of every wall present in the front-sided GTAO normal pass", () => {
    const material = new THREE.MeshNormalMaterial();
    let walls = 0;
    station.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.userData.twoSidedWall) return;
      walls++;
      expect((o.material as THREE.Material).side).toBe(THREE.FrontSide);
      const pos = o.geometry.attributes.position!, idx = o.geometry.index!;
      const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
      const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
      const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const center = a.add(b).add(c).divideScalar(3);
      const mesh = new THREE.Mesh(o.geometry, material);
      for (const sign of [-1, 1]) {
        const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, sign * 0.1), normal.clone().multiplyScalar(-sign), 0, 0.2);
        expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      }
    });
    expect(walls).toBeGreaterThan(5);
    material.dispose();
  });

  it("keeps every batched train finish in the same position and visibility across its cycle", () => {
    const trains: THREE.InstancedMesh[] = [];
    station.root.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === "train-cars:instanced-finish") trains.push(o); });
    expect(trains.length).toBeGreaterThan(0);
    const matrix = new THREE.Matrix4(), reference = new THREE.Matrix4();
    for (const t of [0, 20, 40, 60, 95]) {
      station.update(0, t);
      const statuses = station.trainStatus();
      for (let track = 0; track < statuses.length; track++) {
        const finishes = trains.slice(track * 5, track * 5 + 5);
        for (const mesh of finishes) {
          expect(mesh.visible).toBe(statuses[track]!.present);
          expect(mesh.count).toBe(8);
          if (!mesh.visible) continue;
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix); finishes[0]!.getMatrixAt(i, reference);
            expect(matrix.elements).toEqual(reference.elements);
            expect(matrix.elements.every(Number.isFinite)).toBe(true);
          }
        }
      }
    }
    station.update(0, 0);
  });

  it("skips empty train batches for an upstairs camera and restores them when a car enters view", () => {
    station.update(0, 20);
    station.root.updateMatrixWorld(true);
    const trains: THREE.InstancedMesh[] = [];
    station.root.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === "train-cars:instanced-finish" && o.visible) trains.push(o); });
    expect(trains.length).toBeGreaterThan(0);
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 400);
    const render = (mesh: THREE.InstancedMesh) => mesh.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), camera, mesh.geometry, mesh.material as THREE.Material, null!);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 100, -10);
    camera.updateMatrixWorld(true);
    for (const mesh of trains) { render(mesh); expect(mesh.count).toBe(0); }
    const matrix = new THREE.Matrix4(), center = new THREE.Vector3();
    trains[0]!.getMatrixAt(0, matrix);
    center.setFromMatrixPosition(matrix);
    camera.position.copy(center).add(new THREE.Vector3(20, 3, 0));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    for (const mesh of trains.slice(0, 5)) { render(mesh); expect(mesh.count).toBe(8); }
    station.update(0, 0);
  });

  it("culls an offscreen static batch and restores it when viewed again", () => {
    let batch: THREE.InstancedMesh | undefined;
    station.root.traverse((o) => { if (!batch && o instanceof THREE.InstancedMesh && o.userData.tightCulling) batch = o; });
    expect(batch).toBeDefined();
    const mesh = batch!, center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 400);
    const render = () => mesh.onBeforeRender({} as THREE.WebGLRenderer, new THREE.Scene(), camera, mesh.geometry, mesh.material as THREE.Material, null!);
    camera.position.copy(center).add(new THREE.Vector3(0, 1000, 0));
    camera.lookAt(center.clone().add(new THREE.Vector3(0, 1100, 10)));
    camera.updateMatrixWorld(true);
    render();
    expect(mesh.count).toBe(0);
    camera.position.copy(center).add(new THREE.Vector3(0, 5, 10));
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    render();
    expect(mesh.count).toBe(1);
  });

  it("keeps actual fixture and housing boxes above every graph edge's 2.1 m head band", () => {
    const boxes: { matrix: THREE.Matrix4; inverse: THREE.Matrix4; bounds: THREE.Box3; unit: THREE.Box3 }[] = [];
    station.root.updateMatrixWorld(true);
    station.root.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || (!o.name.startsWith("linear-light:") && !o.name.startsWith("light-housing:"))) return;
      o.geometry.computeBoundingBox();
      const unit = o.geometry.boundingBox!.clone();
      for (let i = 0; i < o.count; i++) {
        const matrix = new THREE.Matrix4();
        o.getMatrixAt(i, matrix);
        matrix.premultiply(o.matrixWorld);
        boxes.push({ matrix, inverse: matrix.clone().invert(), bounds: unit.clone().applyMatrix4(matrix), unit });
      }
    });
    const hit = new THREE.Vector3(), ray = new THREE.Ray(), up = new THREE.Vector3(0, 1, 0);
    const bad: string[] = [];
    for (const { edge, p } of edgeSamples()) for (const b of boxes) {
      if (p.x < b.bounds.min.x || p.x > b.bounds.max.x || -p.y < b.bounds.min.z || -p.y > b.bounds.max.z) continue;
      ray.set(new THREE.Vector3(p.x, p.z + 0.025, -p.y), up).applyMatrix4(b.inverse);
      if (ray.intersectBox(b.unit, hit) && hit.applyMatrix4(b.matrix).y < p.z + 2.1) bad.push(edge);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("gives every underground elevator node a portal mounted on a full-height WalkWorld wall", () => {
    const portals: { nodeIds: string[]; center: XYZ; a: XYZ; b: XYZ }[] = [];
    station.root.traverse((o) => {
      if (o.userData.portals && !portals.length) portals.push(...o.userData.portals); // carried by the batch that holds the portal finishes
    });
    const covered = new Set(portals.flatMap((p) => p.nodeIds));
    const expected = bundle.nodes.filter((n) => n.kind === "elevator" && layout.nodeZ.get(n.id)! < -0.5).map((n) => n.id);
    expect([...covered].sort()).toEqual(expected.sort());
    for (const p of portals) {
      expect(station.layout.levels.flatMap((lv) => lv.walls).some((w) => Math.hypot(w.a.x - p.a.x, w.a.y - p.a.y) < 1e-6 &&
        Math.hypot(w.b.x - p.b.x, w.b.y - p.b.y) < 1e-6 && w.zMin <= p.center.z + 0.02 && w.zMax >= p.center.z + 2.5)).toBe(true);
      const length = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
      const nx = (p.b.y - p.a.y) / length, ny = -(p.b.x - p.a.x) / length;
      const x = (p.a.x + p.b.x) / 2, y = (p.a.y + p.b.y) / 2;
      expect(station.world.firstWallHit({ x: x + nx * 0.1, y: y + ny * 0.1 }, { x: x - nx * 0.1, y: y - ny * 0.1 }, p.center.z + 1.2)).toBeLessThan(1);
    }
  });

  it("keeps elevator portal walls outside every swept graph edge", () => {
    const walls = station.layout.levels.flatMap((lv) => lv.walls.filter((w) => w.kind === "elevator"));
    const bad: string[] = [];
    for (const { edge, p } of edgeSamples()) for (const w of walls) {
      if (p.z + 1.7 < w.zMin || p.z + 0.3 > w.zMax) continue;
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(p.x - w.a.x - dx * t, p.y - w.a.y - dy * t) < 0.31) bad.push(edge);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it("uses one baked floor atlas with valid UVs on every receiving surface", () => {
    const atlases = new Set<THREE.Texture>();
    station.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial) || !o.material.aoMap) return;
      atlases.add(o.material.aoMap);
      const uv = o.geometry.attributes.uv1!;
      expect(uv.count).toBe(o.geometry.attributes.position!.count);
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
    });
    expect(atlases.size).toBe(1);
    expect([...atlases][0]!.channel).toBe(1);
  });
});
