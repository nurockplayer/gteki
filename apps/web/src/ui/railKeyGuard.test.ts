import { describe, expect, it } from "vitest";
import type { ClosestLike } from "../explorer/inputGuard.ts";
import { swallowBackgroundWalkKey, type WalkKeyEventLike } from "./railKeyGuard.ts";

interface Node { tag: string; role?: string; focusVisible?: boolean }

const matchesAny = (selector: string, n: Node): boolean =>
  selector.split(",").map((x) => x.trim()).some((s) => s === n.tag || (n.role !== undefined && s === `[role=${n.role}]`));

/** A fake target whose ancestor chain is `chain` (self first), mirroring the inputGuard tests. */
function fake(...chain: Node[]): ClosestLike {
  const wrap = (n: Node): ClosestLike => ({ matches: (s) => s === ":focus-visible" && n.focusVisible !== false });
  return { closest: (selector: string) => { const hit = chain.find((n) => matchesAny(selector, n)); return hit ? wrap(hit) : null; } };
}

function key(code: string, target: unknown) {
  const seen = { immediate: 0, propagation: 0 };
  const event: WalkKeyEventLike = {
    code,
    target,
    stopImmediatePropagation: () => { seen.immediate += 1; },
    stopPropagation: () => { seen.propagation += 1; },
  };
  return { event, seen, swallowed: () => swallowBackgroundWalkKey(event) };
}

describe("swallowBackgroundWalkKey", () => {
  it("swallows movement keys aimed at the page while the ride modal is open", () => {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      const k = key(code, fake({ tag: "body" }));
      expect(k.swallowed(), code).toBe(true);
      // Both stop calls: the explorer listener is on window, and the event must not reach the page.
      expect(k.seen.immediate, code).toBe(1);
      expect(k.seen.propagation, code).toBe(1);
    }
  });

  it("swallows Escape, which the explorer always treats as walking", () => {
    const k = key("Escape", fake({ tag: "body" }));
    expect(k.swallowed()).toBe(true);
    expect(k.seen.immediate).toBe(1);
  });

  it("leaves keys owned by a focused control alone, matching the explorer's own decision", () => {
    // A text field or a keyboard-focused button keeps its keys: Enter/Space must still press the
    // modal's buttons, and the explorer ignores these targets too.
    const inField = key("KeyW", fake({ tag: "input" }));
    expect(inField.swallowed()).toBe(false);
    expect(inField.seen.immediate).toBe(0);
    const onButton = key("Enter", fake({ tag: "button" }));
    expect(onButton.swallowed()).toBe(false);
    expect(onButton.seen.immediate).toBe(0);
  });

  it("swallows when there is no target, since nothing owns the key", () => {
    const k = key("KeyW", null);
    expect(k.swallowed()).toBe(true);
    expect(k.seen.immediate).toBe(1);
  });
});
