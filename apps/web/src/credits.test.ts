import { describe, expect, it } from "vitest";
import type { Source } from "@gteki/schema";
import { factsOnlyCredit, safeHref, sourceCredit } from "./credits.ts";
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
