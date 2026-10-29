import { isKeyOwner, takesWalkKey } from "./inputGuard.ts";

/**
 * Desktop + phone input for walking: WASD/arrows (+Shift to run), drag to look, wheel to zoom;
 * on touch a left-thumb virtual joystick and right-side drag-to-look.
 */
export class Input {
  enabled = false;
  private readonly keys = new Set<string>();
  /** Keys held by deterministic test simulation (QA hooks), merged with real keys. */
  readonly virtualKeys = new Set<string>();
  private look = { dx: 0, dy: 0, zoom: 0 };
  private drag: { id: number; x: number; y: number } | null = null;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private readonly stickEl: HTMLDivElement;
  private readonly knobEl: HTMLDivElement;
  private readonly off: (() => void)[] = [];

  constructor(private readonly surface: HTMLElement, host: HTMLElement) {
    this.stickEl = document.createElement("div");
    this.stickEl.className = "joystick";
    this.knobEl = document.createElement("div");
    this.knobEl.className = "joystick-knob";
    this.stickEl.appendChild(this.knobEl);
    host.appendChild(this.stickEl);

    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      if (!takesWalkKey(e.target as HTMLElement | null, e.code)) return;
      this.keys.add(e.code);
    });
    // Focus moving into a key-owning element (Tab to a button, say) must not leave a held key stuck.
    on(window, "focusin", (e: FocusEvent) => { if (isKeyOwner(e.target as HTMLElement | null)) this.keys.clear(); });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());
    on(surface, "pointerdown", (e: PointerEvent) => {
      if (!this.enabled) return;
      const rect = surface.getBoundingClientRect();
      if (e.pointerType === "touch" && e.clientX - rect.left < rect.width * 0.45 && !this.stick) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
        this.stickEl.style.left = `${e.clientX - rect.left}px`;
        this.stickEl.style.top = `${e.clientY - rect.top}px`;
        this.stickEl.classList.add("active");
      } else if (!this.drag) {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
      surface.setPointerCapture(e.pointerId);
    });
    on(surface, "pointermove", (e: PointerEvent) => {
      if (this.stick?.id === e.pointerId) {
        this.stick.x = e.clientX;
        this.stick.y = e.clientY;
        const v = this.stickVector();
        this.knobEl.style.transform = `translate(${v.x * 36}px, ${-v.y * 36}px)`;
      } else if (this.drag?.id === e.pointerId) {
        this.look.dx += e.clientX - this.drag.x;
        this.look.dy += e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.stick?.id === e.pointerId) {
        this.stick = null;
        this.stickEl.classList.remove("active");
        this.knobEl.style.transform = "";
      }
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    on(surface, "pointerup", end);
    on(surface, "pointercancel", end);
    on(surface, "wheel", (e: WheelEvent) => { if (this.enabled) { this.look.zoom += e.deltaY; e.preventDefault(); } }, { passive: false });
  }

  private stickVector(): { x: number; y: number } {
    if (!this.stick) return { x: 0, y: 0 };
    const dx = (this.stick.x - this.stick.ox) / 48;
    const dy = (this.stick.oy - this.stick.y) / 48;
    const m = Math.hypot(dx, dy);
    if (m < 0.12) return { x: 0, y: 0 };
    return m > 1 ? { x: dx / m, y: dy / m } : { x: dx, y: dy };
  }

  /** Movement intent: x = strafe right, y = forward, both in [-1, 1]. */
  move(): { x: number; y: number; run: boolean } {
    if (!this.enabled) return { x: 0, y: 0, run: false };
    const k = new Set([...this.keys, ...this.virtualKeys]);
    let x = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let y = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const s = this.stickVector();
    if (s.x || s.y) { x = s.x; y = s.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || Math.hypot(s.x, s.y) > 0.95;
    return { x, y, run };
  }

  consumeLook(): { dx: number; dy: number; zoom: number } {
    const l = this.look;
    this.look = { dx: 0, dy: 0, zoom: 0 };
    return this.enabled ? l : { dx: 0, dy: 0, zoom: 0 };
  }

  dispose(): void {
    for (const f of this.off) f();
    this.stickEl.remove();
  }
}
