import { describe, expect, it } from "vitest";
import { spawnHeading } from "./spawnHeading.ts";

const point = (x: number, y: number) => ({ x, y });

describe("spawnHeading", () => {
  it("uses a configured heading for a spawn node", () => {
    expect(spawnHeading({ spawnHeadings: { gate: 135 } }, { kind: "node", nodeId: "gate" }, [point(0, 0), point(0, 1)])).toBe(135);
  });

  it("uses the route bearing when the node has no configured heading", () => {
    expect(spawnHeading({ spawnHeadings: {} }, { kind: "node", nodeId: "gate" }, [point(0, 0), point(1, 0)])).toBe(90);
  });

  it.each([
    [0, 1, 0],
    [1, 0, 90],
    [0, -1, 180],
    [-1, 0, 270],
  ])("maps ENU direction (%s, %s) to compass heading %s", (dx, dy, heading) => {
    expect(spawnHeading(null, { kind: "poi" }, [point(0, 0), point(dx, dy)])).toBe(heading);
  });

  it("skips zero-length initial segments and defaults for an empty polyline", () => {
    expect(spawnHeading(null, null, [point(0, 0), point(0, 0), point(1, 0)])).toBe(90);
    expect(spawnHeading(null, null, [])).toBe(0);
  });
});
