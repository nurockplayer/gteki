import type { EdgeMode, Floor, Node, StationBundle } from "@gteki/schema";
import type { RouteResult } from "./index.ts";

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
    const raw = edge?.geometry && edge.geometry.length >= 2 ? [...edge.geometry] : [from.position, to.position];
    if (step.reversed && edge?.geometry) raw.reverse();
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

export type InstructionKind =
  | "start" | "walk" | "turn_left" | "turn_right" | "u_turn"
  | "stairs" | "escalator" | "elevator" | "ramp" | "moving_walkway" | "gate" | "arrive";

export interface Instruction {
  kind: InstructionKind;
  /** Steps covered by this instruction (indices into route.steps). */
  stepIndexes: number[];
  distanceM: number;
  /** Vertical sense when evidenced by known elevations or same-operator ordinals; otherwise null. */
  vertical: "up" | "down" | null;
  /** Turn (> 45°, measured over ~5 m) to take before this stair/escalator/lift/ramp/gate; null = none. */
  turn?: "left" | "right" | "back" | null;
  toFloorId: string;
  /** Plain text in the requested language. */
  text: string;
}

const VERTICAL: Partial<Record<EdgeMode, InstructionKind>> = { stairs: "stairs", escalator: "escalator", elevator: "elevator", ramp: "ramp" };
const TURN_DEG = 35;
/** Heading change between consecutive flights that splits them into separate instructions. */
const VERTICAL_TURN_DEG = 45;

/** "level" = heights known and equal (a flat continuation); null = direction UNKNOWN. */
function verticalSense(a: Floor | undefined, b: Floor | undefined, za: number | null, zb: number | null): "up" | "down" | "level" | null {
  if (za !== null && zb !== null) return Math.abs(zb - za) > 0.3 ? (zb > za ? "up" : "down") : "level";
  if (a && b && a.elevationM !== null && b.elevationM !== null && a.elevationM !== b.elevationM) return b.elevationM > a.elevationM ? "up" : "down";
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
    arrive: () => "目的地に到着",
  },
  en: {
    start: () => "Start",
    walk: (m: number) => `Go straight ~${m} m`,
    turn_left: (m: number) => `Turn left, ~${m} m`,
    turnPrefix: (turn: "left" | "right" | "back", text: string) => `${{ left: "Turn left", right: "Turn right", back: "Turn back" }[turn]}, then ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    turn_right: (m: number) => `Turn right, ~${m} m`,
    u_turn: (m: number) => `Turn back, ~${m} m`,
    gate: () => "Pass the ticket gate",
    moving_walkway: (m: number) => `Moving walkway ~${m} m`,
    vertical: (kind: string, sense: string | null, floor: string | null) =>
      `Take the ${kind}${sense ? ` ${sense}` : ""}${floor === null ? "" : ` to ${floor}`}`,
    arrive: () => "Arrive at destination",
  },
};

/** Span over which a step's entry/exit heading is measured, so short snapping hooks don't flip turns. */
const HEADING_SPAN_M = 5;

/**
 * Heading (degrees, clockwise from north) of a step where it starts or ends, measured as the chord
 * over its first/last ~5 m (or the whole step if shorter) rather than its first/last segment.
 */
function stepHeading(points: PolylinePoint[], stepIndex: number, end: "start" | "end"): number | null {
  const own = points.map((p, i) => ({ p, i })).filter(({ p }) => p.stepIndex === stepIndex);
  if (own.length === 0) return null;
  const firstIdx = own[0]!.i - 1;
  const lastIdx = own[own.length - 1]!.i;
  const anchor = end === "start" ? firstIdx : lastIdx;
  const dir = end === "start" ? 1 : -1;
  let k = anchor;
  let walked = 0;
  while (k + dir >= firstIdx && k + dir <= lastIdx && walked < HEADING_SPAN_M) {
    walked += Math.hypot(points[k + dir]!.x - points[k]!.x, points[k + dir]!.y - points[k]!.y);
    k += dir;
  }
  const [a, b] = end === "start" ? [points[anchor]!, points[k]!] : [points[k]!, points[anchor]!];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Signed heading change (degrees, + = right) from the end of step i-1 to the start of step i. */
function turnDelta(points: PolylinePoint[], i: number): number | null {
  const h0 = stepHeading(points, i - 1, "end");
  const h1 = stepHeading(points, i, "start");
  return h0 === null || h1 === null ? null : ((h1 - h0 + 540) % 360) - 180;
}

export function describeRoute(bundle: StationBundle, route: RouteResult, lang: "ja" | "en" = "ja"): Instruction[] {
  const t = TEXT[lang];
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const points = routePolyline(bundle, route);
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
    if (current.kind === "walk" || current.kind === "turn_left" || current.kind === "turn_right" || current.kind === "u_turn") current.text = t[current.kind](m);
    else if (current.kind === "moving_walkway") current.text = t.moving_walkway(m);
    out.push(current);
    current = null;
  };

  route.steps.forEach((step, i) => {
    const vertical = VERTICAL[step.mode];
    if (vertical || step.mode === "gate") {
      flush();
      const kind: InstructionKind = vertical ?? "gate";
      const from = nodes.get(step.fromNodeId)!;
      const to = nodes.get(step.toNodeId)!;
      const sense3 = verticalSense(floors.get(step.fromFloorId), floors.get(step.toFloorId), from.position.z, to.position.z);
      const prev = out[out.length - 1]!;
      // A real turn between two flights is a decision point: never hide it inside one instruction.
      const delta = i > 0 ? turnDelta(points, i) : null;
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
      current = { kind: "moving_walkway", stepIndexes: [i], distanceM: step.lengthM, vertical: null, toFloorId: step.toFloorId, text: "" };
      flush();
      return;
    }
    // Walking: start a new instruction when the heading turns at the junction.
    const prevStep = route.steps[i - 1];
    let turn: InstructionKind = "walk";
    if (prevStep && !VERTICAL[prevStep.mode] && prevStep.mode !== "gate") {
      const delta = turnDelta(points, i);
      if (delta !== null) {
        if (Math.abs(delta) > 150) turn = "u_turn";
        else if (delta > TURN_DEG) turn = "turn_right";
        else if (delta < -TURN_DEG) turn = "turn_left";
      }
    }
    if (current && turn === "walk") {
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
