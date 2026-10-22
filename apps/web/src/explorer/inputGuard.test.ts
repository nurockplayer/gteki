import { describe, expect, it } from "vitest";
import { BUTTON_SELECTOR, KEY_OWNER_SELECTOR, isKeyOwner, takesWalkKey, type ClosestLike } from "./inputGuard.ts";

interface Node { tag: string; role?: string; editable?: boolean; focusVisible?: boolean }

const matchesAny = (selector: string, n: Node): boolean =>
  selector.split(",").map((x) => x.trim()).some((s) => s === n.tag || (n.role !== undefined && s === `[role=${n.role}]`) || (s === "[contenteditable]" && n.editable === true));

/** A fake target whose ancestor chain is `chain` (self first); `closest` walks it like the DOM does. */
function fake(...chain: Node[]): ClosestLike {
  const wrap = (n: Node): ClosestLike => ({ matches: (s) => (s === ":focus-visible" ? n.focusVisible !== false : false) });
  return { closest: (selector: string) => { const hit = chain.find((n) => matchesAny(selector, n)); return hit ? wrap(hit) : null; } };
}

describe("isKeyOwner", () => {
  it("is true for form controls, options, listboxes and editable content", () => {
    for (const tag of ["input", "textarea", "select"]) expect(isKeyOwner(fake({ tag }))).toBe(true);
    for (const role of ["option", "listbox"]) expect(isKeyOwner(fake({ tag: "div", role }))).toBe(true);
    expect(isKeyOwner(fake({ tag: "div", editable: true }))).toBe(true);
  });

  it("is true for a keyboard-focused button, also through a child inside it", () => {
    expect(isKeyOwner(fake({ tag: "button" }))).toBe(true);
    expect(isKeyOwner(fake({ tag: "div", role: "button" }))).toBe(true);
    expect(isKeyOwner(fake({ tag: "span" }, { tag: "button" }))).toBe(true);
  });

  it("is false for a mouse-focused button, so WASD still walks after a click on the HUD", () => {
    expect(isKeyOwner(fake({ tag: "button", focusVisible: false }))).toBe(false);
  });

  it("is false for the canvas, the body and missing targets", () => {
    expect(isKeyOwner(fake({ tag: "canvas" }))).toBe(false);
    expect(isKeyOwner(fake({ tag: "body" }))).toBe(false);
    expect(isKeyOwner(null)).toBe(false);
    expect(isKeyOwner({})).toBe(false);
  });

  it("a button without :focus-visible support counts as an owner", () => {
    const t: ClosestLike = { closest: (s) => (s === BUTTON_SELECTOR ? {} : null) };
    expect(isKeyOwner(t)).toBe(true);
  });

  it("selectors cover the required set", () => {
    const all = `${KEY_OWNER_SELECTOR}, ${BUTTON_SELECTOR}`;
    for (const s of ["input", "textarea", "select", "button", "[role=button]", "[role=option]", "[role=listbox]", "[contenteditable]"]) expect(all).toContain(s);
  });
});

describe("takesWalkKey", () => {
  const button = fake({ tag: "button" });
  const canvas = fake({ tag: "canvas" });

  it("movement keys walk only outside key-owning elements", () => {
    for (const code of ["KeyW", "ArrowUp", "ShiftLeft"]) {
      expect(takesWalkKey(canvas, code)).toBe(true);
      expect(takesWalkKey(button, code)).toBe(false);
      expect(takesWalkKey(fake({ tag: "div", role: "option" }), code)).toBe(false);
    }
  });

  it("Escape works from anywhere", () => {
    expect(takesWalkKey(button, "Escape")).toBe(true);
    expect(takesWalkKey(fake({ tag: "input" }), "Escape")).toBe(true);
  });
});
