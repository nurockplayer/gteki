import { describe, expect, it } from "vitest";
import { shortStationLabel } from "./shortStationLabel.ts";

describe("shortStationLabel", () => {
  it("keeps the station name and drops the trailing qualifier", () => {
    const labels: [string, "ja" | "en", string][] = [
      ["池袋駅 · Ikebukuro Station", "ja", "池袋駅"],
      ["池袋駅 · Ikebukuro Station", "en", "Ikebukuro Station"],
      ["新宿駅（都営大江戸線） · Shinjuku Station (Toei Oedo Line)", "ja", "新宿駅"],
      ["新宿駅（都営大江戸線） · Shinjuku Station (Toei Oedo Line)", "en", "Shinjuku Station"],
      ["Synthetic demo (not a real station)", "en", "Synthetic demo"],
      ["Station — Extra detail", "en", "Station"],
    ];
    for (const [label, lang, expected] of labels) expect(shortStationLabel(label, lang)).toBe(expected);
  });

  it("leaves a label without a qualifier unchanged", () => {
    expect(shortStationLabel("Ikebukuro", "en")).toBe("Ikebukuro");
  });
});
