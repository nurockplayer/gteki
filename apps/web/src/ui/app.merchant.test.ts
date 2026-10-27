// @vitest-environment jsdom
// #213 at the wiring level: the category filter narrows both search lists, and a shop destination gets the
// merchant card beside the no-route card with no direction control anywhere.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Poi, Source } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import { createSyntheticBundle } from "../../../../packages/navigation/src/fixtures.ts";
import { strings, type Lang } from "../i18n.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: { lang: Lang; loaded: { bundle: ReturnType<typeof createSyntheticBundle> } | null; route: unknown; noPath: null; destination: Poi | null; destinationTenant: null; search?: unknown; filter: Poi["category"] | null };
  ui: { sheet: HTMLElement; categoryFilter: HTMLSelectElement; toInput: HTMLInputElement; fromInput: HTMLInputElement; toResults: HTMLElement };
  t: ReturnType<typeof strings>;
  renderCategoryFilter: (b: ReturnType<typeof createSyntheticBundle> | undefined) => void;
  renderResults: (which: "from" | "to") => void;
  renderSheet: () => void;
  explorer: unknown;
};

const SOURCE: Source = {
  id: "sample-directory", title: "サンプル店舗一覧", publisher: "サンプル事業者", url: "https://example.org/shops",
  license: null, rights: "REUSABLE_WITH_CONDITIONS", usage: "facts-only", attribution: "サンプル事業者",
  modified: false, retrievedAt: "2026-10-24", datasetDate: "2026-10", validUntil: null,
} as Source;

const shopPoi = (over: Partial<Poi> = {}): Poi => ({
  id: "shop-sample-001",
  category: "shop",
  names: [{ lang: "ja", text: "サンプル薬局" }],
  aliases: [],
  floorId: null,
  displayPosition: null,
  connectorNodeIds: [],
  paid: null,
  evidence: { sourceIds: [SOURCE.id], method: "facts-only directory listing, UNVERIFIED, AREA_ONLY", checkedDate: "2026-10-24" },
  notes: [{ lang: "ja", text: "位置・入口は未確認（検索のみ。案内ルートなし）。" }],
  ...over,
});

function app(lang: Lang = "ja") {
  const root = document.createElement("div");
  document.body.append(root);
  const a = new App(root) as unknown as Harness;
  a.s.lang = lang;
  const bundle = createSyntheticBundle([]);
  bundle.sources.push(SOURCE);
  bundle.pois.push(shopPoi());
  a.s.loaded = { bundle };
  a.s.destination = null;
  a.s.route = null;
  a.s.destinationTenant = null;
  a.s.noPath = null;
  a.s.search = createSearchIndex(bundle);
  // renderSheet refits an automatic overview after the sheet opens or closes (#385); the real App always has one.
  a.explorer = { refitOverview: vi.fn() } as unknown;
  for (const name of ["releaseMascot", "mascotSay"] as const) vi.spyOn(a as unknown as Record<string, () => void>, name).mockImplementation(() => {});
  return { a, bundle };
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("search category filter (#213)", () => {
  it("offers the bundle's categories plus all, keeps the current choice, and hides itself with no bundle", () => {
    const { a, bundle } = app("ja");
    a.s.filter = "shop";
    a.renderCategoryFilter(bundle);
    expect([...a.ui.categoryFilter.options].map((o) => o.value)).toContain("shop");
    expect(a.ui.categoryFilter.value).toBe("shop");
    expect(a.ui.categoryFilter.options[0]!.textContent).toBe(strings("ja").categoryAll);
    expect(a.ui.categoryFilter.hidden).toBe(false);
    // A filter the new bundle does not have is dropped, not applied to nothing.
    a.renderCategoryFilter(undefined);
    expect(a.s.filter).toBeNull();
    expect(a.ui.categoryFilter.hidden).toBe(true);
  });

  it("narrows the result list and reports an empty list instead of another category", () => {
    const { a } = app("ja");
    a.ui.toInput.value = "サンプル薬局";
    a.s.filter = "shop";
    a.renderResults("to");
    const options = [...a.ui.toResults!.querySelectorAll(".result")];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.classList.contains("cat-shop"))).toBe(true);
    // The same query under another category finds nothing: no fallback to the shop, only a row that counts it.
    a.s.filter = "exit";
    a.renderResults("to");
    expect(a.ui.toResults!.querySelector(".result.empty")).not.toBeNull();
    expect(a.ui.toResults!.querySelector(".result.other-categories")?.textContent).toBe("他の種類に 1 件：すべての種類で探す");
    expect(a.ui.toResults!.querySelector(".cat-shop")).toBeNull();
  });
});

describe("merchant card in the route sheet (#213)", () => {
  it("shows the shop's own facts beside the no-route card and offers no directions", () => {
    const { a } = app("en");
    a.s.destination = a.s.loaded!.bundle.pois.find((p) => p.id === "shop-sample-001")!;
    a.s.route = { ok: false, reason: "unknown_goal", message: "no entrance" };
    a.renderSheet();
    const sheet = a.ui.sheet;
    expect(sheet.querySelector(".card.no-route")).not.toBeNull();
    const card = sheet.querySelector(".card.merchant");
    expect(card).not.toBeNull();
    expect(card!.querySelector("h2")!.textContent).toBe("サンプル薬局");
    expect(card!.textContent).toContain(strings("en").merchant.precision.area);
    expect(card!.textContent).toContain(strings("en").merchant.source);
    expect(card!.querySelector("a.merchant-source-link")!.getAttribute("href")).toBe(SOURCE.url);
    expect(card!.textContent).toContain("2026-10-24");
    // Search-only: no guide, no walk, no overview — the sheet holds only the no-route card's own controls.
    expect(card!.querySelector("button")).toBeNull();
    expect(sheet.querySelector("button.primary")).toBeNull();
  });

  it("adds no merchant card for a non-shop destination", () => {
    const { a } = app("ja");
    a.s.destination = a.s.loaded!.bundle.pois.find((p) => p.category !== "shop")!;
    a.s.route = { ok: false, reason: "unknown_goal", message: "no entrance" };
    a.renderSheet();
    expect(a.ui.sheet.querySelector(".card.merchant")).toBeNull();
  });
});
