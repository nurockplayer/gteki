// Lane F #339 F0/F1: deterministic foot-slide baseline of the player avatar, headless (no GPU, no browser).
//
//   node --experimental-transform-types tools/qa/avatar-baseline/slide.ts --root <installed checkout> [--out <dir>] [--quality high|low] [--adapter procedural]
//
// It steps the avatar at a fixed 60 fps exactly as Explorer.step composes it (avatarMotion from the
// walker's move, rig.update, then the group's position and yaw), over scripted walker paths with no
// collisions: level walk, run, the 2.2 m/s walk/run blend, the guide tiers, start/stop and 90/180
// turns. Stance and slide follow tests/e2e/lib/footSlide.ts. Writes slide.json (every stance phase)
// and slide.md (the table posted on #339). The in-browser cross-check is specs/19-avatar-baseline.
import fs from "node:fs";
import path from "node:path";
import { byEvent, STANCE, stancePhases, summarize, type FootFrame, type StancePhase } from "../../../tests/e2e/lib/footSlide.ts";
import { procedural, type Adapter } from "./procedural.ts";

const ADAPTERS: Record<string, Adapter> = { procedural };
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const root = path.resolve(arg("root") ?? process.env.GTEKI_ROOT ?? ".");
const out = path.resolve(arg("out", "tests/e2e/artifacts/avatar-baseline")!);
const quality = (arg("quality", "high") as "high" | "low");
const adapter = ADAPTERS[arg("adapter", "procedural")!];
if (!adapter) throw new Error(`unknown --adapter; have ${Object.keys(ADAPTERS).join(", ")}`);

const DT = 1 / 60;
const WALK = 1.45, RUN = 3.4; // WALKER_SPEED in packages/scene-api (keyboard walk and Shift run)
/** Analysis windows after an event: a stance phase overlapping [t, t + WINDOW_S) is attributed to it. */
const WINDOW_S = 1.0;
/** Lead-in excluded from steady-state scenarios so the speed smoothing has settled. */
const WARM_S = 2.0;

/** A leg of a scripted path: hold `speed` along `headingDeg` (0 = -Z, the avatar's forward; +90 = turn left). */
interface Leg { s: number; speed: number; headingDeg: number; event?: string }
interface Scenario { id: string; label: string; legs: Leg[]; steady?: boolean; gate?: string }

const repeat = <T>(n: number, f: (i: number) => T[]): T[] => Array.from({ length: n }, (_, i) => f(i)).flat();

const SCENARIOS: Scenario[] = [
  { id: "idle", label: "idle (control)", legs: [{ s: 12, speed: 0, headingDeg: 0 }], steady: true },
  { id: "walk", label: `walk ${WALK} m/s (keyboard)`, legs: [{ s: 16, speed: WALK, headingDeg: 0 }], steady: true, gate: "≤2 cm/cycle" },
  { id: "guide_walk", label: "guide walk tier 1.6 m/s", legs: [{ s: 16, speed: 1.6, headingDeg: 0 }], steady: true, gate: "≤2 cm/cycle" },
  { id: "blend", label: "walk/run blend 2.2 m/s", legs: [{ s: 14, speed: 2.2, headingDeg: 0 }], steady: true, gate: "≤3–4 cm" },
  { id: "run", label: `run ${RUN} m/s (Shift, guide run tier)`, legs: [{ s: 12, speed: RUN, headingDeg: 0 }], steady: true, gate: "≤2 cm/cycle" },
  { id: "fast", label: "guide fast tier 6.8 m/s (to become a 2× time-lapse)", legs: [{ s: 10, speed: 6.8, headingDeg: 0 }], steady: true },
  {
    id: "startstop_walk", label: "start/stop, walk", gate: "≤5 cm",
    legs: repeat(12, () => [{ s: 2.5, speed: 0, headingDeg: 0, event: "stop" }, { s: 3, speed: WALK, headingDeg: 0, event: "start" }]),
  },
  {
    id: "startstop_run", label: "start/stop, run", gate: "≤5 cm",
    legs: repeat(12, () => [{ s: 2.5, speed: 0, headingDeg: 0, event: "stop" }, { s: 3, speed: RUN, headingDeg: 0, event: "start" }]),
  },
  {
    id: "turn90_walk", label: "90° turns at walk, alternating L/R", gate: "≤3–4 cm",
    legs: [{ s: 3, speed: WALK, headingDeg: 0 }, ...repeat(12, (i) => [{ s: 3, speed: WALK, headingDeg: i % 4 < 2 ? (i % 2 ? 0 : 90) : (i % 2 ? 0 : -90), event: "turn" }])],
  },
  {
    id: "turn180_walk", label: "180° reversals at walk", gate: "≤3–4 cm",
    legs: [{ s: 3, speed: WALK, headingDeg: 0 }, ...repeat(12, (i) => [{ s: 3, speed: WALK, headingDeg: i % 2 ? 0 : 180, event: "turn" }])],
  },
  {
    id: "turn90_run", label: "90° turns at run, alternating L/R", gate: "≤3–4 cm",
    legs: [{ s: 3, speed: RUN, headingDeg: 0 }, ...repeat(12, (i) => [{ s: 2.5, speed: RUN, headingDeg: i % 4 < 2 ? (i % 2 ? 0 : 90) : (i % 2 ? 0 : -90), event: "turn" }])],
  },
];

