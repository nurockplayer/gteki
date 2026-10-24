/**
 * Foot-slide analysis shared by the #339 avatar baselines (F0 now, F1 on the rigged character):
 * tools/qa/avatar-baseline/slide.ts feeds it frames from a headless avatar, specs/19-avatar-baseline
 * feeds it frames read from the running explorer. No dependencies, so both can import it.
 *
 * Input: world-space contact probes per foot per frame (a heel and a toe point on the sole, y up, metres)
 * plus the ground height under the walker. A probe is in stance when it is within STANCE.heightM of the
 * ground and its vertical speed is under STANCE.vSpeedMps (#339 F0). A foot is in stance while any of its
 * probes is; one contiguous run of stance frames is one stance phase. A frame's slide is the horizontal
 * move of the foot's least-moving probe that is in stance, so a heel-to-toe roll is not counted as slide.
 */

export interface P3 { x: number; y: number; z: number }
/** One frame: time (s), ground height under the walker, and per foot (left, right) its sole probes. */
export interface FootFrame { t: number; groundY: number; feet: P3[][]; tag?: string }

export const STANCE = { heightM: 0.02, vSpeedMps: 0.05 } as const;

export interface StancePhase {
  foot: number;
  t0: number;
  t1: number;
  frames: number;
  /** Horizontal path of the planted probe over the phase (cm). */
  slideCm: number;
  /** Straight-line horizontal displacement from first to last stance frame (cm). */
  netCm: number;
  /** Phase touches the first or last frame of the capture, so it may be cut short. */
  truncated: boolean;
  /** Tag of the frame the phase started on (scenario segment, e.g. "start", "turn90L"). */
  tag?: string;
}

export interface SlideSummary {
  phases: number;
  /** Complete gait cycles: stance phases of the foot with fewer of them, truncated ones excluded. */
  cycles: number;
  meanCm: number | null;
  p50Cm: number | null;
  p95Cm: number | null;
  maxCm: number | null;
}

const pct = (a: number[], p: number): number | null => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))]! : null);
const r2 = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100);

export function stancePhases(frames: FootFrame[], stance: { heightM: number; vSpeedMps: number } = STANCE): StancePhase[] {
  const out: StancePhase[] = [];
  if (frames.length < 3) return out;
  const nFeet = frames[0]!.feet.length;
  for (let f = 0; f < nFeet; f++) {
    let cur: (StancePhase & { start: P3; last: P3 }) | null = null;
    for (let i = 1; i < frames.length; i++) {
      const fr = frames[i]!, prev = frames[i - 1]!, next = frames[Math.min(i + 1, frames.length - 1)]!;
      const dtc = next.t - prev.t || fr.t - prev.t;
      let best: { d: number; p: P3 } | null = null;
      fr.feet[f]!.forEach((p, k) => {
        const h = p.y - fr.groundY;
        // Central difference of height above ground (a walker on a slope keeps a planted foot at constant h).
        const hp = prev.feet[f]![k]!.y - prev.groundY, hn = next.feet[f]![k]!.y - next.groundY;
        const vy = dtc > 0 ? (hn - hp) / dtc : 0;
        if (h < stance.heightM && Math.abs(vy) < stance.vSpeedMps) {
          const q = prev.feet[f]![k]!;
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          if (!best || d < best.d) best = { d, p };
        }
      });
      if (best) {
        const b = best as { d: number; p: P3 };
        if (!cur) cur = { foot: f, t0: fr.t, t1: fr.t, frames: 1, slideCm: 0, netCm: 0, truncated: i === 1, tag: fr.tag, start: b.p, last: b.p };
        else { cur.slideCm += b.d * 100; cur.frames++; cur.t1 = fr.t; cur.last = b.p; }
      } else if (cur) {
        out.push(close(cur, false));
        cur = null;
      }
    }
    if (cur) out.push(close(cur, true));
  }
  return out.sort((a, b) => a.t0 - b.t0 || a.foot - b.foot);
}

function close(c: StancePhase & { start: P3; last: P3 }, truncatedEnd: boolean): StancePhase {
  const { start, last, ...p } = c;
  return { ...p, slideCm: r2(p.slideCm)!, netCm: r2(Math.hypot(last.x - start.x, last.z - start.z) * 100)!, truncated: p.truncated || truncatedEnd };
}

/**
 * Stance phases around scripted events (start, stop, turn): a phase overlapping [t, t + windowS) of an
 * event belongs to it, with its whole slide (not just the part inside the window). `cycles` here counts
 * events that had at least one stance in their window, not gait cycles.
 */
export function byEvent(phases: StancePhase[], windows: { event: string; t: number }[], windowS: number): Record<string, SlideSummary> {
  const out: Record<string, SlideSummary> = {};
  const hits = (p: StancePhase, w: { t: number }) => p.t1 >= w.t && p.t0 < w.t + windowS;
  for (const ev of new Set(windows.map((w) => w.event))) {
    const ws = windows.filter((w) => w.event === ev);
    const hit = phases.filter((p) => ws.some((w) => hits(p, w)));
    out[ev] = { ...summarize(hit), cycles: ws.filter((w) => hit.some((p) => hits(p, w))).length };
  }
  return out;
}

/** Phases clear of every event window, i.e. the steady gait between scripted events. */
export function steadyPhases(phases: StancePhase[], windows: { t: number }[], windowS: number, warmS = 0): StancePhase[] {
  return phases.filter((p) => p.t0 >= warmS && !windows.some((w) => p.t1 >= w.t && p.t0 < w.t + windowS));
}

export function summarize(phases: StancePhase[]): SlideSummary {
  const full = phases.filter((p) => !p.truncated);
  const s = full.map((p) => p.slideCm).sort((a, b) => a - b);
  const perFoot = [0, 1].map((f) => full.filter((p) => p.foot === f).length);
  return {
    phases: full.length,
    cycles: Math.min(...perFoot),
    meanCm: r2(s.length ? s.reduce((a, b) => a + b, 0) / s.length : null),
    p50Cm: r2(pct(s, 0.5)),
    p95Cm: r2(pct(s, 0.95)),
    maxCm: r2(s.at(-1) ?? null),
  };
}
