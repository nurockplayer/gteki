import { describe, expect, it } from "vitest";
import { watchReducedMotion, type MotionQuery } from "./motion.ts";

function fakeQuery(matches: boolean) {
  const subs = new Set<(e: { matches: boolean }) => void>();
  const mq: MotionQuery = { matches, addEventListener: (_t, cb) => subs.add(cb), removeEventListener: (_t, cb) => subs.delete(cb) };
  return { mq, subs, set: (m: boolean) => { mq.matches = m; subs.forEach((cb) => cb({ matches: m })); } };
}

describe("watchReducedMotion", () => {
  it("reports the current preference at once, then every change", () => {
    const q = fakeQuery(false);
    const seen: boolean[] = [];
    watchReducedMotion((r) => seen.push(r), q.mq);
    q.set(true);
    q.set(false);
    expect(seen).toEqual([false, true, false]);
  });

  it("stops after unsubscribe", () => {
    const q = fakeQuery(true);
    const seen: boolean[] = [];
    const off = watchReducedMotion((r) => seen.push(r), q.mq);
    off();
    q.set(false);
    expect(seen).toEqual([true]);
    expect(q.subs.size).toBe(0);
  });

  it("without matchMedia it is a no-op", () => {
    expect(() => watchReducedMotion(() => { throw new Error("unexpected"); }, null)()).not.toThrow();
  });
});
