// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { PanelFold } from "./panelFold.ts";

let root: HTMLElement, panel: HTMLElement, entry: HTMLButtonElement, input: HTMLInputElement;
let error: boolean, fold: PanelFold;
beforeEach(() => {
  document.body.innerHTML = '<main><section><input id="gteki-to"></section><button>Search</button></main>';
  root = document.querySelector('main')!;
  panel = root.querySelector('section')!;
  entry = root.querySelector('button')!;
  input = root.querySelector('input')!;
  error = false;
  fold = new PanelFold(root, panel, entry, () => error);
});
test('folds, expands and refolds on walking, unless focus is inside', () => {
  fold.fold(true);
  expect(root.dataset.panel).toBe('folded');
  expect(entry.getAttribute('aria-expanded')).toBe('false');
  expect(entry.getAttribute('aria-controls')).toBe(panel.id);
  entry.click();
  expect(root.dataset.panel).toBe('open');
  expect(document.activeElement).toBe(input);
  fold.fold(true);
  expect(root.dataset.panel).toBe('open');
  input.blur();
  fold.fold(true);
  expect(root.dataset.panel).toBe('folded');
});
test('Escape returns focus to the entry and scene errors prevent folding', () => {
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.dataset.panel).toBe('folded');
  expect(document.activeElement).toBe(entry);
  fold.open();
  error = true;
  fold.fold();
  expect(root.dataset.panel).toBe('open');
});
