import { isOpenAt } from "@gteki/schema";
import type { Edge, EdgeMode, Floor, LocalTime, Node, NodeKind, Poi, StationBundle, Weekday } from "@gteki/schema";
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
  /**
   * Turns taken on short walking legs (under ~5 m) folded into the start of this instruction, in walking
   * order, before its own turn; each is still named once, at the junction where it happens. Absent when none.
   */
  leadTurns?: Turn[];
  /** Same, for short legs folded into the end of the last instruction before arrival. Absent when none. */
  trailTurns?: Turn[];
  /**
   * Start or arrive only: the route starts at (or ends at) the origin's (destination's) stair/escalator/ramp
   * connector, not at the POI itself (e.g. the survey stops at the foot of an exit's stairs); for a start, that
   * flight is not part of the route. Absent otherwise.
   */
  connector?: ConnectorEndKind;
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
  /**
   * Walking distance to the junction from where the instruction's own walk starts: after its last turn,
   * so short legs folded in front of it (`leadTurns`) never move where a hint is said to be.
   */
  atM: number;
  /** "straight": the chosen branch is clearly the straightest (or the middle of a fork). */
  action: "straight" | "keep_left" | "keep_right";
  /** Name of a POI reached from this node, in the requested language when available; null = none (never invented). */
  name: string | null;
}

export type Turn = "left" | "right" | "back";

/** Connector node kinds that stand for the start of a further stair/escalator/ramp to the destination. */
export type ConnectorEndKind = Extract<NodeKind, "stair_end" | "escalator_end" | "ramp_end">;
const CONNECTOR_END: Record<ConnectorEndKind, { mode: EdgeMode; self: Poi["category"] | null }> = {
  stair_end: { mode: "stairs", self: "stairs" },
  escalator_end: { mode: "escalator", self: "escalator" },
  // No POI category is a ramp, so a ramp_end connector is never the destination itself.
  ramp_end: { mode: "ramp", self: null },
};

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

