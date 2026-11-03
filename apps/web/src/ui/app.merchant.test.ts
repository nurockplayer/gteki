// @vitest-environment jsdom
// #213 at the wiring level: the category filter narrows both search lists, and a shop destination gets the
// merchant card beside the no-route card with no direction control anywhere.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseStationFiles, type Poi, type Source } from "@gteki/schema";
import { createRouter, routeBetween, type RouteFailure, type RouteResult, type Router } from "@gteki/navigation";
import { createSearchIndex } from "@gteki/search";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { strings, type Lang } from "../i18n.ts";

vi.mock("../explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("../registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./app.ts";

type Harness = {
  s: {
    lang: Lang; loaded: { bundle: ReturnType<typeof createSyntheticBundle> } | null; route: RouteResult | RouteFailure | null; noPath: unknown;
    destination: Poi | null; destinationTenant: null; search?: unknown; filter: Poi["category"] | null;
    router: Router | null; profile: { stepFree: boolean; unpaidOnly: boolean; strictHours: boolean };
    origin?: unknown; polyline?: unknown[]; instructions?: unknown[]; activeInstruction?: number;
  };
  ui: { minimap: { setRoute: ReturnType<typeof vi.fn> }; live: { announce: ReturnType<typeof vi.fn> }; sheet: HTMLElement; categoryFilter: HTMLSelectElement; toInput: HTMLInputElement; fromInput: HTMLInputElement; toResults: HTMLElement };
  t: ReturnType<typeof strings>;
  renderCategoryFilter: (b: ReturnType<typeof createSyntheticBundle> | undefined) => void;
  renderResults: (which: "from" | "to") => void;
  renderSheet: () => void;
  computeRoute: () => void;
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
  a.explorer = {
    refitOverview: vi.fn(), clearRoute: vi.fn(), showRoute: vi.fn(), focusPoints: vi.fn(),
    connectorRoutePaths: () => null, navmeshRoutePaths: () => null, currentMode: "overview",
  };
  a.ui.minimap = { setRoute: vi.fn() };
  a.ui.live = { announce: vi.fn() };
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

  it("labels a route that ends at the store's printed station-level tie, and its search row", () => {
    const { a, bundle } = app("ja");
    const tie = shopPoi({
      id: "shop-sample-tie",
      names: [{ lang: "ja", text: "サンプル百貨店" }],
      connectorNodeIds: ["goal"],
      evidence: {
        sourceIds: [SOURCE.id],
        method: "printed station-level tie: the access page prints 「南改札口から徒歩すぐ」 under JR. STATION_TIE: the store's own entrance is not verified (field item V1).",
        checkedDate: "2026-10-28",
      },
      notes: [{ lang: "ja", text: "「南改札口から徒歩すぐ」（アクセスページの表記）。案内は駅の改札まで。店舗入口の位置は未確認です。" }],
    });
    bundle.pois.push(tie);
    // The harness bundle carries no edges; the tie shop connects to "goal", so give it one.
    bundle.edges.push(syntheticEdge("start-goal", "start", "goal", { lengthM: 20 }));
    a.s.search = createSearchIndex(bundle);
    a.s.origin = { kind: "node", nodeId: "start" };
    a.s.destination = tie;
    const route = routeBetween(createRouter(bundle), { kind: "node", nodeId: "start" }, tie, { fare: "ticketed", stepFree: false, hours: "warn_unknown" });
    if (!route.ok) throw new Error(route.message);
    a.s.route = route;
    a.s.polyline = [];
    a.s.instructions = [];
    a.s.activeInstruction = 0;
    a.renderSheet();
    expect(a.ui.sheet.querySelector(".card.route .entrance-unverified")?.textContent).toBe(strings("ja").merchant.precision.tie);
    expect(a.ui.sheet.querySelector(".card.route")!.textContent).toContain("店舗入口の位置は未確認です");

    // The search row says the same thing, next to the store's own note.
    a.ui.toInput.value = "サンプル百貨店";
    a.renderResults("to");
    const row = [...a.ui.toResults.querySelectorAll(".result")].find((o) => o.textContent?.includes("サンプル百貨店"))!;
    expect(row.textContent).toContain(strings("ja").merchant.precision.tie);
    expect(row.textContent).toContain("店舗入口の位置は未確認です");
    expect(row.getAttribute("aria-label")).toContain(strings("ja").merchant.precision.tie);
  });

  it("leaves a route to a gate destination unlabelled", () => {
    const { a, bundle } = app("ja");
    const gate: Poi = {
      ...shopPoi({ id: "gate-sample", connectorNodeIds: ["goal"] }),
      category: "ticket_gate",
      names: [{ lang: "ja", text: "サンプル改札" }],
      evidence: { sourceIds: [SOURCE.id], method: "test", checkedDate: "2026-10-24" },
    };
    bundle.pois.push(gate);
    bundle.edges.push(syntheticEdge("start-goal", "start", "goal", { lengthM: 20 }));
    a.s.origin = { kind: "node", nodeId: "start" };
    a.s.destination = gate;
    const route = routeBetween(createRouter(bundle), { kind: "node", nodeId: "start" }, gate, { fare: "ticketed", stepFree: false, hours: "warn_unknown" });
    if (!route.ok) throw new Error(route.message);
    a.s.route = route;
    a.s.polyline = [];
    a.s.instructions = [];
    a.s.activeInstruction = 0;
    a.renderSheet();
    expect(a.ui.sheet.querySelector(".card.route")).not.toBeNull();
    expect(a.ui.sheet.querySelector(".entrance-unverified")).toBeNull();
  });

  it("adds no merchant card for a non-shop destination", () => {
    const { a } = app("ja");
    a.s.destination = a.s.loaded!.bundle.pois.find((p) => p.category !== "shop")!;
    a.s.route = { ok: false, reason: "unknown_goal", message: "no entrance" };
    a.renderSheet();
    expect(a.ui.sheet.querySelector(".card.merchant")).toBeNull();
  });
});


