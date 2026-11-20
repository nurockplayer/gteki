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
import { ColdOpenDiscovery, coldOpenPair, demoPair, FIRST_RUN_KEY, markFirstRunDone, shouldShowFirstRun } from "./firstRun.ts";

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

it("selects the routable Shinjuku cold-open pair and rejects a missing endpoint", () => {
  const parsed = parseStationFiles(shinjukuManifest, shinjukuGraph, shinjukuPois);
  if (!parsed.ok) throw new Error("station files failed validation");
  const pair = coldOpenPair("shinjuku", parsed.bundle.pois);
  expect([pair?.from.id, pair?.to.id]).toEqual(["poi:exit:1", "poi:platform:oedo"]);
  expect(routeBetween(createRouter(parsed.bundle), { kind: "poi", poi: pair!.from }, pair!.to, appDefaultProfile)).toMatchObject({ ok: true });
  expect(coldOpenPair("shinjuku", parsed.bundle.pois.filter((p) => p.id !== "poi:exit:1"))).toBeNull();
});

describe("cold-open discovery", () => {
  it("shows floor marks at 2 s, fades for 3 s, and shows the hint from 4 to 9 s", () => {
    const cue = new ColdOpenDiscovery();
    expect(cue.frame(100)).toMatchObject({ opacity: 0, hint: false });
    cue.start(100);
    expect(cue.frame(2099)).toMatchObject({ opacity: 0, hint: false });
    expect(cue.frame(2100)).toMatchObject({ opacity: .28, hint: false });
    expect(cue.frame(4099).hint).toBe(false);
    expect(cue.frame(4100).hint).toBe(true);
    expect(cue.frame(4100).opacity).toBeCloseTo(.28 / 3);
    expect(cue.frame(5100)).toMatchObject({ opacity: 0, hint: true });
    expect(cue.frame(9099).hint).toBe(true);
    expect(cue.frame(9100)).toEqual({ opacity: 0, hint: false, done: true });
    cue.start(10000);
    expect(cue.frame(14000).hint).toBe(false);
  });

  it.each([1000, 4500])("dismisses both cues permanently on input or guide start at %i ms", (at) => {
    const cue = new ColdOpenDiscovery();
    cue.start(0);
    cue.frame(at);
    cue.dismiss();
    expect(cue.frame(at)).toEqual({ opacity: 0, hint: false, done: true });
    cue.start(at);
    expect(cue.frame(at + 4000)).toEqual({ opacity: 0, hint: false, done: true });
  });
});
