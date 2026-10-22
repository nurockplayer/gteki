/** Turn a RouteResult into human instructions (ja/en) without inventing facts. */
import { routeBetween, type RouteResult, type RouteProfile, type Router, type RouteEndpoint } from "@gteki/navigation";
import type { Floor, Node, Poi, StationBundle } from "@gteki/schema";

export interface Maneuver {
  kind: "walk" | "turn" | "stairs" | "escalator" | "elevator" | "gate" | "ramp" | "arrive";
  ja: string;
  en: string;
  lengthM: number;
  /** index into route.nodeIds where this maneuver starts */
  startIndex: number;
  toFloorLabel?: string;
  fromFloorLabel?: string;
  up?: boolean;
  /** Every evidenced floor transition represented by this grouped instruction. */
  floorChanges?: { from: string; to: string }[];
}

/** Display label for an NWD floor: B1, B2, 地上, 1F; intermediate floors as "B2–B3 中間". */
export function floorLabel(f: Floor | undefined): { ja: string; en: string; short: string } {
  if (!f || f.ordinal === null) return { ja: "不明", en: "unknown", short: "?" };
  const o = f.ordinal;
  if (o === 0) return { ja: "地上", en: "Street", short: "GL" };
  if (o > 0) return { ja: `${o}階`, en: `${o}F`, short: `${o}F` };
  if (!Number.isInteger(o)) {
    const a = Math.ceil(o);
    const b = Math.floor(o);
    const s = (x: number) => (x === 0 ? "GL" : `B${-x}`);
    return { ja: `${s(a)}–${s(b)} 中間`, en: `${s(a)}–${s(b)} landing`, short: `${s(a)}/${s(b)}` };
  }
  return { ja: `地下${-o}階`, en: `B${-o}`, short: `B${-o}` };
}

/** A bend sharper than this (60°) is spoken as a turn at any node, and breaks a "straight" claim. */
const TURN_RAD = Math.PI / 3;
const turnAngle = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** True when every heading stays within TURN_RAD of the first and their whole swing does too. */
export function staysStraight(headings: readonly number[]) {
  if (headings.length < 2) return true;
  let rel = 0, lo = 0, hi = 0;
  for (let k = 1; k < headings.length; k++) {
    rel += turnAngle(headings[k - 1]!, headings[k]!);
    lo = Math.min(lo, rel);
    hi = Math.max(hi, rel);
    if (Math.abs(rel) > TURN_RAD || hi - lo > TURN_RAD) return false;
  }
  return true;
}

/** Walk wording: 直進 / "Go straight" only over a walk that actually stays straight, else 進む / "Continue". */
function walkText(m: Maneuver, turn: "left" | "right" | null, headings: readonly number[]) {
  const d = Math.max(1, Math.round(m.lengthM));
  const [ja, en] = turn === "left" ? ["左へ曲がり", "Turn left and continue"] : turn === "right" ? ["右へ曲がり", "Turn right and continue"] : staysStraight(headings) ? ["直進", "Go straight"] : ["進む", "Continue"];
  m.ja = `${ja} ${d} m`;
  m.en = `${en} ${d} m`;
}

