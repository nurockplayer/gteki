import { describe, expect, it } from "vitest";
import { activeContainerNames, findOnPath, isOrbStackContext, isVmIdle, parseIgnoreList } from "./box-idle.mjs";

describe("isOrbStackContext", () => {
  it("matches only the orbstack context", () => {
    expect(isOrbStackContext("orbstack\n")).toBe(true);
    expect(isOrbStackContext("default\n")).toBe(false);
    expect(isOrbStackContext("")).toBe(false);
  });
});

describe("findOnPath", () => {
  const exists = (path) => path === "/opt/bin/orbctl";
  it("finds an executable on PATH", () => {
    expect(findOnPath("orbctl", "/usr/bin::/opt/bin/", exists)).toBe("/opt/bin/orbctl");
  });
  it("returns undefined when absent or PATH is unset", () => {
    expect(findOnPath("orbctl", "/usr/bin", exists)).toBeUndefined();
    expect(findOnPath("orbctl", undefined, exists)).toBeUndefined();
  });
});

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

describe("activeContainerNames", () => {
  const rows = (...states) => states.map((state, i) => `c${i}\t${state}`).join("\n");
  it("ignores exited and dead containers", () => {
    expect(activeContainerNames(rows("exited", "dead"))).toEqual([]);
  });
  it.each(["created", "running", "paused", "restarting", "removing", "someday"])(
    "treats %s as active", (state) => {
      expect(activeContainerNames(rows(state))).toEqual(["c0"]);
    });
  it("handles empty output, blank lines and a missing state", () => {
    expect(activeContainerNames("")).toEqual([]);
    expect(activeContainerNames("\n\n")).toEqual([]);
    expect(activeContainerNames("odd")).toEqual(["odd"]);
  });
});
