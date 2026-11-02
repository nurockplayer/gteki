import { describe, expect, it } from "vitest";
import type { HoursText } from "@gteki/schema";
import { HOURS_MAX_AGE_DAYS, HOURS_STALE_DAYS, hoursStale, printedHours } from "./hours.ts";

const hours = (over: Partial<HoursText> = {}): HoursText => ({
  text: "10:00～21:00", sourceUrl: "https://example.org/shop", retrievedAt: "2026-10-24",
  basis: "undated-official", status: "OK", ...over,
});
const at = (date: string) => new Date(`${date}T00:00:00Z`);

describe("printed hours (OD-32)", () => {
  it("shows the page's own wording up to and including the 180-day cutoff", () => {
    expect(HOURS_MAX_AGE_DAYS).toBe(180);
    expect(printedHours(hours(), at("2026-10-24"))).toBe("10:00～21:00");
    expect(printedHours(hours(), at("2027-04-22"))).toBe("10:00～21:00"); // exactly 180 days later
  });

  it("hides a reading past 180 days rather than show a stale timetable", () => {
    expect(printedHours(hours(), at("2027-04-23"))).toBeNull(); // 181 days later
  });

  it("hides a reading dated after now rather than show a future date", () => {
    expect(printedHours(hours({ retrievedAt: "2026-10-25" }), at("2026-10-24"))).toBeNull();
    expect(printedHours(hours({ retrievedAt: "2026-10-24" }), at("2026-10-24"))).toBe("10:00～21:00");
  });

  it("hides rows where the page printed nothing, and unreadable dates", () => {
    expect(printedHours(hours({ status: "UNKNOWN" }), at("2026-10-24"))).toBeNull();
    expect(printedHours(hours({ text: "  " }), at("2026-10-24"))).toBeNull();
    expect(printedHours(hours({ retrievedAt: "2026-13-40" }), at("2026-10-24"))).toBeNull();
    expect(printedHours(undefined, at("2026-10-24"))).toBeNull();
  });

  it("marks a reading stale only after 90 days, and never an unreadable date", () => {
    expect(HOURS_STALE_DAYS).toBe(90);
    expect(hoursStale(hours(), at("2027-01-22"))).toBe(false); // exactly 90 days later
    expect(hoursStale(hours(), at("2027-01-23"))).toBe(true); // 91 days later
    expect(hoursStale(hours({ retrievedAt: "2026-13-40" }), at("2027-06-01"))).toBe(false);
  });
});
