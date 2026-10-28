import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const targetSources = new Set([
  "tokyometro-ikebukuro-accessibility-2026-10",
  "tokyometro-ikebukuro-shops-2026-10",
  "seibu-ikebukuro-station-2026-10",
  "tobudept-ikebukuro-facilities-2026-10",
  "tobudept-ikebukuro-facilities-access-2026-10",
  "tobudept-ikebukuro-facilities-kids-2026-10",
]);

describe("Ikebukuro official English names", () => {
  it("cites a declared English source for targeted POIs", () => {
    const station = read("../gteki/station.json");
    const sources = new Set<string>(station.sources.map((s: { id: string }) => s.id));
    const pois = read("../gteki/pois.json").pois as { id: string; names: { lang: string }[]; evidence: { sourceIds: string[] } }[];
    for (const poi of pois) {
      if (poi.evidence.sourceIds.some((id) => targetSources.has(id)) && poi.names.some((n) => n.lang === "en")) {
        expect(poi.evidence.sourceIds.some((id) => id.includes("-en-") && sources.has(id)), poi.id).toBe(true);
      }
    }
  });
});
