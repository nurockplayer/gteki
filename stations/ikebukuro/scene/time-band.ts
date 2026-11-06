/**
 * Decorative time band for the station scenes (#870; Ikebukuro's crowd shares it for #627).
 * It only picks a background rhythm (train headway, later crowd density); it is read once when a
 * scene is built and never switches mid-session.
 */

export type TimeBand = "morning" | "midday" | "evening";

const tokyoHourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Hour (0–23) in Tokyo, from the instant, never the device's own time zone. */
export function tokyoHour(now: Date): number {
  const hour = tokyoHourFormat.formatToParts(now).find((part) => part.type === "hour");
  if (!hour) throw new Error("tokyoHour: Intl returned no hour part");
  return Number(hour.value);
}

/** 07–09 morning, 10–20 midday, the rest evening. */
export function bandForHour(hour: number): TimeBand {
  if (hour >= 7 && hour <= 9) return "morning";
  if (hour >= 10 && hour <= 20) return "midday";
  return "evening";
}

/** QA override `?qaTimeBand=morning|midday|evening` wins; anything else falls back to the Tokyo clock. */
export function currentTimeBand(search: string | undefined, now: Date): TimeBand {
  const qa = search === undefined ? null : new URLSearchParams(search).get("qaTimeBand");
  if (qa === "morning" || qa === "midday" || qa === "evening") return qa;
  return bandForHour(tokyoHour(now));
}
