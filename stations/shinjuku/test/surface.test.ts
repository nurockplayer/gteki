import { describe, expect, it, vi } from "vitest";
import { WalkWorld, buildLayout, pointInRings, type Plan } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json";
import surfaceJson from "../data/surface.json";
import { buildSurface, surfaceWalls, type SurfaceData } from "../scene/surface.ts";
import { surfaceBuildingFootprints, surfaceEntrances, surfaceGround, surfaceOpenings, surfacePadWalls, streetFootprint } from "../scene/surface-layout.ts";
import { parseBuildings, simplifyRing, surfaceEnu } from "../tools/import-surface.ts";

const { bundle } = loadShinjukuBundle();
const layout = buildLayout(bundle, planJson as Plan);
const data = surfaceJson as SurfaceData;
const inPolys = (x: number, y: number, polys: number[][][][]) => polys.some((p) => pointInRings({ x, y }, p.map((r) => r.map(([x, y]) => ({ x: x!, y: y! })))));

// Real corners of bldg_3e60150b-c9eb-4f23-aad3-01dada906f15, tile 53394525,
// pinned in surface-manifest.json. Controls calculated independently with GRS80
// Cartesian dot products in Python, not with the production EnuFrame class.
const controls = [
  [35.688235990032425, 139.68798718190186, -1033.056679186892, 137.19709496050777],
  [35.6882431783222, 139.68804307535913, -1027.9972661087872, 137.9940724868541],
] as const;
const ring = "35.687 139.6994 33 35.687 139.6995 33 35.6871 139.6995 33 35.6871 139.6994 33 35.687 139.6994 33";
const fixture = (height = true) => `<core:CityModel srsName="http://www.opengis.net/def/crs/EPSG/0/6697"><bldg:Building gml:id="bldg:fixture">${height ? '<bldg:measuredHeight uom="m">12.34</bldg:measuredHeight>' : ""}<bldg:lod1Solid><gml:Solid><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring.replaceAll(" 33", " 43")}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:Solid></bldg:lod1Solid></bldg:Building></core:CityModel>`;

