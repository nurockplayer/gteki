import { describe, expect, it } from "vitest";
import { escalatorArrow, guideCardText } from "./guideCard.ts";

const opts = { arrived: false, connector: false, name: "Platform", lang: "en" as const, t: { arrived: "You have arrived", arrivedAt: (name: string) => `Arrived · ${name}` } };
describe("guideCardText", () => {
  it("shortens next instructions without ellipses", () => {
    const next = { ...opts, next: true };
    expect(guideCardText({ text: "Turn left, ~26 m. After ~16 m, continue…" }, next).line).toBe("Turn left");
    expect(guideCardText({ text: "Turn left" }, next).line).toBe("Turn left");
    expect(guideCardText({ text: "約26m進み、左に曲がる。" }, { ...next, lang: "ja" }).line).toBe("左に曲がる");
    expect(guideCardText({ text: "Walk about 26 m, then turn left." }, next).line).toBe("Turn left");
    expect(guideCardText({ text: "Walk about 1.5 m, then take the escalator down to B1." }, next).line).toBe("Take the escalator down to B1");
    expect(guideCardText({ text: "GL–B1 landing" }, next).line).toBe("B1");
  });
  it("shows the arrival name and notes in both languages", () => {
    expect(guideCardText({ text: "Platform data" }, { ...opts, next: true, arrived: true })).toEqual({ line: "Arrived · Platform", detail: "Platform data" });
    expect(guideCardText({ text: "ホームのデータ" }, { ...opts, next: true, arrived: true, lang: "ja", t: { arrived: "到着", arrivedAt: (name) => `到着 · ${name}` } })).toEqual({ line: "到着 · Platform", detail: "ホームのデータ" });
  });
  it("shows the up arrow for an upward escalator", () => expect(escalatorArrow(1, 2)).toBe("↑"));
  it("keeps walk instructions", () => expect(guideCardText({ text: "Walk ahead" }, opts)).toEqual({ line: "Walk ahead", detail: null }));
  it("puts an arrival note behind the line", () => expect(guideCardText({ text: "Arrive at destination. Data for the platform." }, { ...opts, arrived: true })).toEqual({ line: "Arrived · Platform", detail: "Arrive at destination. Data for the platform." }));
  it("keeps connector arrival instructions in both modes", () => {
    for (const next of [false, true]) expect(guideCardText({ text: "Stairs start here, destination not reached." }, { ...opts, arrived: true, connector: true, next })).toEqual({ line: "Stairs start here, destination not reached.", detail: null });
  });
});
