import type { Edge, StationBundle, Vec3N } from "@gteki/schema";
import { isOpenAt } from "@gteki/schema";
import { DEFAULT_PROFILE, DEFAULT_STALE_AFTER_DAYS } from "./index.ts";
import type { Router, RouteProfile, RouteResult, RouteStep, RouteUnknown } from "./index.ts";

const WALK_SPEED = 1.2;
const ELEVATOR_SECONDS = 45;
const SLOPED_MODES = new Set(["stairs", "escalator", "ramp"]);

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface QueueEntry {
  nodeId: string;
  cost: number;
}

const compareEntries = (a: QueueEntry, b: QueueEntry): number =>
  a.cost - b.cost || compareIds(a.nodeId, b.nodeId);

/** A binary min-heap; equal costs are visited in node-id order. */
class MinHeap {
  private readonly entries: QueueEntry[] = [];

  push(entry: QueueEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEntries(this.entries[parent]!, entry) <= 0) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): QueueEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (this.entries.length === 0 || !last) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.entries.length &&
        compareEntries(this.entries[child + 1]!, this.entries[child]!) < 0
      ) child++;
      if (compareEntries(last, this.entries[child]!) <= 0) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

/** Polyline length. Symbolic (display-only) z never counts: such polylines are measured in plan (x, y) only. */
function geometryLength(geometry: Vec3N[] | undefined, symbolicZ = false): number | null {
  if (!geometry || geometry.length < 2) return null;
  let length = 0;
  for (const point of geometry) {
    if (
      !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      (point.z !== null && !Number.isFinite(point.z))
    ) return null;
  }
  for (let i = 1; i < geometry.length; i++) {
    const from = geometry[i - 1]!;
    const to = geometry[i]!;
    const dz = !symbolicZ && from.z !== null && to.z !== null ? to.z - from.z : 0;
    length += Math.hypot(to.x - from.x, to.y - from.y, dz);
  }
  return Number.isFinite(length) ? length : null;
}

interface Measurement {
  lengthM: number;
  cost: number;
}

/** Polyline endpoints sit on their nodes in plan, exactly as routePolyline draws them. */
function snapEndpoints(geometry: Vec3N[] | undefined, from: Vec3N, to: Vec3N): Vec3N[] | undefined {
  if (!geometry || geometry.length < 2) return geometry;
  const out = [...geometry];
  out[0] = { x: from.x, y: from.y, z: geometry[0]!.z };
  out[out.length - 1] = { x: to.x, y: to.y, z: geometry[geometry.length - 1]!.z };
  return out;
}

function measureEdge(rawEdge: Edge, from: Vec3N, to: Vec3N): Measurement | null {
  const edge = { ...rawEdge, geometry: snapEndpoints(rawEdge.geometry, from, to) };
  if (edge.lengthM !== null && (!Number.isFinite(edge.lengthM) || edge.lengthM < 0)) return null;
  const symbolicZ = edge.geometryZ === "symbolic";
  if (edge.mode === "elevator") {
    // A lift ride adds time, not walking distance: its length is the plan (x, y) walk in/out only.
    const walk = edge.lengthM ?? geometryLength(edge.geometry, true);
    return walk === null ? null : { lengthM: walk, cost: ELEVATOR_SECONDS * WALK_SPEED };
  }
  if (edge.lengthM === null && SLOPED_MODES.has(edge.mode)) {
    // Stairs/escalators/ramps without a stated length need every geometry height known and
    // non-symbolic; a plan length would silently drop the climb (a stair could read "0 m").
    if (symbolicZ || !edge.geometry || edge.geometry.some((p) => p.z === null)) return null;
  }
  const lengthM = edge.lengthM ?? geometryLength(edge.geometry, symbolicZ);
  if (lengthM === null) return null;
  const cost = lengthM * (edge.mode === "stairs" ? 1.6 : 1);
  return Number.isFinite(cost) ? { lengthM, cost } : null;
}