describe("PLATEAU surface importer", () => {
  it.each(controls)("converts the known building corner %s,%s (EPSG:6697 lat,lon) to ENU", (lat, lon, east, north) => {
    const p = surfaceEnu(lat, lon, 33.593);
    expect(p.x).toBeCloseTo(east, 6); expect(p.y).toBeCloseTo(north, 6);
    expect(p.z).toBe(33.593); // no invented datum tie to station render z
  });
  it("rejects swapped axes, wrong CRS and XML entities", () => {
    expect(() => surfaceEnu(139.6994, 35.687, 0)).toThrow(/axis/);
    expect(() => parseBuildings(fixture().replace("6697", "4326"), [[0, 0]])).toThrow(/6697/);
    expect(() => parseBuildings('<!DOCTYPE bad>' + fixture(), [[0, 0]])).toThrow(/entity/);
  });
  it("deterministically extracts the LOD1 base and measuredHeight, quantised to decimetres", () => {
    const a = parseBuildings(fixture(), [[0, 0]]), b = parseBuildings(fixture(), [[0, 0]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(a).toHaveLength(1);
    expect(a[0]!.height).toBe(12.3); expect(a[0]!.groundHeight).toBe(33);
    expect(a[0]!.heightSource).toBe("measuredHeight");
    expect(a[0]!.rings[0]![0]).toEqual([0, 0]);
    expect(a[0]!.rings[0]!.at(-1)).toEqual([0, 0]);
    expect(parseBuildings(fixture(false), [[0, 0]])[0]!.height).toBe(10);
    expect(parseBuildings(fixture(), [[1000, 1000]])).toEqual([]);
  });
  it("simplifies closed rings without losing corners or closure", () => {
    expect(simplifyRing([[0, 0], [1, 0.05], [2, 0], [2, 2], [0, 2], [0, 0]])).toEqual([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  });
  it("ships only compact render context with attribution and preserved source heights", () => {
    expect(data.note).toBe("render-only context, not routing"); expect(data.license).toBe("CC-BY-4.0");
    expect(data.attribution).toMatch(/Modified by GTEki/); expect(JSON.stringify(data).length).toBeLessThan(1_500_000);
    expect(data.buildings.length).toBeGreaterThan(100);
    expect(new Set(data.buildings.map((b) => b.id)).size).toBe(data.buildings.length);
  });
});

describe("street geometry and collision", () => {
  const openings = surfaceOpenings(layout, bundle), ground = surfaceGround(layout, bundle);
  it("leaves every top run open across its full width and the walker's head clearance", () => {
    let samples = 0;
    for (const r of layout.runs) for (let i = 1; i < 200; i++) {
      const t = i / 200, z = r.a.z + (r.b.z - r.a.z) * t;
      if (z < -2.5 || z > -0.03) continue;
      const dx = r.b.x - r.a.x, dy = r.b.y - r.a.y, L = Math.hypot(dx, dy);
      for (const side of [-0.49, 0, 0.49]) {
        const x = r.a.x + dx * t - dy / L * r.width * side, y = r.a.y + dy * t + dx / L * r.width * side;
        expect(inPolys(x, y, openings), r.edgeId).toBe(true); expect(inPolys(x, y, ground), r.edgeId).toBe(false); samples++;
      }
    }
    expect(samples).toBeGreaterThan(50);
  });
  it("cuts every ground-level elevator endpoint", () => {
    for (const e of bundle.edges.filter((e) => e.mode === "elevator")) for (const id of [e.from, e.to]) {
      if (Math.abs(layout.nodeZ.get(id)!) > 0.1) continue;
      const n = bundle.nodes.find((n) => n.id === id)!;
      expect(inPolys(n.position.x, n.position.y, ground)).toBe(false);
    }
  });
  it("uses every ground-level exit's existing label, and creates no B1 canopy", () => {
    const es = surfaceEntrances(layout, bundle); expect(es.map((e) => e.id)).toEqual(["poi:exit:1", "poi:exit:2", "poi:exit:3", "poi:exit:4"]);
    for (const e of es) expect(e.labelEn).toBe(bundle.pois.find((p) => p.id === e.id)!.names.find((n) => n.lang === "en")!.text);
  });
  it("adds obstacles without adding walkable surfaces", () => {
    const world = new WalkWorld(layout), before = world.heightsAt({ x: -300, y: 100 });
    world.addWalls(surfaceWalls(layout, bundle, data));
    expect(world.heightsAt({ x: -300, y: 100 })).toEqual(before); expect(before).toEqual([]);
    expect(surfacePadWalls(layout, bundle).length).toBeGreaterThan(20);
    expect(streetFootprint(layout).length).toBeGreaterThan(0);
  });
  it("keeps all graph edges clear of every surface rail, column and building wall", () => {
    const baseline = new WalkWorld(layout), world = new WalkWorld(layout);
    world.addWalls(surfaceWalls(layout, bundle, data));
    const bad: string[] = [];
    for (const e of bundle.edges) {
      const a = bundle.nodes.find((n) => n.id === e.from)!, b = bundle.nodes.find((n) => n.id === e.to)!;
      const points = e.geometry?.length ? e.geometry : [a.position, b.position];
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
      const total = lengths.reduce((a, b) => a + b, 0) || 1; let acc = 0;
      for (let i = 0; i < lengths.length; i++) {
        const A = points[i]!, B = points[i + 1]!, L = lengths[i]!, count = Math.max(1, Math.ceil(L / 0.05));
        for (let j = 0; j <= count; j++) {
          const t = j / count, z = layout.nodeZ.get(a.id)! + (layout.nodeZ.get(b.id)! - layout.nodeZ.get(a.id)!) * (acc + L * t) / total;
          const p = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
          const expected = baseline.resolveWalls(p, z, 0.3), actual = world.resolveWalls(p, z, 0.3);
          if (Math.hypot(actual.x - expected.x, actual.y - expected.y) > 0.001) { bad.push(e.id); break; }
        }
        acc += L;
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
  it("trims context masses clear of street slabs", () => {
    const masses = surfaceBuildingFootprints(data, layout, bundle);
    for (const n of bundle.nodes.filter((n) => Math.abs(layout.nodeZ.get(n.id)!) < 0.1)) expect(masses.some((b) => inPolys(n.position.x, n.position.y, [b.rings]))).toBe(false);
  });
  it("builds merged batches within the 60-draw budget and disposes every owned resource", () => {
    // Geometry/resource verification only. This fake canvas does not render pixels;
    // real GPU calls, shaders and visual acceptance still require the QA harness.
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText() {} }) }) });
    try {
      const built = buildSurface(data, layout, { bundle, quality: "high" });
      expect(built.root.userData.drawCallBudget).toBeLessThanOrEqual(30); // <=60 even with a second normal/depth pass
      expect(built.root.userData.buildingParts).toBeGreaterThan(100);
      let tris = 0, meshes = 0;
      built.root.traverse((o) => { if ("isMesh" in o) { const m = o as import("three").Mesh; expect(m.geometry.attributes.position!.array.every(Number.isFinite)).toBe(true); tris += (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3; meshes++; } });
      console.log("surface static geometry (not GPU report):", { meshes, tris, batches: built.root.userData.drawCallBudget });
      expect(meshes).toBeLessThanOrEqual(30);
      const mesh = built.root.getObjectByName("surface-ground") as import("three").Mesh;
      const disposed = vi.fn(); mesh.geometry.addEventListener("dispose", disposed);
      built.dispose(); built.dispose(); expect(disposed).toHaveBeenCalledTimes(1); expect(built.root.children).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
});
