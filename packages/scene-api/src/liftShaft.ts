import type { Edge, StationBundle } from "@gteki/schema";

/**
 * Lift shafts, shared by the greybox connectors (which build them) and station scenes (whose fences must leave each lift
 * door clear, #645 step 2c). Everything here is in the bundle's plan frame: x east, y north, metres.
 */
export type PlanXY = { x: number; y: number };

/** Half the plan side of a shaft (2.2 m square, connector spec), half a landing door (0.9 m), and the clear depth before it. */
export const LIFT_SHAFT_HALF_M = 1.1, LIFT_DOOR_HALF_M = 0.45, LIFT_DOOR_CLEARANCE_M = 0.6;

/** Plan outward normals of a shaft's four faces, in a fixed order so ties resolve the same way every run. */
export const LIFT_FACE_NORMALS: readonly PlanXY[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

export interface LiftStop {
  /** Height of the stop's car nodes. */
  z: number;
  nodeIds: string[];
  /** Index into LIFT_FACE_NORMALS of the face the door opens onto. */
  face: number;
  /** Centre of the door on that face. */
  door: PlanXY;
}

export interface LiftShaft { id: string; edges: Edge[]; centre: PlanXY; stops: LiftStop[] }

/** Traversable lift edges that rise more than 0.5 m: a same-floor car-to-hall stub is a walk run, not a ride. */
export function liftRides(bundle: StationBundle, nodeZ: (nodeId: string) => number, traversable: (edge: Edge) => boolean = () => true): Edge[] {
  return bundle.edges.filter((edge) => edge.mode === "elevator" && traversable(edge) && Math.abs(nodeZ(edge.from) - nodeZ(edge.to)) > 0.5);
}

/**
 * Rides whose car nodes lie within one shaft footprint form one shaft, centred on the plan centroid of its cars; its
 * stops are the distinct car heights, lowest first. Choose the lowest hall node id then walk edge id, independent
 * of bundle order. Its first segment leaving the shaft chooses the door face and offset, kept inside the face.
 */
export function liftShafts(bundle: StationBundle, rides: readonly Edge[], nodeZ: (nodeId: string) => number, traversable: (edge: Edge) => boolean = () => true): LiftShaft[] {
  if (!rides.length) return [];
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const at = (id: string): PlanXY => { const p = nodes.get(id)!.position; return { x: p.x, y: p.y }; };
  // Match display heights along each hall, including null intermediate heights interpolated by plan distance.
  const pointsOf = (edge: Edge) => {
    const from = at(edge.from), to = at(edge.to), za = nodeZ(edge.from), zb = nodeZ(edge.to);
    const raw = edge.geometry && edge.geometry.length >= 2 ? edge.geometry : [{ ...from, z: za }, { ...to, z: zb }];
    const lengths = [0];
    for (let i = 1; i < raw.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
    const total = lengths.at(-1)! || 1;
    return raw.map((p, i) => ({ x: i === 0 ? from.x : i === raw.length - 1 ? to.x : p.x, y: i === 0 ? from.y : i === raw.length - 1 ? to.y : p.y,
      z: i === 0 ? za : i === raw.length - 1 ? zb : p.z ?? za + (zb - za) * (lengths[i]! / total) }));
  };
  const ends = (edge: Edge) => [edge.from, edge.to].filter((id) => nodes.has(id));
  const usable = rides.filter((edge) => ends(edge).length === 2);
  const parent = usable.map((_e, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
    const near = ends(usable[i]!).some((a) => ends(usable[j]!).some((b) => Math.max(Math.abs(at(a).x - at(b).x), Math.abs(at(a).y - at(b).y)) <= LIFT_SHAFT_HALF_M));
    if (near) parent[root(i)] = root(j);
  }
  const groups = new Map<number, Edge[]>();
  usable.forEach((edge, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), edge]));
  const hallEdges = bundle.edges.filter((edge) => edge.mode === "walk").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const landingStubs = bundle.edges.filter((edge) => edge.mode === "elevator").sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...groups.values()].map((group) => {
    const cars = [...new Set(group.flatMap(ends))];
    const centre = { x: cars.reduce((s, id) => s + at(id).x, 0) / cars.length, y: cars.reduce((s, id) => s + at(id).y, 0) / cars.length };
    const stops: { z: number; nodeIds: string[] }[] = [];
    for (const id of [...cars].sort((a, b) => nodeZ(a) - nodeZ(b))) {
      const stop = stops.at(-1);
      if (stop && nodeZ(id) - stop.z <= 0.5) stop.nodeIds.push(id); else stops.push({ z: nodeZ(id), nodeIds: [id] });
    }
    const door = (nodeIds: readonly string[], stopZ: number): { face: number; door: PlanXY } => {
      // Same-level lift-labelled stubs connect the car to its walking hall; vertical rides never supply a door.
      const starts = [...nodeIds].sort().flatMap((nodeId) => {
        const starts = [{ nodeId, approach: [] as ReturnType<typeof pointsOf> }];
        for (const stub of landingStubs) {
          if (!traversable(stub) || (stub.from !== nodeId && stub.to !== nodeId) || !nodes.has(stub.from) || !nodes.has(stub.to)) continue;
          const approach = pointsOf(stub);
          if (Math.max(...approach.map((p) => p.z)) - Math.min(...approach.map((p) => p.z)) > 0.5) continue;
          if (stub.to === nodeId) approach.reverse();
          starts.push({ nodeId: stub.from === nodeId ? stub.to : stub.from, approach });
        }
        return starts;
      }).sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);
      for (const { nodeId, approach } of starts) for (const other of hallEdges) {
        if (!traversable(other) || (other.from !== nodeId && other.to !== nodeId)) continue;
        if (!nodes.has(other.from) || !nodes.has(other.to)) continue;
        const hall = pointsOf(other);
        if (other.to === nodeId) hall.reverse();
        const line = [...approach.slice(0, -1), ...hall];
        const firstOutside = line.findIndex((p, i) => i > 0 && Math.max(Math.abs(p.x - centre.x), Math.abs(p.y - centre.y)) > LIFT_SHAFT_HALF_M + 1e-9);
        const car = line[firstOutside > 0 ? firstOutside - 1 : 0]!, far = firstOutside > 0 ? line[firstOutside]! : line.at(-1)!;
        const dx = far.x - centre.x, dy = far.y - centre.y;
        if (dx * dx + dy * dy < 1e-8) continue;
        let face = 0, score = -Infinity;
        LIFT_FACE_NORMALS.forEach((n, index) => { const dot = dx * n.x + dy * n.y; if (dot > score) { score = dot; face = index; } });
        const run = { x: far.x - car.x, y: far.y - car.y };
        let firstCrossing = Infinity;
        if (firstOutside > 0) LIFT_FACE_NORMALS.forEach((n, index) => {
          const into = run.x * n.x + run.y * n.y;
          if (into <= 1e-9) return;
          const at = (LIFT_SHAFT_HALF_M - ((car.x - centre.x) * n.x + (car.y - centre.y) * n.y)) / into;
          if (at >= -1e-9 && at <= 1 + 1e-9 && at < firstCrossing) { face = index; firstCrossing = at; }
        });
        const n = LIFT_FACE_NORMALS[face]!, t = { x: -n.y, y: n.x };
        const into = run.x * n.x + run.y * n.y;
        const s = Math.abs(into) > 1e-9 ? (LIFT_SHAFT_HALF_M - ((car.x - centre.x) * n.x + (car.y - centre.y) * n.y)) / into : 0;
        const k = Math.min(1, Math.max(0, s)), cross = { x: car.x + run.x * k - centre.x, y: car.y + run.y * k - centre.y };
        if (Math.abs(car.z + (far.z - car.z) * k - stopZ) > 0.5) continue;
        const offset = Math.min(LIFT_SHAFT_HALF_M - LIFT_DOOR_HALF_M, Math.max(-(LIFT_SHAFT_HALF_M - LIFT_DOOR_HALF_M), cross.x * t.x + cross.y * t.y));
        return { face, door: { x: centre.x + n.x * LIFT_SHAFT_HALF_M + t.x * offset, y: centre.y + n.y * LIFT_SHAFT_HALF_M + t.y * offset } };
      }
      return { face: 0, door: { x: centre.x + LIFT_SHAFT_HALF_M, y: centre.y } };
    };
    return { id: group.map((edge) => edge.id).sort()[0]!, edges: group, centre, stops: stops.map((stop) => ({ ...stop, ...door(stop.nodeIds, stop.z) })) };
  });
}

/** The stop's square inside the shaft, as a closed-free ring (no repeated first point). */
export function liftStopSquare(shaft: LiftShaft): PlanXY[] {
  const { x, y } = shaft.centre, h = LIFT_SHAFT_HALF_M;
  return [{ x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x + h, y: y + h }, { x: x - h, y: y + h }];
}

/** The clear space in front of a stop's door: the door's width, LIFT_DOOR_CLEARANCE_M deep, outward from the face. */
export function liftDoorClearance(stop: LiftStop): PlanXY[] {
  const n = LIFT_FACE_NORMALS[stop.face]!, t = { x: -n.y, y: n.x }, d = LIFT_DOOR_CLEARANCE_M, h = LIFT_DOOR_HALF_M;
  const p = (along: number, across: number) => ({ x: stop.door.x + n.x * along + t.x * across, y: stop.door.y + n.y * along + t.y * across });
  return [p(0, -h), p(d, -h), p(d, h), p(0, h)];
}