interface Result {
  id: string; label: string; gate?: string; seconds: number;
  windows: { event: string; t: number }[];
  summary: ReturnType<typeof summarize>;
  byEvent?: Record<string, ReturnType<typeof summarize>>;
  phases: StancePhase[];
}

async function run(sc: Scenario): Promise<Result> {
  const av = await adapter!.create(root, quality);
  const frames: FootFrame[] = [];
  const windows: { event: string; t: number }[] = [];
  const pos = { x: 0, y: 0, z: 0 };
  let t = 0;
  // Settle the rig at rest before the script starts (both feet planted, speed smoothing at zero).
  for (let i = 0; i < 60; i++) av.step(DT, pos, pos);
  for (const leg of sc.legs) {
    if (leg.event) windows.push({ event: leg.event, t });
    const h = (leg.headingDeg * Math.PI) / 180;
    const dx = -Math.sin(h) * leg.speed * DT, dz = -Math.cos(h) * leg.speed * DT;
    for (let i = 0, n = Math.round(leg.s / DT); i < n; i++) {
      const prev = { x: pos.x, z: pos.z };
      pos.x += dx; pos.z += dz; t += DT;
      av.step(DT, prev, pos);
      frames.push({ t, groundY: pos.y, feet: av.probes() });
    }
  }
  av.dispose();
  const all = stancePhases(frames);
  const phases = sc.steady ? all.filter((p) => p.t0 >= WARM_S) : all;
  const res: Result = { id: sc.id, label: sc.label, gate: sc.gate, seconds: Math.round(t * 100) / 100, windows, summary: summarize(phases), phases };
  if (windows.length) res.byEvent = byEvent(phases, windows, WINDOW_S);
  return res;
}

const results: Result[] = [];
for (const sc of SCENARIOS) results.push(await run(sc));
const tris = await adapter.create(root, quality).then((a) => { const n = a.triangles(); a.dispose(); return n; });

fs.mkdirSync(out, { recursive: true });
const meta = {
  adapter: adapter.name, quality, root, dt: DT, stance: STANCE, warmS: WARM_S, windowS: WINDOW_S, triangles: tris,
  node: process.version, generated: new Date().toISOString(),
};
fs.writeFileSync(path.join(out, `slide-${quality}.json`), JSON.stringify({ meta, results }, null, 2));

const f = (x: number | null) => (x === null ? "–" : x.toFixed(2));
const rows = results.flatMap((r) => {
  const line = (name: string, s: Result["summary"]) => `| ${name} | ${s.cycles} | ${s.phases} | ${f(s.p50Cm)} | ${f(s.p95Cm)} | ${f(s.maxCm)} | ${r.gate ?? ""} |`;
  return r.byEvent ? Object.entries(r.byEvent).map(([ev, s]) => line(`${r.label}: ${ev} (stances within ${WINDOW_S} s)`, s)) : [line(r.label, r.summary)];
});
const md = [
  `Foot slide per stance phase, ${adapter.name}, quality=${quality}, ${tris} triangles.`,
  `Fixed ${Math.round(1 / DT)} fps step; stance = sole probe < ${STANCE.heightM * 100} cm above ground and |vertical speed| < ${STANCE.vSpeedMps * 100} cm/s; slide = horizontal path of the planted probe (heel or toe, whichever moves less).`,
  "",
  "| scenario | cycles | stances | p50 cm | p95 cm | max cm | #339 gate |",
  "|---|---|---|---|---|---|---|",
  ...rows,
].join("\n");
fs.writeFileSync(path.join(out, `slide-${quality}.md`), md + "\n");
console.log(md);
