export class PanelFold {
  constructor(private root: HTMLElement, private panel: HTMLElement, private entry: HTMLButtonElement, private sceneError: () => boolean) {
    panel.id = "search-panel";
    entry.setAttribute("aria-controls", panel.id);
    entry.addEventListener("click", () => this.open(true));
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
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
    if (focus) this.panel.querySelector<HTMLElement>("#gteki-to, input, select, textarea")?.focus();
  }

  fold(guardFocus = false, focusEntry = false): void {
    if (this.sceneError() || (guardFocus && this.panel.contains(document.activeElement))) return;
    this.root.dataset.panel = "folded";
    this.entry.setAttribute("aria-expanded", "false");
    if (focusEntry) this.entry.focus();
  }
}
