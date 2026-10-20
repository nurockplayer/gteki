import { describe, expect, it } from "vitest";
import { stationClock } from "./stationClock.ts";

describe("stationClock", () => {
  it("reads the Tokyo day and time without host-zone reparsing", () => {
    // 2026-10-20T15:30Z is Wednesday 00:30 in Tokyo, the case that used to land on the previous day.
    expect(stationClock(new Date("2026-10-20T15:30:00Z"), "Asia/Tokyo")).toEqual({ weekday: "wed", minutes: 30, date: "2026-10-21" });
  });

  it("reports midnight as 0 minutes, not 24:00", () => {
    expect(stationClock(new Date("2026-10-20T15:00:00Z"), "Asia/Tokyo")).toEqual({ weekday: "wed", minutes: 0, date: "2026-10-21" });
  });

  it("ignores the host's own DST transitions", () => {
    // 2026-03-08T07:30Z is inside the America/New_York spring-forward hour; Tokyo has no DST.
    expect(stationClock(new Date("2026-03-08T07:30:00Z"), "Asia/Tokyo")).toEqual({ weekday: "sun", minutes: 16 * 60 + 30, date: "2026-03-08" });
  });
});
