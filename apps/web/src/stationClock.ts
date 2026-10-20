import type { Weekday } from "@gteki/schema";

const WEEKDAY_BY_SHORT: Record<string, Weekday> = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };

export interface StationClock {
  weekday: Weekday;
  /** Minutes since station-local midnight. */
  minutes: number;
  /** Station-local calendar date, YYYY-MM-DD. */
  date: string;
}

/**
 * Station-local wall clock read straight from Intl parts. Never reparses a formatted string as a
 * host-local Date, which shifts the day near midnight and normalises hours inside host DST gaps.
 */
export function stationClock(now: Date, timeZone: string): StationClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`stationClock: no ${type} for ${timeZone}`);
    return value;
  };
  const weekday = WEEKDAY_BY_SHORT[part("weekday")];
  if (!weekday) throw new Error(`stationClock: unexpected weekday ${part("weekday")}`);
  return {
    weekday,
    minutes: (Number(part("hour")) % 24) * 60 + Number(part("minute")),
    date: `${part("year")}-${part("month")}-${part("day")}`,
  };
}
