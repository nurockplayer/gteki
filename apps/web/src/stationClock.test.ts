import { describe, expect, it } from "vitest";
import { createRouter } from "@gteki/navigation";
import { createSyntheticBundle, syntheticEdge } from "../../../packages/navigation/src/fixtures.ts";
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

  it("keeps seconds, so a walk that would end after a closing minute waits instead", () => {
    // 2026-10-21T13:59:50.500Z is 22:59:50.5 in Tokyo: a 24 m passage (20 s) closing at 23:00 ends at 23:00:10.5.
    const clock = stationClock(new Date("2026-10-21T13:59:50.500Z"), "Asia/Tokyo");
    expect(clock.minutes).toBeCloseTo(22 * 60 + 59 + 50.5 / 60, 9);
    const evidence = { sourceIds: ["fixture-access"], method: "synthetic-fixture", checkedDate: "2026-10-20" };
    const router = createRouter(createSyntheticBundle([
      syntheticEdge("passage", "start", "goal", { lengthM: 24, hours: { kind: "window", open: "05:00", close: "23:00", evidence } }),
    ]));
    const at = { weekday: clock.weekday, minutes: clock.minutes };
    const late = router.route("start", "goal", { fare: "ticketed", stepFree: false, hours: "require_known", at });
    expect(late.ok && late.steps[0]!.waitUntil).toEqual({ weekday: "thu", minutes: 5 * 60, dayOffset: 1 });
    const earlier = stationClock(new Date("2026-10-21T13:59:30Z"), "Asia/Tokyo");
    const inTime = router.route("start", "goal", { fare: "ticketed", stepFree: false, hours: "require_known", at: { weekday: earlier.weekday, minutes: earlier.minutes } });
    expect(inTime.ok && inTime.waitSeconds).toBe(0);
  });
});
