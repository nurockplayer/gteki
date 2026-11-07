import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stableHypot } from "./stable-hypot.ts";

// The two fascia edges that decided #1012, as layout.ts builds them from the station data.
const EDGES = {
  m2: [13.073232128505989 - 10.403296530582232, 38.94670346941776 - 38.10323212850599],
  m1: [-54.1430527589428 - -51.570806249302066, 146.82080624930205 - 147.92694724105718],
};

/** Deterministic LCG so a failure reproduces on any machine. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("stableHypot", () => {
  it("agrees with this engine's hypot bit for bit on a seeded sample", () => {
    const rnd = seeded(31337);
    const cases: number[][] = [];
    for (let i = 0; i < 2000; i++) cases.push([(rnd() - 0.5) * 400, (rnd() - 0.5) * 400]);
    for (let i = 0; i < 2000; i++) cases.push([(rnd() - 0.5) * 3, (rnd() - 0.5) * 3]);
    // Lengths on the 2.8 m design tie, the case #1012 turns on.
    for (let i = 0; i < 2000; i++) { const t = rnd() * Math.PI * 2; cases.push([2.8 * Math.cos(t), 2.8 * Math.sin(t)]); }
    for (let i = 0; i < 1000; i++) cases.push([(rnd() - 0.5) * 200, (rnd() - 0.5) * 20, (rnd() - 0.5) * 200]);
    for (const values of cases) expect(Object.is(stableHypot(...values), Math.hypot(...values)), `${values.join(", ")}`).toBe(true);
  });

  it("reproduces V8's bits on the two #1012 edges", () => {
    // These literals are V8 13.6's results; the whole point is that every engine gets them.
    expect(Object.is(stableHypot(...EDGES.m1), 2.7999999999999923)).toBe(true);
    expect(Object.is(stableHypot(...EDGES.m2), 2.8000000000000007)).toBe(true);
    expect(Object.is(stableHypot(...EDGES.m1), Math.hypot(...EDGES.m1))).toBe(true);
    expect(Object.is(stableHypot(...EDGES.m2), Math.hypot(...EDGES.m2))).toBe(true);
  });

  it("keeps V8's handling of zero, infinity and NaN", () => {
    expect(Object.is(stableHypot(), 0)).toBe(true);
    expect(Object.is(stableHypot(-0, -0), 0)).toBe(true);
    expect(stableHypot(3, 4)).toBe(5);
    expect(stableHypot(Infinity, NaN)).toBe(Infinity);
    expect(Number.isNaN(stableHypot(NaN, 1))).toBe(true);
    expect(stableHypot(1e308, 1e308)).toBe(Math.hypot(1e308, 1e308));
  });

  it("finds no engine hypot call left in the scene sources", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
    });
    const offenders = walk(dir).filter((p) => fs.readFileSync(p, "utf8").includes("Math.hypot"));
    expect(offenders.map((p) => path.relative(dir, p))).toEqual([]);
  });
});
