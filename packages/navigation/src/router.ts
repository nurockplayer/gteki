import type { Edge, EvidenceRef, LocalTime, StationBundle, Vec3N, Weekday } from "@gteki/schema";
import { isOpenAt, parseHm } from "@gteki/schema";
import { DEFAULT_PROFILE, DEFAULT_STALE_AFTER_DAYS } from "./index.ts";
import type { Router, RouteProfile, RouteResult, RouteStep, RouteUnknown } from "./index.ts";

const WALK_SPEED = 1.2;
const ELEVATOR_SECONDS = 45;
const SLOPED_MODES = new Set(["stairs", "escalator", "ramp"]);
/** Never step-free, whatever an edge's access flags say. */
const NOT_STEP_FREE_MODES = new Set(["stairs", "escalator"]);
/** Minutes of slack around a traversal when sampling hours (well under the router's timing precision). */
const CLOCK_EPSILON = 1e-6;
/** Latest arrival (clock minutes from the departure day) whose hours are checked. */
const MAX_CLOCK_MINUTES = 366 * 1440;
const WEEK_MINUTES = 7 * 1440;
const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Travel time of one edge: lifts are a fixed ride, everything else length over the mode's speed. */
function edgeSeconds(mode: Edge["mode"], lengthM: number): number {
  return mode === "elevator" ? ELEVATOR_SECONDS : lengthM / (mode === "stairs" ? 0.5 : mode === "escalator" ? 0.75 : WALK_SPEED);
}

/**
 * The station-local time `clock` minutes after midnight of `at`'s day, rolling over into later weekdays
 * (whole `clock` minutes stay exact). An invalid `at` stays as is (UNKNOWN).
 */
