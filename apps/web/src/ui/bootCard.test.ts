import { describe, expect, it } from "vitest";
import { bootProgress, FrameReadiness, type BootStage } from "./bootCard.ts";

describe("boot card", () => {
  it("progresses strictly from above zero to one", () => {
    const stages: BootStage[] = ["start", "stations", "data", "graph", "scene", "composer", "ready", "settled"];
    const values = stages.map(bootProgress);
    expect(values[0]).toBeGreaterThan(0);
    expect(values.at(-1)).toBe(1);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]!);
  });
  it("lifts after six consecutive fast frames, resetting on a slow frame, or after three seconds", () => {
    const frames = new FrameReadiness();
    for (let i = 0; i < 5; i++) expect(frames.push(16, i * 16)).toBe(false);
    expect(frames.push(300, 400)).toBe(false);
    for (let i = 0; i < 5; i++) expect(frames.push(16, 416 + i * 16)).toBe(false);
    expect(frames.push(16, 500)).toBe(true);
    expect(new FrameReadiness().push(300, 3000)).toBe(true);
  });
});
