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
    expect(railDemoLink("ikebukuro")!.platformJa).toContain("1 番線");
    expect(railDemoLink("shinjuku")!.platformJa).toContain("JR 新宿駅");
    expect(railDemoLink("shinjuku")!.platformJa).not.toContain("大江戸線");
  });
  it("renders destination names in either language", () => {
    expect(railStationName("shinjuku", "ja")).toBe("新宿");
    expect(railStationName("ikebukuro", "en")).toBe("Ikebukuro");
  });
});
