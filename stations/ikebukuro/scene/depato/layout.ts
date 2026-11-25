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
  circulation?: { aisleX: number; from: number; to: number };
  entrances: { level: string; point: PlanPoint; outsideNode: string; inward?: PlanPoint }[];
}

/** Reusable circulation plan: any number of floors, with paired station-family escalators per pair. */
export function depatoLayout(input: DepatoInput) {
  const { store, footprint, elevations } = input;
  const xs = footprint.map(p => p[0]), zs = footprint.map(p => p[1]);
  const bounds = { left: Math.min(...xs), right: Math.max(...xs), front: Math.min(...zs), back: Math.max(...zs) };
  const ordinal = (level: string) => level.startsWith("B") ? -Number(level.slice(1)) : Number(level.replace("F", "")) - 1;
  const height = (level: string) => elevations[level] ?? elevations["1F"]! + ordinal(level) * 4.5;
  const floors = [...store.floors].sort((a, b) => height(a.level) - height(b.level));
  const aisleX = input.circulation?.aisleX ?? (bounds.left + bounds.right) / 2;
  const stair = { x: aisleX, from: input.circulation?.from ?? bounds.front + 26, to: input.circulation?.to ?? bounds.front + 38, width: 4.2 };
  const contains = ([x, z]: PlanPoint) => {
    let inside = false;
    for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
      const a = footprint[i]!, b = footprint[j]!;
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const counters: PlanPoint[] = [];
  for (let z = bounds.front + 12; z < bounds.back - 5; z += 7) {
    for (const side of [-1, 1]) for (let offset = 2.3; offset < (bounds.right - bounds.left) / 2; offset += 4) {
      const x = aisleX + side * offset;
      if (z > stair.from - 5 && z < stair.to + 5 && offset < 6) continue;
      if (input.entrances.some(e => Math.abs(e.point[1] - z) < 4)) continue;
      if ([-0.55, 0.55].every(dx => [-2, 2].every(dz => contains([x + dx, z + dz])))) counters.push([x, z]);
    }
  }
  return { input, bounds, floors, height, aisleX, stair, counters, contains };
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
    edges.push({ id: `${a.id}__${b.id}`, from: a.id, to: b.id, direction: mode === "escalator" ? "forward" : "both", mode,
      lengthM: Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z! - a.position.z!),
      geometry: [a.position, b.position], paid: false, crossesFareBoundary: false, wheelchair: mode === "walk", steps: mode !== "walk",
      hours: null, closed: false, verification: "geometry_only", geometryEvidence: evidence, accessEvidence: null });
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
      const takeoff = node(plan.floors[plan.floors.indexOf(floor) - 1]!.level, "takeoff", plan.aisleX - 0.95, plan.stair.from);
      const landing = node(floor.level, "landing", plan.aisleX - 0.95, plan.stair.to);
      edge(bottom, takeoff); edge(takeoff, landing, "escalator"); edge(landing, upper);
      const downStart = node(floor.level, "down-start", plan.aisleX + 0.95, plan.stair.from);
      const downEnd = node(plan.floors[plan.floors.indexOf(floor) - 1]!.level, "down-end", plan.aisleX + 0.95, plan.stair.to);
      edge(lower, downStart); edge(downStart, downEnd, "escalator");
      edge(downEnd, nodes.find(n => n.id === id(plan.floors[plan.floors.indexOf(floor) - 1]!.level, "upper"))!);
    }
    previousLower = lower;
    for (const [i, entrance] of entrances.filter(e => e.level === floor.level).entries()) {
      const door = node(floor.level, `door${i}`, ...entrance.point);
      if (floor.level === "1F") door.kind = "exit";
      const front = Math.abs(entrance.point[1] - plan.bounds.front) < 0.1;
      const inward = entrance.inward ?? (front ? [0,1] : [-1,0]);
      const inside = node(floor.level, `inside${i}`, entrance.point[0] + inward[0]! * 2, entrance.point[1] + inward[1]! * 2);
      const insideZ = -inside.position.y;
      const east = inside.position.x > plan.aisleX && insideZ > plan.stair.from - 2 && insideZ < plan.stair.to + 2;
      const approach = node(floor.level, `approach${i}`, plan.aisleX + (east ? 4 : -4), insideZ);
      edge(door, inside); edge(inside, approach);
      if(east){
        const around = node(floor.level, `around${i}`, plan.aisleX + 4, plan.stair.to + 2);
        edge(approach, around); edge(around, bypass);
      }else edge(approach, bypass);
      edge(bundle.nodes.find(n => n.id === entrance.outsideNode)!, door);
    }
  }
  const goal = nodes.find(n => n.id === id(plan.floors[0]!.level, "aisle"))!;
  return { ...bundle,
    floors: [...bundle.floors, ...plan.floors.map(f => ({ id: id(f.level, "floor"), operatorId: "public", sourceLabels: [], ordinal: f.level.startsWith("B") ? -Number(f.level.slice(1)) : Number(f.level.replace("F", "")) - 1, intermediate: false, elevationM: null, elevationSource: "unknown" as const, renderElevationM: plan.height(f.level), displayNames: [{ lang: "ja", text: `${store.name.ja} ${f.level}` }, { lang: "en", text: `${store.name.en} ${f.level}` }] }))],
    nodes: [...bundle.nodes, ...nodes], edges: [...bundle.edges, ...edges],
    pois: bundle.pois.map(p => p.id !== plan.input.poiId ? p : { ...p, floorId: goal.floorId, displayPosition: goal.position, connectorNodeIds: [goal.id], aliases: [...p.aliases, { lang: "ja", text: "デパ地下" }, { lang: "en", text: `${store.name.en} food hall` }], evidence, notes: [{ lang: "ja", text: "生成された店内プレビュー。通路・売場位置は実測ではありません。" }, { lang: "en", text: "Generated interior preview; aisles and tenant positions are illustrative." }] }),
  };
}
