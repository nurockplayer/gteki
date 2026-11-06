import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Input } from "./input.ts";

type Listener = (event: never) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) { listeners.get(type)?.delete(fn); },
    dispatch(type: string, event: object) {
      for (const fn of [...(listeners.get(type) ?? [])]) (fn as (e: object) => void)(event);
    },
  };
}

const pointer = (type: string, x: number, y: number, pointerType = "mouse") => ({ type, pointerId: 1, pointerType, clientX: x, clientY: y });

describe("Input tap", () => {
  let surface: ReturnType<typeof fakeTarget> & { getBoundingClientRect: () => { left: number; top: number; width: number; height: number }; setPointerCapture: () => void };
  let input: Input;
  let clock = 0;

  beforeEach(() => {
    clock = 0;
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal("window", fakeTarget());
    vi.stubGlobal("document", {
      createElement: () => ({ className: "", style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
    });
    surface = Object.assign(fakeTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture() {},
    });
    input = new Input(surface as unknown as HTMLElement, { appendChild() {} } as unknown as HTMLElement);
    input.enabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("counts a short still pointerup once, then clears it", () => {
    clock = 1000;
    surface.dispatch("pointerdown", pointer("pointerdown", 100, 120));
    clock = 1100;
    surface.dispatch("pointerup", pointer("pointerup", 100, 120));
    expect(input.consumeTap()).toEqual({ x: 100, y: 120 });
    expect(input.consumeTap()).toBeNull();
  });

  it("keeps a look drag a drag, not a tap", () => {
    clock = 1000;
    surface.dispatch("pointerdown", pointer("pointerdown", 100, 100));
    clock = 1050;
    surface.dispatch("pointermove", pointer("pointermove", 120, 100));
    surface.dispatch("pointerup", pointer("pointerup", 120, 100));
    expect(input.consumeLook().dx).toBe(20);
    expect(input.consumeTap()).toBeNull();
  });

  it("ignores a long press and a pointercancel", () => {
    clock = 1000;
    surface.dispatch("pointerdown", pointer("pointerdown", 100, 100));
    clock = 1500;
    surface.dispatch("pointerup", pointer("pointerup", 100, 100));
    expect(input.consumeTap()).toBeNull();
    clock = 2000;
    surface.dispatch("pointerdown", pointer("pointerdown", 100, 100));
    clock = 2010;
    surface.dispatch("pointercancel", pointer("pointercancel", 100, 100));
    expect(input.consumeTap()).toBeNull();
  });

  it("never taps from the joystick side", () => {
    surface.dispatch("pointerdown", pointer("pointerdown", 100, 400, "touch"));
    surface.dispatch("pointerup", pointer("pointerup", 100, 400, "touch"));
    expect(input.consumeTap()).toBeNull();
  });
});
