import { describe, expect, it } from "vitest";
import { guideCardText } from "./guideCard.ts";

const opts = { arrived: false, connector: false, name: "Platform", lang: "en" as const, t: { arrived: "You have arrived", arrivedAt: (name: string) => `Arrived · ${name}` } };
describe("guideCardText", () => {
  it("shortens next instructions without ellipses", () => {
    const next = { ...opts, next: true };
    expect(guideCardText({ text: "Turn left, ~26 m. After ~16 m, continue…" }, next).line).toBe("Turn left");
    expect(guideCardText({ text: "Turn left" }, next).line).toBe("Turn left");
    expect(guideCardText({ text: "約26m進み、左に曲がる。" }, { ...next, lang: "ja" }).line).toBe("進み");
  });
  it("keeps walk instructions", () => expect(guideCardText({ text: "Walk ahead" }, opts)).toEqual({ line: "Walk ahead", detail: null }));
  it("puts an arrival note behind the line", () => expect(guideCardText({ text: "Arrive at destination. Data for the platform." }, { ...opts, arrived: true })).toEqual({ line: "Arrived · Platform", detail: "Arrive at destination. Data for the platform." }));
  it("keeps connector arrival instructions", () => expect(guideCardText({ text: "Stairs start here" }, { ...opts, arrived: true, connector: true })).toEqual({ line: "Stairs start here", detail: null }));
});