export function narrate(bundle: StationBundle, route: RouteResult): Maneuver[] {
  const nodes = new Map<string, Node>(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map<string, Floor>(bundle.floors.map((f) => [f.id, f]));
  const out: Maneuver[] = [];
  const edges = new Map(bundle.edges.map((e) => [e.id, e]));
  /** Plan headings of each walk maneuver, in travel order, for the straightness check. */
  const headingsOf = new Map<Maneuver, number[]>();
  /** Plan headings along one step: its edge polyline where there is one, else the node chord. */
  const stepHeadings = (step: (typeof route.steps)[number]) => {
    const edge = edges.get(step.edgeId);
    const from = nodes.get(step.fromNodeId)!.position, to = nodes.get(step.toNodeId)!.position;
    const line = edge?.geometry && edge.geometry.length > 2 ? edge.geometry.map((p) => ({ x: p.x, y: p.y })) : null;
    const pts = line ? (edge!.from === step.fromNodeId ? line : [...line].reverse()) : [from, to];
    const hs: number[] = [];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!, b = pts[k]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) hs.push(Math.atan2(b.x - a.x, b.y - a.y));
    }
    return hs;
  };
  let pendingTurn: "left" | "right" | null = null;
  let i = 0;
  const steps = route.steps;
  while (i < steps.length) {
    const s = steps[i]!;
    if (s.mode === "stairs" || s.mode === "escalator" || s.mode === "elevator" || s.mode === "ramp") {
      // merge the whole vertical chain
      let j = i;
      let len = 0;
      while (j < steps.length && steps[j]!.mode === s.mode) (len += steps[j]!.lengthM), j++;
      const fromF = floors.get(steps[i]!.fromFloorId);
      // final floor = last non-intermediate floor reached in the chain
      let toF = floors.get(steps[j - 1]!.toFloorId);
      if (s.mode !== "elevator") for (let k = j - 1; k >= i; k--) {
        const f = floors.get(steps[k]!.toFloorId);
        if (f && !f.intermediate) { toF = f; break; }
      }
      const up = (toF?.ordinal ?? 0) > (fromF?.ordinal ?? 0);
      const L = floorLabel(toF);
      const verbJa = up ? "上る" : "下りる";
      const what = { stairs: ["階段", "stairs"], escalator: ["エスカレーター", "escalator"], elevator: ["エレベーター", "elevator"], ramp: ["スロープ", "ramp"] }[s.mode]!;
      const floorChanges = steps.slice(i, j).filter((step) => step.fromFloorId !== step.toFloorId).map((step) => ({ from: floorLabel(floors.get(step.fromFloorId)).short, to: floorLabel(floors.get(step.toFloorId)).short }));
      if (s.mode === "elevator") out.push({ kind: "elevator", ja: `エレベーターで ${L.ja} へ`, en: `Take the elevator to ${L.en}`, lengthM: 0, startIndex: i, fromFloorLabel: floorLabel(fromF).short, toFloorLabel: L.short, up, floorChanges });
      else if (s.mode === "stairs") out.push({ kind: "stairs", ja: fromF?.id === toF?.id ? "そのまま階段を進む" : `そのまま階段を進む · ${L.ja} へ`, en: fromF?.id === toF?.id ? "Continue on the stairs" : `Continue on the stairs to ${L.en}`, lengthM: len, startIndex: i, fromFloorLabel: floorLabel(fromF).short, toFloorLabel: L.short, floorChanges });
      else if (fromF?.id === toF?.id) out.push({ kind: s.mode, ja: `${what[0]}を進む（${Math.round(len)} m）`, en: `Continue via ${what[1]} (${Math.round(len)} m)`, lengthM: len, startIndex: i, floorChanges });
      else out.push({ kind: s.mode, ja: `${what[0]}で ${L.ja} へ${verbJa}`, en: `Take the ${what[1]} ${up ? "up" : "down"} to ${L.en}`, lengthM: len, startIndex: i, fromFloorLabel: floorLabel(fromF).short, toFloorLabel: L.short, up, floorChanges });
      i = j;
      continue;
    }
    if (s.mode === "gate") {
      out.push({ kind: "gate", ja: "改札を通る", en: "Pass through the ticket gates", lengthM: s.lengthM, startIndex: i });
      i++;
      continue;
    }
    // walk: merge segments until a significant bend at any node (whatever its degree), and name it
    let j = i;
    let len = 0;
    let heading: number | null = null;
    const headings: number[] = [];
    const turn = pendingTurn;
    pendingTurn = null;
    while (j < steps.length && steps[j]!.mode === "walk") {
      const hs = stepHeadings(steps[j]!);
      if (heading !== null && hs.length) {
        const d = turnAngle(heading, hs[0]!);
        if (Math.abs(d) > TURN_RAD) {
          pendingTurn = d > 0 ? "right" : "left";
          break;
        }
      }
      if (hs.length) heading = hs[hs.length - 1]!;
      headings.push(...hs);
      len += steps[j]!.lengthM;
      j++;
    }
    const m: Maneuver = { kind: turn ? "turn" : "walk", ja: "", en: "", lengthM: len, startIndex: i };
    headingsOf.set(m, headings);
    walkText(m, turn, headings);
    out.push(m);
    // A tiny walk edge that changes floors still needs an explicit, honest floor cue.
    const changedSteps = steps.slice(i, j).filter((step) => step.fromFloorId !== step.toFloorId);
    const floorChanges = changedSteps.map((step) => ({ from: floorLabel(floors.get(step.fromFloorId)).short, to: floorLabel(floors.get(step.toFloorId)).short }));
    if (floorChanges.length) {
      const labels = changedSteps.map((step) => ({ from: floorLabel(floors.get(step.fromFloorId)).ja, to: floorLabel(floors.get(step.toFloorId)).ja }));
      const ja = labels.map((f) => `${f.from}から${f.to}へ移動`).join(" · ");
      const en = floorChanges.map((f) => `${f.from} to ${f.to}`).join(" · ");
      out[out.length - 1]!.floorChanges = floorChanges;
      out[out.length - 1]!.ja += ` · ${ja}`;
      out[out.length - 1]!.en += ` · ${en}`;
    }
    i = j;
  }
  // Very short mapped walk links are junction geometry, not useful spoken turns.
  for (let k = out.length - 1; k >= 0; k--) {
    const current = out[k]!;
    if (current.kind !== "walk" || current.lengthM >= 5) continue;
    const neighborIndex = k > 0 ? k - 1 : k + 1 < out.length ? k + 1 : -1;
    if (neighborIndex < 0) continue;
    const neighbor = out[neighborIndex]!;
    neighbor.lengthM += current.lengthM;
    if (neighbor.kind === "walk" || neighbor.kind === "turn") {
      // The merged leg's bends count too: "straight" must hold over the whole spoken distance.
      const own = headingsOf.get(neighbor) ?? [], added = headingsOf.get(current) ?? [];
      const headings = neighborIndex < k ? [...own, ...added] : [...added, ...own];
      headingsOf.set(neighbor, headings);
      const cue = (text: string) => text.split(" · ").slice(1);
      const cues = { ja: cue(neighbor.ja), en: cue(neighbor.en) };
      walkText(neighbor, neighbor.kind === "turn" ? (neighbor.en.startsWith("Turn left") ? "left" : "right") : null, headings);
      if (cues.ja.length) neighbor.ja += ` · ${cues.ja.join(" · ")}`;
      if (cues.en.length) neighbor.en += ` · ${cues.en.join(" · ")}`;
    }
    if (current.floorChanges?.length) {
      const cueJa = current.ja.split(" · ").slice(1).join(" · ");
      const cueEn = current.en.split(" · ").slice(1).join(" · ");
      if (neighborIndex < k) {
        if (cueJa) neighbor.ja += ` · ${cueJa}`;
        if (cueEn) neighbor.en += ` · ${cueEn}`;
        neighbor.floorChanges = [...(neighbor.floorChanges ?? []), ...current.floorChanges];
      } else {
        if (cueJa) neighbor.ja = `${cueJa} · ${neighbor.ja}`;
        if (cueEn) neighbor.en = `${cueEn} · ${neighbor.en}`;
        neighbor.floorChanges = [...current.floorChanges, ...(neighbor.floorChanges ?? [])];
      }
    }
    out.splice(k, 1);
  }
  out.push({ kind: "arrive", ja: "目的地に到着", en: "Arrive at destination", lengthM: 0, startIndex: steps.length });
  return out;
}

