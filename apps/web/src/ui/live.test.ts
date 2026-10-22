import type { RouteFailure, RouteResult } from "@gteki/navigation";
import { describe, expect, it } from "vitest";
import { strings } from "../i18n.ts";
import { joinLive, routeLiveMessage, searchLiveMessage } from "./live.ts";

const found = { ok: true, totalLengthM: 203.4, estimatedSeconds: 170 } as unknown as RouteResult;
const failed = { ok: false, reason: "no_path", message: "m" } as unknown as RouteFailure;

describe("live messages", () => {
  it("route found: one short sentence with metres and minutes (en)", () => {
    expect(routeLiveMessage(strings("en"), found)).toBe("Route found: 203 m, about 3 minutes");
  });

  it("route found (ja)", () => {
    expect(routeLiveMessage(strings("ja"), found)).toBe("ルートが見つかりました：203m、約3分");
  });

  it("a route under half a minute is announced as 1 minute, singular in English", () => {
    const quick = { ok: true, totalLengthM: 20, estimatedSeconds: 10 } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), quick)).toBe("Route found: 20 m, about 1 minute");
  });

  it("no route: the no-route heading", () => {
    expect(routeLiveMessage(strings("en"), failed)).toBe("No verified route to show");
    expect(routeLiveMessage(strings("ja"), failed)).toBe("表示できる確認済みルートがありません");
  });

  it("search count and the empty-results message", () => {
    expect(searchLiveMessage(strings("en"), 5)).toBe("5 results");
    expect(searchLiveMessage(strings("en"), 1)).toBe("1 result");
    expect(searchLiveMessage(strings("en"), 0)).toBe("No matches");
    expect(searchLiveMessage(strings("ja"), 5)).toBe("5件の候補");
    expect(searchLiveMessage(strings("ja"), 0)).toBe("該当なし");
  });

  it("joinLive dedupes a burst and drops empties", () => {
    expect(joinLive(["Turn left", "Turn left", "", "You have arrived"], strings("en"))).toBe("Turn left. You have arrived");
    expect(joinLive(["左折", "到着"], strings("ja"))).toBe("左折。到着");
    expect(joinLive([], strings("en"))).toBe("");
  });
});
