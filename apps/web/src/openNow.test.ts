import { describe, expect, it, vi } from "vitest";
import type { HoursText } from "@gteki/schema";
import { openNow } from "./openNow.ts";

const hours = (text: string, over: Partial<HoursText> = {}): HoursText => ({
  text, sourceUrl: "https://example.org/hours", retrievedAt: "2026-10-24",
  basis: "undated-official", status: "OK", ...over,
});
const at = (time: string, date = "2026-11-04") => new Date(`${date}T${time}:00+09:00`);

// Every printed pattern named in the brief, including literal line breaks and full-width punctuation.
const patterns = [
  ["平日 11:00 ~ 21:00 土日祝 10:30 ~ 21:00", "11:00", "21:00"],
  ["平日 11:00 ~ 21:00\n土日祝 10:30 ~ 21:00", "11:00", "21:00"],
  ["月～土 11:00～20:30 日祝 11:00～20:00", "11:00", "20:30"],
  ["月～土 10：00～21：00\n日・祝 10：00～19：30\n※館営業時間に準ずる", "10:00", "21:00"],
  ["10:00～21:00", "10:00", "21:00"],
  ["11:00 ～ 22:00", "11:00", "22:00"],
  ["10:00-21:00", "10:00", "21:00"],
  ["月～土 8:00～21:00 日・祝日 8:00～20:30 ※ご利用にはJRの入場券が必要です。", "08:00", "21:00"],
  ["6:30A.M.～11:00P.M.", "06:30", "23:00"],
  ["午前10時～午後8時", "10:00", "20:00"],
  ["午前10時30分～午後7時30分", "10:30", "19:30"],
];

describe("openNow from printed OD-32 hours", () => {
  it.each(patterns)("%s: opening inclusive, closing exclusive", (text, open, close) => {
    expect(openNow(hours(text!), at(open!))).toBe("open");
    expect(openNow(hours(text!), at("05:00"))).toBe("closed");
    expect(openNow(hours(text!), at(close!))).toBe("closed");
  });

  it.each(["土日祝", "土・日・祝", "土日祝日"])("selects %s on Culture Day and weekends", (group) => {
    const h = hours(`平日 11:00~21:00 ${group} 10:30〜20:00`);
    expect(openNow(h, at("10:30", "2026-11-03"))).toBe("open");
    expect(openNow(h, at("20:00", "2026-11-03"))).toBe("closed");
    expect(openNow(h, at("10:30"))).toBe("closed");
    expect(openNow(h, at("10:30", "2026-11-07"))).toBe("open");
  });
  it.each(["日祝", "日・祝", "日・祝日"])("excludes holidays from 月~土 and selects %s", (group) => {
    const h = hours(`月~土 10:00~21:00 ${group} 11:00~19:30`);
    expect(openNow(h, at("10:30", "2026-11-03"))).toBe("closed");
    expect(openNow(h, at("19:30", "2026-11-03"))).toBe("closed");
    expect(openNow(h, at("10:30", "2026-11-07"))).toBe("open");
    expect(openNow(h, at("10:30", "2026-11-08"))).toBe("closed");
  });

  it.each([
    "不定休", "10:00~21:00 (LO 20:30)", "平日 11:00~21:00", "日祝 10:00~20:00",
    "平日 10:00~21:00 日祝 10:00~20:00", // Saturday missing
    "10:00~21:00 平日 10:00~20:00", "月~土 10:00~21:00 土日祝 10:00~20:00", // overlaps
    "10:00~24:00", "10:00~25:00", "21:00~08:00", "10:60~21:00", "0:30A.M.~11:00P.M.",
    "午前13時~午後8時", "※館営業時間に準ずる",
  ])("keeps unsupported/incomplete/overlapping text unknown: %s", (text) => {
    expect(openNow(hours(text), at("12:00"))).toBe("unknown");
  });

  it("strips each footnote only through its own line and handles 12 AM/PM", () => {
    expect(openNow(hours("平日 11:00~21:00 ※注記\n土日祝 10:30~21:00 ※注記"), at("12:00"))).toBe("open");
    expect(openNow(hours("12:00A.M.~12:00P.M."), at("00:00"))).toBe("open");
    expect(openNow(hours("午前12時~午後12時"), at("12:00"))).toBe("closed");
  });
  it("honours the exact 180-day cutoff, unknown status, and missing readings", () => {
    const h = hours("10:00~21:00");
    const cutoff = new Date(Date.parse("2026-10-24T00:00:00Z") + 180 * 86400000);
    expect(openNow(h, cutoff)).toBe("closed"); // 09:00 JST
    expect(openNow(h, new Date(+cutoff + 1))).toBe("unknown");
    expect(openNow(hours(h.text!, { status: "UNKNOWN" }), at("12:00"))).toBe("unknown");
    expect(openNow(hours(h.text!, { retrievedAt: "2026-11-05" }), at("12:00"))).toBe("unknown");
    expect(openNow(null, at("12:00"))).toBe("unknown");
    expect(openNow(undefined, at("12:00"))).toBe("unknown");
  });
  it("uses the same Tokyo date, holiday and time under a non-JST TZ", () => {
    const h = hours("平日 11:00~21:00 土日祝 10:30~21:00");
    try {
      for (const tz of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
        vi.stubEnv("TZ", tz);
        expect(openNow(h, new Date("2026-11-03T01:30:00Z"))).toBe("open");
        expect(openNow(h, new Date("2026-11-02T15:30:00Z"))).toBe("closed");
      }
    } finally { vi.unstubAllEnvs(); }
  });
});
