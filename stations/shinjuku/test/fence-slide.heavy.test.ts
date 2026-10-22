/** Every fare fence, gate machine and gate line segment through the wall-slide probe (fence-slide-probe.ts).
 * ~785 segments, ~15 min single-worker; fence-slide.test.ts runs a sample in the default suite. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openStation, probeAll, segments } from "./fence-slide-probe.ts";

describe("walking along every fare fence, gate machine and gate line", () => {
  let station: Awaited<ReturnType<typeof openStation>>;
  beforeAll(async () => { station = await openStation(); }, 120_000);
  afterAll(() => station?.close());
  it("never reaches a differently labelled or unmapped floor except through a verified gate aisle", () => {
    const all = segments(station.built), total = probeAll(station.env, all, all, "fence-slide all");
    expect(total.starts).toBeGreaterThan(0);
    expect(total.slid, "runs that actually slid 3 m").toBeGreaterThan(0);
    expect(total.leaks.slice(0, 10)).toEqual([]);
  }, 7_200_000);
});
