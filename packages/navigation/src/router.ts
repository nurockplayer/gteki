import type { Edge, StationBundle, Vec3N } from "@gteki/schema";
import { isOpenAt } from "@gteki/schema";
import { DEFAULT_PROFILE, DEFAULT_STALE_AFTER_DAYS } from "./index.ts";
import type { Router, RouteProfile, RouteResult, RouteStep, RouteUnknown } from "./index.ts";

const WALK_SPEED = 1.2;
const ELEVATOR_SECONDS = 45;

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

function measureEdge(edge: Edge): Measurement | null {
  if (edge.lengthM !== null && (!Number.isFinite(edge.lengthM) || edge.lengthM < 0)) return null;
  const lengthM = edge.lengthM ?? geometryLength(edge.geometry, edge.geometryZ === "symbolic");
  if (lengthM === null) return null;
  // Every mode needs measurable geometry or length; lift cost is fixed per ride.
  if (edge.mode === "elevator") return { lengthM, cost: ELEVATOR_SECONDS * WALK_SPEED };
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

function daysBetween(older: string, newer: string): number | null {
  const a = Date.parse(older);
  const b = Date.parse(newer);
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / DAY_MS : null;
}

export function createRouter(bundle: StationBundle): Router {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const floors = new Map(bundle.floors.map((floor) => [floor.id, floor]));
  const sourceDates = new Map(bundle.sources.map((source) => [source.id, source.datasetDate]));
  const adjacency = new Map<string, Traversal[]>();
  for (const nodeId of nodes.keys()) adjacency.set(nodeId, []);
  for (const edge of bundle.edges) {
    const measurement = measureEdge(edge);
    if (!measurement || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
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

  function result(fromNodeId: string, goal: string, previous: Map<string, Previous>, profile: RouteProfile): RouteResult {
    const path: Previous[] = [];
    for (let nodeId = goal; nodeId !== fromNodeId;) {
      const step = previous.get(nodeId)!;
      path.push(step);
      nodeId = step.fromNodeId;
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
      for (const evidence of [edge.geometryEvidence, edge.accessEvidence]) {
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
    // Known-old evidence proves staleness; otherwise an undated dependency leaves freshness UNKNOWN.
    let stale: boolean | null = null;
    if (profile.today && oldestSourceDate) {
      const age = daysBetween(oldestSourceDate, profile.today);
      if (age !== null) stale = age > (profile.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS);
    }
    if (stale === false && undatedSourceIds.length > 0) stale = null;
    return {
      ok: true, nodeIds, steps, totalLengthM, estimatedSeconds, floorChanges, crossesFareBoundary, unknowns,
      sourceIds: [...sourceIds].sort(), evidenceCheckedDate, oldestSourceDate, undatedSourceIds, stale, synthetic, timeRestricted, operatorIds,
    };
  }

  return {
    isTraversable(edge, profile) {
      return nodes.has(edge.from) && nodes.has(edge.to) && measureEdge(edge) !== null &&
        permits(edge, profile, new Set(profile.avoidModes), new Set(profile.extraClosedEdgeIds));
    },
    route(fromNodeId, toNodeIds, profile = DEFAULT_PROFILE) {
      if (!nodes.has(fromNodeId)) return { ok: false, reason: "unknown_start", message: `Unknown start node: ${fromNodeId}` };
      const requestedGoals = typeof toNodeIds === "string" ? [toNodeIds] : toNodeIds;
      const goals = new Set(requestedGoals.filter((id) => nodes.has(id)));
      if (goals.size === 0) return { ok: false, reason: "unknown_goal", message: "No known goal nodes were supplied." };
      if (goals.has(fromNodeId)) return { ok: false, reason: "start_equals_goal", message: "The start is already a goal node." };

      const avoided = new Set(profile.avoidModes);
      const closed = new Set(profile.extraClosedEdgeIds);
      const distances = new Map<string, number>([[fromNodeId, 0]]);
      const previous = new Map<string, Previous>();
      const settled = new Set<string>();
      const queue = new MinHeap();
      queue.push({ nodeId: fromNodeId, cost: 0 });
      for (let current = queue.pop(); current; current = queue.pop()) {
        if (settled.has(current.nodeId) || current.cost !== distances.get(current.nodeId)) continue;
        settled.add(current.nodeId);
        if (goals.has(current.nodeId)) return result(fromNodeId, current.nodeId, previous, profile);
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
