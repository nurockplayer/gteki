import { describe, expect, it } from "vitest";
import { isVmIdle, parseIgnoreList } from "./box-idle.mjs";

describe("isVmIdle", () => {
  it("is idle with no containers", () => expect(isVmIdle([])).toBe(true));
  it("is idle with only the default ignored container", () => {
    expect(isVmIdle(["belabox-receiver"])).toBe(true);
  });
  it("is not idle while another gteki box runs", () => {
    expect(isVmIdle(["belabox-receiver", "gteki-box-abc123"])).toBe(false);
  });
  it("is not idle for an unknown container", () => {
    expect(isVmIdle(["postgres"])).toBe(false);
  });
  it("honors a custom ignore list", () => {
    expect(isVmIdle(["postgres", "redis"], ["postgres", "redis"])).toBe(true);
    expect(isVmIdle(["belabox-receiver"], ["postgres"])).toBe(false);
  });
  it("never ignores gteki- names even if listed", () => {
    expect(isVmIdle(["gteki-box-x"], ["gteki-box-x"])).toBe(false);
  });
});

describe("parseIgnoreList", () => {
  it("defaults to belabox-receiver", () => {
    expect(parseIgnoreList(undefined)).toEqual(["belabox-receiver"]);
  });
  it("splits and trims", () => {
    expect(parseIgnoreList(" a, b ,,c")).toEqual(["a", "b", "c"]);
  });
  it("allows an empty list", () => expect(parseIgnoreList("")).toEqual([]));
});
