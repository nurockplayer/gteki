import { describe, expect, it } from "vitest";
import type { Source } from "@gteki/schema";
import { safeHref, sourceCredit } from "./credits.ts";

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
