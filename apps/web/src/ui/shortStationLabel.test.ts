import { describe, expect, it } from "vitest";
import { shortStationLabel } from "./shortStationLabel.ts";

describe("shortStationLabel", () => {
  it("keeps the station name and drops the trailing qualifier", () => {
    const labels = [
      ["池袋駅 · Ikebukuro Station", "池袋駅"],
      ["新宿駅（都営大江戸線） · Shinjuku Station (Toei Oedo Line)", "新宿駅"],
      ["Synthetic demo (not a real station)", "Synthetic demo"],
      ["Station — Extra detail", "Station"],
    ];
    for (const [label, expected] of labels) expect(shortStationLabel(label)).toBe(expected);
  });

  it("leaves a label without a qualifier unchanged", () => {
    expect(shortStationLabel("Ikebukuro")).toBe("Ikebukuro");
  });
});
