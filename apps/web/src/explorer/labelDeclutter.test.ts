import { describe, expect, it } from "vitest";
import { DECLUTTER_HOLD_PX, DECLUTTER_PAD_PX, LABEL_CLASS, declutter, estimateLabelBox, labelClass, revealedUnmeasured, type DeclutterItem } from "./labelDeclutter.ts";

const item = (id: string, x: number, y: number, over: Partial<DeclutterItem> = {}): DeclutterItem => ({
  id, x, y, w: 80, h: 24, klass: LABEL_CLASS.other, routable: true, ...over,
});

const overlap = (a: DeclutterItem, b: DeclutterItem, gap = 0): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;

/** Deterministic pseudo-random numbers (no Math.random: the suite must be repeatable). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function crowd(n: number, seed = 7): DeclutterItem[] {
  const r = rng(seed);
  const classes = [LABEL_CLASS.exit, LABEL_CLASS.gate, LABEL_CLASS.other, LABEL_CLASS.other];
  return Array.from({ length: n }, (_, i) => item(`poi-${i}`, 100 + r() * 400, 100 + r() * 250, { klass: classes[i % 4]!, routable: r() > 0.3, w: 50 + r() * 90 }));
}

describe("declutter", () => {
  it("keeps everything when nothing touches", () => {
    const items = [item("a", 0, 0), item("b", 200, 0), item("c", 0, 100)];
    expect([...declutter(items)].sort()).toEqual(["a", "b", "c"]);
  });

  it("drops the lower-priority label of an overlapping pair, whatever the input order", () => {
    const exit = item("z-exit", 10, 0, { klass: LABEL_CLASS.exit });
    const shop = item("a-shop", 0, 0);
    expect([...declutter([shop, exit])]).toEqual(["z-exit"]);
    expect([...declutter([exit, shop])]).toEqual(["z-exit"]);
  });

  it("ranks endpoints, exits, gates, others in that order", () => {
    const stack = [
      item("other", 0, 0),
      item("gate", 5, 0, { klass: LABEL_CLASS.gate }),
      item("exit", 10, 0, { klass: LABEL_CLASS.exit }),
    ];
    expect([...declutter(stack)]).toEqual(["exit"]);
    expect([...declutter(stack.filter((s) => s.id !== "exit"))]).toEqual(["gate"]);
    expect(labelClass(true, "exit")).toBe(LABEL_CLASS.endpoint);
    expect(labelClass(false, "exit")).toBe(LABEL_CLASS.exit);
    expect(labelClass(false, "ticket_gate")).toBe(LABEL_CLASS.gate);
    expect(labelClass(false, "shop")).toBe(LABEL_CLASS.other);
  });

  it("within a class prefers clear over faded, routable over search-only, then the id", () => {
    const base = { klass: LABEL_CLASS.exit } as const;
    expect([...declutter([item("a", 0, 0, { ...base, faded: true }), item("b", 4, 0, base)])]).toEqual(["b"]);
    expect([...declutter([item("a", 0, 0, { ...base, routable: false }), item("b", 4, 0, base)])]).toEqual(["b"]);
    expect([...declutter([item("b", 0, 0, base), item("a", 4, 0, base)])]).toEqual(["a"]);
  });

  it("always keeps the start and the destination, even when they sit on each other", () => {
    const items = [
      item("exit", 0, 0, { klass: LABEL_CLASS.exit }),
      item("start", 6, 0, { klass: LABEL_CLASS.endpoint }),
      item("dest", 9, 2, { klass: LABEL_CLASS.endpoint }),
    ];
    expect([...declutter(items)].sort()).toEqual(["dest", "start"]);
  });

  it("never lets a lower-priority label displace a higher one, even if that frees more labels", () => {
    // The exit overlaps two shops that do not overlap each other: priority still wins.
    const items = [item("exit", 50, 0, { klass: LABEL_CLASS.exit, w: 120 }), item("s1", 0, 0), item("s2", 100, 0)];
    expect([...declutter(items)]).toEqual(["exit"]);
  });

  it("leaves no overlaps among non-endpoint labels (with the pad) in a dense crowd", () => {
    for (const seed of [1, 2, 3]) {
      const items = crowd(200, seed);
      const kept = declutter(items);
      const list = items.filter((i) => kept.has(i.id));
      expect(list.length).toBeGreaterThan(5);
      expect(list.length).toBeLessThan(items.length);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        expect(overlap(list[i]!, list[j]!, DECLUTTER_PAD_PX), `${list[i]!.id} vs ${list[j]!.id}`).toBe(false);
      }
    }
  });

  it("is maximal in priority terms: every dropped label overlaps a kept label of equal or better class", () => {
    const items = crowd(120, 9);
    const kept = declutter(items);
    for (const d of items.filter((i) => !kept.has(i.id))) {
      const blockers = items.filter((k) => kept.has(k.id) && overlap(d, k, DECLUTTER_PAD_PX + DECLUTTER_HOLD_PX));
      expect(blockers.length, d.id).toBeGreaterThan(0);
      expect(blockers.some((b) => b.klass <= d.klass), d.id).toBe(true);
    }
  });

  it("is stable: same input, same output, independent of input order", () => {
    const items = crowd(200, 4);
    const a = [...declutter(items)].sort();
    expect([...declutter(items)].sort()).toEqual(a);
    expect([...declutter(items.slice().reverse())].sort()).toEqual(a);
    expect([...declutter(items.slice().sort((x, y) => x.x - y.x))].sort()).toEqual(a);
  });

  it("holds a visible label that merely touches, and makes a hidden one clear the extra margin", () => {
    // Rects 80 wide, centres 84 apart: a 4 px gap, inside pad + hold (7) but outside pad (3).
    const first = item("a", 0, 0, { klass: LABEL_CLASS.exit });
    const second = (wasVisible: boolean) => item("b", 84, 0, { wasVisible });
    expect(declutter([first, second(true)]).has("b")).toBe(true);
    expect(declutter([first, second(false)]).has("b")).toBe(false);
    expect(declutter([first, item("b", 90, 0, { wasVisible: false })]).has("b")).toBe(true);
  });

  it("handles 200 labels in well under a millisecond (loose bound)", () => {
    const items = crowd(200, 11);
    declutter(items); // warm up
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) declutter(items);
    const perRun = (performance.now() - t0) / runs;
    expect(perRun).toBeLessThan(1);
  });

  it("copes with no labels", () => {
    expect(declutter([]).size).toBe(0);
  });
});

describe("selected labels bypass the declutter", () => {
  it("an exit hidden under others reappears once it is picked as from/to (class endpoint)", () => {
    const crowd = [
      item("exit-a", 0, 0, { klass: LABEL_CLASS.exit }),
      item("exit-b", 10, 0, { klass: labelClass(false, "exit") }),
      item("exit-c", 20, 0, { klass: labelClass(false, "exit") }),
    ];
    expect(declutter(crowd).has("exit-c")).toBe(false);
    // The same label, now selected: labelClass puts it first, and it is kept.
    const picked = crowd.map((i) => (i.id === "exit-c" ? { ...i, klass: labelClass(true, "exit"), wasVisible: false } : i));
    const keep = declutter(picked);
    expect(keep.has("exit-c")).toBe(true);
    // ... and it takes the place, not the other way round: the exits it covers give way.
    expect(keep.has("exit-a")).toBe(false);
  });

  it("selected labels are kept even when faded, search-only, unmeasured or covering each other", () => {
    const sel = { klass: labelClass(true, "shop"), faded: true, routable: false, measured: false } as const;
    const items = [item("from", 0, 0, sel), item("to", 3, 0, sel), item("exit", 0, 0, { klass: LABEL_CLASS.exit })];
    expect([...declutter(items)].sort()).toEqual(["from", "to"]);
  });
});

describe("estimateLabelBox", () => {
  it("counts full-width characters as one em and ASCII as 0.55 em at 12 px", () => {
    expect(estimateLabelBox("").w).toBe(31);
    expect(estimateLabelBox("abcdefghij").w).toBe(Math.ceil(31 + 10 * 0.55 * 12));
    expect(estimateLabelBox("西口地下改札").w).toBe(31 + 6 * 12);
  });

  it("errs toward wide for Japanese: a CJK label is far wider than the same count of ASCII letters", () => {
    expect(estimateLabelBox("新宿駅南口").w).toBeGreaterThan(estimateLabelBox("abcde").w);
    // The old 7 px/char guess gave 66 px for 5 characters; the label is about 91 px.
    expect(estimateLabelBox("新宿駅南口").w).toBeGreaterThanOrEqual(31 + 5 * 12);
  });

  it("treats kana, fullwidth forms and Hangul as full width, mixed text per character", () => {
    expect(estimateLabelBox("ひらがな").w).toBe(31 + 4 * 12);
    expect(estimateLabelBox("ＡＢ").w).toBe(31 + 2 * 12);
    expect(estimateLabelBox("한글").w).toBe(31 + 2 * 12);
    expect(estimateLabelBox("出口A").w).toBe(Math.ceil(31 + (2 + 0.55) * 12));
  });

  it("scales with the font size", () => {
    expect(estimateLabelBox("口", 16).w).toBe(31 + 16);
  });
});

describe("revealedUnmeasured", () => {
  const a = item("a", 0, 0, { measured: false });
  const b = item("b", 300, 0, { measured: true });
  const c = item("c", 600, 0, { measured: false });

  it("reports kept labels that were placed on an estimate, so another pass is scheduled", () => {
    expect(revealedUnmeasured([a, b, c], declutter([a, b, c]))).toEqual(["a", "c"]);
  });

  it("does not report dropped or already measured labels, so it settles once measured", () => {
    const hidden = item("d", 5, 0, { measured: false, klass: LABEL_CLASS.other });
    const front = item("e", 0, 0, { klass: LABEL_CLASS.exit, measured: true });
    expect(revealedUnmeasured([hidden, front], declutter([hidden, front]))).toEqual([]);
    const measured = [a, b, c].map((i) => ({ ...i, measured: true }));
    expect(revealedUnmeasured(measured, declutter(measured))).toEqual([]);
  });
});
