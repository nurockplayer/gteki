import { afterEach, describe, expect, it, vi } from "vitest";
import { strings, type Lang } from "../i18n.ts";
import { MASCOT_ART, MascotSlot, TRANSIENT_MS, mascotLine, type MascotEvent, type MascotExpression, type MascotId } from "./mascot.ts";

const LANGS: Lang[] = ["ja", "en"];
const REASONS = ["no_path", "unknown_start", "unknown_goal", "start_equals_goal", "search_limit"];
const EXPRESSIONS: MascotExpression[] = ["neutral", "happy", "encourage", "sorry", "unsure"];

/** The few DOM members MascotSlot touches (the repo's unit tests run in plain node, without a DOM). */
class FakeEl {
  className = "";
  hidden = false;
  textContent = "";
  innerHTML = "";
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  private attrs = new Map<string, string>();
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  append(...c: FakeEl[]): void { this.children.push(...c); }
}
const fakeDoc = { createElement: () => new FakeEl() } as unknown as Pick<Document, "createElement">;
function slot(lang: Lang = "en", announce: (t: string) => void = () => {}) {
  const s = new MascotSlot(() => strings(lang), announce, fakeDoc);
  const root = s.root as unknown as FakeEl;
  const [figure, bubble] = root.children as [FakeEl, FakeEl];
  return { s, root, figure, bubble };
}

afterEach(() => vi.useRealTimers());