export interface StepFreeAlternative {
  reason: { ja: string; en: string };
  alternative: { poi: Poi; distanceM: number } | null;
}

/** Explain a step-free refusal and find the nearest reachable POI of the same category. */
export function explainStepFreeFailure(bundle: StationBundle, router: Router, origin: RouteEndpoint, target: Poi, profile: RouteProfile): StepFreeAlternative {
  const standardProfile: RouteProfile = { ...profile, stepFree: false };
  const standard = routeBetween(router, origin, target, standardProfile);
  const usesStairs = standard.ok && standard.steps.some((step) => step.mode === "stairs");
  const reason = usesStairs
    ? { ja: "この目的地へのデータ上の経路は階段を通ります。段差なし経路は確認されていません。", en: "The mapped route to this destination uses stairs; no step-free route is verified." }
    : { ja: "この目的地への段差なし経路はデータ上で確認できません。", en: "A step-free route to this destination is not verified in the data." };
  const alternatives = bundle.pois.filter((poi) => poi.id !== target.id && poi.category === target.category).flatMap((poi) => {
    const route = routeBetween(router, origin, poi, profile);
    return route.ok ? [{ poi, distanceM: Math.round(route.totalLengthM) }] : [];
  }).sort((a, b) => a.distanceM - b.distanceM || a.poi.id.localeCompare(b.poi.id));
  return { reason, alternative: alternatives[0] ?? null };
}

