import { describe, expect, it } from "vitest";
import { evaluateCheck, flatRatio } from "./golden";

describe("golden camera checks", () => {
  it("finds the largest quantised RGB bucket", () => {
    expect(flatRatio([0, 0, 0, 255, 15, 15, 15, 255, 16, 0, 0, 255])).toBe(2 / 3);
  });
  it("checks upper and lower bounds inclusively", () => {
    expect(evaluateCheck("voidRatio", 0.005, 0.005).status).toBe("pass");
    expect(evaluateCheck("stationShare", 0.09, 0.1).status).toBe("fail");
  });
  it("records only a failing named check as known", () => {
    expect(evaluateCheck("voidRatio", 0.1, 0.005, { voidRatio: "#221" })).toMatchObject({ status: "known", issue: "#221" });
    expect(evaluateCheck("flatRatio", 0.9, 0.85, { voidRatio: "#221" }).status).toBe("fail");
  });
});