describe("mascotLine: event -> line", () => {
  for (const lang of LANGS) {
    const t = strings(lang);
    it(`arrival is the dog, happy, not announced (the toast says it) (${lang})`, () => {
      expect(mascotLine(t, { kind: "arrival" })).toMatchObject({ character: "dog", expression: "happy", lineKey: "arrival", line: t.mascot.arrival, announce: false });
    });

    it(`arrival_connector is the cat, unsure, and never says arrived (${lang})`, () => {
      const m = mascotLine(t, { kind: "arrival_connector" })!;
      expect(m).toMatchObject({ character: "cat", expression: "unsure", lineKey: "arrival_connector", announce: true });
      expect(m.line).not.toBe(t.mascot.arrival);
      expect(m.line).not.toBe(t.arrived);
      expect(m.line).not.toMatch(/arriv|着いた|到着|We're here/i);
    });

    it(`no_path: one cat line per reason, announced (${lang})`, () => {
      for (const reason of REASONS) {
        expect(mascotLine(t, { kind: "no_path", reason })).toMatchObject({ character: "cat", lineKey: `no_path.${reason}`, line: t.mascot.noPath[reason], announce: true, transient: false });
      }
    });

    it(`no_path: unknown reasons fall back to the generic line, even prototype names (${lang})`, () => {
      for (const reason of ["something_new", "", "toString", "__proto__", "constructor", "other"]) {
        const m = mascotLine(t, { kind: "no_path", reason })!;
        expect(m.lineKey).toBe("no_path.other");
        expect(m.line).toBe(t.mascot.noPath.other);
        expect(typeof m.line).toBe("string");
      }
    });

    it(`route_unknowns: cat, unsure, state line pointing at the badges (${lang})`, () => {
      expect(mascotLine(t, { kind: "route_unknowns" })).toMatchObject({ character: "cat", expression: "unsure", lineKey: "route_unknowns", announce: true, transient: false });
      expect(t.mascot.routeUnknowns).toMatch(lang === "ja" ? /バッジ/ : /badges/);
    });

    it(`search_empty: dog, encourage, announced, stays (${lang})`, () => {
      expect(mascotLine(t, { kind: "search_empty" })).toMatchObject({ character: "dog", expression: "encourage", lineKey: "search_empty", announce: true, transient: false });
    });

    it(`turn: dog nudge, transient, NOT announced (the instruction already is) (${lang})`, () => {
      expect(mascotLine(t, { kind: "turn" })).toMatchObject({ character: "dog", expression: "encourage", lineKey: "turn", announce: false, transient: true });
    });

    it(`load_error: cat, sorry, announced because the error card says nothing (${lang})`, () => {
      expect(mascotLine(t, { kind: "load_error" })).toMatchObject({ character: "cat", expression: "sorry", lineKey: "load_error", line: t.mascot.loadError, announce: true, transient: false });
    });

    it(`scene_fallback: cat, sorry, not announced (the toast is), stays (${lang})`, () => {
      expect(mascotLine(t, { kind: "scene_fallback" })).toMatchObject({ character: "cat", expression: "sorry", lineKey: "scene_fallback", line: t.mascot.sceneFallback, announce: false, transient: false });
    });

    it(`start_hint: dog, encourage, not announced, stays, and names the actual "to" field label (${lang})`, () => {
      const m = mascotLine(t, { kind: "start_hint" })!;
      expect(m).toMatchObject({ character: "dog", expression: "encourage", lineKey: "start_hint", line: t.mascot.startHint, announce: false, transient: false });
      expect(m.line).toContain(t.to);
    });

    it(`idle hides the bubble (${lang})`, () => {
      expect(mascotLine(t, { kind: "idle" })).toBeNull();
    });
  }

  it("expressions: 'I don't know' is unsure, a proven dead end and failures are sorry, start_equals_goal is neutral", () => {
    const t = strings("en");
    const expression = (ev: MascotEvent) => mascotLine(t, ev)!.expression;
    for (const reason of ["search_limit", "unknown_start", "unknown_goal", "weird", "", "other"]) expect(expression({ kind: "no_path", reason }), reason).toBe("unsure");
    expect(expression({ kind: "no_path", reason: "no_path" })).toBe("sorry");
    expect(expression({ kind: "no_path", reason: "start_equals_goal" })).toBe("neutral");
    for (const kind of ["route_unknowns", "arrival_connector"] as const) expect(expression({ kind }), kind).toBe("unsure");
    for (const kind of ["load_error", "scene_fallback"] as const) expect(expression({ kind }), kind).toBe("sorry");
  });

  it("announce is true for arrival_connector and the error/empty states; false for turn, arrival, scene_fallback and start_hint (said elsewhere or only a hint)", () => {
    const t = strings("en");
    const events: MascotEvent[] = [{ kind: "arrival_connector" }, { kind: "no_path", reason: "no_path" }, { kind: "route_unknowns" }, { kind: "search_empty" }, { kind: "load_error" }];
    for (const ev of events) expect(mascotLine(t, ev)!.announce).toBe(true);
    for (const kind of ["scene_fallback", "start_hint"] as const) expect(mascotLine(t, { kind })!.announce).toBe(false);
    expect(mascotLine(t, { kind: "turn" })!.announce).toBe(false);
    expect(mascotLine(t, { kind: "arrival" })!.announce).toBe(false);
  });

  it("transient: only turn and arrival lines time out", () => {
    const t = strings("en");
    expect(mascotLine(t, { kind: "arrival" })!.transient).toBe(true);
    expect(mascotLine(t, { kind: "arrival_connector" })!.transient).toBe(true);
    for (const ev of [{ kind: "route_unknowns" }, { kind: "search_empty" }, { kind: "no_path", reason: "no_path" }] as MascotEvent[]) expect(mascotLine(t, ev)!.transient).toBe(false);
  });
});

describe("truthfulness: lines are fixed strings that cannot carry route facts", () => {
  /** Every leaf of the mascot table with its path. */
  function leaves(v: unknown, path: string): [string, unknown][] {
    if (v !== null && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}.${k}`));
    return [[path, v]];
  }

  for (const lang of LANGS) {
    const t = strings(lang);

    it(`the line table is only strings, no functions to interpolate with (${lang})`, () => {
      const all = leaves(t.mascot, "mascot");
      expect(all.length).toBeGreaterThanOrEqual(14);
      for (const [path, v] of all) expect(typeof v, path).toBe("string");
    });

    it(`no digits, units, directions or floors in any line (${lang})`, () => {
      for (const [path, v] of leaves(t.mascot, "mascot")) {
        const line = v as string;
        // "3D" is the one UI term allowed to carry a digit (the scene_fallback line); it is no route fact.
        expect(line.replaceAll("3D", ""), path).not.toMatch(/[0-9０-９]/);
        expect(line, path).not.toMatch(/\{|\}|\$|%s/);
        if (lang === "ja") expect(line, path).not.toMatch(/[左右北南東西階分秒]|メートル|まっすぐ|エスカレーター|エレベーター|階段/);
        else expect(line, path).not.toMatch(/\b(left|right|straight|north|south|east|west|floors?|levels?|minutes?|seconds?|metres?|meters?|stairs?|escalators?|elevators?|lifts?)\b/i);
      }
    });

    it(`mascotLine returns the table's own text for every event, nothing built at runtime (${lang})`, () => {
      const table = new Set(leaves(t.mascot, "mascot").map(([, v]) => v));
      const events: MascotEvent[] = [{ kind: "arrival" }, { kind: "arrival_connector" }, { kind: "route_unknowns" }, { kind: "search_empty" }, { kind: "turn" }, { kind: "load_error" }, { kind: "scene_fallback" }, { kind: "start_hint" }, ...REASONS.map((reason) => ({ kind: "no_path", reason }) as MascotEvent)];
      for (const ev of events) expect(table.has(mascotLine(t, ev)!.line), JSON.stringify(ev)).toBe(true);
    });

    it(`search_limit and unknown_* say plainly that it does not know, never "no route" (${lang})`, () => {
      const dontKnow = lang === "ja" ? /わからない/ : /don't know/;
      const claimsNone = lang === "ja" ? /(ルート|道|経路)(は|が)(ない|ありません)/ : /\bno (route|path|way)\b|not possible|impossible/i;
      for (const reason of ["search_limit", "unknown_start", "unknown_goal", "something_new"]) {
        const m = mascotLine(t, { kind: "no_path", reason })!;
        expect(m.line, reason).toMatch(dontKnow);
        expect(m.line, reason).not.toMatch(claimsNone);
        expect(m.expression).toBe("unsure");
      }
      expect(t.mascot.routeUnknowns).toMatch(dontKnow);
      expect(t.mascot.arrivalConnector).toMatch(lang === "ja" ? /わからない/ : /can't tell/);
    });
  }

  it("ja and en tables have the same keys", () => {
    const keys = (lang: Lang) => leaves(strings(lang).mascot, "mascot").map(([p]) => p).sort();
    expect(keys("en")).toEqual(keys("ja"));
  });
});

