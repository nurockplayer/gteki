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
  upperBank?: { transfer: string; x: number; from: number; to: number };
  floorFootprint?: (level: string) => PlanPoint[];
  lift?: { x: number; z: number; entrance: string; destinations: string[]; source: string };
  entrances: { level: string; point: PlanPoint; outsideNode: string; inward?: PlanPoint }[];
}

/** Reusable circulation plan: any number of floors, with paired station-family escalators per pair. */
export function depatoLayout(input: DepatoInput) {
  const { store, footprint, elevations } = input;
  const ordinal = (level: string) => level.startsWith("B") ? -Number(level.slice(1)) : Number(level.replace("F", "")) - 1;
  const height = (level: string) => elevations[level] ?? elevations["1F"]! + ordinal(level) * 4.5;
  const floors = [...store.floors].sort((a, b) => height(a.level) - height(b.level));
  const boundsOf = (points: PlanPoint[]) => {
    const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), front: Math.min(...zs), back: Math.max(...zs) };
  };
  const bounds = boundsOf(footprint);
  const aisleX = input.circulation?.aisleX ?? (bounds.left + bounds.right) / 2;
  const stair = { x: aisleX, from: input.circulation?.from ?? bounds.front + 26, to: input.circulation?.to ?? bounds.front + 38, width: 4.2 };
  const upper = input.upperBank && { ...input.upperBank, width: stair.width };
  const bank = (level: string) => upper && height(level) >= height(upper.transfer) ? upper : stair;
  const crossZ = upper ? Math.max(stair.to, upper.to) + 4 : stair.to + 4;
  const plateFor = (points: PlanPoint[], banks: (typeof stair)[], main: typeof stair) => {
    const bounds = boundsOf(points);
    const contains = ([x, z]: PlanPoint) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!, b = points[j]!;
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    };
    const counters: PlanPoint[] = [];
    for (let rowZ = bounds.front + 12; rowZ < bounds.back - 5; rowZ += 7) {
      for (const side of [-1, 1]) for (let offset = 2.3; offset < (bounds.right - bounds.left) / 2; offset += 4) {
        const x = main.x + side * offset;
        if (banks.some(b => rowZ > b.from - 5 && rowZ < b.to + 5 && Math.abs(x - b.x) < 6)) continue;
        // The tower's first east-side row faces the landing across the cross-aisle.
        const z = main === upper && banks.length === 1 && side === 1 && rowZ === bounds.front + 12 ? bounds.back - 3 : rowZ;
        if (input.entrances.some(e => Math.abs(e.point[1] - z) < 4)) continue;
        if (upper && Math.abs(z - crossZ) < 3) continue;
        if (input.lift && Math.abs(z - input.lift.z) < 5 && Math.abs(x - input.lift.x) < 5) continue;
        if ([-0.55, 0.55].every(dx => [-2, 2].every(dz => contains([x + dx, z + dz])))) counters.push([x, z]);
      }
    }
    return { footprint: points, bounds, counters, contains };
  };
  const base = plateFor(footprint, [stair], stair);
  const plates = input.floorFootprint && new Map(floors.map(({ level }) => [
    level, plateFor(input.floorFootprint!(level), level === upper?.transfer ? [stair, upper] : [bank(level)], bank(level)),
  ]));
  return { input, ...base, floors, height, aisleX, stair, bank, crossZ, plate: (level: string) => plates?.get(level) ?? base };
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
    const geometryEvidence = mode === "elevator" ? {
      ...evidence, method: `Public restaurant lift access: ${plan.input.lift!.source}; preview stops are illustrative`,
    } : evidence;
    edges.push({ id: `${a.id}__${b.id}`, from: a.id, to: b.id, direction: mode === "escalator" ? "forward" : "both", mode,
      lengthM: Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z! - a.position.z!),
      geometry: [a.position, b.position], paid: false, crossesFareBoundary: false, wheelchair: mode !== "escalator", steps: mode === "escalator",
      hours: null, closed: false, verification: "geometry_only", geometryEvidence, accessEvidence: null });
  };
  const halls = (level: string, bank: typeof plan.stair, suffix = "") => {
    const { x, from, to } = bank;
    const lower = node(level, "lower" + suffix, x, from - 2);
    const upper = node(level, "upper" + suffix, x, to + 2);
    const aisle = node(level, "aisle" + suffix, x - 4, from - 2);
    const bypass = node(level, "bypass" + suffix, x - 4, to + 2);
    edge(lower, aisle); edge(aisle, bypass); edge(bypass, upper);
    return { lower, upper, aisle, bypass };
  };
  const liftStops: Node[] = [];
  let previous: ReturnType<typeof halls> | undefined;
  for (const [index, floor] of plan.floors.entries()) {
    const { level } = floor, bank = plan.bank(level), main = halls(level, bank);
    const { bypass } = main;
    const below = plan.floors[index - 1]?.level;
    if (previous && below) {
      const incoming = plan.bank(below), { x, from, to } = incoming;
      const arrival = incoming === bank ? main : halls(level, incoming, "-arrival");
      if (arrival !== main) {
        const a = node(level, "transfer-from", incoming.x - 4, plan.crossZ);
        const b = node(level, "transfer-to", bank.x - 4, plan.crossZ);
        edge(arrival.bypass, a); edge(a, b); edge(b, bypass);
      }
      const takeoff = node(below, "takeoff", x - 0.95, from);
      const landing = node(level, "landing", x - 0.95, to);
      edge(previous.lower, takeoff); edge(takeoff, landing, "escalator"); edge(landing, arrival.upper);
      const downStart = node(level, "down-start", x + 0.95, from);
      const downEnd = node(below, "down-end", x + 0.95, to);
      edge(arrival.lower, downStart); edge(downStart, downEnd, "escalator"); edge(downEnd, previous.upper);
    }
    previous = main;
    const lift = plan.input.lift;
    if (lift && (level === lift.entrance || lift.destinations.includes(level))) {
      const stop = node(level, "lift", lift.x, lift.z - 2);
      const turn = node(level, "lift-turn", bank.x - 4, plan.crossZ);
      const lobby = node(level, "lift-lobby", lift.x, plan.crossZ);
      edge(bypass, turn); edge(turn, lobby); edge(lobby, stop);
      liftStops.push(stop);
    }
    for (const [i, entrance] of entrances.filter(e => e.level === floor.level).entries()) {
      const door = node(floor.level, `door${i}`, ...entrance.point);
      if (floor.level === "1F") door.kind = "exit";
      const front = Math.abs(entrance.point[1] - plan.bounds.front) < 0.1;
      const inward = entrance.inward ?? (front ? [0,1] : [-1,0]);
      // Marui Main's diagonal frontage needs a deeper turn to keep the cross-aisle inside its footprint.
      const depth = store.id === "shinjuku-marui-main" ? 4 : 2;
      const inside = node(floor.level, `inside${i}`, entrance.point[0] + inward[0]! * depth, entrance.point[1] + inward[1]! * depth);
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
  for (const stop of liftStops.slice(1)) edge(liftStops[0]!, stop, "elevator");
  const goal = nodes.find(n => n.id === id(plan.floors[0]!.level, "aisle"))!;
  return { ...bundle,
    floors: [...bundle.floors, ...plan.floors.map(f => ({ id: id(f.level, "floor"), operatorId: "public", sourceLabels: [], ordinal: f.level.startsWith("B") ? -Number(f.level.slice(1)) : Number(f.level.replace("F", "")) - 1, intermediate: false, elevationM: null, elevationSource: "unknown" as const, renderElevationM: plan.height(f.level), displayNames: [{ lang: "ja", text: `${store.name.ja} ${f.level}` }, { lang: "en", text: `${store.name.en} ${f.level}` }] }))],
    nodes: [...bundle.nodes, ...nodes], edges: [...bundle.edges, ...edges],
    pois: bundle.pois.map(p => p.id !== plan.input.poiId ? p : { ...p, floorId: goal.floorId, displayPosition: goal.position, connectorNodeIds: [goal.id], aliases: [...p.aliases, { lang: "ja", text: "デパ地下" }, { lang: "en", text: `${store.name.en} food hall` }], evidence, notes: [{ lang: "ja", text: "生成された店内プレビュー。通路・売場位置は実測ではありません。" }, { lang: "en", text: "Generated interior preview; aisles and tenant positions are illustrative." }] }),
  };
}
