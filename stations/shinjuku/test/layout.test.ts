import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { buildLayout, pointInRings, soffitHeight, WalkWorld, type Plan, type Soffit } from "../scene/layout.ts";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };

const { bundle } = loadShinjukuBundle();
const plan = planJson as unknown as Plan;

it("finishes grouped flights on their own planes with flat landings and shoulders", () => {
  const coordinates = [{ x: 0, y: 0, z: -12 }, { x: 4, y: 0, z: -10 }, { x: 5, y: 0, z: -10 }, { x: 9, y: 0, z: -7.96 }];
  const nodes = coordinates.map((p, i) => ({ ...bundle.nodes[0]!, id: `flight-${i}`, floorId: "test", position: { ...p, z: null }, renderZ: p.z }));
  const stairs = bundle.edges.find((e) => e.mode === "stairs")!, walk = bundle.edges.find((e) => e.mode === "walk")!;
  const edges = [stairs, walk, stairs].map((e, i) => ({ ...e, id: `flight-edge-${i}`, from: nodes[i]!.id, to: nodes[i + 1]!.id, geometry: undefined, attributes: { ...e.attributes, width: 3 } }));
  const ring = [{ x: -4, y: -5 }, { x: 13, y: -5 }, { x: 13, y: 5 }, { x: -4, y: 5 }];
  const fixture: Plan = { levels: [{ label: "B3", ordinal: -3, floorId: "test", renderElevationM: -12, outline: [[ring]],
    spaces: [{ id: "hall", category: "B001", restricted: false, toll: null, rings: [ring] }], facilities: [] }],
    nodeRenderZ: Object.fromEntries(nodes.map((n) => [n.id, n.renderZ])), attribution: [] };
  const built = buildLayout({ ...bundle, nodes, edges, floors: [{ ...bundle.floors[0]!, id: "test", ordinal: -3, renderElevationM: -12 }] }, fixture);
  const sheets = (built as typeof built & { shaftFinishes?: Soffit[] }).shaftFinishes;
  const finishes = sheets ? [...built.soffits.filter((s) => !/^shaft-(roof|invert):/.test(s.spaceId)), ...sheets] : built.soffits;
  const at = (kind: string, x: number, y: number) => finishes.filter((s) =>
    (s.spaceId.startsWith(`shaft-${kind}:`) || kind === "roof" && s.spaceId.startsWith("shaft-collar:")) && pointInRings({ x, y }, s.rings));
  for (const kind of ["roof", "invert"]) {
    const offset = kind === "roof" ? 4.5 : -0.3;
    for (const x of [4.2, 4.8]) {
      const landing = at(kind, x, 0);
      expect(landing.length).toBeGreaterThan(0);
      expect(landing.every((s) => !s.slope && Math.abs(s.z - (kind === "roof" ? -6.8 : -10.18)) < 0.001)).toBe(true);
    }
    for (const [x, floor, slope] of [[2, -11, 0.5], [7, -8.98, 0.51]]) {
      const flight = at(kind, x!, 0);
      expect(flight.length).toBeGreaterThan(0);
      expect(flight.every((s) => Math.abs((s.slope?.x ?? 0) - slope!) < 1e-6 && Math.abs(soffitHeight(s, { x: x!, y: 0 }) - (floor! + offset)) < 0.001)).toBe(true);
    }
    for (const x of [-0.1, 1.5, 3, 9.1]) {
      const shoulder = at(kind, x, 2);
      expect(shoulder.length).toBeGreaterThan(0);
      expect(shoulder.every((s) => !s.slope)).toBe(true);
    }
  }
  for (const height of [-12.1, -11, -10.2, -8.8, -7.8, -6.9]) {
    expect(built.shaftFascias.some(({ wall }) => {
      const dx = wall.b.x - wall.a.x, dy = wall.b.y - wall.a.y, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((2 - wall.a.x) * dx + (2 - wall.a.y) * dy) / l2));
      const profile = wall.profile!;
      return Math.hypot(2 - wall.a.x - dx * t, 2 - wall.a.y - dy * t) < 0.002
        && height >= profile.bottomA + (profile.bottomB - profile.bottomA) * t
        && height <= profile.topA + (profile.topB - profile.topA) * t;
    }), `closed shoulder step at ${height}`).toBe(true);
  }
});

describe("E27 scene layout", () => {
  const layout = buildLayout(bundle, plan);
  const world = new WalkWorld(layout);

  it("builds every level with floor slabs and walls", () => {
    expect(layout.levels.length).toBe(6);
    for (const lv of layout.levels) {
      expect(lv.slabs.length).toBeGreaterThan(0);
      expect(lv.walls.length).toBeGreaterThan(0);
      expect(lv.ceilingZ).toBeGreaterThan(lv.z + 2.2);
    }
  });

  it("puts walkable ground under every non-elevator graph node at its render height", () => {
    const misses: string[] = [];
    for (const n of bundle.nodes) {
      if (n.kind === "elevator") continue;
      const z = layout.nodeZ.get(n.id)!;
      if (world.groundAt(n.position, z, 0.3, 0.3) === null) misses.push(`${n.id} ${n.floorId} ${n.kind}`);
    }
    // report, then require near-total coverage
    if (misses.length) console.warn("nodes without ground:", misses.length, misses.slice(0, 12));
    expect(misses).toEqual([]);
  });

  it("lets a walker follow every walk/stairs/escalator/gate edge without leaving the ground", () => {
    const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    const bad: string[] = [];
    for (const e of bundle.edges) {
      if (e.mode === "elevator") continue;
      const A = nodeById.get(e.from)!;
      const B = nodeById.get(e.to)!;
      let z = layout.nodeZ.get(e.from)!;
      const steps = Math.max(2, Math.ceil((e.lengthM ?? 1) / 0.25));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const p = { x: A.position.x + (B.position.x - A.position.x) * t, y: A.position.y + (B.position.y - A.position.y) * t };
        const g = world.groundAt(p, z);
        if (g === null) {
          bad.push(`${e.id} ${e.mode} at t=${t.toFixed(2)}`);
          break;
        }
        z = g;
      }
      // must also end at the destination's height (no staying on an overlapping surface)
      if (!bad.at(-1)?.startsWith(e.id) && Math.abs(z - layout.nodeZ.get(e.to)!) > 0.35) bad.push(`${e.id} ${e.mode} ends at ${z.toFixed(2)} ≠ ${layout.nodeZ.get(e.to)!.toFixed(2)}`);
    }
    if (bad.length) console.warn("edges not walkable:", bad.length, bad.slice(0, 15));
    expect(bad).toEqual([]);
  });
});
