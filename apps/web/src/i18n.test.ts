// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { coverageText, strings } from "./i18n.ts";
import type { Lang } from "./i18n.ts";

vi.mock("./explorer/explorer.ts", () => ({ Explorer: class {} }));
vi.mock("./registry.ts", () => ({ listStations: vi.fn(), PRIVATE_BUILD: false, StationLoadError: class extends Error {} }));
import { App } from "./ui/app.ts";

/** Dotted paths of every key under an object (functions and strings are leaves). */
function paths(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n", () => {
  it("names the cold-open guided walk and its hint in ja and en", () => {
    expect(strings("ja").coldOpen).toMatchObject({ guide: "ホームまで自動で歩く", hint: "押すと猫がホームまで案内します" });
    expect(strings("en").coldOpen).toMatchObject({ guide: "Take a guided walk", hint: "Tap and the cat walks you to the platform" });
  });

  it.each(["en", "ja"] as const)("updates HUD buttons loaded in %s after a runtime language switch", (lang) => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    history.replaceState(null, "", `?lang=${lang}`);
    const root = document.createElement("div");
    document.body.append(root);
    const app = new App(root);
    const explorer = {
      currentMode: "walk", firstPersonOn: false, graphOverlayOn: false, audioMuted: true,
      getPose: () => null, clearRoute() {}, refitOverview() {}, setCreditLine() {}, frameAll: vi.fn(),
      toggleFirstPerson() { return this.firstPersonOn = !this.firstPersonOn; },
      setGraphOverlay(on: boolean) { this.graphOverlayOn = on; },
      setMuted(muted: boolean) { this.audioMuted = muted; },
    };
    const a = app as unknown as { explorer: typeof explorer; layout: () => void; renderHud: () => void };
    a.explorer = explorer;
    const labels = {
      en: ["First person", "Network", "Overview", "Sound off", "Sound on"],
      ja: ["一人称", "経路網", "全体表示", "音声オフ", "音声オン"],
    };
    const buttons = () => [...root.querySelectorAll<HTMLButtonElement>(".hud-row > button")];
    const expectLabels = (language: Lang, soundOn: boolean) => {
      const [fp, net, ov, off, on] = labels[language];
      const expected = [fp, net, ov, soundOn ? on : off];
      expect(buttons().map((b) => b.textContent)).toEqual(expected);
      buttons().forEach((b, i) => {
        for (const attr of ["aria-label", "title"]) {
          if (b.hasAttribute(attr)) expect(b.getAttribute(attr)).toBe(expected[i]);
        }
      });
      expect(buttons()[3]!.getAttribute("aria-pressed")).toBe(String(soundOn));
    };
    const toggle = () => { for (const i of [0, 1, 3]) buttons()[i]!.click(); };
    try {
      a.layout();
      a.renderHud();
      expectLabels(lang, false);
      toggle();
      expectLabels(lang, true);
      root.querySelector<HTMLButtonElement>(".lang")!.click();
      const switched = lang === "en" ? "ja" : "en";
      expectLabels(switched, true);
      expect(buttons().slice(0, 2).every((b) => b.classList.contains("on"))).toBe(true);
      toggle();
      expectLabels(switched, false);
      expect(buttons().slice(0, 2).every((b) => !b.classList.contains("on"))).toBe(true);
      buttons()[2]!.click();
      expect(explorer.frameAll).toHaveBeenCalledOnce();
      root.querySelector<HTMLButtonElement>(".lang")!.click();
      expectLabels(lang, false);
    } finally {
      app.dispose();
      root.remove();
      history.replaceState(null, "", "/");
      vi.unstubAllGlobals();
    }
  });

  it("has the same keys in ja and en", () => {
    expect(paths(strings("en")).sort()).toEqual(paths(strings("ja")).sort());
  });

  it("has the guide step and arrival follow-up strings in both languages", () => {
    const en = strings("en");
    const ja = strings("ja");
    expect([en.guidePrev, en.guideNext, en.reverseRoute, en.searchAgain]).toEqual(["Previous instruction", "Next instruction", "Reverse route", "Search again"]);
    expect([ja.guidePrev, ja.guideNext, ja.reverseRoute, ja.searchAgain]).toEqual(["前の案内", "次の案内", "逆向きのルート", "もう一度検索"]);
    for (const t of [en, ja]) {
      // The tooltips name both shortcuts.
      expect(t.guidePrevTitle).toContain("[");
      expect(t.guidePrevTitle).toContain("PageUp");
      expect(t.guideNextTitle).toContain("]");
      expect(t.guideNextTitle).toContain("PageDown");
    }
  });

  it("shows coverage gap text in the requested language, falling back to ja then any, or the plain string (#259)", () => {
    const both = [{ lang: "ja" as const, text: "全フロア" }, { lang: "en" as const, text: "All levels" }];
    expect(coverageText(both, "ja")).toBe("全フロア");
    expect(coverageText(both, "en")).toBe("All levels");
    // A station that only supplied ja still shows ja to an en reader rather than an empty cell.
    expect(coverageText([{ lang: "ja", text: "営業時間" }], "en")).toBe("営業時間");
    // Any other language is preferred over nothing.
    expect(coverageText([{ lang: "zh-Hant", text: "車站" }], "en")).toBe("車站");
    // A legacy plain string is shown exactly as written, never translated.
    expect(coverageText("TP-only passages", "ja")).toBe("TP-only passages");
    expect(coverageText(undefined, "ja")).toBe("");
  });

  it("labels every rights value in plain language (#130)", () => {
    for (const lang of ["ja", "en"] as const) {
      const t = strings(lang);
      for (const v of [t.rightsReusable, t.rightsOwnerOverride, t.rightsReference, t.rightsRestricted, t.rightsUnverified]) {
        expect(v.length).toBeGreaterThan(0);
        expect(v).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
      }
    }
  });
});