/** A run of turns in walking order: the first in full, later ones as "then …" ("again" when repeated). */
function turnRun(turns: readonly Turn[], first: Record<Turn, string>, next: Record<Turn, string>, again: Record<Turn, string>, sep: string): string {
  return turns.map((turn, k) => (k === 0 ? first : turn === turns[k - 1] ? again : next)[turn]).join(sep);
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

const TEXT = {
  ja: {
    start: () => "出発",
    /**
     * The route starts on the origin's own stair/escalator/ramp connector and does not use that flight. A stair end
     * is the foot of the stairs (the survey of such an exit stops at the bottom); an escalator or ramp end is only "the end".
     */
    startAtConnector: (kind: ConnectorEndKind, name: string | null) => {
      const via = { stair_end: "階段", escalator_end: "エスカレーター", ramp_end: "スロープ" }[kind];
      return `${name === null ? "" : `${name}の`}${via}の${kind === "stair_end" ? "下" : "端"}から出発（${via}は経路に含まれません）`;
    },
    walk: (m: number) => `約${m}m 直進`,
    /** The opening leg: no heading comes before it, so it only says how far. */
    go: (m: number) => `約${m}m 進む`,
    /** A walk whose own path bends: no "straight" claim (turns inside one edge aren't named). */
    continue: (m: number) => `約${m}m 進む`,
    turns: (turns: readonly Turn[]) => turnRun(turns,
      { left: "左へ曲がり", right: "右へ曲がり", back: "引き返して" },
      { left: "すぐ左へ曲がり", right: "すぐ右へ曲がり", back: "すぐ引き返して" },
      { left: "さらに左へ曲がり", right: "さらに右へ曲がり", back: "再び引き返して" }, "、"),
    turnWalk: (turns: readonly Turn[], m: number) => `${TEXT.ja.turns(turns)}約${m}m`,
    turnPrefix: (turns: readonly Turn[], text: string) => `${TEXT.ja.turns(turns)}、${text}`,
    gate: () => "改札を通過",
    moving_walkway: (m: number, _afterTurn: boolean) => `動く歩道で約${m}m`,
    /**
     * `floor` null = the chain starts and ends on the same floor: name no destination floor.
     * `continued` = the flight right after another of the same kind (only short legs between).
     */
    vertical: (kind: string, sense: string | null, floor: string | null, continued: boolean) => {
      const via = { stairs: "階段", escalator: "エスカレーター", elevator: "エレベーター", ramp: "スロープ" }[kind];
      const dir = sense === "up" ? "上へ" : sense === "down" ? "下へ" : "";
      const again = continued ? "引き続き" : "";
      if (floor === null) return dir ? `${again}${via}で${dir}` : continued ? `引き続き${via}を進む` : `${via}を利用`;
      return `${again}${via}で${dir ? `${dir}・` : ""}${floor}へ`;
    },
    junction: (atM: number, action: JunctionHint["action"], name: string | null) =>
      `約${atM}m先${name === null ? "" : `、${name}`}の分岐は${{ straight: "そのまま直進", keep_left: "左寄りに進む", keep_right: "右寄りに進む" }[action]}`,
    /**
     * Main text, then junction hints, then the turns of short legs folded into its end. After a hint the
     * trailing turns get their own distance (`m`, the main text's), so they cannot read as part of the hint.
     */
    compose: (text: string, hints: string[], trail: readonly Turn[], m: number) => {
      if (trail.length === 0) return [text, ...hints].join("。");
      const at = hints.length === 0 ? "その先で" : `約${m}m先で`;
      const turns = turnRun(trail, { left: `${at}左へ`, right: `${at}右へ`, back: `${at}引き返す` },
        { left: "すぐ左へ", right: "すぐ右へ", back: "すぐ引き返す" }, { left: "さらに左へ", right: "さらに右へ", back: "再び引き返す" }, "、");
      return hints.length === 0 ? `${text}、${turns}` : [text, ...hints, turns].join("。");
    },
    arrive: () => "目的地に到着",
    /** A ticket gate is reached from the public side: the paid concourse behind it is not modelled (#203 B7). */
    gateArrive: () => "改札外側に到着（改札内は未モデル化）",
    /** `name` null = the destination has no display name: say "目的地". `ridden` = the route ended by using this connector. */
    connectorArrive: (kind: ConnectorEndKind, name: string | null, ridden: boolean) => {
      const via = { stair_end: "階段", escalator_end: "エスカレーター", ramp_end: "スロープ" }[kind];
      return ridden ? `${name ?? "目的地"}への${via}で経路終了` : `${name ?? "目的地"}への${via}はここから`;
    },
    wait: (time: string, dayOffset: number, weekday: string, zone: string | null) =>
      `${dayOffset === 0 ? "" : dayOffset === 1 ? "翌日" : `${dayOffset < 7 ? "" : `${dayOffset}日後の`}${{ mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" }[weekday]}曜日`}${time}${zone === null ? "" : `（${zone}）`}まで待つ`,
  },
  en: {
    start: () => "Start",
    startAtConnector: (kind: ConnectorEndKind, name: string | null) => {
      const via = { stair_end: "stairs", escalator_end: "escalator", ramp_end: "ramp" }[kind];
      const of = name === null ? `the ${via}` : `the ${name} ${via}`;
      return `Start at the ${kind === "stair_end" ? "foot" : "end"} of ${of} (${kind === "stair_end" ? "the stairs are" : `the ${via} is`} not part of this route)`;
    },
    walk: (m: number) => `Go straight ~${m} m`,
    go: (m: number) => `Go ~${m} m`,
    continue: (m: number) => `Continue ~${m} m`,
    turns: (turns: readonly Turn[]) => turnRun(turns,
      { left: "Turn left", right: "Turn right", back: "Turn back" },
      { left: "then left", right: "then right", back: "then turn back" },
      { left: "then left again", right: "then right again", back: "then turn back again" }, ", "),
    turnWalk: (turns: readonly Turn[], m: number) => `${TEXT.en.turns(turns)}, ~${m} m`,
    turnPrefix: (turns: readonly Turn[], text: string) => `${TEXT.en.turns(turns)}, then ${lowerFirst(text)}`,
    gate: () => "Pass the ticket gate",
    /** After a turn the walkway needs a verb of its own: "Turn left, then take the moving walkway ~10 m". */
    moving_walkway: (m: number, afterTurn: boolean) => `${afterTurn ? "Take the moving walkway" : "Moving walkway"} ~${m} m`,
    vertical: (kind: string, sense: string | null, floor: string | null, continued: boolean) =>
      `${continued ? `Continue ${sense ?? "on"} the ${kind}` : `Take the ${kind}${sense ? ` ${sense}` : ""}`}${floor === null ? "" : ` to ${floor}`}`,
    junction: (atM: number, action: JunctionHint["action"], name: string | null) =>
      `After ~${atM} m, ${action === "straight"
        ? name === null ? "continue straight through the junction" : `continue straight past ${name}`
        : `keep ${action === "keep_left" ? "left" : "right"} at ${name ?? "the junction"}`}`,
    compose: (text: string, hints: string[], trail: readonly Turn[], m: number) => {
      if (hints.length === 0) return trail.length === 0 ? text : `${text}, then ${lowerFirst(TEXT.en.turns(trail))}`;
      return `${[text, ...hints, ...(trail.length === 0 ? [] : [`After ~${m} m, ${lowerFirst(TEXT.en.turns(trail))}`])].join(". ")}.`;
    },
    arrive: () => "Arrive at destination",
    gateArrive: () => "Arrived at the public side of the gate (inside the gate is not modelled)",
    connectorArrive: (kind: ConnectorEndKind, name: string | null, ridden: boolean) => {
      const via = { stair_end: "stairs", escalator_end: "escalator", ramp_end: "ramp" }[kind];
      const to = name ?? "your destination";
      if (ridden) return `Route ends at the ${via} for ${to}`;
      return kind === "stair_end" ? `Stairs to ${to} start here` : `${via.charAt(0).toUpperCase()}${via.slice(1)} to ${to} starts here`;
    },
    wait: (time: string, dayOffset: number, weekday: string, zone: string | null) =>
      `Wait until ${time}${zone === null ? "" : zone.includes("/") ? ` (${zone})` : ` ${zone}`}${dayOffset === 0 ? "" : dayOffset === 1 ? " tomorrow" : ` on ${{ mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }[weekday]}${dayOffset < 7 ? "" : `, ${dayOffset} days later`}`}`,
  },
};

/** How a wait names the station time zone: Asia/Tokyo reads "日本時間" / "JST", any other IANA id as itself; no zone, no label. */
const zoneLabel = (timeZone: string | undefined, lang: "ja" | "en"): string | null =>
  !timeZone ? null : timeZone === "Asia/Tokyo" ? (lang === "ja" ? "日本時間" : "JST") : timeZone;

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
/** Sideways offset (m) that makes a short sidestep (a jog) off the walk's heading too real to call the walk straight. */
const JOG_M = 0.75;

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
  nodes: ReadonlyMap<string, Node>, edges: ReadonlyMap<string, Edge>, openDuringRoute: (e: Edge) => boolean,
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
  // Hours are the costly check, so they are scanned last and only for real alternatives.
  const others = branches.filter((e) => !own.includes(e) && !samePassage(e, departureHeading(e, node, otherEnd(e))) && openDuringRoute(e));
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

const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * True when a branch's known hours keep it shut at every whole minute the route spans (departure to arrival,
 * waits included), or, under `require_known`, never show it open. Openness is not judged at the departure
 * minute alone: the traveller reaches a junction later, and dropping a branch that is open by then could
 * turn "keep right" into a wrong instruction, while counting a shut one can only withhold a hint.
 */
function shutForWholeRoute(edge: Edge, at: LocalTime, spanSeconds: number, strict: boolean): boolean {
  if (edge.hours === null || edge.hours.kind === "always") return false;
  // A malformed departure (unknown weekday, minutes outside 0–1439) is an UNKNOWN time: never roll it into a known one.
  if (!WEEK.includes(at.weekday) || !(at.minutes >= 0 && at.minutes < 1440) || !Number.isFinite(spanSeconds)) return false;
  const from = Math.floor(at.minutes);
  const to = Math.min(Math.ceil(at.minutes + spanSeconds / 60), from + 7 * 1440);
  for (let c = from; c <= to; c++) {
    const days = Math.floor(c / 1440);
    const open = isOpenAt(edge.hours, { weekday: WEEK[(((WEEK.indexOf(at.weekday) + days) % 7) + 7) % 7]!, minutes: c - days * 1440 });
    if (open === true || (open === null && !strict)) return false;
  }
  return true;
}

/**
 * Branches that may be walked away from each node: the station's traversable graph under the query's
 * operational restrictions (closures, strict hours), but not the traveller's own preferences — a stair
 * or a ticket gate the traveller avoids is still a visible branch. Known hours are checked separately,
 * and only for branches at the route's junctions (see shutForWholeRoute).
 */
function departuresByNode(bundle: StationBundle, route: RouteResult): Map<string, Edge[]> {
  const router = createRouter(bundle);
  const { profile } = route;
  const operational: RouteProfile = {
    ...DEFAULT_PROFILE,
    ...(profile.extraClosedEdgeIds ? { extraClosedEdgeIds: profile.extraClosedEdgeIds } : {}),
    ...(profile.hours ? { hours: profile.hours } : {}),
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

/**
 * Display names for junction hints: only exits and ticket gates name a junction. Naming it after a hall or
 * service POI reads backwards when the route itself goes into that area ("continue straight past West Exit"
 * for a route heading into it), so any other category stays "the junction" (#203 B9).
 */
const NAMES_JUNCTIONS: ReadonlySet<Poi["category"]> = new Set(["exit", "ticket_gate"]);

/** Display name of the first exit or ticket-gate POI (bundle order) reached from each node: requested language, then ja, then any. */
function junctionNames(bundle: StationBundle, lang: "ja" | "en"): Map<string, string> {
  const out = new Map<string, string>();
  for (const poi of bundle.pois) {
    if (!NAMES_JUNCTIONS.has(poi.category)) continue;
    const named = poi.names.find((t) => t.lang === lang) ?? poi.names.find((t) => t.lang === "ja") ?? poi.names[0];
    if (!named || named.text.trim() === "") continue;
    for (const nodeId of poi.connectorNodeIds) if (!out.has(nodeId)) out.set(nodeId, named.text);
  }
  return out;
}

const WALK_KINDS: ReadonlySet<InstructionKind> = new Set(["walk", "turn_left", "turn_right", "u_turn"]);
const WALK_TURN: Partial<Record<InstructionKind, Turn>> = { turn_left: "left", turn_right: "right", u_turn: "back" };
/** Walking legs shorter than this are folded into a neighbouring instruction instead of being read out alone. */
const SHORT_LEG_M = 5;

/**
 * An instruction before its text is written; `label` is the floor a flight leads to (null = none to name),
 * `ownM` / `ownSteps` the distance and steps of its own walk or walkway, without the short legs folded into it.
 */
type Draft = Instruction & { label: string | null; ownM?: number; ownSteps?: number[] };

/**
 * Folds walking legs under SHORT_LEG_M (without junction hints) into their neighbours, so a few metres
 * between two turns or onto a flight are not read out as lines of their own. Each folded turn is kept,
 * in order, on the instruction that starts (or, before arrival, ends) at that junction:
 * - a straight leg off a flight, lift, gate or walkway is just the way out of it: added to that instruction;
 * - other short legs lead into the next instruction ("Turn left, then right, ~16 m");
 * - short legs right before arrival end the instruction before them ("…, then turn right"; after a
 *   junction hint "After ~90 m, turn right.", so the turn cannot read as the hint's);
 * - the opening leg sets the heading every later turn is measured from, so it is only folded into a
 *   flight, lift, gate or walkway it leads straight onto, without a turn of its own. The same holds for a
 *   straight first leg after a wait (its metres must not slip in front of the next turn); a first leg that
 *   turns there still has the heading the traveller waited in, so its turn leads into the next line;
 * - nothing is folded into or across a wait: legs before it end the instruction before them.
 * `distanceM` and `stepIndexes` grow to cover folded legs; spoken distances and "straight" stay those of
 * the instruction's own walk (`ownM`, `ownSteps`), so "~20 m, then turn back" still turns back after 20 m.
 */
function foldShortLegs(drafts: Draft[]): Draft[] {
  const isWalk = (d: Draft) => WALK_KINDS.has(d.kind);
  const isShort = (d: Draft) => isWalk(d) && d.distanceM < SHORT_LEG_M && !d.junctions;
  const turnsOf = (legs: Draft[]) => legs.flatMap((d) => [...(d.leadTurns ?? []), ...(WALK_TURN[d.kind] ? [WALK_TURN[d.kind]!] : [])]);
  const lengthOf = (legs: Draft[]) => legs.reduce((sum, d) => sum + d.distanceM, 0);
  const appendTo = (into: Draft, legs: Draft[]) => {
    into.stepIndexes.push(...legs.flatMap((d) => d.stepIndexes));
    into.distanceM += lengthOf(legs);
    into.toFloorId = legs[legs.length - 1]!.toFloorId;
    const trail = turnsOf(legs);
    if (trail.length > 0) into.trailTurns = [...(into.trailTurns ?? []), ...trail];
  };
  for (const d of drafts) {
    d.ownM = d.distanceM;
    d.ownSteps = [...d.stepIndexes];
  }
  // Nothing is folded into or across the start or a wait: it covers no step, and the walk resumes from it.
  const barrier = (d: Draft) => d.kind === "start" || d.kind === "wait";
  const out: Draft[] = [drafts[0]!];
  let pending: Draft[] = [];
  /** Short legs with nothing after them to lead into: they end the instruction before them. */
  const settle = () => {
    // After the start or a wait the first leg stays a line of its own; the rest end it.
    if (pending.length > 0 && barrier(out[out.length - 1]!)) out.push(pending.shift()!);
    if (pending.length > 0) appendTo(out[out.length - 1]!, pending);
    pending = [];
  };
  for (const d of drafts.slice(1, -1)) {
    const last = out[out.length - 1]!;
    if (isShort(d)) {
      if (pending.length === 0 && d.kind === "walk" && !isWalk(last) && !barrier(last)) appendTo(last, [d]);
      else pending.push(d);
      continue;
    }
    if (d.kind === "wait") {
      settle();
      out.push(d);
      continue;
    }
    if (barrier(last) && pending[0]?.kind === "walk" && (pending.length > 1 || isWalk(d) || d.turn)) out.push(pending.shift()!);
    if (pending.length > 0) {
      const turns = turnsOf(pending);
      d.stepIndexes = [...pending.flatMap((p) => p.stepIndexes), ...d.stepIndexes];
      d.distanceM += lengthOf(pending);
      if (turns.length > 0) d.leadTurns = turns;
      pending = [];
    }
    out.push(d);
  }
  settle();
  out.push(drafts[drafts.length - 1]!);
  return out;
}

/** POI display name in `lang`, then ja, then the first non-blank name; null when it has none. Never an id. */
function poiDisplayName(poi: Poi, lang: "ja" | "en"): string | null {
  const names = poi.names.map((n) => ({ lang: n.lang, text: n.text.trim() })).filter((n) => n.text !== "");
  const named = names.find((n) => n.lang === lang) ?? names.find((n) => n.lang === "ja") ?? names[0];
  return named?.text ?? null;
}

/**
 * The POI's own note in the requested language only (null when it has none): a note is a statement by the
 * station data, and one written in another language is not shown as if it were the requested one.
 */
function poiNote(poi: Poi, lang: "ja" | "en"): string | null {
  const note = poi.notes?.find((n) => n.lang === lang);
  return note && note.text.trim() !== "" ? note.text.trim() : null;
}

/**
 * True when every heading along the walk over these steps lies within one TURN_DEG-wide range (so neither
 * one turn nor a zig-zag, e.g. +30° then −30°, exceeds TURN_DEG). Every segment of at
 * least MIN_HEADING_STEP_M in plan has a heading of its own; only consecutive shorter ones are joined into
 * runs (so centimetre jitter doesn't count, but a gradual curve does, and no short leg hides a bend).
 * A sidestep also breaks it: a run of segments each more than TURN_DEG off the first heading that shifts the
 * walker JOG_M or more sideways, however short its pieces (a 0.9 m jog between two long runs is not straight).
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
  const ref = first as number | null;
  if (bent || ref === null) return !bent;
  // Jog pass: sideways travel (perpendicular to the first heading) summed over consecutive off-heading segments.
  const [sin, cos] = [Math.sin((ref * Math.PI) / 180), Math.cos((ref * Math.PI) / 180)];
  let lateral = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1]!;
    const b = points[k]!;
    if (!steps.has(b.stepIndex)) { lateral = 0; continue; }
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    if (dx === 0 && dy === 0) continue;
    const off = Math.abs(((((Math.atan2(dx, dy) * 180) / Math.PI) - ref + 540) % 360) - 180);
    if (off <= TURN_DEG) { lateral = 0; continue; }
    lateral += dx * cos - dy * sin;
    if (Math.abs(lateral) >= JOG_M) return false;
  }
  return true;
}

/**
 * Grouped instructions for a route. Junction hints count only branches open under the route's own
 * closures and hours (`route.profile`), never hiding one for the traveller's preferences.
 *
 * `destination` is the POI the route was computed to (as with `routeBetween`). When the route ends on
 * one of its connectors that is a stair/escalator/ramp end — and the POI is not that stair/escalator
 * itself — the last instruction says the connector starts there instead of claiming arrival. It names
 * only the node kind and the POI: never a direction or floor, which the graph does not evidence there.
 */
export function describeRoute(bundle: StationBundle, route: RouteResult, lang: "ja" | "en" = "ja", destination?: Poi, origin?: Poi): Instruction[] {
  const t = TEXT[lang];
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const points = routePolyline(bundle, route);
  const edges = new Map(bundle.edges.map((e) => [e.id, e]));
  const departures = departuresByNode(bundle, route);
  const shut = new Map<Edge, boolean>();
  const { at } = route.profile;
  const openDuringRoute = (e: Edge): boolean => {
    if (!at) return true;
    if (!shut.has(e)) shut.set(e, shutForWholeRoute(e, at, route.estimatedSeconds, route.profile.hours === "require_known"));
    return !shut.get(e);
  };
  const names = junctionNames(bundle, lang);
  const startNode = nodes.get(route.nodeIds[0]!)!;
  const firstFloor = startNode.floorId;
  // Mirror of the arrival side: the route starts on one of the origin's stair/escalator/ramp connectors (and the
  // origin is not that flight itself), and its first step is not that flight, so the flight is not part of it.
  const startEnd = Object.hasOwn(CONNECTOR_END, startNode.kind) ? CONNECTOR_END[startNode.kind as ConnectorEndKind] : null;
  const startConnector = origin && startEnd && origin.category !== startEnd.self && origin.connectorNodeIds.includes(startNode.id) && route.steps[0]?.mode !== startEnd.mode
    ? startNode.kind as ConnectorEndKind : null;
  const out: Draft[] = [startConnector
    ? { kind: "start", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: firstFloor, connector: startConnector, text: t.startAtConnector(startConnector, poiDisplayName(origin!, lang)), label: null }
    : { kind: "start", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: firstFloor, text: t.start(), label: null }];
  let current: Draft | null = null;
  /** Evidenced sense of the last vertical instruction, including "level". */
  let lastSense: "up" | "down" | "level" | null = null;
  /** Floor where the current vertical chain started. */
  let chainFromFloorId: string | null = null;
  const flush = () => {
    if (current) out.push(current);
    current = null;
  };
  const stepSense = (k: number) => {
    const s = route.steps[k]!;
    return verticalSense(floors.get(s.fromFloorId), floors.get(s.toFloorId), nodes.get(s.fromNodeId)!.position.z, nodes.get(s.toNodeId)!.position.z);
  };
  const floorLabel = (fromFloorId: string, toFloorId: string) => fromFloorId === toFloorId ? null : floorDisplayName(floors.get(toFloorId), lang);

  route.steps.forEach((step, i) => {
    // A wait for an opening window is its own instruction, before the step it waits for.
    if (step.waitSeconds && step.waitUntil) {
      flush();
      const { minutes, dayOffset, weekday } = step.waitUntil;
      const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
      out.push({ kind: "wait", stepIndexes: [], beforeStepIndex: i, distanceM: 0, vertical: null, toFloorId: step.fromFloorId, text: t.wait(hhmm, dayOffset, weekday, zoneLabel(route.profile.timeZone, lang)), label: null });
    }
    const vertical = VERTICAL[step.mode];
    if (vertical || step.mode === "gate") {
      flush();
      const kind: InstructionKind = vertical ?? "gate";
      const sense3 = stepSense(i);
      const prev = out[out.length - 1]!;
      if (kind === "elevator" && prev.kind === "elevator") {
        // One lift ride, however many cab, door or floor links it is stored as: ride from where it was
        // boarded to where it is left. Up/down only when that is evidenced and no link of it says otherwise.
        const first = route.steps[prev.stepIndexes[0]!]!;
        prev.stepIndexes.push(i);
        prev.distanceM += step.lengthM;
        prev.toFloorId = step.toFloorId;
        const ride = verticalSense(floors.get(first.fromFloorId), floors.get(step.toFloorId), nodes.get(first.fromNodeId)!.position.z, nodes.get(step.toNodeId)!.position.z);
        const legs = prev.stepIndexes.map(stepSense);
        const sense = ride === "up" || ride === "down" ? ride : null;
        prev.vertical = sense && !legs.includes(sense === "up" ? "down" : "up") ? sense : null;
        prev.label = floorLabel(first.fromFloorId, step.toFloorId);
        return;
      }
      // A real turn between two flights is a decision point: never hide it inside one instruction.
      const delta = i > 0 ? turnDelta(points, route.steps, i) : null;
      const turnHere: Turn | null =
        delta === null ? null : Math.abs(delta) > 150 ? "back" : delta > VERTICAL_TURN_DEG ? "right" : delta < -VERTICAL_TURN_DEG ? "left" : null;
      const merging = prev.kind === kind && kind !== "gate" && turnHere === null && (lastSense === sense3 || lastSense === "level" || sense3 === "level");
      if (!merging) chainFromFloorId = step.fromFloorId;
      const label = floorLabel(chainFromFloorId!, step.toFloorId);
      // Consecutive segments of one stair/escalator/lift chain read as one instruction — only when they
      // share the same evidenced sense; a known "up" never absorbs a segment whose direction is UNKNOWN.
      // A known-level segment continues either sense.
      if (merging) {
        lastSense = lastSense === "level" ? sense3 : lastSense;
        prev.stepIndexes.push(i);
        prev.distanceM += step.lengthM;
        prev.toFloorId = step.toFloorId;
        prev.vertical = lastSense === "up" || lastSense === "down" ? lastSense : null;
        prev.label = label;
        return;
      }
      lastSense = sense3;
      const sense = sense3 === "up" || sense3 === "down" ? sense3 : null;
      // A walk instruction only says how far to go, so a turn onto the flight/gate is named here.
      out.push({ kind, stepIndexes: [i], distanceM: step.lengthM, vertical: sense, turn: turnHere, toFloorId: step.toFloorId, text: "", label });
      return;
    }
    if (step.mode === "moving_walkway") {
      flush();
      // Like a flight or gate, the turn onto the walkway is named on the walkway instruction itself.
      const delta = i > 0 ? turnDelta(points, route.steps, i) : null;
      const turn: Turn | null =
        delta === null ? null : Math.abs(delta) > 150 ? "back" : delta > TURN_DEG ? "right" : delta < -TURN_DEG ? "left" : null;
      out.push({ kind: "moving_walkway", stepIndexes: [i], distanceM: step.lengthM, vertical: null, toFloorId: step.toFloorId, text: "", label: null, ...(turn ? { turn } : {}) });
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
      const action = junctionAction(points, route.steps, i, departures.get(step.fromNodeId) ?? [], nodes, edges, openDuringRoute);
      if (action) {
        (current.junctions ??= []).push({ nodeId: step.fromNodeId, stepIndex: i, atM: Math.max(1, Math.round(current.distanceM)), action, name: names.get(step.fromNodeId) ?? null });
      }
      current.stepIndexes.push(i);
      current.distanceM += step.lengthM;
      current.toFloorId = step.toFloorId;
      return;
    }
    flush();
    current = { kind: turn, stepIndexes: [i], distanceM: step.lengthM, vertical: null, toFloorId: step.toFloorId, text: "", label: null };
  });
  flush();
  const goal = nodes.get(route.nodeIds[route.nodeIds.length - 1]!)!;
  const end = Object.hasOwn(CONNECTOR_END, goal.kind) ? CONNECTOR_END[goal.kind as ConnectorEndKind] : null;
  if (destination && end && destination.category !== end.self && destination.connectorNodeIds.includes(goal.id)) {
    const kind = goal.kind as ConnectorEndKind;
    // Arriving on the connector's own mode means these stairs are the ones just used: claim no further flight.
    const ridden = route.steps[route.steps.length - 1]?.mode === end.mode;
    out.push({ kind: "arrive", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: goal.floorId, connector: kind, text: t.connectorArrive(kind, poiDisplayName(destination, lang), ridden), label: null });
  } else {
    // A gate (or any non-exit destination) says where the route stops: its own note in this language when it
    // has one, else a gate says the paid side is not modelled. A note in another language is never shown as
    // if it were this one; exits keep the plain arrival (#203 B7).
    const note = destination && destination.category !== "exit" ? poiNote(destination, lang) : null;
    const text = note ?? (destination?.category === "ticket_gate" ? t.gateArrive() : t.arrive());
    out.push({ kind: "arrive", stepIndexes: [], distanceM: 0, vertical: null, toFloorId: goal.floorId, text, label: null });
  }

  return foldShortLegs(out).map(({ label, ownM, ownSteps, ...ins }, k, all) => {
    if (ins.kind === "start" || ins.kind === "arrive" || ins.kind === "wait") return ins;
    const m = Math.max(1, Math.round(ownM ?? ins.distanceM));
    const turns = [...(ins.leadTurns ?? []), ...(WALK_TURN[ins.kind] ? [WALK_TURN[ins.kind]!] : []), ...(ins.turn ? [ins.turn] : [])];
    let main: string;
    // The opening leg has no heading before it, so it never claims "straight": it only says how far.
    if (WALK_KINDS.has(ins.kind)) main = turns.length > 0 ? t.turnWalk(turns, m) : ins.stepIndexes.includes(0) ? t.go(m) : straightInPlan(points, ownSteps ?? ins.stepIndexes) ? t.walk(m) : t.continue(m);
    else {
      // A flight right after another of the same kind (only short legs between) continues it, unless it
      // is known to reverse it (down, then up).
      const before = all[k - 1]!;
      const continued = (ins.kind === "stairs" || ins.kind === "ramp") && before.kind === ins.kind && (ins.vertical === null || ins.vertical === before.vertical);
      const base = ins.kind === "gate" ? t.gate() : ins.kind === "moving_walkway" ? t.moving_walkway(m, turns.length > 0) : t.vertical(ins.kind, ins.vertical, label, continued);
      main = turns.length > 0 ? t.turnPrefix(turns, base) : base;
    }
    const hints = (ins.junctions ?? []).map((j) => t.junction(j.atM, j.action, j.name));
    return { ...ins, text: t.compose(main, hints, ins.trailTurns ?? [], m) };
  });
}
