import { describe, expect, it } from "vitest";
import { parseStationFiles } from "@gteki/schema";
import { createRouter, DEFAULT_PROFILE, routeBetween } from "@gteki/navigation";
import ikebukuroManifest from "../../../../stations/ikebukuro/gteki/station.json" with { type: "json" };
import ikebukuroGraph from "../../../../stations/ikebukuro/gteki/graph.json" with { type: "json" };
import ikebukuroPois from "../../../../stations/ikebukuro/gteki/pois.json" with { type: "json" };
import shinjukuManifest from "../../../../stations/shinjuku/gteki/station.json" with { type: "json" };
import shinjukuGraph from "../../../../stations/shinjuku/gteki/graph.json" with { type: "json" };
import shinjukuPois from "../../../../stations/shinjuku/gteki/pois.json" with { type: "json" };
import { stationClock } from "../stationClock.ts";
import { demoPair, FIRST_RUN_KEY, markFirstRunDone, shouldShowFirstRun } from "./firstRun.ts";

const tokyo = stationClock(new Date(), "Asia/Tokyo");
const appDefaultProfile = {
  ...DEFAULT_PROFILE,
  hours: "warn_unknown" as const,
  at: { weekday: tokyo.weekday, minutes: tokyo.minutes },
  today: tokyo.date,
  timeZone: "Asia/Tokyo",
};

describe("first visit guide card state", () => {
  it("shows without storage, when storage throws, or until storage says 1", () => {
    expect(shouldShowFirstRun(null)).toBe(true);
    expect(shouldShowFirstRun({ getItem: () => { throw new Error("unavailable"); } })).toBe(true);
    expect(shouldShowFirstRun({ getItem: () => null })).toBe(true);
    expect(shouldShowFirstRun({ getItem: () => "0" })).toBe(true);
    expect(shouldShowFirstRun({ getItem: () => "1" })).toBe(false);
  });

  it("marks done and tolerates unavailable storage", () => {
    const values = new Map<string, string>();
    markFirstRunDone({ setItem: (key, value) => { values.set(key, value); } });
    expect(values.get(FIRST_RUN_KEY)).toBe("1");
    expect(() => markFirstRunDone(null)).not.toThrow();
    expect(() => markFirstRunDone({ setItem: () => { throw new Error("unavailable"); } })).not.toThrow();
  });

  it("has no pair for an unknown station", () => {
    expect(demoPair("unknown", [])).toBeNull();
  });

  it.each([
    ["ikebukuro", parseStationFiles(ikebukuroManifest, ikebukuroGraph, ikebukuroPois)],
    ["shinjuku", parseStationFiles(shinjukuManifest, shinjukuGraph, shinjukuPois)],
  ] as const)("provides a routable demo pair for %s", (key, parsed) => {
    if (!parsed.ok) throw new Error(`${key} station files failed validation`);
    const pair = demoPair(key, parsed.bundle.pois);
    expect(pair).not.toBeNull();
    if (!pair) throw new Error(`${key} has no routable demo pair`);
    const route = routeBetween(createRouter(parsed.bundle), { kind: "poi", poi: pair.from }, pair.to, appDefaultProfile);
    expect(route).toMatchObject({ ok: true });
  });
});