describe("step-free routes to unverified store ties", () => {
  it.each(["ja", "en"] as const)("keeps ordinary routing and chooses the cheapest accessible tie in %s", (lang) => {
    const { a, bundle } = app(lang);
    const tie = shopPoi({
      connectorNodeIds: ["a", "b", "goal"], paid: false,
      evidence: { ...shopPoi().evidence, method: "STATION_TIE: entrance unverified" },
    });
    // The closest tie needs stairs. The accessible lift is shorter in metres but costs
    // more time than the walk, so the walk must win the step-free multi-target query.
    bundle.edges.push(
      syntheticEdge("stairs", "start", "a", { mode: "stairs", lengthM: 1 }),
      syntheticEdge("lift", "start", "b", { mode: "elevator", lengthM: 2 }),
      syntheticEdge("walk", "start", "goal", { lengthM: 12 }),
    );
    a.s.router = createRouter(bundle);
    a.s.origin = { kind: "node", nodeId: "start" };
    a.s.destination = tie;
    a.computeRoute();
    expect(a.s.route).toMatchObject({ ok: true, nodeIds: ["start", "a"], profile: { stepFree: false } });
    expect(a.ui.sheet.querySelector(".card.route .entrance-unverified")?.textContent).toBe(strings(lang).merchant.precision.tie);
    expect(a.ui.sheet.querySelector(".merchant-meta")?.textContent).not.toContain(strings(lang).merchant.stepFreeTie);

    a.s.profile.stepFree = true;
    a.computeRoute();
    expect(a.s.route).toMatchObject({ ok: true, nodeIds: ["start", "goal"], steps: [{ edgeId: "walk" }], profile: { stepFree: true } });
    expect(a.ui.sheet.querySelector(".card.route .entrance-unverified")?.textContent).toBe(strings(lang).merchant.stepFreeTie);
    expect(a.ui.sheet.querySelector(".merchant-meta")?.textContent).toContain(strings(lang).merchant.stepFreeTie);
    expect(a.ui.sheet.querySelector(".merchant-no-route")).toBeNull();

    a.s.profile.stepFree = false;
    a.computeRoute();
    expect(a.s.route).toMatchObject({ ok: true, nodeIds: ["start", "a"] });
    expect(a.ui.sheet.querySelector(".card.route .entrance-unverified")?.textContent).toBe(strings(lang).merchant.precision.tie);
  });

  it.each(["ja", "en"] as const)("shows no reachable gate for real Ikebukuro Seibu in %s", (lang) => {
    const { a } = app(lang);
    const read = (file: string) => JSON.parse(readFileSync(`stations/ikebukuro/gteki/${file}.json`, "utf8"));
    const parsed = parseStationFiles(read("station"), read("graph"), read("pois"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const bundle = parsed.bundle;
    a.s.loaded = { bundle };
    a.s.router = createRouter(bundle);
    a.s.origin = { kind: "poi", poi: bundle.pois.find((p) => p.id === "jr-central-gate-2")! };
    a.s.destination = bundle.pois.find((p) => p.id === "shop-ikb-seibu-honten")!;
    a.s.profile.stepFree = true;
    a.computeRoute();
    expect(a.s.route).toMatchObject({ ok: false, reason: "no_path" });
    expect(a.ui.sheet.querySelector(".card.no-route")?.textContent).toContain(strings(lang).merchant.noStepFreeTie);
    expect(a.ui.sheet.querySelector(".merchant-no-route")?.textContent).toBe(strings(lang).merchant.noStepFreeTie);
    expect(a.ui.sheet.querySelector("button.primary")).toBeNull();
    expect(a.ui.sheet.querySelector(".card.route")).toBeNull();
    expect(a.ui.live.announce).toHaveBeenCalledWith(expect.stringContaining(strings(lang).merchant.noStepFreeTie));
  });
});
