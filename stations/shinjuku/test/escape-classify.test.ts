import { describe, expect, it } from "vitest";
import { classifyRay } from "./helpers/escape-classify.ts";

const underground = { point: { y: -4.7 } };
const aboveStreet = { point: { y: 1.2 } };

describe("escape ray classification", () => {
  it("encloses a near hit at or below the street", () => {
    expect(classifyRay(underground, underground)).toBe("enclosed");
    expect(classifyRay({ point: { y: -0.001 } }, { point: { y: -0.001 } })).toBe("enclosed");
  });

  it("escapes a near hit above the street", () => {
    expect(classifyRay(aboveStreet, aboveStreet)).toBe("escape");
  });

  it("escapes a hit above the street at the 250 m horizon", () => {
    expect(classifyRay(null, aboveStreet)).toBe("escape");
  });

  it("escapes when nothing is hit at 250 m", () => {
    expect(classifyRay(null, null)).toBe("escape");
  });

  it("reports a range miss for an underground hit at the 250 m horizon", () => {
    expect(classifyRay(null, underground)).toBe("rangeMiss");
  });
});