describe("MascotSlot", () => {
  it("markup: figure and bubble are aria-hidden, and no placeholder marker remains", () => {
    const { root, figure, bubble } = slot();
    expect(root.className).toBe("mascot");
    expect(root.dataset.placeholder).toBeUndefined();
    expect(figure.dataset.placeholder).toBeUndefined();
    expect(figure.getAttribute("aria-hidden")).toBe("true");
    expect(bubble.getAttribute("aria-hidden")).toBe("true");
    expect(root.getAttribute("aria-live")).toBeNull();
  });

  it("starts hidden; say shows the bubble, the character and the expression", () => {
    const { s, root, figure, bubble } = slot("en");
    expect(root.hidden).toBe(true);
    expect(s.info()).toEqual({ visible: false, character: null, expression: "neutral", lineKey: null, motion: "off" });
    s.say({ kind: "no_path", reason: "search_limit" });
    expect(root.hidden).toBe(false);
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toBe(strings("en").mascot.noPath.search_limit);
    expect(root.dataset).toMatchObject({ character: "cat", expression: "unsure" });
    expect(figure.innerHTML).toBe(MASCOT_ART.cat.unsure);
    expect(s.info()).toMatchObject({ visible: true, character: "cat", expression: "unsure", lineKey: "no_path.search_limit" });
  });

  it("speaks in the current language", () => {
    const ja = slot("ja");
    ja.s.say({ kind: "search_empty" });
    expect(ja.bubble.textContent).toBe(strings("ja").mascot.searchEmpty);
  });

  it("announces through the callback only when the line asks to", () => {
    const heard: string[] = [];
    const { s } = slot("en", (t) => heard.push(t));
    s.say({ kind: "turn" });
    expect(heard).toEqual([]);
    s.say({ kind: "arrival" });
    s.say({ kind: "route_unknowns" });
    expect(heard).toEqual([strings("en").mascot.routeUnknowns]);
  });

  it("state lines stay until cleared; turn and arrival lines time out", () => {
    vi.useFakeTimers();
    const { s, root } = slot();
    s.say({ kind: "route_unknowns" });
    vi.advanceTimersByTime(TRANSIENT_MS * 10);
    expect(s.info().visible).toBe(true);
    s.say({ kind: "turn" });
    vi.advanceTimersByTime(TRANSIENT_MS - 1);
    expect(s.info().visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(s.info()).toMatchObject({ visible: false, lineKey: null });
    expect(root.hidden).toBe(true);
    s.say({ kind: "arrival" });
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(s.info().visible).toBe(false);
  });

  it("a state line replacing a transient one is not hidden by the old timer", () => {
    vi.useFakeTimers();
    const { s } = slot();
    s.say({ kind: "turn" });
    vi.advanceTimersByTime(TRANSIENT_MS - 100);
    s.say({ kind: "search_empty" });
    vi.advanceTimersByTime(TRANSIENT_MS);
    expect(s.info()).toMatchObject({ visible: true, lineKey: "search_empty" });
  });

  it("idle and clear hide the bubble", () => {
    const { s, root, bubble } = slot();
    s.say({ kind: "search_empty" });
    expect(s.say({ kind: "idle" })).toBeNull();
    expect(s.info().visible).toBe(false);
    expect(bubble.hidden).toBe(true);
    expect(root.hidden).toBe(true);
    s.say({ kind: "search_empty" });
    s.clear();
    expect(s.info().visible).toBe(false);
  });

  it("resident keeps a neutral figure up with no bubble (the guide HUD) until released", () => {
    const { s, root, bubble } = slot();
    s.setResident(true);
    expect(root.hidden).toBe(false);
    expect(bubble.hidden).toBe(true);
    expect(root.dataset.expression).toBe("neutral");
    s.setResident(false);
    expect(root.hidden).toBe(true);
  });

  it("motion is off by default and under reduced motion or the low (phone) tier; on only with neither", () => {
    const { s, root } = slot();
    expect(s.info().motion).toBe("off");
    const cases: [boolean, boolean, "on" | "off"][] = [[false, false, "on"], [true, false, "off"], [false, true, "off"], [true, true, "off"]];
    for (const [reduce, low, want] of cases) {
      s.setMotion(reduce, low);
      expect(s.info().motion, `reduce=${reduce} low=${low}`).toBe(want);
      expect(root.dataset.motion).toBe(want);
    }
    s.setMotion(false, false);
    s.say({ kind: "turn" });
    expect(root.dataset.motion).toBe("on");
  });
});

describe("mascot art cost guard", () => {
  const all = (["cat", "dog"] as MascotId[]).flatMap((c) => EXPRESSIONS.map((e) => [c, e, MASCOT_ART[c][e]] as const));

  it("has all ten faces (2 characters x 5 expressions), each a 64x64 Lane E SVG inlined without xmlns", () => {
    expect(all).toHaveLength(10);
    for (const c of ["cat", "dog"] as MascotId[]) expect(Object.keys(MASCOT_ART[c]).sort()).toEqual([...EXPRESSIONS].sort());
    for (const [c, e, art] of all) {
      expect(art, `${c}/${e}`).toMatch(/^<svg [^>]*viewBox="0 0 64 64"/);
      expect(art, `${c}/${e}`).not.toContain("xmlns");
    }
  });

  it("each svg is under 4 KB (Lane E's 4096 B limit)", () => {
    for (const [c, e, art] of all) expect(new TextEncoder().encode(art).length, `${c}/${e}`).toBeLessThan(4096);
  });

  it("no images, url() references, links or scripts: inline shapes only", () => {
    for (const [c, e, art] of all) {
      const markup = art.replace('xmlns="http://www.w3.org/2000/svg"', "");
      expect(markup, `${c}/${e}`).not.toMatch(/<img|<image|<use|<script|<foreignObject|<style|<filter|url\(|href|https?:|data:|\bon\w+=/i);
    }
  });

  it("expressions and characters are visibly distinct", () => {
    expect(new Set(all.map(([, , art]) => art)).size).toBe(10);
  });

  it("unsure is a face, not a question mark: no glyphs or text, and its own drawing", () => {
    for (const c of ["cat", "dog"] as MascotId[]) {
      const art = MASCOT_ART[c].unsure;
      expect(art, c).not.toMatch(/<text|\?|？/);
      expect(art, c).not.toBe(MASCOT_ART[c].neutral);
      expect(art, c).not.toBe(MASCOT_ART[c].sorry);
    }
  });
});
