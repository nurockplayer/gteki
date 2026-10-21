/** Turn a RouteResult into human instructions (ja/en) without inventing facts. */
import type { RouteResult } from "@gteki/navigation";
import type { Floor, Node, StationBundle } from "@gteki/schema";

export interface Maneuver {
  kind: "walk" | "turn" | "stairs" | "escalator" | "elevator" | "gate" | "ramp" | "arrive";
  ja: string;
  en: string;
  lengthM: number;
  /** index into route.nodeIds where this maneuver starts */
  startIndex: number;
  toFloorLabel?: string;
  up?: boolean;
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

export function narrate(bundle: StationBundle, route: RouteResult): Maneuver[] {
  const nodes = new Map<string, Node>(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map<string, Floor>(bundle.floors.map((f) => [f.id, f]));
  const out: Maneuver[] = [];
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
      for (let k = j - 1; k >= i; k--) {
        const f = floors.get(steps[k]!.toFloorId);
        if (f && !f.intermediate) {
          toF = f;
          break;
        }
      }
      const up = (toF?.ordinal ?? 0) > (fromF?.ordinal ?? 0);
      const L = floorLabel(toF);
      const verbJa = up ? "上る" : "下りる";
      const what = { stairs: ["階段", "stairs"], escalator: ["エスカレーター", "escalator"], elevator: ["エレベーター", "elevator"], ramp: ["スロープ", "ramp"] }[s.mode]!;
      if (s.mode === "elevator") out.push({ kind: "elevator", ja: `エレベーターで ${L.ja} へ`, en: `Take the elevator to ${L.en}`, lengthM: 0, startIndex: i, toFloorLabel: L.short, up });
      else if (fromF?.id === toF?.id) out.push({ kind: s.mode, ja: `${what[0]}を進む（${Math.round(len)} m）`, en: `Continue via ${what[1]} (${Math.round(len)} m)`, lengthM: len, startIndex: i });
      else out.push({ kind: s.mode, ja: `${what[0]}で ${L.ja} へ${verbJa}`, en: `Take the ${what[1]} ${up ? "up" : "down"} to ${L.en}`, lengthM: len, startIndex: i, toFloorLabel: L.short, up });
      i = j;
      continue;
    }
    if (s.mode === "gate") {
      out.push({ kind: "gate", ja: "改札を通る", en: "Pass through the ticket gates", lengthM: s.lengthM, startIndex: i });
      i++;
      continue;
    }
    // walk: merge straight-ish segments, emit turn at significant heading change
    let j = i;
    let len = 0;
    let heading: number | null = null;
    let turn: "left" | "right" | null = null;
    while (j < steps.length && steps[j]!.mode === "walk") {
      const a = nodes.get(steps[j]!.fromNodeId)!.position;
      const b = nodes.get(steps[j]!.toNodeId)!.position;
      const h = Math.atan2(b.x - a.x, b.y - a.y);
      const segLen = steps[j]!.lengthM;
      if (heading !== null && segLen > 1.5) {
        const d = Math.atan2(Math.sin(h - heading), Math.cos(h - heading));
        if (Math.abs(d) > 0.9 && len > 3) {
          turn = d > 0 ? "right" : "left";
          break;
        }
      }
      if (segLen > 1.5) heading = h;
      len += segLen;
      j++;
    }
    out.push({ kind: "walk", ja: `直進 ${Math.max(1, Math.round(len))} m`, en: `Go straight ${Math.max(1, Math.round(len))} m`, lengthM: len, startIndex: i });
    if (turn) out.push({ kind: "turn", ja: turn === "left" ? "左へ曲がる" : "右へ曲がる", en: turn === "left" ? "Turn left" : "Turn right", lengthM: 0, startIndex: j });
    i = j;
  }
  out.push({ kind: "arrive", ja: "目的地に到着", en: "Arrive at destination", lengthM: 0, startIndex: steps.length });
  return out;
}

export const UNKNOWN_LABELS: Record<string, { ja: string; en: string }> = {
  hours: { ja: "営業時間 未確認", en: "Hours unverified" },
  paid: { ja: "運賃区分 不明区間あり", en: "Fare zone unknown on part" },
  wheelchair: { ja: "車椅子可否 不明区間あり", en: "Wheelchair access unknown on part" },
  steps: { ja: "段差 不明区間あり", en: "Steps unknown on part" },
  length: { ja: "距離 不明区間あり", en: "Length unknown on part" },
  access_evidence: { ja: "通行根拠 不足区間あり", en: "Access evidence missing on part" },
};
