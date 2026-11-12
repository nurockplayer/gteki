import { describe, expect, it } from "vitest";
import { evaluateCheck, flatRatio } from "./golden";
import { goldenPixels } from "../../../apps/web/src/explorer/goldenPixels";

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
  it("rejects a flat synthetic frame", () => {
    const pixels = new Uint8Array(400).fill(80);
    expect(evaluateCheck("flatRatio", flatRatio(pixels), 0.85).status).toBe("fail");
  });
  it("rejects station contribution below one percent", () => {
    const hidden = new Uint8Array(800), shown = hidden.slice();
    shown[0] = 255;
    expect(evaluateCheck("stationShare", goldenPixels(shown, hidden).stationShare!, 0.01).status).toBe("fail");
  });
  it("rejects a magenta void frame", () => {
    const pixels = new Uint8Array([255, 0, 255, 255, 12, 34, 56, 255]);
    expect(evaluateCheck("voidRatio", goldenPixels(pixels, null).voidRatio, 0.005).status).toBe("fail");
  });
});
