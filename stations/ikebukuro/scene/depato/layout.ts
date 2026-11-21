import type { StationBundle, Edge, Node } from "@gteki/schema";

export interface DepatoStore {
  id: string;
  name: { ja: string; en: string };
  building: string | null;
  floors: { level: string; category: string; label: { ja: string; en: string }; tenants: { ja: string; en: string }[]; source: string; read: string }[];
}
export type PlanPoint = [number, number]; // renderer x, z (east, south), metres
export interface DepatoInput {
  store: DepatoStore;
  footprint: PlanPoint[];
  poiId: string;
  sourceId: string;
  elevations: Record<string, number>;
  entrances: { level: string; point: PlanPoint; outsideNode: string }[];
}

/** Reusable circulation plan: any number of floors, with one straight stair flight per pair. */
export function depatoLayout(input: DepatoInput) {
  const { store, footprint, elevations } = input;
  const xs = footprint.map(p => p[0]), zs = footprint.map(p => p[1]);
  const bounds = { left: Math.min(...xs), right: Math.max(...xs), front: Math.min(...zs), back: Math.max(...zs) };
  const ordinal = (level: string) => level.startsWith("B") ? -Number(level.slice(1)) : Number(level.replace("F", "")) - 1;
  const height = (level: string) => elevations[level] ?? elevations["1F"]! + ordinal(level) * 4.5;
  const floors = [...store.floors].sort((a, b) => height(a.level) - height(b.level));
  const aisleX = (bounds.left + bounds.right) / 2;
  const stair = { x: aisleX, from: bounds.front + 26, to: bounds.front + 38, width: 3 };
  const contains = ([x, z]: PlanPoint) => {
    let inside = false;
    for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
      const a = footprint[i]!, b = footprint[j]!;
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const counters: PlanPoint[] = [];
  for (let z = bounds.front + 12; z < bounds.back - 5; z += 8) {
    for (let x = bounds.left + 5; x < bounds.right - 4; x += 7) {
      if (Math.abs(x - aisleX) < 5 || input.entrances.some(e => Math.abs(e.point[1] - z) < 5)) continue;
      if ([-2, 2].every(dx => [-1, 1].every(dz => contains([x + dx, z + dz])))) counters.push([x, z]);
    }
  }
  return { input, bounds, floors, height, aisleX, stair, counters };
}
export type DepatoLayout = ReturnType<typeof depatoLayout>;

/** Preview-only graph, kept out of the published station's survey data. */
export function depatoBundle(bundle: StationBundle, plan: DepatoLayout): StationBundle {
  const { store, entrances } = plan.input;
  const nodes: Node[] = [], edges: Edge[] = [];
  const prefix = `depato-${store.id}`;
  const evidence = { sourceIds: [plan.input.sourceId], method: "Owner-requested generated interior preview; circulation and tenant placements are illustrative, not surveyed", checkedDate: "2026-11-22" };
  const id = (level: string, part: string) => `${prefix}-${level}-${part}`;
  const node = (level: string, part: string, x: number, z: number) => {
    const n: Node = { id: id(level, part), floorId: id(level, "floor"), position: { x, y: -z, z: plan.height(level) }, kind: "junction", inOut: "inside", sourceRefs: [] };
    nodes.push(n); return n;
  };
  const edge = (a: Node, b: Node, mode: Edge["mode"] = "walk") => {
    edges.push({ id: `${a.id}__${b.id}`, from: a.id, to: b.id, direction: "both", mode,
      lengthM: Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z! - a.position.z!),
      geometry: [a.position, b.position], paid: false, crossesFareBoundary: false, wheelchair: mode === "walk", steps: mode === "stairs",
      hours: null, closed: false, verification: "verified", geometryEvidence: evidence, accessEvidence: evidence });
  };
  let previousLower: Node | undefined;
  for (const floor of plan.floors) {
    const lower = node(floor.level, "lower", plan.aisleX, plan.stair.from - 2);
    const upper = node(floor.level, "upper", plan.aisleX, plan.stair.to + 2);
    const aisle = node(floor.level, "aisle", plan.aisleX - 4, plan.stair.from - 2);
    const bypass = node(floor.level, "bypass", plan.aisleX - 4, plan.stair.to + 2);
    edge(lower, aisle); edge(aisle, bypass); edge(bypass, upper);
    if (previousLower) {
      const bottom = previousLower;
      const takeoff = node(plan.floors[plan.floors.indexOf(floor) - 1]!.level, "takeoff", plan.aisleX, plan.stair.from);
      const landing = node(floor.level, "landing", plan.aisleX, plan.stair.to);
      edge(bottom, takeoff); edge(takeoff, landing, "stairs"); edge(landing, upper);
    }
    previousLower = lower;
    for (const [i, entrance] of entrances.filter(e => e.level === floor.level).entries()) {
      const door = node(floor.level, `door${i}`, ...entrance.point);
      const approach = node(floor.level, `approach${i}`, plan.aisleX - 4, entrance.point[1]);
      edge(door, approach); edge(approach, aisle);
      edge(bundle.nodes.find(n => n.id === entrance.outsideNode)!, door);
    }
  }
  const goal = nodes.find(n => n.id === id("B1", "aisle")) ?? nodes[0]!;
  return { ...bundle,
    floors: [...bundle.floors, ...plan.floors.map(f => ({ id: id(f.level, "floor"), operatorId: "public", sourceLabels: [], ordinal: f.level.startsWith("B") ? -Number(f.level.slice(1)) : Number(f.level.replace("F", "")) - 1, intermediate: false, elevationM: null, elevationSource: "unknown" as const, renderElevationM: plan.height(f.level), displayNames: [{ lang: "ja", text: `${store.name.ja} ${f.level}` }, { lang: "en", text: `${store.name.en} ${f.level}` }] }))],
    nodes: [...bundle.nodes, ...nodes], edges: [...bundle.edges, ...edges],
    pois: bundle.pois.map(p => p.id !== plan.input.poiId ? p : { ...p, floorId: goal.floorId, displayPosition: goal.position, connectorNodeIds: [goal.id], aliases: [...p.aliases, { lang: "ja", text: "デパ地下" }, { lang: "en", text: "Seibu Ikebukuro food hall" }], evidence, notes: [{ lang: "ja", text: "生成された店内プレビュー。通路・売場位置は実測ではありません。" }, { lang: "en", text: "Generated interior preview; aisles and tenant positions are illustrative." }] }),
  };
}
