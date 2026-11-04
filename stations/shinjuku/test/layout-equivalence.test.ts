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
    // Captured from cc9a2ca before any performance edits (six identical builds).
    expect(digest).toBe("a6d062d218dec1e06fc241a0d4707a6b303b0f44d28a44f60bec21b6495a5b20");
  });
});
