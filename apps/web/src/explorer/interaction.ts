import type { InteractableSpec } from "@gteki/scene-api";

export interface InteractionState {
  nearId: string | null;
  /** The kind of the interactable in reach ("shop", "vending"), so the prompt can name it. */
  nearKind: string | null;
  phase: "idle" | "active" | "done";
  step: string | null;
  unavailable: "already-done" | null;
  items: string[];
  interrupted: boolean;
}

/** Session-only state, independent of the particular kind of interactable. */
export class InteractionController {
  private readonly completed = new Set<string>();
  private readonly items: string[] = [];
  private near: InteractableSpec | undefined;
  private active: InteractableSpec | undefined;
  private index = 0;
  private elapsed = 0;
  private phase: InteractionState["phase"] = "idle";
  private interrupted = false;

  constructor(private readonly specs: InteractableSpec[]) {}

  get state(): InteractionState {
    return {
      nearId: this.near?.id ?? null,
      nearKind: this.near?.kind ?? null,
      phase: this.phase,
      step: this.active?.steps[this.index]?.id ?? null,
      unavailable: this.near?.once && this.completed.has(this.near.id) ? "already-done" : null,
      items: [...this.items],
      interrupted: this.interrupted,
    };
  }

  start(): InteractionState {
    if (!this.near || this.active || (this.near.once && this.completed.has(this.near.id))) return this.state;
    this.active = this.near;
    this.index = 0;
    this.elapsed = 0;
    this.phase = "active";
    this.interrupted = false;
    return this.state;
  }

  update(dt: number, input: { position: { x: number; y: number; z: number }; moving: boolean; mode: string }): InteractionState {
    this.near = input.mode === "walk" ? this.specs.find((spec) =>
      Math.hypot(spec.anchor.x - input.position.x, spec.anchor.y - input.position.y, spec.anchor.z - input.position.z) <= spec.radiusM,
    ) : undefined;
    if (this.active && (input.moving || input.mode !== "walk")) {
      this.active = undefined;
      this.phase = "idle";
      this.interrupted = true;
    } else if (this.active) {
      this.elapsed += Math.max(0, dt);
      while (this.active && this.elapsed >= (this.active.steps[this.index]?.seconds ?? 0)) {
        this.elapsed -= this.active.steps[this.index]?.seconds ?? 0;
        this.index++;
        if (this.index >= this.active.steps.length) {
          this.completed.add(this.active.id);
          if (this.active.reward) this.items.push(this.active.reward);
          this.active = undefined;
          this.phase = "done";
        }
      }
    }
    if (!this.near && !this.active && this.phase === "done") this.phase = "idle";
    return this.state;
  }
}
