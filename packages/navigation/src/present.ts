import type { Edge, EdgeMode, Floor, Node, StationBundle } from "@gteki/schema";
import { DEFAULT_PROFILE } from "./index.ts";
import { createRouter } from "./router.ts";
import type { RouteProfile, RouteResult } from "./index.ts";

/**
 * Renderer-neutral presentation of a computed route: a station-ENU polyline for drawing and
 * walking, and grouped instructions. Both are derived only from the route and the bundle, so
 * Web and Godot clients present identical guidance without re-implementing routing.
 */

export interface PolylinePoint {
  x: number;
  y: number;
  /** Height used for display. */
  z: number;
  /** False when z is a symbolic/interpolated display height rather than a source/measured value. */
  zKnown: boolean;
  /** Index into route.steps of the segment ending at this point; -1 for the start point. */
  stepIndex: number;
  floorId: string;
}

export function nodeDisplayZ(node: Node, floor: Floor | undefined): { z: number; known: boolean } {
  if (node.position.z !== null) return { z: node.position.z, known: true };
  if (node.renderZ !== undefined) return { z: node.renderZ, known: false };
  return { z: floor?.renderElevationM ?? 0, known: false };
}

/** Polyline along the route, following edge geometry (reversed when traversed backwards). */
export function routePolyline(bundle: StationBundle, route: RouteResult): PolylinePoint[] {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const edges = new Map(bundle.edges.map((e) => [e.id, e]));
  const points: PolylinePoint[] = [];
  const startNode = nodes.get(route.nodeIds[0]!)!;
  const s = nodeDisplayZ(startNode, floors.get(startNode.floorId));
  points.push({ x: startNode.position.x, y: startNode.position.y, z: s.z, zKnown: s.known, stepIndex: -1, floorId: startNode.floorId });

  route.steps.forEach((step, stepIndex) => {
    const from = nodes.get(step.fromNodeId)!;
    const to = nodes.get(step.toNodeId)!;
    const a = nodeDisplayZ(from, floors.get(from.floorId));
    const b = nodeDisplayZ(to, floors.get(to.floorId));
    const edge = edges.get(step.edgeId);
    const symbolicPolyline = edge?.geometryZ === "symbolic";
    const drawn = edge?.geometry && edge.geometry.length >= 2 ? edge.geometry : null;
    const raw = drawn ? [...drawn] : [from.position, to.position];
    // Only drawn geometry is stored in edge direction; the node-to-node fallback already runs from → to.
    if (step.reversed && drawn) raw.reverse();
    // Interior points: cumulative 2D distance for height interpolation when z is unknown.
    const lengths = [0];
    for (let i = 1; i < raw.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
    const total = lengths[lengths.length - 1]! || 1;
    for (let i = 1; i < raw.length; i++) {
      const p = raw[i]!;
      const last = i === raw.length - 1;
      const t = lengths[i]! / total;
      const known = p.z !== null && !symbolicPolyline && (last ? b.known : true);
      const z = last ? b.z : p.z !== null ? p.z : a.z + (b.z - a.z) * t;
      points.push({ x: last ? to.position.x : p.x, y: last ? to.position.y : p.y, z, zKnown: known, stepIndex, floorId: last ? to.floorId : from.floorId });
    }
  });
  return points;
}

/**
 * The polyline points an instruction covers, including the junction it starts from (each point is
 * tagged with the step that *ends* at it, so the step's start carries the previous step's index).
 */
export function instructionPoints(points: readonly PolylinePoint[], instruction: Pick<Instruction, "stepIndexes" | "beforeStepIndex">): PolylinePoint[] {
  // A wait covers no step: it is where the step it precedes starts.
  if (instruction.beforeStepIndex !== undefined) {
    const k = instruction.beforeStepIndex;
    const i = points.findIndex((p, j) => j + 1 < points.length && points[j + 1]!.stepIndex === k && p.stepIndex !== k);
    return i >= 0 ? [points[i]!] : [];
  }
  const covered = new Set(instruction.stepIndexes);
  return points.filter((p, i) => covered.has(p.stepIndex) || (i + 1 < points.length && covered.has(points[i + 1]!.stepIndex)));
}

export type InstructionKind =
  | "start" | "walk" | "turn_left" | "turn_right" | "u_turn"
  | "stairs" | "escalator" | "elevator" | "ramp" | "moving_walkway" | "gate" | "arrive"
  /** Wait where you are until a known opening window starts (the time is in the text). */
  | "wait";

export interface Instruction {
  kind: InstructionKind;
  /** Steps covered by this instruction (indices into route.steps). */
  stepIndexes: number[];
  /** For a "wait": the step it waits before (the wait happens where that step starts). */
  beforeStepIndex?: number;
  distanceM: number;
  /** Vertical sense when evidenced by known elevations or same-operator ordinals; otherwise null. */
  vertical: "up" | "down" | null;
  /** Turn (> 45°, measured over ~5 m) to take before this stair/escalator/lift/ramp/gate; null = none. */
  turn?: "left" | "right" | "back" | null;
  toFloorId: string;
  /** Choice points this walk passes through without a turn, in walking order; absent when none. */
  junctions?: JunctionHint[];
  /** Plain text in the requested language. */
  text: string;
}

/**
 * A node inside a merged walk where another traversable branch leaves (degree ≥ 3 counting the
 * route's own in/out edges): which branch to take there, since no turn instruction marks it.
 */
export interface JunctionHint {
  nodeId: string;
  /** Index into route.steps of the step that leaves the junction. */
  stepIndex: number;
  /** Walking distance from the start of the instruction to the junction. */
  atM: number;
  /** "straight": the chosen branch is clearly the straightest (or the middle of a fork). */
  action: "straight" | "keep_left" | "keep_right";
  /** Name of a POI reached from this node, in the requested language when available; null = none (never invented). */
  name: string | null;
}

const VERTICAL: Partial<Record<EdgeMode, InstructionKind>> = { stairs: "stairs", escalator: "escalator", elevator: "elevator", ramp: "ramp" };
const TURN_DEG = 35;
/** Heading change between consecutive flights that splits them into separate instructions. */
const VERTICAL_TURN_DEG = 45;

/** "level" = heights known and equal (a flat continuation); null = direction UNKNOWN. */
function verticalSense(a: Floor | undefined, b: Floor | undefined, za: number | null, zb: number | null): "up" | "down" | "level" | null {
  if (za !== null && zb !== null) return Math.abs(zb - za) > 0.3 ? (zb > za ? "up" : "down") : "level";
  const evidenced = (f: Floor) => f.elevationM !== null && (f.elevationSource === "measured" || f.elevationSource === "source-derived");
  if (a && b && evidenced(a) && evidenced(b) && a.elevationM !== b.elevationM) return b.elevationM! > a.elevationM! ? "up" : "down";
  if (a && b && a.operatorId === b.operatorId && a.ordinal !== null && b.ordinal !== null && a.ordinal !== b.ordinal) return b.ordinal > a.ordinal ? "up" : "down";
  return null;
}

/** Human-facing floor name: station-authored `displayNames` (lang, then ja), else the exact source label. */
export function floorDisplayName(floor: Floor | undefined, lang: "ja" | "en" = "ja"): string {
  const names = floor?.displayNames ?? [];
  const named = names.find((t) => t.lang === lang) ?? names.find((t) => t.lang === "ja") ?? names[0];
  return named?.text ?? floor?.sourceLabels[0]?.label ?? floor?.id ?? "?";
}

const TEXT = {
  ja: {
    start: () => "出発",
    walk: (m: number) => `約${m}m 直進`,
    /** A walk whose own path bends: no "straight" claim (turns inside one edge aren't named). */
    continue: (m: number) => `約${m}m 進む`,
    turn_left: (m: number) => `左へ曲がり約${m}m`,
    turnPrefix: (turn: "left" | "right" | "back", text: string) => `${{ left: "左へ曲がり、", right: "右へ曲がり、", back: "引き返して、" }[turn]}${text}`,
    turn_right: (m: number) => `右へ曲がり約${m}m`,
    u_turn: (m: number) => `引き返して約${m}m`,
    gate: () => "改札を通過",
    moving_walkway: (m: number) => `動く歩道で約${m}m`,
    /** `floor` null = the chain starts and ends on the same floor: name no destination floor. */
    vertical: (kind: string, sense: string | null, floor: string | null) => {
      const via = { stairs: "階段", escalator: "エスカレーター", elevator: "エレベーター", ramp: "スロープ" }[kind];
      const dir = sense === "up" ? "上へ" : sense === "down" ? "下へ" : "";
      if (floor === null) return dir ? `${via}で${dir}` : `${via}を利用`;
      return `${via}で${dir ? `${dir}・` : ""}${floor}へ`;
    },
    junction: (atM: number, action: JunctionHint["action"], name: string | null) =>
      `約${atM}m先${name === null ? "" : `、${name}`}の分岐は${{ straight: "そのまま直進", keep_left: "左寄りに進む", keep_right: "右寄りに進む" }[action]}`,
    withJunctions: (text: string, hints: string[]) => [text, ...hints].join("。"),
    arrive: () => "目的地に到着",
    wait: (time: string, dayOffset: number, weekday: string) =>
      `${dayOffset === 0 ? "" : dayOffset === 1 ? "翌日" : `${dayOffset < 7 ? "" : `${dayOffset}日後の`}${{ mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" }[weekday]}曜日`}${time}まで待つ`,
  },
  en: {
    start: () => "Start",
    walk: (m: number) => `Go straight ~${m} m`,
    continue: (m: number) => `Continue ~${m} m`,
    turn_left: (m: number) => `Turn left, ~${m} m`,
    turnPrefix: (turn: "left" | "right" | "back", text: string) => `${{ left: "Turn left", right: "Turn right", back: "Turn back" }[turn]}, then ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    turn_right: (m: number) => `Turn right, ~${m} m`,
    u_turn: (m: number) => `Turn back, ~${m} m`,
    gate: () => "Pass the ticket gate",
    moving_walkway: (m: number) => `Moving walkway ~${m} m`,
    vertical: (kind: string, sense: string | null, floor: string | null) =>
      `Take the ${kind}${sense ? ` ${sense}` : ""}${floor === null ? "" : ` to ${floor}`}`,
    junction: (atM: number, action: JunctionHint["action"], name: string | null) =>
      `After ~${atM} m, ${action === "straight"
        ? name === null ? "continue straight through the junction" : `continue straight past ${name}`
        : `keep ${action === "keep_left" ? "left" : "right"} at ${name ?? "the junction"}`}`,
    withJunctions: (text: string, hints: string[]) => `${[text, ...hints].join(". ")}.`,
    arrive: () => "Arrive at destination",
    wait: (time: string, dayOffset: number, weekday: string) =>
      `Wait until ${time}${dayOffset === 0 ? "" : dayOffset === 1 ? " tomorrow" : ` on ${{ mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }[weekday]}${dayOffset < 7 ? "" : `, ${dayOffset} days later`}`}`,
  },
};

/** Span over which a step's entry/exit heading is measured, so short snapping hooks don't flip turns. */
const HEADING_SPAN_M = 5;

/**
 * The point HEADING_SPAN_M along a plan path from its first point, interpolating inside the last
 * segment, so a long sparse segment cannot stretch the chord and invent a turn (or the path's end
 * when it is shorter).
 */
function chordEnd(path: readonly { x: number; y: number }[]): { x: number; y: number } {
  let far = { x: path[0]!.x, y: path[0]!.y };
  let walked = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const p = path[k]!;
    const q = path[k + 1]!;
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    if (walked + seg >= HEADING_SPAN_M) {
      const f = seg === 0 ? 0 : (HEADING_SPAN_M - walked) / seg;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
    }
    walked += seg;
    far = { x: q.x, y: q.y };
  }
  return far;
}

/** Heading (degrees, clockwise from north) from a to b; null when they coincide in plan. */
function heading(a: { x: number; y: number }, b: { x: number; y: number }): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Heading (degrees, clockwise from north) of a step where it starts or ends, measured as the chord
 * over its first/last ~5 m (or the whole step if shorter) rather than its first/last segment.
 */
function stepHeading(points: PolylinePoint[], stepIndex: number, end: "start" | "end"): number | null {
  const own = points.map((p, i) => ({ p, i })).filter(({ p }) => p.stepIndex === stepIndex);
  if (own.length === 0) return null;
  const path = points.slice(own[0]!.i - 1, own[own.length - 1]!.i + 1);
  if (end === "end") path.reverse();
  const at = path[0]!;
  const far = chordEnd(path);
  return end === "start" ? heading(at, far) : heading(far, at);
}

/** Signed heading change (degrees, + = right) from the end of step i-1 to the start of step i. */
/** Steps shorter than this in plan (a co-located or offset gate line) carry no heading of their own. */
const MIN_HEADING_STEP_M = 1;

function stepPlanLength(points: PolylinePoint[], stepIndex: number): number {
  let length = 0;
  for (let k = 1; k < points.length; k++) {
    if (points[k]!.stepIndex === stepIndex) length += Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y);
  }
  return length;
}

/**
 * Heading change at the junction before step i. A step too short to have a heading (a gate line, a
 * sub-metre offset) gets no turn of its own; the turn is named once, at the junction after it, measured
 * from the heading before it. So a short step neither hides a turn, invents one from centimetres of
 * offset, nor repeats one. A lift ride is never looked through: its doors may face anywhere.
 */
function turnDelta(points: PolylinePoint[], steps: RouteResult["steps"], i: number): number | null {
  if (!stepHasHeading(points, steps, i)) return null;
  const h0 = arrivalHeading(points, steps, i);
  const h1 = stepHeading(points, i, "start");
  return h0 === null || h1 === null ? null : signedDelta(h0, h1);
}

/** A lift's plan displacement is motion through the shaft, not which way its doors face: never a heading. */
function stepHasHeading(points: PolylinePoint[], steps: RouteResult["steps"], k: number): boolean {
  return steps[k]!.mode !== "elevator" && stepPlanLength(points, k) >= MIN_HEADING_STEP_M;
}

/** Heading on arrival at the junction before step i: the end of the nearest earlier step that has one. */
function arrivalHeading(points: PolylinePoint[], steps: RouteResult["steps"], i: number): number | null {
  for (let k = i - 1; k >= 0; k--) {
    if (steps[k]!.mode === "elevator") return null;
    if (stepHasHeading(points, steps, k)) return stepHeading(points, k, "end");
  }
  return null;
}

/** Signed change (degrees in [-180, 180), + = right) from heading h0 to heading h1. */
function signedDelta(h0: number, h1: number): number {
  return ((h1 - h0 + 540) % 360) - 180;
}

/** A branch competes with the chosen one unless it bends at least this much more sharply. */
const STRAIGHT_MARGIN_DEG = 30;
/** Branches bending more than this lie behind the traveller: they do not make "keep left/right" ambiguous. */
const AHEAD_DEG = 90;
/** Branches leaving within this angle of each other cannot be told apart by "left/right/straight". */
const SAME_BRANCH_DEG = 1;

/** Plan heading of an edge leaving `node` (its first ~5 m, endpoints snapped as drawn); null = none. */
function departureHeading(edge: Edge, node: Node, other: Node): number | null {
  const drawn = edge.geometry && edge.geometry.length >= 2 ? [...edge.geometry] : [node.position, other.position];
  if (edge.from !== node.id) drawn.reverse();
  const path = [node.position, ...drawn.slice(1, -1), other.position];
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k]!.x - path[k - 1]!.x, path[k]!.y - path[k - 1]!.y);
  return length < MIN_HEADING_STEP_M ? null : heading(path[0]!, chordEnd(path));
}

/**
 * Which way to go at the pass-through node before step i, given the other traversable branches that
 * leave it; null when there is no other branch or the choice cannot be stated without guessing: no
 * heading in or out, a branch (other than a lift door) too short to have a heading, two branches on the
 * same line, or a fork where the route is neither clearly the straightest, nor the straightest of its
 * competitors, nor to one side of every branch ahead.
 */
function junctionAction(
  points: PolylinePoint[], steps: RouteResult["steps"], i: number, branches: readonly Edge[],
  nodes: ReadonlyMap<string, Node>, edges: ReadonlyMap<string, Edge>,
): JunctionHint["action"] | null {
  const node = nodes.get(steps[i]!.fromNodeId)!;
  const otherEnd = (e: Edge) => nodes.get(e.from === node.id ? e.to : e.from)!;
  // The route's own passages leaving this node: back the way the walk came, and on the way it goes.
  const own = [steps[i - 1]!, steps[i]!].map((s) => edges.get(s.edgeId)!);
  const ownHeadings = own.map((e) => ({ end: otherEnd(e).id, h: departureHeading(e, node, otherEnd(e)) }));
  // A separately stored edge between the same nodes that leaves along the same line (a reciprocal
  // one-way pair, a duplicated corridor) is that passage again; a parallel corridor drawn elsewhere is a choice.
  const samePassage = (e: Edge, h: number | null) => ownHeadings.some((o) =>
    o.end === otherEnd(e).id && o.h !== null && h !== null && Math.abs(signedDelta(o.h, h)) < SAME_BRANCH_DEG);
  const others = branches.filter((e) => !own.includes(e) && !samePassage(e, departureHeading(e, node, otherEnd(e))));
  if (others.length === 0) return null;
  const chosen = turnDelta(points, steps, i);
  const h0 = arrivalHeading(points, steps, i);
  if (chosen === null || h0 === null) return null;
  const ahead: number[] = [];
  for (const e of others) {
    // A lift's doors may face anywhere: it is a choice, but never a competing direction.
    if (e.mode === "elevator") continue;
    const h = departureHeading(e, node, otherEnd(e));
    // A walkable branch with no heading of its own (a sub-metre connector) may lead anywhere: no guess.
    if (h === null) return null;
    const d = signedDelta(h0, h);
    if (Math.abs(d - chosen) < SAME_BRANCH_DEG) return null;
    if (Math.abs(d) <= AHEAD_DEG) ahead.push(d);
  }
  const rivals = ahead.filter((d) => Math.abs(d) < Math.abs(chosen) + STRAIGHT_MARGIN_DEG);
  if (rivals.length === 0) return "straight";
  // Keeping to a side is only unambiguous when every branch ahead lies on the other side.
  if (ahead.every((d) => d > chosen)) return "keep_left";
  if (ahead.every((d) => d < chosen)) return "keep_right";
  return rivals.every((d) => Math.abs(d) > Math.abs(chosen)) ? "straight" : null;
}

/**
 * Branches that may be walked away from each node: the station's traversable graph under the query's
 * operational restrictions (closures, opening hours at the departure time, strict hours), but not the
 * traveller's own preferences — a stair or a ticket gate the traveller avoids is still a visible branch.
 */
function departuresByNode(bundle: StationBundle, profile: RouteProfile): Map<string, Edge[]> {
  const router = createRouter(bundle);
  const operational: RouteProfile = {
    ...DEFAULT_PROFILE,
    ...(profile.extraClosedEdgeIds ? { extraClosedEdgeIds: profile.extraClosedEdgeIds } : {}),
    ...(profile.hours ? { hours: profile.hours } : {}),
    ...(profile.at ? { at: profile.at } : {}),
  };
  const out = new Map<string, Edge[]>();
  for (const edge of bundle.edges) {
    if (edge.from === edge.to || !router.isTraversable(edge, operational)) continue;
    for (const nodeId of edge.direction === "both" ? [edge.from, edge.to] : [edge.from]) {
      const list = out.get(nodeId);
      if (list) list.push(edge);
      else out.set(nodeId, [edge]);
    }
  }
  return out;
}

/** Display name of the first POI (bundle order) reached from each node: requested language, then ja, then any. */
function junctionNames(bundle: StationBundle, lang: "ja" | "en"): Map<string, string> {
  const out = new Map<string, string>();
  for (const poi of bundle.pois) {
    const named = poi.names.find((t) => t.lang === lang) ?? poi.names.find((t) => t.lang === "ja") ?? poi.names[0];
    if (!named || named.text.trim() === "") continue;
    for (const nodeId of poi.connectorNodeIds) if (!out.has(nodeId)) out.set(nodeId, named.text);
  }
  return out;
}

/**
 * True when every heading along the walk over these steps lies within one TURN_DEG-wide range (so neither
 * one turn nor a zig-zag, e.g. +30° then −30°, exceeds TURN_DEG). Every segment of at
 * least MIN_HEADING_STEP_M in plan has a heading of its own; only consecutive shorter ones are joined into
 * runs (so centimetre jitter doesn't count, but a gradual curve does, and no short leg hides a bend).
 */
function straightInPlan(points: PolylinePoint[], stepIndexes: number[]): boolean {
  const steps = new Set(stepIndexes);
  let first: number | null = null;
  // Range of headings relative to the first one (signed, so -30° and +30° are 60° apart).
  let lo = 0;
  let hi = 0;
  let bent = false;
  const check = (a: PolylinePoint, b: PolylinePoint) => {
    const h = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
    if (first === null) { first = h; return; }
    const rel = ((h - first + 540) % 360) - 180;
    lo = Math.min(lo, rel);
    hi = Math.max(hi, rel);
    if (hi - lo > TURN_DEG) bent = true;
  };
  const plan = (a: PolylinePoint, b: PolylinePoint) => Math.hypot(b.x - a.x, b.y - a.y);
  /** Start of the current run of short segments, if any. */
  let runFrom: PolylinePoint | null = null;
  for (let k = 1; k < points.length && !bent; k++) {
    if (!steps.has(points[k]!.stepIndex)) continue;
    const a = points[k - 1]!;
    const b = points[k]!;
    if (plan(a, b) >= MIN_HEADING_STEP_M) {
      if (runFrom && plan(runFrom, a) >= MIN_HEADING_STEP_M) check(runFrom, a);
      runFrom = null;
      check(a, b);
      continue;
    }
    runFrom ??= a;
    if (plan(runFrom, b) >= MIN_HEADING_STEP_M) {
      check(runFrom, b);
      runFrom = null;
    }
  }
  return !bent;
}

/**
 * Grouped instructions for a route. Junction hints count only branches open under the route's own
 * closures and hours (`route.profile`), never hiding one for the traveller's preferences.
 */
export function describeRoute(bundle: StationBundle, route: RouteResult, lang: "ja" | "en" = "ja"): Instruction[] {
  const t = TEXT[lang];
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const points = routePolyline(bundle, route);
  const edges = new Map(bundle.edges.map((e) => [e.id, e]));
  const departures = departuresByNode(bundle, route.profile);
  const names = junctionNames(bundle, lang);
  const firstFloor = nodes.get(route.nodeIds[0]!)!.floorId;
  const out: Instruction[] = [{ kind: "start", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: firstFloor, text: t.start() }];
  let current: Instruction | null = null;
  /** Evidenced sense of the last vertical instruction, including "level". */
  let lastSense: "up" | "down" | "level" | null = null;
  /** Floor where the current vertical chain started. */
  let chainFromFloorId: string | null = null;
  const flush = () => {
    if (!current) return;
    const m = Math.max(1, Math.round(current.distanceM));
    if (current.kind === "walk" || current.kind === "turn_left" || current.kind === "turn_right" || current.kind === "u_turn") {
      const main = current.kind === "walk" ? (straightInPlan(points, current.stepIndexes) ? t.walk(m) : t.continue(m)) : t[current.kind](m);
      const hints = (current.junctions ?? []).map((j) => t.junction(j.atM, j.action, j.name));
      current.text = hints.length > 0 ? t.withJunctions(main, hints) : main;
    }
    else if (current.kind === "moving_walkway") current.text = current.turn ? t.turnPrefix(current.turn, t.moving_walkway(m)) : t.moving_walkway(m);
    out.push(current);
    current = null;
  };

  route.steps.forEach((step, i) => {
    // A wait for an opening window is its own instruction, before the step it waits for.
    if (step.waitSeconds && step.waitUntil) {
      flush();
      const { minutes, dayOffset, weekday } = step.waitUntil;
      const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
      out.push({ kind: "wait", stepIndexes: [], beforeStepIndex: i, distanceM: 0, vertical: null, toFloorId: step.fromFloorId, text: t.wait(hhmm, dayOffset, weekday) });
    }
    const vertical = VERTICAL[step.mode];
    if (vertical || step.mode === "gate") {
      flush();
      const kind: InstructionKind = vertical ?? "gate";
      const from = nodes.get(step.fromNodeId)!;
      const to = nodes.get(step.toNodeId)!;
      const sense3 = verticalSense(floors.get(step.fromFloorId), floors.get(step.toFloorId), from.position.z, to.position.z);
      const prev = out[out.length - 1]!;
      // A real turn between two flights is a decision point: never hide it inside one instruction.
      const delta = i > 0 ? turnDelta(points, route.steps, i) : null;
      const turnHere: "left" | "right" | "back" | null =
        delta === null ? null : Math.abs(delta) > 150 ? "back" : delta > VERTICAL_TURN_DEG ? "right" : delta < -VERTICAL_TURN_DEG ? "left" : null;
      const merging = prev.kind === kind && kind !== "gate" && turnHere === null && (lastSense === sense3 || lastSense === "level" || sense3 === "level");
      if (!merging) chainFromFloorId = step.fromFloorId;
      const label = chainFromFloorId === step.toFloorId ? null : floorDisplayName(floors.get(step.toFloorId), lang);
      // Consecutive segments of one stair/escalator/lift chain read as one instruction — only when they
      // share the same evidenced sense; a known "up" never absorbs a segment whose direction is UNKNOWN.
      // A known-level segment continues either sense.
      if (merging) {
        lastSense = lastSense === "level" ? sense3 : lastSense;
        prev.stepIndexes.push(i);
        prev.distanceM += step.lengthM;
        prev.toFloorId = step.toFloorId;
        prev.vertical = lastSense === "up" || lastSense === "down" ? lastSense : null;
        const merged = t.vertical(kind, prev.vertical, label);
        prev.text = prev.turn ? t.turnPrefix(prev.turn, merged) : merged;
        return;
      }
      lastSense = sense3;
      const sense = sense3 === "up" || sense3 === "down" ? sense3 : null;
      const base = kind === "gate" ? t.gate() : t.vertical(kind, sense, label);
      // A walk instruction only says how far to go, so a turn onto the flight/gate is named here.
      out.push({
        kind, stepIndexes: [i], distanceM: step.lengthM, vertical: sense, turn: turnHere, toFloorId: step.toFloorId,
        text: turnHere ? t.turnPrefix(turnHere, base) : base,
      });
      return;
    }
    if (step.mode === "moving_walkway") {
      flush();
      // Like a flight or gate, the turn onto the walkway is named on the walkway instruction itself.
      const delta = i > 0 ? turnDelta(points, route.steps, i) : null;
      const turn: "left" | "right" | "back" | null =
        delta === null ? null : Math.abs(delta) > 150 ? "back" : delta > TURN_DEG ? "right" : delta < -TURN_DEG ? "left" : null;
      current = { kind: "moving_walkway", stepIndexes: [i], distanceM: step.lengthM, vertical: null, toFloorId: step.toFloorId, text: "", ...(turn ? { turn } : {}) };
      flush();
      return;
    }
    // Walking: start a new instruction when the heading turns at the junction.
    const prevStep = route.steps[i - 1];
    let turn: InstructionKind = "walk";
    // Leaving a flight, lift or gate still needs its turn named: the connector's instruction only
    // covers using it. A headingless lift ride yields no delta, so no turn is invented there.
    if (prevStep) {
      const delta = turnDelta(points, route.steps, i);
      if (delta !== null) {
        if (Math.abs(delta) > 150) turn = "u_turn";
        else if (delta > TURN_DEG) turn = "turn_right";
        else if (delta < -TURN_DEG) turn = "turn_left";
      }
    }
    if (current && turn === "walk") {
      // Passing a choice point without turning: say which branch to keep to, since no turn marks it.
      const action = junctionAction(points, route.steps, i, departures.get(step.fromNodeId) ?? [], nodes, edges);
      if (action) {
        (current.junctions ??= []).push({
          nodeId: step.fromNodeId, stepIndex: i, atM: Math.max(1, Math.round(current.distanceM)), action, name: names.get(step.fromNodeId) ?? null,
        });
      }
      current.stepIndexes.push(i);
      current.distanceM += step.lengthM;
      current.toFloorId = step.toFloorId;
      return;
    }
    flush();
    current = { kind: turn, stepIndexes: [i], distanceM: step.lengthM, vertical: null, toFloorId: step.toFloorId, text: "" };
  });
  flush();
  const lastFloor = nodes.get(route.nodeIds[route.nodeIds.length - 1]!)!.floorId;
  out.push({ kind: "arrive", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: lastFloor, text: t.arrive() });
  return out;
}
