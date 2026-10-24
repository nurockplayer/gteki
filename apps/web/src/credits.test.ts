import { describe, expect, it } from "vitest";
import type { Source } from "@gteki/schema";
import { factsOnlyCredit, overrideCredits, rightsLabel, safeHref, sourceCredit } from "./credits.ts";
import { strings } from "./i18n.ts";

const glbSource: Source = {
  id: "plateau-lod2", title: "PLATEAU LOD2 buildings", publisher: "MLIT", url: "https://www.mlit.go.jp/plateau/",
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  rights: "REUSABLE_WITH_CONDITIONS", attribution: "© MLIT PLATEAU", modified: true, retrievedAt: null, datasetDate: "2024",
} as Source;

describe("source credits", () => {
  it("credits a source cited only by an asset with its link, licence and licence link", () => {
    expect(sourceCredit(glbSource)).toEqual({
      title: "PLATEAU LOD2 buildings",
      href: "https://www.mlit.go.jp/plateau/",
      license: { name: "CC BY 4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
      attribution: "© MLIT PLATEAU",
      modified: true,
    });
  });

  it("never turns station data into a non-http link", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
    expect(sourceCredit({ ...glbSource, license: { name: "PDL 1.0", url: "" } }).license).toEqual({ name: "PDL 1.0", href: null });
  });
});

describe("facts-only credit line (#26)", () => {
  const facts: Source = {
    ...glbSource, id: "guide-2022", license: null, rights: "REFERENCE_ONLY", usage: "facts-only",
    decision: { url: "https://github.com/nurockplayer/gteki/issues/26#issuecomment-1", date: "2026-10-01" },
  } as Source;

  it("shows the #26 wording and the decision link, in both languages", () => {
    expect(factsOnlyCredit(facts, strings("ja"))).toEqual({
      text: "ライセンスなし・事実のみ参照（複製なし）",
      decision: { label: "権利判断 2026-10-01", href: "https://github.com/nurockplayer/gteki/issues/26#issuecomment-1" },
    });
    expect(factsOnlyCredit(facts, strings("en"))?.text).toBe("No licence; cited for facts only (not reproduced)");
  });

  it("omits the decision link unless decision.url is an http(s) URL", () => {
    expect(factsOnlyCredit({ ...facts, decision: { url: "javascript:alert(1)", date: "2026-10-01" } } as Source, strings("en"))?.decision).toBeNull();
    expect(factsOnlyCredit({ ...facts, decision: undefined } as Source, strings("en"))?.decision).toBeNull();
  });

  it("shows nothing for a data source, with or without a decision", () => {
    expect(factsOnlyCredit(glbSource, strings("en"))).toBeNull();
    expect(factsOnlyCredit({ ...glbSource, usage: "data" } as Source, strings("en"))).toBeNull();
    expect(factsOnlyCredit({ ...glbSource, decision: facts.decision } as Source, strings("en"))).toBeNull();
  });
});

describe("rights label (#130)", () => {
  it("words every rights value in plain language, in both languages", () => {
    const t = strings("en");
    expect(rightsLabel("REUSABLE_WITH_CONDITIONS", t)).toBe(t.rightsReusable);
    expect(rightsLabel("PUBLISHED_UNDER_OWNER_OVERRIDE", t)).toBe(t.rightsOwnerOverride);
    expect(rightsLabel("REFERENCE_ONLY", t)).toBe(t.rightsReference);
    expect(rightsLabel("RESTRICTED", t)).toBe(t.rightsRestricted);
    expect(rightsLabel("UNVERIFIED", t)).toBe(t.rightsUnverified);
    expect(rightsLabel("PUBLISHED_UNDER_OWNER_OVERRIDE", strings("ja"))).toBe("ライセンス未確認・オーナー判断により公開");
  });

  it("reads an unknown or empty rights value as unverified and never prints the enum", () => {
    for (const lang of ["ja", "en"] as const) {
      const t = strings(lang);
      for (const bad of ["", "SOMETHING_NEW", undefined]) {
        const label = rightsLabel(bad as unknown as Source["rights"], t);
        expect(label).toBe(t.rightsUnverified);
        expect(label).not.toContain("SOMETHING_NEW");
      }
    }
  });
});

describe("owner override credit (#249)", () => {
  const ownerOverride: Source = {
    ...glbSource,
    rights: "PUBLISHED_UNDER_OWNER_OVERRIDE",
    override: { decision: "https://github.com/nurockplayer/gteki/issues/249", date: "2026-10-24" },
  } as Source;

  it("uses the rights label wording in both languages", () => {
    for (const lang of ["ja", "en"] as const) {
      const t = strings(lang);
      expect(overrideCredits([ownerOverride], t)?.text).toBe(rightsLabel(ownerOverride.rights, t));
    }
  });

  it("links an http(s) decision and keeps a safe #reference visible as plain text", () => {
    const t = strings("en");
    expect(overrideCredits([ownerOverride], t)?.decisions).toEqual([{
      label: `${t.rightsDecision} 2026-10-24`,
      href: "https://github.com/nurockplayer/gteki/issues/249",
    }]);
    expect(overrideCredits([{ ...ownerOverride, override: { decision: "#16", date: "2026-10-24" } } as Source], t)?.decisions).toEqual([
      { label: `${t.rightsDecision} #16 2026-10-24`, href: null },
    ]);
  });

  it("does not expose URL schemes that are not safe to link", () => {
    const t = strings("en");
    const result = overrideCredits([{ ...ownerOverride, override: { decision: "javascript:alert(1)", date: "2026-10-24" } } as Source], t);
    expect(result?.decisions).toEqual([{ label: `${t.rightsDecision} 2026-10-24`, href: null }]);
    expect(result?.decisions[0]?.label).not.toContain("javascript:alert(1)");
  });

  it("deduplicates identical decision and date pairs and keeps distinct decisions in source order", () => {
    const t = strings("en");
    const duplicate = { ...ownerOverride };
    const second = { ...ownerOverride, override: { decision: "#17", date: "2026-10-25" } } as Source;
    expect(overrideCredits([ownerOverride, duplicate], t)?.decisions).toHaveLength(1);
    expect(overrideCredits([ownerOverride, second], t)?.decisions).toEqual([
      { label: `${t.rightsDecision} 2026-10-24`, href: "https://github.com/nurockplayer/gteki/issues/249" },
      { label: `${t.rightsDecision} #17 2026-10-25`, href: null },
    ]);
  });

  it("emits one rights wording for a mixed override and non-override group", () => {
    const t = strings("en");
    const result = overrideCredits([ownerOverride, glbSource], t);
    expect(result?.text).toBe(rightsLabel(ownerOverride.rights, t));
    expect(result?.decisions).toHaveLength(1);
  });

  it("omits the decision when absent and returns null for other rights", () => {
    expect(overrideCredits([{ ...ownerOverride, override: undefined } as Source], strings("en"))?.decisions).toEqual([]);
    expect(overrideCredits([glbSource], strings("en"))).toBeNull();
  });
});
