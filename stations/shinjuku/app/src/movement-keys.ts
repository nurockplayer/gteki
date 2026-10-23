/**
 * Keyboard capture for the walk controls, kept free of three.js and the page so it can be unit tested.
 *
 * Arrow keys, WASD and the one-letter shortcuts are movement input only while focus is on the
 * scene. Anything that owns the keyboard itself (the search inputs, the focusable result rows
 * `li[role=button]`, buttons, selects, editable text) must not feed the movement `keys` set, or
 * the avatar walks while the user is navigating search results (#157).
 */

/** The slice of an Element this module reads, so tests need no DOM library. */
export interface KeyTargetLike {
  tagName?: string;
  id?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  parentElement?: KeyTargetLike | null;
}

const OWNS_KEYBOARD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"]);
const OWNS_KEYBOARD_ROLES = new Set(["button", "option", "listbox", "textbox", "combobox", "searchbox"]);
/** The search result list; its rows (and any future row markup) are search UI. */
const SEARCH_RESULTS_ID = "results";

/** True when `target`, or an ancestor, is a widget that handles its own keys. */
export function ownsKeyboard(target: unknown): boolean {
  for (let el = target as KeyTargetLike | null | undefined; el && el.tagName; el = el.parentElement) {
    if (OWNS_KEYBOARD_TAGS.has(el.tagName.toUpperCase())) return true;
    if (el.isContentEditable || el.getAttribute?.("contenteditable") === "true") return true;
    if (el.id === SEARCH_RESULTS_ID) return true;
    const role = el.getAttribute?.("role");
    if (role && OWNS_KEYBOARD_ROLES.has(role)) return true;
  }
  return false;
}

export interface MovementKeyEvent {
  key: string;
  code: string;
  target: EventTarget | KeyTargetLike | null;
  preventDefault(): void;
}

export interface MovementKeyHooks {
  /** Escape always runs, wherever focus is, so the panel can be dismissed from the search box. */
  onEscape(): void;
  /** True while a modal dialog is open; movement and shortcuts are suspended. */
  dialogOpen(): boolean;
  /** Called after the key entered `keys`, for the one-shot shortcuts (Slash, V, G, M, E). */
  onShortcut(e: MovementKeyEvent): void;
}

export interface KeyListenerHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts Window and test hosts alike
  addEventListener(type: string, listener: (e: any) => void): void;
}

/** Wires keydown/keyup/blur on `host` and returns the live set of held `KeyboardEvent.code`s. */
export function installMovementKeys(host: KeyListenerHost, hooks: MovementKeyHooks): Set<string> {
  const keys = new Set<string>();
  host.addEventListener("keydown", (e: MovementKeyEvent) => {
    if (e.key === "Escape") hooks.onEscape();
    if (ownsKeyboard(e.target) || hooks.dialogOpen()) return;
    keys.add(e.code);
    hooks.onShortcut(e);
  });
  host.addEventListener("keyup", (e: { code: string }) => { keys.delete(e.code); });
  host.addEventListener("blur", () => keys.clear());
  return keys;
}
