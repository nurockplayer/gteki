import type { HoursText } from "@gteki/schema";
import holidayJp from "@holiday-jp/holiday_jp";
import { printedHours } from "./hours.ts";

const tokyo = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
// Slots 0–6 are non-holiday Sun–Sat; slot 7 is any national holiday.
const days: Record<string, number[]> = {
  "": [0, 1, 2, 3, 4, 5, 6, 7], 平日: [1, 2, 3, 4, 5],
  土日祝: [0, 6, 7], "土・日・祝": [0, 6, 7], 土日祝日: [0, 6, 7],
  "月~土": [1, 2, 3, 4, 5, 6], 日祝: [0, 7], "日・祝": [0, 7], "日・祝日": [0, 7],
};
const time = String.raw`(?:午[前後]\s*\d{1,2}時(?:\d{1,2}分)?|\d{1,2}:\d{2}(?:[AP]\.M\.)?)`;
const block = new RegExp(String.raw`^(平日|土日祝日|土日祝|土・日・祝|月[~〜]土|日・祝日|日・祝|日祝)?\s*(${time})\s*[~〜-]\s*(${time})`);

function minutes(text: string): number | null {
  const jp = /^(午前|午後)\s*(\d{1,2})時(?:(\d{1,2})分)?$/.exec(text);
  const clock = /^(\d{1,2}):(\d{2})([AP]\.M\.)?$/.exec(text);
  const h = Number(jp ? jp[2] : clock?.[1]);
  const m = Number(jp ? jp[3] ?? 0 : clock?.[2]);
  const period = jp?.[1] ?? clock?.[3];
  if (m > 59 || h > 23 || (period && (h < 1 || h > 12))) return null;
  return (period ? h % 12 + (period === "午後" || period === "P.M." ? 12 : 0) : h) * 60 + m;
}

/** Footnote words that change the schedule on some days (定休日, 臨時休業, 月曜除く, 短縮営業, other times …). */
const EXCEPTION_NOTE = /休|除|臨時|異な|変更|短縮|延長|特別|曜|祝|[0-9]+月|[0-9]+日|入替|[0-9]{1,2}\s*[:時]|ラストオーダー|L\.?O/;

/** Only complete, unambiguous printed schedules qualify; all other wording stays unknown. */
export function openNow(hours: HoursText | null | undefined, now: Date): "open" | "closed" | "unknown" {
  const printed = printedHours(hours, now);
  if (printed === null) return "unknown";
  const text = printed.normalize("NFKC");
  // A footnote may carry an exception to the schedule (closed days, special hours): then the schedule is not complete.
  if ((text.match(/※[^\r\n]*/g) ?? []).some((note) => EXCEPTION_NOTE.test(note))) return "unknown";
  let rest = text.replace(/※[^\r\n]*/g, "").trim();
  const schedule = new Map<number, [number, number]>();
  while (rest) {
    const match = block.exec(rest);
    if (!match) return "unknown";
    const open = minutes(match[2]!);
    const close = minutes(match[3]!);
    if (open === null || close === null || close < open) return "unknown";
    const group = (match[1] ?? "").replace("〜", "~");
    for (const day of days[group]!) {
      if (schedule.has(day)) return "unknown";
      schedule.set(day, [open, close]);
    }
    rest = rest.slice(match[0].length).trim();
  }
  if (schedule.size !== 8) return "unknown";
  const parts = Object.fromEntries(tokyo.formatToParts(now).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const day = holidayJp.isHoliday(date) ? 7 : new Date(`${date}T00:00:00Z`).getUTCDay();
  const [open, close] = schedule.get(day)!;
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  return open <= current && current < close ? "open" : "closed";
}
