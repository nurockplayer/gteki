import { expect, it } from "vitest";
import { bandForHour, currentTimeBand, tokyoHour } from "./time-band.ts";

it("bands the Tokyo hour", () => {
  expect([6, 21, 23, 0].map(bandForHour)).toEqual(["evening", "evening", "evening", "evening"]);
  expect([7, 8, 9].map(bandForHour)).toEqual(["morning", "morning", "morning"]);
  expect([10, 15, 20].map(bandForHour)).toEqual(["midday", "midday", "midday"]);
});

it("reads the hour in Tokyo whatever the device zone is", () => {
  // 22:30 UTC is 07:30 the next day in Tokyo; a device-zone getHours() (UTC here) would say 22.
  expect(tokyoHour(new Date("2026-03-17T22:30:00Z"))).toBe(7);
  expect(tokyoHour(new Date("2026-03-17T15:00:00Z"))).toBe(0);
  expect(tokyoHour(new Date("2026-03-17T00:05:00Z"))).toBe(9);
});

it("lets the QA param win and ignores invalid values", () => {
  const midday = new Date("2026-03-17T03:00:00Z"); // 12:00 JST
  expect(currentTimeBand("?qaTimeBand=morning", midday)).toBe("morning");
  expect(currentTimeBand("?qaTimeBand=evening", midday)).toBe("evening");
  expect(currentTimeBand("?qaTimeBand=night&x=1", midday)).toBe("midday");
  expect(currentTimeBand("", midday)).toBe("midday");
  expect(currentTimeBand(undefined, midday)).toBe("midday");
  expect(currentTimeBand(undefined, new Date("2026-03-17T13:00:00Z"))).toBe("evening"); // 22:00 JST
});
