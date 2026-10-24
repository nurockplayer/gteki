import { describe, expect, it } from "vitest";
import type { Source } from "@gteki/schema";
import { assetDerivationPresentation, factsOnlyCredit, rightsLabel, safeHref, sourceCredit } from "./credits.ts";
import { entryRightsLabels } from "./creditLine.ts";
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

  it("localizes licence names with requested-language and ja/first fallbacks", () => {
    const localized = { ...glbSource, license: { name: [{ lang: "ja", text: "日本語" }, { lang: "en", text: "English" }], url: "https://example.org/licence" } } as Source;
    expect(sourceCredit(localized, "ja").license?.name).toBe("日本語");
    expect(sourceCredit(localized, "en").license?.name).toBe("English");
    expect(sourceCredit({ ...localized, license: { ...localized.license!, name: [{ lang: "ja", text: "日本語" }, { lang: "fr", text: "Français" }] } }, "en").license?.name).toBe("日本語");
    expect(sourceCredit({ ...localized, license: { ...localized.license!, name: [{ lang: "fr", text: "Français" }] } }, "en").license?.name).toBe("Français");
    expect(sourceCredit(glbSource, "en").license?.name).toBe("CC BY 4.0");
  });
});

describe("asset derivation presentation", () => {
  const derivation = "pipeline/build.ts: full provenance and processing record";
  const summary = [{ lang: "ja", text: "通路の形状から案内表示を作成" }, { lang: "en", text: "Wayfinding signs made from passage geometry" }];

  it("shows the localized summary and retains full derivation behind details", () => {
    expect(assetDerivationPresentation(derivation, summary, "ja", strings("ja").derivationDetails)).toEqual({
      text: "通路の形状から案内表示を作成", details: derivation, detailsLabel: "加工の詳細",
    });
    expect(assetDerivationPresentation(derivation, summary, "en", strings("en").derivationDetails)).toEqual({
      text: "Wayfinding signs made from passage geometry", details: derivation, detailsLabel: "Derivation details",
    });
  });

  it("keeps the old full-text output when there is no summary", () => {
    expect(assetDerivationPresentation(derivation, undefined, "en", strings("en").derivationDetails)).toEqual({
      text: derivation, details: null, detailsLabel: null,
    });
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

  it("keeps the controlled override wording when an English licence name says CC BY 4.0", () => {
    const overridden: Source = {
      ...glbSource,
      rights: "PUBLISHED_UNDER_OWNER_OVERRIDE",
      license: {
        name: [{ lang: "ja", text: "ライセンス未確認" }, { lang: "en", text: "CC BY 4.0" }],
        url: "https://example.org/terms",
      },
    };
    expect(sourceCredit(overridden, "en").license?.name).toBe("CC BY 4.0");
    for (const lang of ["ja", "en"] as const) {
      const t = strings(lang);
      expect(entryRightsLabels([overridden], t)).toEqual([t.rightsOwnerOverride]);
    }
  });
});
