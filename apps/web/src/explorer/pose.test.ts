import { describe, expect, it } from "vitest";
import { headingFromYaw } from "./pose.ts";

describe("body yaw to ENU heading", () => {
  it.each([0, 90, 180, 270])("matches walkFrom's yaw for heading %i", (heading) => {
    expect(headingFromYaw(-heading * Math.PI / 180)).toBeCloseTo(heading);
  });
  it.each([[Math.PI / 2, 270], [5 * Math.PI / 2, 270], [-5 * Math.PI / 2, 90], [4 * Math.PI, 0]])(
    "normalises yaw %f", (yaw, heading) => expect(headingFromYaw(yaw)).toBeCloseTo(heading),
  );
});
