import { describe, expect, it } from "vitest";
import { strings } from "./i18n.ts";

describe("i18n", () => {
  it("has the same keys in ja and en", () => {
    expect(Object.keys(strings("en")).sort()).toEqual(Object.keys(strings("ja")).sort());
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