export const UNKNOWN_LABELS: Record<string, { ja: string; en: string }> = {
  hours: { ja: "営業時間 未確認", en: "Hours unverified" },
  paid: { ja: "運賃区分 不明区間あり", en: "Fare zone unknown on part" },
  wheelchair: { ja: "車椅子可否 不明区間あり", en: "Wheelchair access unknown on part" },
  steps: { ja: "段差 不明区間あり", en: "Steps unknown on part" },
  length: { ja: "距離 不明区間あり", en: "Length unknown on part" },
  access_evidence: { ja: "通行根拠 不足区間あり", en: "Access evidence missing on part" },
};

/** Presentation only. Distances/timing/fare state remain the router's truth. */
export function summarizeRoute(bundle: StationBundle, route: RouteResult) {
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const visited = route.steps.length ? [route.steps[0]!.fromFloorId, ...route.steps.map((s) => s.toFloorId)] : [];
  const floorLabels = visited.filter((id, i) => i === 0 || id !== visited[i - 1]).map((id) => floorLabel(floors.get(id)).short);
  return {
    distanceM: Math.round(route.totalLengthM),
    minutes: Math.max(1, Math.ceil(route.estimatedSeconds / 60)),
    floorChanges: route.floorChanges,
    floorLabels,
    fare: route.crossesFareBoundary === true
      ? { ja: "改札を通過 · きっぷ・IC が必要", en: "Crosses ticket gates · ticket / IC required" }
      : route.crossesFareBoundary === null
        ? { ja: "改札通過の有無は未確認", en: "Fare boundary unverified" }
        : { ja: "改札内外の移動なし", en: "No fare boundary crossing" },
  };
}

/** Fit the whole route in the existing map without a camera flight through floors. */
export function routeMapFrame(points: readonly { x: number; y: number }[], size: number) {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: (size - 88) / Math.max(12, maxX - minX, maxY - minY) };
}

/** Nearby means a verified route on this floor, never a straight-line guess. */
export function nearbyExits(bundle: StationBundle, router: Router, originNodeId: string, profile: RouteProfile, limitM = 80) {
  const origin = bundle.nodes.find((n) => n.id === originNodeId);
  if (!origin) return [];
  return bundle.pois.filter((p) => p.category === "exit" && p.floorId === origin.floorId && !p.connectorNodeIds.includes(originNodeId)).flatMap((poi) => {
    const r = routeBetween(router, { kind: "node", nodeId: originNodeId }, poi, profile);
    return r.ok && r.floorChanges === 0 && r.totalLengthM <= limitM ? [{ poi, distanceM: Math.round(r.totalLengthM) }] : [];
  }).sort((a, b) => a.distanceM - b.distanceM).slice(0, 2);
}
