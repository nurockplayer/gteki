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
    expect(digest).toBe("42b5fc8f49f7425a64a403042f261efe11fb8fa181874d57f569451e1d475316");
  });
});
