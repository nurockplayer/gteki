/** Elements that always own the keyboard: movement keys pressed while one has focus are theirs, not the avatar's. */
export const KEY_OWNER_SELECTOR = "input, textarea, select, [role=option], [role=listbox], [contenteditable]";
/** Buttons own it only when keyboard-focused: a mouse click leaves focus on the button, and WASD must still walk after it. */
export const BUTTON_SELECTOR = "button, [role=button]";

/** The slice of an Element the guard needs (fakes are fine in tests). */
export interface ClosestLike {
  closest?: (selector: string) => unknown;
  matches?: (selector: string) => boolean;
}

/** True when `target` is, or sits inside, an element that owns the keyboard. */
export function isKeyOwner(target: ClosestLike | null | undefined): boolean {
  if (!target?.closest) return false;
  if (target.closest(KEY_OWNER_SELECTOR)) return true;
  const button = target.closest(BUTTON_SELECTOR) as ClosestLike | null | undefined;
  // Without :focus-visible support assume keyboard focus (the safe side for a button).
  return Boolean(button) && (button?.matches?.(":focus-visible") ?? true);
}

/** Whether a key press is walking input: Escape always is, anything else only outside key-owning elements. */
export function takesWalkKey(target: ClosestLike | null | undefined, code: string): boolean {
  return code === "Escape" || !isKeyOwner(target);
}
