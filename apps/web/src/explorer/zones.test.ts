import { describe, expect, it } from "vitest";
import { classifyZone, type ZoneAnchor } from "./zones.ts";

const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });
const platform = (x: number, y: number, z: number): ZoneAnchor => ({ kind: "platform", x, y, z });
const gate = (x: number, y: number, z: number): ZoneAnchor => ({ kind: "ticket_gate", x, y, z });

describe("classifyZone", () => {
  it("is outdoor whenever the walker is outdoors, anchors or not", () => {
    expect(classifyZone(at(0, 0, 0), true, [platform(0, 0, 0), gate(0, 0, 0)])).toBe("outdoor");
  });

  it("is platform within 40 m horizontally and 3 m vertically of a platform anchor", () => {
    expect(classifyZone(at(0, 0, 0), false, [platform(30, 2, 0)])).toBe("platform");
    expect(classifyZone(at(0, 0, 0), false, [platform(41, 0, 0)])).toBe("passage");
  });

  it("is not platform from a platform anchor 5 m below", () => {
    expect(classifyZone(at(0, 0, 0), false, [platform(0, -5, 0)])).toBe("passage");
  });

  it("is concourse within 25 m horizontally and 3 m vertically of a ticket gate", () => {
    expect(classifyZone(at(0, 0, 0), false, [gate(20, 2, 0)])).toBe("concourse");
    expect(classifyZone(at(0, 0, 0), false, [gate(26, 0, 0)])).toBe("passage");
  });

  it("takes a matching platform anchor over a matching ticket gate", () => {
    expect(classifyZone(at(0, 0, 0), false, [gate(0, 0, 0), platform(30, 0, 0)])).toBe("platform");
  });

  it("is passage with no anchor in range", () => {
    expect(classifyZone(at(0, 0, 0), false, [])).toBe("passage");
  });
});
