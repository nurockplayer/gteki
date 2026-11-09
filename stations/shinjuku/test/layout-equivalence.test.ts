import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json";
import { buildLayout, type Layout, type Plan } from "../scene/layout.ts";

/** Preserve the original physical layout; visible shaft sheets have their own regression test. */
export function layoutHash(layout: Layout): string {
  const { shaftFinishes: _visual, shaftFascias: _fascias, ...physical } = layout;
  return createHash("sha256").update(JSON.stringify(physical, (_key, value: unknown) => {
    if (value instanceof Map) return [...value];
    return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
  })).digest("hex");
}

describe("layout equivalence", () => {
  let digest: string;
  beforeAll(() => {
    const { bundle } = loadShinjukuBundle();
    digest = layoutHash(buildLayout(bundle, planJson as unknown as Plan));
  }, 60_000);
  it("preserves the pre-optimization physical layout at millimetre precision", () => {
    // #789 intentionally repairs eight display rises; preserve that physical layout.
    // #1000 carries the shell of the three shafts with a near-street landing (c3fe6342
    // at -1.6, 636c6fc9 and 0564105d at -1.68) up to their own roofs, and (fix 1) cuts
    // that shell only where a passage crosses it; only those walls move.
    expect(digest).toBe("5a259b259ac3d9acf1c28889e2a5d2488f4183031c3756b810b42d23787cde63");
  });
});
