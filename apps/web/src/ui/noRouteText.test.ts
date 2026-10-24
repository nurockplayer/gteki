import { describe, expect, it } from "vitest";
import type { Poi } from "@gteki/schema";
import type { RouteFailure } from "@gteki/navigation";
import { strings } from "../i18n.ts";
import { noRouteText } from "./noRouteText.ts";

const poi = (category: Poi["category"]): Poi => ({
  id: "shop-test",
  category,
  names: [],
  aliases: [],
  floorId: null,
  displayPosition: null,
  connectorNodeIds: [],
  paid: null,
  evidence: { sourceIds: [], method: "test", checkedDate: "2026-10-24" },
  notes: [],
});

const failure = (reason: RouteFailure["reason"]): RouteFailure => ({ ok: false, reason, message: "fallback" });

describe("noRouteText", () => {
  it("uses the shop wording for unknown_goal in both languages", () => {
    expect(noRouteText(strings("ja"), failure("unknown_goal"), poi("shop"))).toBe("この店舗への道案内はまだありません（位置未確認）");
    expect(noRouteText(strings("en"), failure("unknown_goal"), poi("shop"))).toBe("No directions to this shop yet (location not verified).");
  });

  it("keeps the existing unknown_goal wording for non-shop POIs", () => {
    expect(noRouteText(strings("en"), failure("unknown_goal"), poi("exit"))).toBe(strings("en").noRouteWhy.unknown_goal);
  });

  it("does not use shop wording for another failure reason", () => {
    expect(noRouteText(strings("en"), failure("unknown_start"), poi("shop"))).toBe(strings("en").noRouteWhy.unknown_start);
  });
});
