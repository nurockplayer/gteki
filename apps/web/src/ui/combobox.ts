/** WAI-ARIA APG "combobox with listbox popup": the pure key model and the ARIA attributes it implies. */

export interface ComboState {
  /** The listbox is showing options. */
  open: boolean;
  /** Number of options in it. */
  count: number;
  /** Index of the active (aria-activedescendant) option, -1 for none. */
  active: number;
}

export interface ComboOutcome extends ComboState {
  /** Option index to pick (Enter), else null. */
  pick: number | null;
  /** The key was used here: the caller prevents its default. */
  handled: boolean;
}

export const COMBO_CLOSED: ComboState = { open: false, count: 0, active: -1 };

/** New state for a key press: Down/Up move the active option (wrapping), Enter picks it (the first when none), Escape closes. */
export function comboboxKeys(state: ComboState, key: string): ComboOutcome {
  const out = (patch: Partial<ComboState>, pick: number | null = null, handled = true): ComboOutcome => ({ ...state, ...patch, pick, handled });
  const { open, count, active } = state;
  switch (key) {
    case "ArrowDown":
      if (count === 0) return out({}, null, false);
      return out({ open: true, active: open ? (active + 1) % count : 0 });
    case "ArrowUp":
      if (count === 0) return out({}, null, false);
      return out({ open: true, active: open && active > 0 ? active - 1 : count - 1 });
    case "Enter":
      if (!open || count === 0) return out({}, null, false);
      return out({ open: false, active: -1 }, active >= 0 && active < count ? active : 0);
    case "Escape":
      if (!open) return out({}, null, false);
      return out({ open: false, active: -1 });
    default:
      return out({}, null, false);
  }
}

/** Safari fires the Enter that confirms a conversion just after compositionend. */
export const IME_ENTER_GRACE_MS = 50;

export interface KeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * A keydown that belongs to an IME, not to the combobox: composing, the legacy keyCode 229 (Safari reports
 * isComposing false for the confirming Enter), or an Enter within a few ms of compositionend. `anyKey`
 * extends that grace to every key: after the key that confirms a conversion, Safari can dispatch a second
 * keydown for the same character, which is not a shortcut (guide keys).
 */
export function isImeKeydown(e: KeyLike, lastCompositionEndMs: number, nowMs: number, anyKey = false): boolean {
  if (e.isComposing || e.keyCode === 229) return true;
  const since = nowMs - lastCompositionEndMs;
  return (anyKey || e.key === "Enter") && since >= 0 && since < IME_ENTER_GRACE_MS;
}

export type AriaAttrs = Record<string, string | null>;

/** Id of option `i` of the listbox `listId`. */
export const optionId = (listId: string, i: number): string => `${listId}-opt-${i}`;

/** A closed list holds nothing: any closed state is COMBO_CLOSED. */
export function normalizeCombo(state: ComboState): ComboState {
  return state.open ? { open: true, count: state.count, active: state.active } : COMBO_CLOSED;
}

/**
 * The single source of truth for the popup: it is visible (the box holds options or the empty message,
 * and has the listbox role) exactly when `open`, and aria-expanded mirrors it.
 */
export function listboxRole(state: ComboState): string | null {
  return state.open ? "listbox" : null;
}

/** Attributes for the input (null removes the attribute). */
export function inputAria(state: ComboState, listId: string): AriaAttrs {
  const shown = state.open;
  return {
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-haspopup": "listbox",
    "aria-controls": listId,
    "aria-expanded": String(shown),
    "aria-activedescendant": shown && state.active >= 0 && state.active < state.count ? optionId(listId, state.active) : null,
  };
}

/** Attributes for option `i`; `label` is its accessible name, carrying the visible tags. */
export function optionAria(state: ComboState, listId: string, i: number, label: string): AriaAttrs {
  return { id: optionId(listId, i), role: "option", "aria-selected": String(i === state.active), "aria-label": label, tabindex: "-1" };
}

export function applyAria(el: Element, attrs: AriaAttrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null) el.removeAttribute(k);
    else el.setAttribute(k, v);
  }
}
