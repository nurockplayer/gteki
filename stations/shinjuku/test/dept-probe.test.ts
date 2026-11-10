import { it } from "vitest";
import { createSearchIndex } from "@gteki/search";
import { parseStationFiles } from "@gteki/schema";
import { readFileSync } from "node:fs";
import { loadShinjukuBundle } from "../data/bundle.ts";

it("prints department-store query ranks", () => {
  const results: string[] = [];
  const read = (f: string) => JSON.parse(readFileSync(`stations/ikebukuro/gteki/${f}.json`, "utf8"));
  const ikb = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
  if (!ikb.bundle) throw new Error("Ikebukuro bundle failed");
  for (const [bundle, rows] of [
    [loadShinjukuBundle().bundle, [["shop-sjk-isetan-honkan", "伊勢丹", "Isetan"], ["shop-sjk-isetan-mens", "伊勢丹", "Isetan"], ["shop-sjk-marui-honkan", "マルイ", "Marui", "OIOI"], ["shop-sjk-marui-annex", "マルイ", "Marui", "OIOI"], ["shop-sjk-marui-men", "マルイ", "Marui", "OIOI"], ["shop-sjk-takashimaya", "高島屋", "Takashimaya"], ["shop-sjk-keio", "京王", "Keio"], ["shop-sjk-odakyudept", "小田急", "Odakyu"], ["shop-sjk-lumine1", "ルミネ", "Lumine", "ルミネ1"], ["shop-sjk-lumine2", "ルミネ", "Lumine", "ルミネ2"], ["shop-sjk-lumineest", "ルミネ", "Lumine", "ルミネエスト"]]],
    [ikb.bundle, [["shop-ikb-tobudept", "東武", "Tobu", "東武百貨店"], ["shop-ikb-seibu-honten", "西武", "Seibu", "西武池袋本店"], ["shop-ikb-lumine", "ルミネ", "Lumine", "ルミネ池袋"], ["shop-ikb-parco", "パルコ", "Parco", "池袋PARCO"], ["shop-ikb-esola", "エソラ", "Esola", "エソラ池袋"]]],
  ] as const) {
    const index = createSearchIndex(bundle);
    for (const [id, ...queries] of rows) {
      const poi = bundle.pois.find(p => p.id === id);
      results.push(JSON.stringify({id, names: poi?.names, ranks: Object.fromEntries(queries.map(q => [q, index.search(q, {limit: 1000}).findIndex(h => h.poi.id === id) + 1]))}));
    }
  }
  throw new Error(`Probe output:\n${results.join("\n")}`);
});
