/** Default-suite sample of the wall-slide probe (fence-slide-probe.ts): every fare fence, gate machine and gate
 * line plus every FENCE_SLIDE_STRIDE-th (default 30) access fence, from FENCE_SLIDE_OFFSET. The whole set is fence-slide.heavy.test.ts (~15 min single-worker). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { distance, fencesOf, mutateFence, replayEnvironment } from "./fare-replay-audit.ts";
import { openStation, probeAll, probeSegment, sample, segments, tally, type Seg, type Tally } from "./fence-slide-probe.ts";

describe("walking along sampled fare fences, gate machines and gate lines", () => {
  let station: Awaited<ReturnType<typeof openStation>>;
  beforeAll(async () => { station = await openStation(); }, 120_000);
  afterAll(() => station?.close());

  it("never reaches a differently labelled or unmapped floor except through a verified gate aisle", () => {
    const all = segments(station.built), stride = Math.max(1, Number(process.env.FENCE_SLIDE_STRIDE) || 30);
    const total = probeAll(station.env, all, sample(all, stride, Number(process.env.FENCE_SLIDE_OFFSET) || 0), `fence-slide stride=${stride}`);
    expect(total.starts).toBeGreaterThan(0);
    expect(total.slid, "runs that actually slid 3 m").toBeGreaterThan(0);
    expect(total.leaks.slice(0, 10)).toEqual([]);
  }, 600_000);

  it("negative control: with a fare fence removed the same probe reports a leak", () => {
    const { built, scene, plan } = station;
    const candidates = fencesOf(built).filter(f => f.reason === "fare" && !f.id.startsWith("join:") && distance(f.a, f.b) > .7)
      .sort((a, b) => distance(b.a, b.b) - distance(a.a, a.b)).slice(0, 8);
    let witness: Tally["leaks"][number] | undefined;
    for (const fence of candidates) {
      const mutated = mutateFence(built, scene, fence, "remove");
      try {
        const t = tally(), seg: Seg = { id: fence.id, kind: "fence:fare", a: fence.a, b: fence.b, z: fence.zMin + .05 };
        probeSegment(replayEnvironment(mutated.built, mutated.scene, plan), seg, t);
        witness = t.leaks[0];
      } finally { mutated.dispose(); }
      if (witness) break;
    }
    expect(witness, "no removed fence produced a leak: the probe cannot fail").toBeDefined();
  }, 300_000);
});
