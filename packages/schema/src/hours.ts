import type { HoursSpec, Weekday } from "./index.ts";

/** Station-local wall-clock time. Time zones and holidays are the caller's responsibility. */
export interface LocalTime {
  weekday: Weekday;
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
}

const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "HH:MM" → minutes (00:00–47:59 allowed for after-midnight service); null when malformed. */
export function parseHm(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 47 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Whether an edge is open at `at`.
 * true/false only when the hours are known; null = UNKNOWN (no hours, or malformed hours).
 */
export function isOpenAt(hours: HoursSpec | null, at: LocalTime): boolean | null {
  if (hours === null) return null;
  if (hours.kind === "always") return true;
  const open = parseHm(hours.open);
  let close = parseHm(hours.close);
  if (open === null || close === null || open === close) return null;
  if (close < open) close += 1440; // e.g. 22:00–02:00 runs past midnight
  const days = new Set(hours.days ?? WEEK);
  const today = WEEK.indexOf(at.weekday);
  if (today < 0 || !(at.minutes >= 0 && at.minutes < 1440)) return null;
  // A service day's window can reach several calendar days later (open ≤ 47:59, close < open wraps +24h),
  // so check every service day whose window could still cover `at`.
  for (let back = 0; back * 1440 < close; back++) {
    const serviceDay = WEEK[(today - back + 7 * 4) % 7]!;
    const t = at.minutes + back * 1440;
    if (days.has(serviceDay) && t >= open && t < close) return true;
  }
  return false;
}
