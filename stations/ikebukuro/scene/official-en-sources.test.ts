import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
// PR B #595 removes these
const allowed = new Set<string>([
  "exit-22",
  "exit-26",
  "exit-28",
  "exit-32",
  "exit-33",
  "exit-27",
  "exit-34",
  "exit-35",
  "exit-36",
  "exit-37",
  "exit-42",
  "exit-43",
  "exit-41",
  "exit-38",
  "exit-39",
  "exit-40",
  "exit-19",
  "exit-5",
  "exit-6a",
  "exit-6b",
  "exit-7",
  "exit-8",
  "exit-9",
  "exit-14",
  "exit-16",
  "exit-23",
  "exit-24",
  "exit-25",
  "exit-29",
  "exit-30",
  "exit-31",
  "jr-central-gate-2",
  "jr-central-gate-1",
  "tobu-central-gate-1",
  "tobu-central-gate-2",
  "central-passage",
  "exit-10",
  "exit-11",
  "exit-15",
  "exit-17",
  "exit-18",
  "exit-4",
  "exit-13",
  "jr-south-gate",
  "north-passage",
  "south-passage",
  "east-exit-b1",
  "west-exit-b1",
  "west-exit-south-b1",
  "exit-1a",
  "exit-2a",
  "exit-1b",
  "exit-2b",
  "exit-3",
  "exit-c1",
  "exit-c1b",
  "exit-c2",
  "exit-c3",
  "exit-c4",
  "exit-c6",
  "exit-c7",
  "exit-c8",
  "exit-c9",
  "exit-c10",
  "jr-north-gate",
  "tobu-north-gate",
  "seibu-platform-1",
  "seibu-platform-2",
  "seibu-platform-3",
  "seibu-platform-4",
  "seibu-platform-5",
  "seibu-platform-6",
  "seibu-platform-7",
  "tobu-south-gate",
  "tobu-jr-transfer-gate",
  "jr-metropolitan-gate",
  "exit-20a",
  "exit-20b",
  "exit-20c",
  "exit-c1a"
]);

describe("Ikebukuro official English names", () => {
  it("cites a declared English source for every English POI name", () => {
    const station = read("../gteki/station.json");
    const sources = new Set<string>(station.sources.map((s: { id: string }) => s.id));
    const pois = read("../gteki/pois.json").pois as { id: string; names: { lang: string }[]; evidence: { sourceIds: string[] } }[];
    for (const poi of pois) {
      if (poi.names.some((n) => n.lang === "en") && !allowed.has(poi.id)) {
        expect(poi.evidence.sourceIds.some((id) => id.includes("-en-") && sources.has(id)), poi.id).toBe(true);
      }
    }
  });
});
