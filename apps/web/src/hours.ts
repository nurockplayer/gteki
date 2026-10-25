import type { HoursText } from "@gteki/schema";

/**
 * How long a printed hours reading is shown (OD-32). The text is the page's own wording, not a timetable, and
 * nothing rechecks it: past this age the app hides it rather than show an old timetable as if it were current.
 */
export const HOURS_MAX_AGE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The hours text to show, or null. Only a page that really printed hours counts (`status: "OK"` with text), and
 * only while the reading is dated no later than `now` and at most HOURS_MAX_AGE_DAYS old. `retrievedAt` is a
 * YYYY-MM-DD date, so age is measured from the start of that day in UTC.
 */
export function printedHours(hours: HoursText | null | undefined, now: Date): string | null {
  if (!hours || hours.status !== "OK") return null;
  const text = (hours.text ?? "").trim();
  if (!text) return null;
  const readAt = Date.parse(`${hours.retrievedAt}T00:00:00Z`);
  const nowMs = now.getTime();
  if (!Number.isFinite(readAt) || nowMs < readAt || nowMs - readAt > HOURS_MAX_AGE_DAYS * DAY_MS) return null;
  return text;
}
