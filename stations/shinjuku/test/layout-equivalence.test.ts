import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json";
import { buildLayout, type Layout, type Plan } from "../scene/layout.ts";

/** Preserve topology, array order and metadata; normalize only sub-millimetre floats. */
export function layoutHash(layout: Layout): string {
  return createHash("sha256").update(JSON.stringify(layout, (_key, value: unknown) => {
    if (value instanceof Map) return [...value];
    return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
  })).digest("hex");
}

describe("layout equivalence", () => {
  it("preserves the complete pre-optimization layout at millimetre precision", () => {
    const { bundle } = loadShinjukuBundle();
    // Captured from cc9a2ca before any performance edits (six identical builds).
    expect(layoutHash(buildLayout(bundle, planJson as unknown as Plan))).toBe("a6d062d218dec1e06fc241a0d4707a6b303b0f44d28a44f60bec21b6495a5b20");
  });
});