interface Traversal {
  edge: Edge;
  toNodeId: string;
  reversed: boolean;
  measurement: Measurement;
}

interface Previous {
  fromNodeId: string;
  traversal: Traversal;
}

const DAY_MS = 86_400_000;

/**
 * The interval a reduced-precision ISO date stands for, in UTC ms: "2024" is all of 2024 and "2024-03"
 * all of March. A full date is one day. null when unparseable.
 */
function dateInterval(date: string): { first: number; last: number } | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] === undefined ? 0 : Number(m[2]) - 1;
  const day = m[3] === undefined ? 1 : Number(m[3]);
  const first = new Date(Date.UTC(y, mo, day));
  // Calendar round-trip: "2026-13-01" or "2026-02-30" is not a date, never a normalised one.
  if (first.getUTCFullYear() !== y || first.getUTCMonth() !== mo || first.getUTCDate() !== day) return null;
  if (m[2] === undefined) return { first: first.getTime(), last: Date.UTC(y, 11, 31) };
  if (m[3] === undefined) return { first: first.getTime(), last: Date.UTC(y, mo + 1, 0) };
  return { first: first.getTime(), last: first.getTime() };
}

export function createRouter(bundle: StationBundle): Router {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const sourceDates = new Map(bundle.sources.map((source) => [source.id, source.datasetDate]));
  const adjacency = new Map<string, Traversal[]>();
  for (const nodeId of nodes.keys()) adjacency.set(nodeId, []);
  for (const edge of bundle.edges) {
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    const measurement = fromNode && toNode ? measureEdge(edge, fromNode.position, toNode.position) : null;
    if (!measurement) continue;
    adjacency.get(edge.from)!.push({ edge, toNodeId: edge.to, reversed: false, measurement });
    if (edge.direction === "both") {
      adjacency.get(edge.to)!.push({ edge, toNodeId: edge.from, reversed: true, measurement });
    }
  }
  for (const traversals of adjacency.values()) {
    traversals.sort((a, b) => compareIds(a.toNodeId, b.toNodeId) || compareIds(a.edge.id, b.edge.id));
  }

  function permits(edge: Edge, profile: RouteProfile, avoided: Set<string>, closed: Set<string>): boolean {
    if (
      edge.verification !== "verified" &&
      !(edge.verification === "synthetic" && bundle.station.synthetic === true)
    ) return false;
    if (edge.closed || closed.has(edge.id) || avoided.has(edge.mode)) return false;
    if (profile.stepFree && (edge.wheelchair !== true || edge.steps === true)) return false;
    if (profile.fare === "unpaid_only" && (edge.paid !== false || edge.crossesFareBoundary !== false)) return false;
    if (edge.hours === null) return profile.hours !== "require_known";
    if (profile.at) {
      const open = isOpenAt(edge.hours, profile.at);
      if (open === false) return false;
      if (open === null && profile.hours === "require_known") return false;
    }
    return true;
  }

  function result(goal: string, previous: Map<string, Previous>, profile: RouteProfile): RouteResult {
    // Starts have no predecessor, so the walk back ends at whichever start the path came from.
    const path: Previous[] = [];
    let fromNodeId = goal;
    for (let step = previous.get(fromNodeId); step; step = previous.get(fromNodeId)) {
      path.push(step);
      fromNodeId = step.fromNodeId;
    }
    path.reverse();

    const nodeIds = [fromNodeId];
    const steps: RouteStep[] = [];
    const unknownEdges = new Map<RouteUnknown, string[]>();
    const sourceIds = new Set<string>();
    let totalLengthM = 0;
    let estimatedSeconds = 0;
    let floorChanges = 0;
    let crossesFareBoundary: boolean | null = false;
    let evidenceCheckedDate: string | null = null;
    let synthetic = bundle.station.synthetic;
    const timeRestricted: RouteResult["timeRestricted"] = [];
    const operatorIds: string[] = [];
    const touchOperator = (floorId: string) => {
      const operatorId = floors.get(floorId)?.operatorId;
      if (operatorId !== undefined && !operatorIds.includes(operatorId)) operatorIds.push(operatorId);
    };
    touchOperator(nodes.get(fromNodeId)!.floorId);
    const unknown = (kind: RouteUnknown, edgeId: string) => {
      const ids = unknownEdges.get(kind) ?? [];
      ids.push(edgeId);
      unknownEdges.set(kind, ids);
    };

    for (const { fromNodeId: from, traversal } of path) {
      const { edge, toNodeId: to, reversed, measurement } = traversal;
      const fromFloorId = nodes.get(from)!.floorId;
      const toFloorId = nodes.get(to)!.floorId;
      const lengthM = measurement.lengthM;
      steps.push({ edgeId: edge.id, fromNodeId: from, toNodeId: to, reversed, mode: edge.mode, lengthM, fromFloorId, toFloorId });
      nodeIds.push(to);
      totalLengthM += lengthM;
      estimatedSeconds += edge.mode === "elevator" ? ELEVATOR_SECONDS
        : lengthM / (edge.mode === "stairs" ? 0.5 : edge.mode === "escalator" ? 0.75 : WALK_SPEED);
      if (fromFloorId !== toFloorId) floorChanges++;
      if (edge.crossesFareBoundary === true) crossesFareBoundary = true;
      else if (edge.crossesFareBoundary === null) {
        unknown("fare_boundary", edge.id);
        if (crossesFareBoundary === false) crossesFareBoundary = null;
      }
      touchOperator(toFloorId);
      if (edge.verification === "synthetic") synthetic = true;
      if (edge.hours === null) unknown("hours", edge.id);
      else if (edge.hours.kind === "window" && !profile.at) {
        const { open, close, days } = edge.hours;
        timeRestricted.push(days ? { edgeId: edge.id, open, close, days } : { edgeId: edge.id, open, close });
      }
      if (edge.paid === null) unknown("paid", edge.id);
      if (edge.wheelchair === null) unknown("wheelchair", edge.id);
      if (edge.steps === null) unknown("steps", edge.id);
      if (edge.accessEvidence === null) unknown("access_evidence", edge.id);
      // Hours evidence counts like geometry and access evidence: its sources are dependencies (an undated
      // one keeps freshness UNKNOWN) and its checkedDate joins evidenceCheckedDate.
      for (const evidence of [edge.geometryEvidence, edge.accessEvidence, edge.hours?.evidence ?? null]) {
        if (!evidence) continue;
        for (const sourceId of evidence.sourceIds) sourceIds.add(sourceId);
        if (evidenceCheckedDate === null || evidence.checkedDate > evidenceCheckedDate) {
          evidenceCheckedDate = evidence.checkedDate;
        }
      }
    }

    const kinds: RouteUnknown[] = ["hours", "paid", "fare_boundary", "wheelchair", "steps", "access_evidence"];
    const unknowns = kinds.flatMap((kind) => {
      const edgeIds = unknownEdges.get(kind);
      return edgeIds ? [{ kind, edgeIds }] : [];
    });
    let oldestSourceDate: string | null = null;
    const undatedSourceIds: string[] = [];
    for (const sourceId of [...sourceIds].sort()) {
      const date = sourceDates.get(sourceId) ?? null;
      if (date === null) undatedSourceIds.push(sourceId);
      else if (oldestSourceDate === null || date < oldestSourceDate) oldestSourceDate = date;
    }
    // Stale when some source is old even at the latest moment its stated date allows; fresh only when every
    // source is recent even at its earliest. A year/month-only date straddling the cutoff, or an undated
    // dependency, leaves freshness UNKNOWN.
    let stale: boolean | null = null;
    // `today` must be one real calendar day; a partial or invalid one leaves freshness UNKNOWN.
    const todayInterval = profile.today ? dateInterval(profile.today) : null;
    const today = todayInterval && todayInterval.first === todayInterval.last ? todayInterval : null;
    if (today) {
      const maxAgeDays = profile.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
      let allFresh = undatedSourceIds.length === 0;
      for (const sourceId of sourceIds) {
        const date = sourceDates.get(sourceId);
        if (!date) continue;
        const interval = dateInterval(date);
        if (!interval) { allFresh = false; continue; }
        if ((today.first - interval.last) / DAY_MS > maxAgeDays) { stale = true; break; }
        if ((today.first - interval.first) / DAY_MS > maxAgeDays) allFresh = false;
      }
      if (stale === null && allFresh && sourceIds.size > 0) stale = false;
    }
    return {
      ok: true, nodeIds, steps, totalLengthM, estimatedSeconds, floorChanges, crossesFareBoundary, unknowns,
      sourceIds: [...sourceIds].sort(), evidenceCheckedDate, oldestSourceDate, undatedSourceIds, stale, synthetic, timeRestricted, operatorIds,
    };
  }

  return {
    isTraversable(edge, profile) {
      const fromNode = nodes.get(edge.from);
      const toNode = nodes.get(edge.to);
      return fromNode !== undefined && toNode !== undefined && measureEdge(edge, fromNode.position, toNode.position) !== null &&
        permits(edge, profile, new Set(profile.avoidModes), new Set(profile.extraClosedEdgeIds));
    },
    route(fromNodeIds, toNodeIds, profile = DEFAULT_PROFILE) {
      const requestedStarts = typeof fromNodeIds === "string" ? [fromNodeIds] : fromNodeIds;
      const starts = [...new Set(requestedStarts.filter((id) => nodes.has(id)))];
      if (starts.length === 0) return { ok: false, reason: "unknown_start", message: `Unknown start node: ${requestedStarts.join(", ")}` };
      const requestedGoals = typeof toNodeIds === "string" ? [toNodeIds] : toNodeIds;
      const goals = new Set(requestedGoals.filter((id) => nodes.has(id)));
      if (goals.size === 0) return { ok: false, reason: "unknown_goal", message: "No known goal nodes were supplied." };
      // Already standing at the destination beats any walk from another start.
      if (starts.some((id) => goals.has(id))) return { ok: false, reason: "start_equals_goal", message: "The start is already a goal node." };

      const avoided = new Set(profile.avoidModes);
      const closed = new Set(profile.extraClosedEdgeIds);
      // Multi-source Dijkstra: every start begins at cost 0, so the cheapest start wins on the router's own cost.
      const distances = new Map<string, number>(starts.map((id) => [id, 0]));
      const previous = new Map<string, Previous>();
      const settled = new Set<string>();
      const queue = new MinHeap();
      for (const id of starts) queue.push({ nodeId: id, cost: 0 });
      for (let current = queue.pop(); current; current = queue.pop()) {
        if (settled.has(current.nodeId) || current.cost !== distances.get(current.nodeId)) continue;
        settled.add(current.nodeId);
        if (goals.has(current.nodeId)) return result(current.nodeId, previous, profile);
        for (const traversal of adjacency.get(current.nodeId)!) {
          if (settled.has(traversal.toNodeId) || !permits(traversal.edge, profile, avoided, closed)) continue;
          const cost = current.cost + traversal.measurement.cost;
          if (!Number.isFinite(cost) || cost >= (distances.get(traversal.toNodeId) ?? Infinity)) continue;
          distances.set(traversal.toNodeId, cost);
          previous.set(traversal.toNodeId, { fromNodeId: current.nodeId, traversal });
          queue.push({ nodeId: traversal.toNodeId, cost });
        }
      }
      return { ok: false, reason: "no_path", message: "No traversable path connects the start to a goal." };
    },
  };
}
