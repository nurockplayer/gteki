import { describe, expect, it } from "vitest";
import { coverageText, strings } from "./i18n.ts";

/** Dotted paths of every key under an object (functions and strings are leaves). */
function paths(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("has the same keys in ja and en", () => {
    expect(paths(strings("en")).sort()).toEqual(paths(strings("ja")).sort());
  });

  it("has the guide step and arrival follow-up strings in both languages", () => {
    const en = strings("en");
    const ja = strings("ja");
    expect([en.guidePrev, en.guideNext, en.reverseRoute, en.searchAgain]).toEqual(["Previous instruction", "Next instruction", "Reverse route", "Search again"]);
    expect([ja.guidePrev, ja.guideNext, ja.reverseRoute, ja.searchAgain]).toEqual(["前の案内", "次の案内", "逆向きのルート", "もう一度検索"]);
    for (const t of [en, ja]) {
      // The tooltips name both shortcuts.
      expect(t.guidePrevTitle).toContain("[");
      expect(t.guidePrevTitle).toContain("PageUp");
      expect(t.guideNextTitle).toContain("]");
      expect(t.guideNextTitle).toContain("PageDown");
    }
  });

  it("shows coverage gap text in the requested language, falling back to ja then any, or the plain string (#259)", () => {
    const both = [{ lang: "ja" as const, text: "全フロア" }, { lang: "en" as const, text: "All levels" }];
    expect(coverageText(both, "ja")).toBe("全フロア");
    expect(coverageText(both, "en")).toBe("All levels");
    // A station that only supplied ja still shows ja to an en reader rather than an empty cell.
    expect(coverageText([{ lang: "ja", text: "営業時間" }], "en")).toBe("営業時間");
    // Any other language is preferred over nothing.
    expect(coverageText([{ lang: "zh-Hant", text: "車站" }], "en")).toBe("車站");
    // A legacy plain string is shown exactly as written, never translated.
    expect(coverageText("TP-only passages", "ja")).toBe("TP-only passages");
    expect(coverageText(undefined, "ja")).toBe("");
  });

  it("labels every rights value in plain language (#130)", () => {
    for (const lang of ["ja", "en"] as const) {
      const t = strings(lang);
      for (const v of [t.rightsReusable, t.rightsOwnerOverride, t.rightsReference, t.rightsRestricted, t.rightsUnverified]) {
        expect(v.length).toBeGreaterThan(0);
        expect(v).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
      }
    }
  });
});
