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
    expect(routeLiveMessage(strings("en"), failed)).toBe("No route confirmed in the surveyed data");
    expect(routeLiveMessage(strings("ja"), failed)).toBe("データ上で確認できたルートがありません");
    // The card's shop explanation is announced too (#212), so sight and sound agree.
    expect(routeLiveMessage(strings("ja"), failed, strings("ja").shopNoRoute)).toBe(`データ上で確認できたルートがありません${strings("ja").liveSeparator}この店舗への道案内はまだありません（位置未確認）`);
  });

  it("announces stale freshness with its reason, and unknown facts by kind (#203 B5)", () => {
    const stale = {
      ok: true, totalLengthM: 203.4, estimatedSeconds: 170,
      stale: true, expiredSourceIds: ["mlit-b1"], undatedSourceIds: [], oldestSourceDate: "2024-05-01",
      unknowns: [{ kind: "hours", edgeIds: ["e1", "e2"] }, { kind: "hours", edgeIds: ["e3"] }, { kind: "wheelchair", edgeIds: ["e4"] }],
    } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), stale)).toBe(
      "Route found: 203 m, about 3 minutes. Possibly outdated. Source validity ended: mlit-b1. Hours unverified. Wheelchair access unknown",
    );
    expect(routeLiveMessage(strings("ja"), stale)).toBe("ルートが見つかりました：203m、約3分。情報が古い可能性。有効期限切れの出典: mlit-b1。営業時間未確認。車いす可否未確認");
  });

  it("says why the freshness is unknown, with the oldest date when no source is expired or undated", () => {
    const unknownDate = { ok: true, totalLengthM: 100, estimatedSeconds: 100, stale: null, expiredSourceIds: [], undatedSourceIds: ["src-a"], oldestSourceDate: null, unknowns: [] } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), unknownDate)).toBe("Route found: 100 m, about 2 minutes. Data date unknown. Undated sources: src-a");
    const noUndated = { ...unknownDate, undatedSourceIds: [], oldestSourceDate: "2024-01-02" } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), noUndated)).toBe("Route found: 100 m, about 2 minutes. Data date unknown. Oldest source 2024-01-02");
    const staleNoExpired = { ...unknownDate, stale: true, undatedSourceIds: [], oldestSourceDate: null } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), staleNoExpired)).toBe("Route found: 100 m, about 2 minutes. Possibly outdated. Oldest source ?");
  });

  it("a fresh route with no unknown facts stays one sentence", () => {
    const fresh = { ...found, stale: false, unknowns: [], expiredSourceIds: [], undatedSourceIds: [] } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), fresh)).toBe("Route found: 203 m, about 3 minutes");
  });

  it("names an unknown kind it has no label for by its own key, once", () => {
    const odd = { ...found, stale: false, unknowns: [{ kind: "mystery", edgeIds: ["e"] }, { kind: "mystery", edgeIds: ["f"] }] } as unknown as RouteResult;
    expect(routeLiveMessage(strings("en"), odd)).toBe("Route found: 203 m, about 3 minutes. mystery");
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
