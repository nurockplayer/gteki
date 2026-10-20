import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { buildLayout, clearSoffit, pointInRings, soffitHeight, type Plan, type SlabPoly, type Soffit, type XYZ } from "../scene/layout.ts";
import { buildStation, soffitGeometry, type BuiltStation } from "../scene/build.ts";

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

  it("adds pitched roofs for deep runs and stays below the street lane boundary", () => {
    const shafts = layout.soffits.filter((s) => s.kind === "shaft");
    expect(shafts.length).toBeGreaterThan(10);
    expect(layout.soffits.some((s) => s.kind === "landing")).toBe(true);
    expect(layout.soffits.some((s) => s.kind === "slab")).toBe(true);
    for (const s of layout.soffits) for (const p of s.rings.flat()) expect(soffitHeight(s, p)).toBeLessThanOrEqual(-0.5);
    for (const lv of layout.levels) for (const w of lv.walls.filter((w) => w.finish)) expect(w.zMax).toBeLessThan(-0.5);
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
});

describe("enclosure scene assembly (geometry only, no WebGL or raster validation)", () => {
  let station: BuiltStation;
  beforeAll(() => {
    // Texture painting is irrelevant to these collision/mesh checks. Keep the real Three.js
    // geometry, materials, instancing, placement and collision; stub only canvas drawing.
    const context = new Proxy({}, { get: (_target, key) => key === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => undefined });
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => context }) });
    station = buildStation(bundle, planJson as unknown as Plan, { quality: "high" });
  }, 60_000);
  afterAll(() => {
    station?.dispose();
    vi.unstubAllGlobals();
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
});
