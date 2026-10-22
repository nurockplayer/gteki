import { describe, expect, it } from "vitest";
import { railDemoLink, railStationName } from "./railTravel.ts";

describe("JR Saikyo ride demo", () => {
  it("has explicit two-way direct station edges and no other destinations", () => {
    const fromIkebukuro = railDemoLink("ikebukuro");
    const fromShinjuku = railDemoLink("shinjuku");
    expect(fromIkebukuro).toMatchObject({ from: "ikebukuro", to: "shinjuku", lineId: "jr-saikyo" });
    expect(fromShinjuku).toMatchObject({ from: "shinjuku", to: "ikebukuro", lineId: "jr-saikyo" });
    expect(railDemoLink("_synthetic-demo")).toBeNull();
    expect(railDemoLink("toei-oedo")).toBeNull();
  });
  it("labels the *JR* station, never Oedo platform E27", () => {
    expect(railDemoLink("ikebukuro")!.platformJa).toContain("JR 池袋駅 1 番線");
    expect(railDemoLink("shinjuku")!.platformJa).toContain("JR 新宿駅");
    expect(railDemoLink("shinjuku")!.platformJa).not.toContain("大江戸線");
  });
  it("marks published platform numbers as JR East's, not surveyed, in ja and en alike", () => {
    for (const key of ["ikebukuro", "shinjuku"] as const) {
      const link = railDemoLink(key)!;
      expect(link.platformJa, key).toContain("JR 東日本公表（未調査）");
      expect(link.platformEn, key).toContain("per JR East, not surveyed");
      // Both languages carry the same platform information, so neither reads as a surveyed fact.
      expect(link.platformJa.match(/番線/), key).not.toBeNull();
      expect(link.platformEn, key).toMatch(/platform/i);
      expect(link.platformEn, key).not.toMatch(/大江戸|Oedo/);
    }
  });
  it("renders destination names in either language", () => {
    expect(railStationName("shinjuku", "ja")).toBe("新宿");
    expect(railStationName("ikebukuro", "en")).toBe("Ikebukuro");
  });
});