function clockTime(at: LocalTime, clock: number): LocalTime {
  if (!WEEK.includes(at.weekday) || !(at.minutes >= 0 && at.minutes < 1440)) return at;
  const days = Math.floor(clock / 1440);
  return { weekday: WEEK[(((WEEK.indexOf(at.weekday) + days) % 7) + 7) % 7]!, minutes: clock - days * 1440 };
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface QueueEntry {
  nodeId: string;
  cost: number;
  /** Push order: the last tie-breaker, so equal labels are settled deterministically. */
  seq: number;
  label: Label;
}

const compareEntries = (a: QueueEntry, b: QueueEntry): number =>
  a.cost - b.cost || compareIds(a.nodeId, b.nodeId) || a.seq - b.seq;

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

/**
 * Polyline endpoints sit on their nodes, exactly as routePolyline draws them: in plan and in height.
 * A node of unknown height makes its endpoint height unknown too, so no climb is measured that the
 * drawn path (which shows the node's display height there) doesn't have.
 */
function snapEndpoints(geometry: Vec3N[] | undefined, from: Vec3N, to: Vec3N): Vec3N[] | undefined {
  if (!geometry || geometry.length < 2) return geometry;
  const out = [...geometry];
  out[0] = { x: from.x, y: from.y, z: from.z };
  out[out.length - 1] = { x: to.x, y: to.y, z: to.z };
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
  /** Clock minute (from midnight of the departure day) the edge is entered; only with `profile.at`. */
  startClock?: number;
  /** Seconds spent waiting at `fromNodeId` for the edge to open. */
  waitSeconds?: number;
}

/**
 * A partial route: where it is, at what cost, at which clock minute (from midnight of the departure day;
 * 0 without `profile.at`), whether that clock is exact (the departure, or the whole minute a wait ended)
 * rather than a sum of durations, and how it got there.
 */
interface Label {
  nodeId: string;
  cost: number;
  clock: number;
  exact: boolean;
  parent: Label | null;
  via: Previous | null;
}

/**
 * Router cost of waiting one second for an edge to open: no more than any way of moving costs per second
 * (escalator 0.75 m/s at 1/m; stairs 0.8; walking, ramps, walkways and lifts 1.2). So walking a loop is
 * never cheaper than waiting it out, which makes "earlier and not dearer than waiting would make it"
 * a sound dominance, and a detour that exists is preferred over a long wait.
 */
const WAIT_COST_PER_SECOND = 0.75;
/**
 * Work budget of a clock-dependent search, in edges tried, dominance comparisons and opening-hours samples
 * (well under a second on a laptop; real stations use a few percent of it); past it the result is
 * `search_limit`, never `no_path`.
 */
const WORK_BUDGET = 2_000_000;
/** Relative cost slack in label dominance (far below any real cost difference). */
const COST_TOLERANCE = 1e-9;

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
  const sourceValidUntil = new Map(bundle.sources.map((source) => [source.id, source.validUntil ?? null]));
  const adjacency = new Map<string, Traversal[]>();
  for (const nodeId of nodes.keys()) adjacency.set(nodeId, []);
  /**
   * Relative rounding bound on any route's elapsed time: a path's duration sums at most one term per edge
   * and per polyline segment in the bundle, each a few roundings off (subtract, hypot, divide), and the
   * running sums add one rounding per term. 4·N·ε (= 8·N·u) covers that with margin.
   */
  const timeDrift = 4 * (bundle.edges.length + bundle.edges.reduce((n, e) => n + (e.geometry?.length ?? 0), 0) + 8) * Number.EPSILON;
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

  /** Access facts only count when evidenced: without accessEvidence every flag is UNKNOWN. */
  const accessOf = (edge: Edge): Pick<Edge, "paid" | "crossesFareBoundary" | "wheelchair" | "steps"> =>
    edge.accessEvidence ? edge : { paid: null, crossesFareBoundary: null, wheelchair: null, steps: null };

  /** Everything about an edge but the clock: verification, closures, profile filters, unknown hours. */
  function allowed(edge: Edge, profile: RouteProfile, avoided: Set<string>, closed: Set<string>): boolean {
    if (
      edge.verification !== "verified" &&
      !(edge.verification === "synthetic" && bundle.station.synthetic === true)
    ) return false;
    if (edge.closed || closed.has(edge.id) || avoided.has(edge.mode)) return false;
    const access = accessOf(edge);
    if (profile.stepFree && (NOT_STEP_FREE_MODES.has(edge.mode) || access.wheelchair !== true || access.steps === true)) return false;
    if (profile.fare === "unpaid_only" && (access.paid !== false || access.crossesFareBoundary !== false)) return false;
    if (edge.hours === null) return profile.hours !== "require_known";
    return true;
  }

  /**
   * Known hours stay open for the whole traversal entered at clock minute `enter` (from midnight of the
   * departure day) and lasting `edgeSec`. Windows open and close on whole minutes (close exclusive), so
   * entry, exit and every whole clock minute in between catch any closure; the in-between samples are exact
   * integers. Both ends are widened by the rounding a summed clock can carry (`timeDrift`), so floating-point
   * drift can't round a boundary minute away: an exact-minute arrival may then fail closed, never the other
   * way round. An `exact` entry (the departure, or the end of a wait) is not widened. Hours repeat weekly, so
   * one week of clock minutes covers every minute of a longer traversal.
   */
  // Per-query search state: work spent (see WORK_BUDGET) and each window edge's weekly openings.
  let work = 0;
  let openingCache = new Map<Edge, number[]>();

  function openThroughout(edge: Edge, profile: RouteProfile, enter: number, edgeSec: number, exact: boolean): boolean {
    if (!profile.at || edge.hours === null) return true;
    const leave = enter + edgeSec / 60;
    // Past a year the hours can't be meaningfully checked: fail closed.
    if (!(leave <= MAX_CLOCK_MINUTES)) return false;
    const drift = timeDrift * leave;
    const samples = [enter, leave];
    work += 2 + Math.min(Math.max(0, leave - enter), WEEK_MINUTES);
    const first = Math.floor(exact ? enter : enter - drift);
    // A week from the entry minute (plus the minute the widening may add before it) covers every weekly minute.
    for (let c = first, n = 0; c <= leave + drift + CLOCK_EPSILON && n < 7 * 1440 + 2; c++, n++) samples.push(c);
    for (const clock of samples) {
      const open = isOpenAt(edge.hours, clockTime(profile.at, clock));
      if (open === false) return false;
      if (open === null && profile.hours === "require_known") return false;
    }
    return true;
  }

  /**
   * The earliest clock minute ≥ `enter` at which the edge can be entered and stay open throughout, waiting
   * at its start if need be; null when it doesn't open within a week (hours repeat weekly) or the year cap.
   * Windows open on whole minutes, and in an open stretch the earliest feasible start is its first minute,
   * so besides `enter` itself only window openings are candidates.
   */
  function earliestStart(edge: Edge, profile: RouteProfile, enter: number, edgeSec: number, exact: boolean): number | null {
    if (openThroughout(edge, profile, enter, edgeSec, exact)) return enter;
    const at = profile.at;
    if (!at || edge.hours?.kind !== "window") return null;
    const weekly = openings(edge, at);
    // A summed clock may carry rounding (see openThroughout): an opening minute within that bound below
    // `enter` (an arrival computed as exactly 05:00) is a candidate too, checked from the opening itself.
    const slack = exact ? 0 : timeDrift * (enter + edgeSec / 60);
    const from = Math.floor(enter - slack) + 1;
    const week = Math.floor(from / WEEK_MINUTES) * WEEK_MINUTES;
    // Openings from `from` up to one week later, in order: this week's, then next week's.
    for (const base of [week, week + WEEK_MINUTES])
      for (const o of weekly) {
        const m = base + o;
        if (m < from) continue;
        if (m >= from + WEEK_MINUTES || m > MAX_CLOCK_MINUTES) return null;
        // Entering at max(m, enter) stays inside [m, m + the edge's time + how far enter is past m].
        if (openThroughout(edge, profile, m, edgeSec + Math.max(0, enter - m) * 60, true)) return Math.max(m, enter);
      }
    return null;
  }

  /**
   * Clock minutes (mod one week from the departure day's midnight) at which a window of the edge begins, a
   * superset of the minutes it turns open. A start inside a stretch that is already open is harmless:
   * that stretch's own start comes first, or the entry itself was feasible. Empty when hours are UNKNOWN.
   */
  function openings(edge: Edge, at: LocalTime): number[] {
    let out = openingCache.get(edge);
    if (out) return out;
    out = [];
    work += 7;
    const hours = edge.hours;
    const today = WEEK.indexOf(at.weekday);
    if (hours?.kind === "window" && today >= 0 && at.minutes >= 0 && at.minutes < 1440) {
      const open = parseHm(hours.open);
      let close = parseHm(hours.close);
      // As isOpenAt: a close before the open runs past midnight; equal ends are UNKNOWN (never open).
      if (close !== null && open !== null) while (close < open) close += 1440;
      if (open !== null && close !== null && open !== close) {
        const days = new Set(hours.days ?? WEEK);
        for (let k = 0; k < 7; k++) if (days.has(WEEK[(today + k) % 7]!)) out.push((k * 1440 + open) % WEEK_MINUTES);
        out.sort((a, b) => a - b);
      }
    }
    openingCache.set(edge, out);
    return out;
  }

  function result(goal: Label, profile: RouteProfile, endpointEvidence: readonly EvidenceRef[]): RouteResult {
    // Starts have no predecessor, so the walk back ends at whichever start the path came from.
    const path: Previous[] = [];
    let fromNodeId = goal.nodeId;
    for (let label: Label | null = goal; label?.via; label = label.parent) {
      path.push(label.via);
      fromNodeId = label.via.fromNodeId;
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

    let waitSeconds = 0;
    for (const { fromNodeId: from, traversal, startClock, waitSeconds: wait } of path) {
      const { edge, toNodeId: to, reversed, measurement } = traversal;
      const fromFloorId = nodes.get(from)!.floorId;
      const toFloorId = nodes.get(to)!.floorId;
      const lengthM = measurement.lengthM;
      const step: RouteStep = { edgeId: edge.id, fromNodeId: from, toNodeId: to, reversed, mode: edge.mode, lengthM, fromFloorId, toFloorId };
      if (wait && wait > 0 && profile.at && startClock !== undefined) {
        // A wait always ends on a whole minute (a window opening), so the stated time is exact.
        const dayOffset = Math.floor(startClock / 1440);
        step.waitSeconds = wait;
        step.waitUntil = { weekday: clockTime(profile.at, startClock).weekday, minutes: startClock - dayOffset * 1440, dayOffset };
        waitSeconds += wait;
        estimatedSeconds += wait;
      }
      steps.push(step);
      nodeIds.push(to);
      totalLengthM += lengthM;
      estimatedSeconds += edgeSeconds(edge.mode, lengthM);
      if (fromFloorId !== toFloorId) floorChanges++;
      const access = accessOf(edge);
      if (access.crossesFareBoundary === true) crossesFareBoundary = true;
      else if (access.crossesFareBoundary === null) {
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
      if (access.paid === null) unknown("paid", edge.id);
      if (access.wheelchair === null) unknown("wheelchair", edge.id);
      if (access.steps === null) unknown("steps", edge.id);
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
    // Node coordinates are drawn and measured too, so their sources are dependencies like edge evidence;
    // so are the traversed floors' sources, which back floor names and up/down in the directions.
    for (const nodeId of nodeIds) for (const ref of nodes.get(nodeId)!.sourceRefs) sourceIds.add(ref.sourceId);
    for (const floorId of new Set(nodeIds.map((id) => nodes.get(id)!.floorId)))
      for (const label of floors.get(floorId)?.sourceLabels ?? []) sourceIds.add(label.sourceId);
    // So is whatever ties the chosen origin/destination (e.g. a POI) to these connector nodes.
    for (const evidence of endpointEvidence) {
      for (const sourceId of evidence.sourceIds) sourceIds.add(sourceId);
      if (evidenceCheckedDate === null || evidence.checkedDate > evidenceCheckedDate) evidenceCheckedDate = evidence.checkedDate;
    }
    let oldestSourceDate: string | null = null;
    const undatedSourceIds: string[] = [];
    for (const sourceId of [...sourceIds].sort()) {
      const date = sourceDates.get(sourceId) ?? null;
      if (date === null) undatedSourceIds.push(sourceId);
      else if (oldestSourceDate === null || date < oldestSourceDate) oldestSourceDate = date;
    }
    // Stale when some source is old even at the latest moment its stated date allows, or its declared
    // validity (validUntil) has ended; fresh only when every source is recent even at its earliest and still
    // valid. A year/month-only date straddling the cutoff, or an undated dependency, leaves freshness UNKNOWN.
    let stale: boolean | null = null;
    const expiredSourceIds: string[] = [];
    // `today` must be one real calendar day; a partial or invalid one leaves freshness UNKNOWN.
    const todayInterval = profile.today ? dateInterval(profile.today) : null;
    const today = todayInterval && todayInterval.first === todayInterval.last ? todayInterval : null;
    if (today) {
      const maxAgeDays = profile.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
      let allFresh = undatedSourceIds.length === 0;
      for (const sourceId of [...sourceIds].sort()) {
        const validUntil = sourceValidUntil.get(sourceId);
        if (validUntil) {
          const until = dateInterval(validUntil);
          if (!until) allFresh = false;
          else if (today.first > until.last) { expiredSourceIds.push(sourceId); stale = true; }
          else if (today.first > until.first) allFresh = false; // "2026-10" may have ended before the 20th; it covers the 1st
        }
        const date = sourceDates.get(sourceId);
        if (!date) continue;
        const interval = dateInterval(date);
        if (!interval) { allFresh = false; continue; }
        if ((today.first - interval.last) / DAY_MS > maxAgeDays) stale = true;
        if ((today.first - interval.first) / DAY_MS > maxAgeDays) allFresh = false;
      }
      if (stale === null && allFresh && sourceIds.size > 0) stale = false;
    }
    return {
      ok: true, nodeIds, steps, totalLengthM, estimatedSeconds, waitSeconds, floorChanges, crossesFareBoundary, unknowns,
      sourceIds: [...sourceIds].sort(), evidenceCheckedDate, oldestSourceDate, undatedSourceIds, expiredSourceIds, stale, synthetic, timeRestricted, operatorIds,
    };
  }

  return {
    isTraversable(edge, profile) {
      const fromNode = nodes.get(edge.from);
      const toNode = nodes.get(edge.to);
      const measured = fromNode && toNode ? measureEdge(edge, fromNode.position, toNode.position) : null;
      return measured !== null && allowed(edge, profile, new Set(profile.avoidModes), new Set(profile.extraClosedEdgeIds)) &&
        openThroughout(edge, profile, profile.at?.minutes ?? 0, edgeSeconds(edge.mode, measured.lengthM), true);
    },
    route(fromNodeIds, toNodeIds, profile = DEFAULT_PROFILE, endpointEvidence = []) {
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
      // Multi-source label-setting search: every start begins at cost 0, so the cheapest start wins on the
      // router's own cost. Without clock-dependent hours this is plain Dijkstra (one label per node).
      // With them, an edge is entered at the earliest moment it is open for the whole traversal, waiting at
      // its start for a window to open if need be (the wait is a route step, narrated and timed). Waiting
      // makes the search FIFO: a label that is earlier, and no dearer than waiting until the other's time
      // would make it, can do everything the other can. So each node keeps only labels no settled one
      // dominates (a Pareto set over cost and arrival); a loop is always dominated by waiting it out
      // (WAIT_COST_PER_SECOND), so the search is complete and ends. Its work is still budgeted: past
      // WORK_BUDGET the answer is `search_limit`, never a false `no_path`.
      const timed = profile.at !== undefined && bundle.edges.some((e) => e.hours?.kind === "window");
      const departure = profile.at?.minutes ?? 0;
      // Escalators cost exactly what waiting does, so a loop ties its ancestor: compare with a relative
      // tolerance, or rounding (18 vs 18.000000000004) keeps every loop alive until the budget runs out.
      const dominates = (x: Label, y: Label) =>
        x.clock <= y.clock && x.cost + WAIT_COST_PER_SECOND * (y.clock - x.clock) * 60 <= y.cost + COST_TOLERANCE * Math.max(1, Math.abs(y.cost));
      const settled = new Map<string, Label[]>();
      work = 0;
      openingCache = new Map();
      const dominated = (label: Label) => {
        const done = settled.get(label.nodeId) ?? [];
        work += done.length;
        return done.some((l) => dominates(l, label));
      };
      const best = new Map<string, number>();
      const queue = new MinHeap();
      let seq = 0;
      const push = (label: Label) => queue.push({ nodeId: label.nodeId, cost: label.cost, seq: seq++, label });
      for (const id of starts) push({ nodeId: id, cost: 0, clock: departure, exact: true, parent: null, via: null });
      for (let entry = queue.pop(); entry; entry = queue.pop()) {
        const current = entry.label;
        if (timed && work > WORK_BUDGET)
          return { ok: false, reason: "search_limit", message: "The route search hit its work limit; whether a route exists is UNKNOWN." };
        const done = settled.get(current.nodeId) ?? [];
        // Popped in cost order, so a settled label is never dearer.
        if (timed ? dominated(current) : done.length > 0) continue;
        done.push(current);
        settled.set(current.nodeId, done);
        if (goals.has(current.nodeId)) return result(current, profile, endpointEvidence);
        for (const traversal of adjacency.get(current.nodeId)!) {
          // The budget is checked per edge tried, so one wide node can't overrun it.
          if (timed && ++work > WORK_BUDGET)
            return { ok: false, reason: "search_limit", message: "The route search hit its work limit; whether a route exists is UNKNOWN." };
          const to = traversal.toNodeId;
          if (!timed && settled.has(to)) continue;
          if (!allowed(traversal.edge, profile, avoided, closed)) continue;
          const seconds = edgeSeconds(traversal.edge.mode, traversal.measurement.lengthM);
          const start = timed
            ? earliestStart(traversal.edge, profile, current.clock, seconds, current.exact)
            : openThroughout(traversal.edge, profile, current.clock, seconds, current.exact) ? current.clock : null;
          if (start === null) continue;
          const waitSeconds = (start - current.clock) * 60;
          const cost = current.cost + traversal.measurement.cost + WAIT_COST_PER_SECOND * waitSeconds;
          if (!Number.isFinite(cost)) continue;
          // Untimed, only a strictly cheaper path to a node is worth queueing (as before).
          if (!timed) {
            if (cost >= (best.get(to) ?? Infinity)) continue;
            best.set(to, cost);
          }
          const label: Label = {
            nodeId: to, cost, clock: start + seconds / 60,
            // A wait ends on an exact whole minute; a zero-length step keeps it exact.
            exact: (waitSeconds > 0 || current.exact) && seconds === 0,
            parent: current,
            via: { fromNodeId: current.nodeId, traversal, ...(profile.at ? { startClock: start } : {}), ...(waitSeconds > 0 ? { waitSeconds } : {}) },
          };
          if (timed && dominated(label)) continue;
          push(label);
        }
      }
      return { ok: false, reason: "no_path", message: "No traversable path connects the start to a goal." };
    },
  };
}
