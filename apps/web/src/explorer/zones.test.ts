import { describe, expect, it } from "vitest";
import type { Floor, Node } from "@gteki/schema";
import { classifyZone, zoneAnchors, type ZoneAnchor } from "./zones.ts";

const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });
const platform = (x: number, y: number, z: number): ZoneAnchor => ({ kind: "platform", x, y, z });
const gate = (x: number, y: number, z: number): ZoneAnchor => ({ kind: "ticket_gate", x, y, z });
const exit = (x: number, y: number, z: number): ZoneAnchor => ({ kind: "exit", x, y, z });

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

  it("is outdoor within 4 m horizontally and 1.5 m vertically of a street-level exit", () => {
    expect(classifyZone(at(0, 0, 0), false, [exit(3, 0, 0)])).toBe("outdoor");
    expect(classifyZone(at(0, 0, 0), false, [exit(0, 1, 4)])).toBe("outdoor");
  });

  it("is not outdoor from an exit 5 m away or 2 m below", () => {
    expect(classifyZone(at(0, 0, 0), false, [exit(5, 0, 0)])).toBe("passage");
    expect(classifyZone(at(0, 0, 0), false, [exit(0, -2, 0)])).toBe("passage");
  });

  it("takes a matching exit over a matching platform anchor", () => {
    expect(classifyZone(at(0, 0, 0), false, [platform(0, 0, 0), exit(3, 0, 0)])).toBe("outdoor");
  });
});

describe("zoneAnchors", () => {
  const node = (id: string, floorId: string, kind: Node["kind"], x = 0): Node =>
    ({ id, floorId, kind, position: { x, y: 0, z: 0 } }) as unknown as Node;
  const floor = (id: string, ordinal: number | null): Floor => ({ id, ordinal }) as unknown as Floor;

  it("keeps exits on ordinal 0 and ordinal 1 floors", () => {
    const anchors = zoneAnchors(
      [node("street", "f0", "exit", 1), node("upper", "f1", "exit", 2)],
      [floor("f0", 0), floor("f1", 1)],
    );
    expect(anchors).toEqual([
      { kind: "exit", x: 1, y: 0, z: -0 },
      { kind: "exit", x: 2, y: 0, z: -0 },
    ]);
  });

  it("drops exits on an ordinal -1 floor or an unknown floor", () => {
    const anchors = zoneAnchors(
      [node("under", "fm1", "exit", 1), node("unknown", "missing", "exit", 2)],
      [floor("fm1", -1)],
    );
    expect(anchors).toEqual([]);
  });
});
