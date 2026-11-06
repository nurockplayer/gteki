import type { InteractionState } from "../explorer/interaction.ts";
import type { Strings } from "../i18n.ts";

export class InteractionPrompt {
  readonly el = document.createElement("div");
  readonly button = document.createElement("button");
  private readonly status = document.createElement("div");
  private readonly item = document.createElement("div");
  private lastAnnouncement = "";
  private state: InteractionState = { nearId: null, nearKind: null, phase: "idle", step: null, unavailable: null, items: [], interrupted: false };

  constructor(private readonly strings: () => Strings, start: () => void, private readonly announce: (text: string) => void) {
    this.el.className = "interaction-prompt";
    this.button.type = "button";
    this.button.addEventListener("click", start);
    this.el.append(this.button, this.status, this.item);
    this.render(this.state);
  }

  render(state: InteractionState): void {
    this.state = state;
    const t = this.strings();
    const visible = Boolean(state.nearId || state.phase === "active");
    this.el.hidden = !visible && state.items.length === 0 && !state.interrupted;
    this.button.hidden = !state.nearId || state.phase === "active";
    this.button.disabled = state.unavailable !== null;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    this.button.textContent = state.unavailable ? t.interactionReceived : coarse ? t.interactionStart : `${t.interactionStart} (E)`;
    const simulated = state.nearKind === "vending" ? t.interactionSimulatedVending : t.interactionSimulated;
    this.status.textContent = visible ? simulated : state.interrupted ? t.interactionInterrupted : "";
    if (visible && state.interrupted) this.status.textContent += ` · ${t.interactionInterrupted}`;
    const hasBag = state.items.includes("paper-bag");
    this.item.textContent = hasBag ? t.interactionBag : "";
    // Only the shop hands out the paper bag; a vending interaction ends with nothing held.
    const announcement = state.interrupted ? t.interactionInterrupted : state.phase === "done" && hasBag ? t.interactionBag : "";
    if (announcement && announcement !== this.lastAnnouncement) this.announce(announcement);
    this.lastAnnouncement = announcement;
  }

  refresh(): void { this.render(this.state); }
}
