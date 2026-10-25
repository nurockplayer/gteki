import { describe, expect, it } from "vitest";
import { consentText, merchantLabels, problemText } from "./labels.ts";

describe("merchant form labels (#438)", () => {
  it("words every field and every problem in both languages", () => {
    const ja = merchantLabels("ja");
    const en = merchantLabels("en");
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ja.problem).sort()).toEqual(Object.keys(en.problem).sort());
    expect(Object.keys(ja.gates).sort()).toEqual(Object.keys(en.gates).sort());
    expect(Object.keys(ja.category).sort()).toEqual(Object.keys(en.category).sort());
    expect(Object.keys(ja.contactKinds).sort()).toEqual(Object.keys(en.contactKinds).sort());
  });

  it("fills the consent sentence with the terms version", () => {
    expect(consentText("ja", "2026-10-24")).toContain("2026-10-24");
    expect(consentText("en", "2026-10-24")).toContain("2026-10-24");
    expect(merchantLabels("ja").consentLabel).toContain("{version}");
  });

  it("shows an unknown problem code as itself instead of dropping it", () => {
    expect(problemText("ja", "floor.required")).toBe("階を選んでください。");
    expect(problemText("en", "unheard.of")).toBe("unheard.of");
  });
});
