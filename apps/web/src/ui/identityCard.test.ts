// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSyntheticBundle } from "../../../../packages/navigation/src/fixtures.ts";
import { identityNamesOf, StationIdentityView } from "./identityCard.ts";
import type { StationIdentity } from "@gteki/schema";

const identity: StationIdentity = { names: [
  { lang: "ja", text: "池袋" }, { lang: "ja-Hrkt", text: "いけぶくろ" }, { lang: "en", text: "Ikebukuro" },
] };
function bundle() {
  const b = createSyntheticBundle([]);
  b.station.identity = { ...identity, sides: ["west", "east"].map((side) => ({
    side: side as "west" | "east", exit: [{ lang: "ja", text: side === "west" ? "西口" : "東口" }, { lang: "en", text: side === "west" ? "West Exit" : "East Exit" }],
    landmark: [{ lang: "ja", text: side === "west" ? "東武" : "西武" }, { lang: "en", text: side === "west" ? "Tobu" : "Seibu" }],
    evidence: { sourceIds: [b.sources[0]!.id], method: "facts", checkedDate: "2026-10-24" }, verification: "unverified",
  })) };
  return b;
}

describe("station identity presentation", () => {
  it("renders kanji, kana, English and original decorative SVG without a second live region or focus target", () => {
    const view = new StationIdentityView();
    view.showCard(identity, "fallback", "ja");
    expect(view.info().card).toEqual({ visible: true, ja: "池袋", kana: "いけぶくろ", en: "Ikebukuro" });
    expect(view.card.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(view.card.textContent).toContain("読み込み中…");
    expect(view.card.querySelector('[role="status"], [aria-live], button, input, [tabindex]')).toBeNull();
  });
  it("uses the registry label when identity is absent and sanitizes unvalidated manifests", () => {
    const view = new StationIdentityView();
    view.showCard(undefined, "旧駅 · Legacy Station", "en");
    expect(view.info().card?.ja).toBe("旧駅 · Legacy Station");
    expect(view.card.textContent).toContain("Loading…");
    expect(identityNamesOf({ station: { identity } })).toEqual({ names: identity.names });
    for (const input of [null, {}, { station: { identity: { names: [null] } } }, { station: { identity: { names: [{ lang: "ja", text: "池袋" }] } } }]) expect(identityNamesOf(input)).toBeUndefined();
  });
  it("shows the overview header only in overview, after loading", () => {
    const view = new StationIdentityView(); const b = bundle();
    view.showCard(identity, "fallback", "en");
    view.renderOverview(b, "fallback", "en", "overview");
    expect(view.overview.hidden).toBe(true);
    view.hideCard();
    for (const mode of ["overview", "walk", "guide", "overview"]) {
      view.renderOverview(b, "fallback", "en", mode);
      expect(view.overview.hidden).toBe(mode !== "overview");
    }
    expect(view.overview.textContent).toContain("Ikebukuro");
  });
  it("shows evidenced sides together and marks each unverified fact immediately after it in both languages", () => {
    const view = new StationIdentityView(); const b = bundle();
    view.renderOverview(b, "fallback", "ja", "overview");
    expect(view.overview.querySelector('.identity-sides')?.textContent).toBe("西口側：東武 (未確認) ・ 東口側：西武 (未確認)");
    view.renderOverview(b, "fallback", "en", "overview");
    expect(view.overview.querySelector('.identity-sides')?.textContent).toBe("West Exit side: Tobu (unconfirmed) · East Exit side: Seibu (unconfirmed)");
    b.station.identity!.sides![0]!.evidence.sourceIds = [];
    view.renderOverview(b, "fallback", "ja", "overview");
    expect(view.overview.querySelector('.identity-sides')).toBeNull();
    b.station.identity!.sides![0]!.evidence.sourceIds = ["missing"];
    view.renderOverview(b, "fallback", "ja", "overview");
    expect(view.overview.querySelector('.identity-sides')).toBeNull();
  });
  it("omits a lone side and leaves confirmed sides unmarked", () => {
    const view = new StationIdentityView(); const b = bundle();
    b.station.identity!.sides!.forEach((side) => side.verification = "confirmed");
    view.renderOverview(b, "fallback", "en", "overview");
    expect(view.overview.querySelector('.identity-unconfirmed')).toBeNull();
    b.station.identity!.sides!.pop();
    view.renderOverview(b, "fallback", "en", "overview");
    expect(view.overview.querySelector('.identity-sides')).toBeNull();
  });
});
