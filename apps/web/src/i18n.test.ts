import { describe, expect, it } from "vitest";
import { strings } from "./i18n.ts";

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
