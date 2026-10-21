import { describe, expect, it } from "vitest";
import { COMBO_CLOSED, applyAria, comboboxKeys, inputAria, listboxRole, normalizeCombo, optionAria, optionId, type ComboState } from "./combobox.ts";

const open = (count: number, active = -1): ComboState => ({ open: true, count, active });

describe("comboboxKeys", () => {
  it("ArrowDown moves to the next option and wraps", () => {
    expect(comboboxKeys(open(3), "ArrowDown").active).toBe(0);
    expect(comboboxKeys(open(3, 0), "ArrowDown").active).toBe(1);
    expect(comboboxKeys(open(3, 2), "ArrowDown").active).toBe(0);
  });

  it("ArrowUp moves to the previous option and wraps; from none it goes to the last", () => {
    expect(comboboxKeys(open(3, 2), "ArrowUp").active).toBe(1);
    expect(comboboxKeys(open(3, 0), "ArrowUp").active).toBe(2);
    expect(comboboxKeys(open(3), "ArrowUp").active).toBe(2);
  });

  it("arrows open a closed list that has options, and ignore an empty one", () => {
    expect(comboboxKeys({ open: false, count: 3, active: -1 }, "ArrowDown")).toMatchObject({ open: true, active: 0, handled: true });
    expect(comboboxKeys({ open: false, count: 3, active: -1 }, "ArrowUp")).toMatchObject({ open: true, active: 2 });
    expect(comboboxKeys(COMBO_CLOSED, "ArrowDown").handled).toBe(false);
    expect(comboboxKeys(open(0), "ArrowUp").handled).toBe(false);
  });

  it("Enter picks the active option, or the first when none is active, and closes", () => {
    expect(comboboxKeys(open(3, 2), "Enter")).toMatchObject({ pick: 2, open: false, active: -1, handled: true });
    expect(comboboxKeys(open(3), "Enter")).toMatchObject({ pick: 0, open: false, handled: true });
  });

  it("Enter does nothing when closed or empty (the browser's default stands)", () => {
    expect(comboboxKeys(COMBO_CLOSED, "Enter")).toMatchObject({ pick: null, handled: false });
    expect(comboboxKeys(open(0), "Enter")).toMatchObject({ pick: null, handled: false });
  });

  it("Escape closes the list and clears the active option; closed it is left alone", () => {
    expect(comboboxKeys(open(3, 1), "Escape")).toMatchObject({ open: false, active: -1, pick: null, handled: true });
    expect(comboboxKeys(COMBO_CLOSED, "Escape").handled).toBe(false);
  });

  it("leaves other keys (typing, Home/End cursor moves) alone", () => {
    for (const k of ["a", "Home", "End", "Tab", "ArrowLeft"]) expect(comboboxKeys(open(3, 1), k)).toMatchObject({ handled: false, active: 1, pick: null });
  });

  it("never mutates its input", () => {
    const s = open(3, 1);
    comboboxKeys(s, "ArrowDown");
    expect(s).toEqual(open(3, 1));
  });
});

describe("combobox ARIA attributes", () => {
  const list = "gteki-to-listbox";

  it("the input is a combobox owning the listbox, with the active option as its descendant", () => {
    expect(inputAria(open(3, 1), list)).toEqual({
      role: "combobox", "aria-autocomplete": "list", "aria-haspopup": "listbox", "aria-controls": list,
      "aria-expanded": "true", "aria-activedescendant": "gteki-to-listbox-opt-1",
    });
  });

  it("a closed list is not expanded and has no active descendant", () => {
    expect(inputAria(COMBO_CLOSED, list)).toMatchObject({ "aria-expanded": "false", "aria-activedescendant": null });
    expect(inputAria(open(3), list)["aria-activedescendant"]).toBeNull();
  });

  it("the empty-results message is a shown popup: expanded, nothing active", () => {
    expect(inputAria(open(0), list)).toMatchObject({ "aria-expanded": "true", "aria-activedescendant": null });
  });

  it("popup visibility and aria-expanded agree for every state", () => {
    for (const s of [COMBO_CLOSED, open(0), open(3), open(3, 1), { open: false, count: 3, active: 1 }]) {
      expect(inputAria(s, list)["aria-expanded"] === "true").toBe(listboxRole(s) === "listbox");
    }
  });

  it("closing (Escape) normalizes to the empty closed state, so the options are dropped", () => {
    const closed = normalizeCombo(comboboxKeys(open(3, 1), "Escape"));
    expect(closed).toEqual(COMBO_CLOSED);
    expect(normalizeCombo(open(3, 1))).toEqual(open(3, 1));
  });

  it("options have unique ids, role=option, aria-selected only on the active one, and carry their label", () => {
    const attrs = [0, 1, 2].map((i) => optionAria(open(3, 1), list, i, `Exit ${i}, Search only (entrance not verified)`));
    expect(new Set(attrs.map((a) => a.id)).size).toBe(3);
    expect(attrs.map((a) => a.role)).toEqual(["option", "option", "option"]);
    expect(attrs.map((a) => a["aria-selected"])).toEqual(["false", "true", "false"]);
    expect(attrs[2]!["aria-label"]).toContain("Search only");
    expect(attrs[1]!.id).toBe(optionId(list, 1));
  });

  it("applyAria sets values and removes null attributes", () => {
    const store = new Map<string, string>([["aria-activedescendant", "x"]]);
    const el = { setAttribute: (k: string, v: string) => store.set(k, v), removeAttribute: (k: string) => store.delete(k) } as unknown as Element;
    applyAria(el, { role: "combobox", "aria-activedescendant": null });
    expect([...store]).toEqual([["role", "combobox"]]);
  });
});
