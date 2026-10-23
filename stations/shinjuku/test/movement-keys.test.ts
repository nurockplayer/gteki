import { describe, expect, it, vi } from "vitest";
import { installMovementKeys, ownsKeyboard, type KeyTargetLike, type MovementKeyEvent } from "../app/src/movement-keys.ts";

// The repo has no DOM test environment; these stand-ins expose the same members the
// handler reads from real elements (tagName, id, role, parentElement).
function el(tagName: string, parent: KeyTargetLike | null, attrs: Record<string, string> = {}): KeyTargetLike {
  return { tagName, id: attrs.id ?? "", parentElement: parent, getAttribute: (n) => attrs[n] ?? null };
}

function page(dialogOpen = false) {
  const body = el("BODY", null);
  const panel = el("SECTION", body, { id: "panel" });
  const input = el("INPUT", panel, { id: "to" });
  const results = el("UL", panel, { id: "results" });
  const row = el("LI", results, { role: "button" });
  const rowLabel = el("B", row);
  const listeners: Record<string, ((e: never) => void)[]> = {};
  const host = { addEventListener: (t: string, l: (e: never) => void) => (listeners[t] ??= []).push(l) };
  const hooks = { onEscape: vi.fn(), dialogOpen: () => dialogOpen, onShortcut: vi.fn() };
  const keys = installMovementKeys(host, hooks);
  // Window-level dispatch: the event arrives with the focused element as its target.
  const fire = (type: "keydown" | "keyup", target: KeyTargetLike, code: string, key = code) => {
    const e: MovementKeyEvent = { key, code, target, preventDefault: () => {} };
    for (const l of listeners[type] ?? []) l(e as never);
  };
  return { body, input, row, rowLabel, keys, hooks, fire };
}

describe("movement keys vs the search UI (#157)", () => {
  it("ignores ArrowDown/ArrowUp on the focused search input, but walks from the body", () => {
    const p = page();
    for (const code of ["ArrowDown", "ArrowUp"]) {
      p.fire("keydown", p.input, code);
      expect([...p.keys]).toEqual([]);
      p.fire("keydown", p.body, code);
      expect([...p.keys]).toEqual([code]);
      p.fire("keyup", p.body, code);
      expect(p.keys.size).toBe(0);
    }
  });

  it("ignores arrows on a focused result row li[role=button] and on its children", () => {
    const p = page();
    for (const code of ["ArrowDown", "ArrowUp", "KeyW"]) {
      p.fire("keydown", p.row, code);
      p.fire("keydown", p.rowLabel, code);
    }
    expect(p.keys.size).toBe(0);
    expect(p.hooks.onShortcut).not.toHaveBeenCalled();
  });

  it("keeps Escape working from the search box and result rows, without moving", () => {
    const p = page();
    p.fire("keydown", p.input, "Escape");
    p.fire("keydown", p.row, "Escape");
    expect(p.hooks.onEscape).toHaveBeenCalledTimes(2);
    expect(p.keys.size).toBe(0);
  });

  it("does not capture Enter or Space on the search UI, so the field and row handlers own them", () => {
    const p = page();
    p.fire("keydown", p.input, "Enter");
    p.fire("keydown", p.row, "Space", " ");
    expect(p.keys.size).toBe(0);
  });

  it("resumes movement once focus leaves the search UI", () => {
    const p = page();
    p.fire("keydown", p.input, "ArrowDown");
    expect(p.keys.size).toBe(0);
    p.fire("keydown", p.body, "ArrowDown");
    expect(p.keys.has("ArrowDown")).toBe(true);
  });

  it("runs one-shot shortcuts from the scene, and suspends movement under an open dialog", () => {
    const p = page();
    p.fire("keydown", p.body, "KeyG");
    expect(p.hooks.onShortcut).toHaveBeenCalledTimes(1);
    const d = page(true);
    d.fire("keydown", d.body, "ArrowUp");
    expect(d.keys.size).toBe(0);
  });

  it("classifies targets", () => {
    expect(ownsKeyboard(el("INPUT", null))).toBe(true);
    expect(ownsKeyboard(el("DIV", null, { contenteditable: "true" }))).toBe(true);
    expect(ownsKeyboard(el("CANVAS", el("BODY", null)))).toBe(false);
    expect(ownsKeyboard(null)).toBe(false);
    expect(ownsKeyboard({})).toBe(false); // window/document have no tagName
  });
});
