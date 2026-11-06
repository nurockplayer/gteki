export class PanelFold {
  constructor(private root: HTMLElement, private panel: HTMLElement, private entry: HTMLButtonElement, private sceneError: () => boolean) {
    panel.id = "search-panel";
    entry.setAttribute("aria-controls", panel.id);
    entry.addEventListener("click", () => this.open(true));
    panel.addEventListener("keydown", (e) => {
      // An open suggestion list or an IME composition takes this Escape; the next one folds the panel (#903).
      if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.stopPropagation();
        this.fold(false, true);
      }
    });
    this.open();
  }

  open(focus = false): void {
    this.root.dataset.panel = "open";
    this.entry.setAttribute("aria-expanded", "true");
    if (focus) (this.panel.querySelector<HTMLElement>("#gteki-to") ?? this.panel.querySelector<HTMLElement>("input, select, textarea"))?.focus();
  }

  fold(guardFocus = false, focusEntry = false): void {
    if (this.sceneError() || (guardFocus && this.panel.contains(document.activeElement))) return;
    this.root.dataset.panel = "folded";
    this.entry.setAttribute("aria-expanded", "false");
    if (focusEntry) this.entry.focus();
  }
}
