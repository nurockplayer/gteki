import { describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { InteractionController } from "./interaction.ts";
import type { InteractableSpec } from "@gteki/scene-api";

const info: InteractableSpec = {
  id: "info", layer: "fictional", simulated: true, kind: "board",
  anchor: { x: 0, y: 0, z: 0 }, radiusM: 2, steps: [{ id: "look", seconds: 1 }],
};

/** Drive Explorer.interact() without a renderer, the way catFallback.test.ts drives its methods. */
function explorer(overrides: Record<string, unknown>): any {
  const e = Object.create(Explorer.prototype) as any;
  Object.assign(e, {
    interactionController: new InteractionController([]),
    interactionSnapshot: "",
    events: {},
    interactionVisual: null,
    catAvatar: true,
    avatarRig: { meow: () => true, setHold() {} },
    catMeowSound: null,
    audio: null,
    ensureAudio: () => true,
    ...overrides,
  });
  return e;
}

describe("Explorer.interact", () => {
  it("meows with its synth when the cat is not near a usable interactable", () => {
    const meow = vi.fn(() => true);
    const sound = vi.fn();
    const context = {}, master = {};
    const e = explorer({ avatarRig: { meow, setHold() {} }, catMeowSound: sound, audio: { context, master } });
    e.interact();
    expect(meow).toHaveBeenCalledTimes(1);
    expect(sound).toHaveBeenCalledWith(context, master);
  });

  it("lets a usable interactable win over the meow", () => {
    const meow = vi.fn(() => true);
    const sound = vi.fn();
    const controller = new InteractionController([info]);
    controller.update(0.1, { position: { x: 0, y: 0, z: 0 }, moving: false, mode: "walk" });
    expect(controller.state.nearId).toBe("info");
    const e = explorer({ interactionController: controller, avatarRig: { meow, setHold() {} }, catMeowSound: sound, audio: { context: {}, master: {} } });
    e.interact();
    expect(e.interactionController.state.phase).toBe("active");
    expect(meow).not.toHaveBeenCalled();
    expect(sound).not.toHaveBeenCalled();
  });

  it("never meows for the human avatar", () => {
    const meow = vi.fn(() => true);
    const sound = vi.fn();
    const e = explorer({ catAvatar: false, avatarRig: { meow, setHold() {} }, catMeowSound: sound, audio: { context: {}, master: {} } });
    e.interact();
    expect(meow).not.toHaveBeenCalled();
    expect(sound).not.toHaveBeenCalled();
  });

  it("sits only the cat riding an escalator in the guide", () => {
    const escalator = [{ fromS: 0, toS: 10, maxMps: 0.75, scales: true, mode: "escalator" as const }];
    const stairs = [{ fromS: 0, toS: 10, maxMps: 0.9, scales: true, mode: "stairs" as const }];
    const idle = { phase: "idle" as const, step: null };
    const ride = (overrides: Record<string, unknown>) => {
      const setHold = vi.fn();
      const e = explorer({ mode: "guide", avatarRig: { meow: () => true, setHold }, ...overrides });
      e.publishInteraction(idle);
      return setHold;
    };
    expect(ride({ guide: { s: 5, spans: escalator } })).toHaveBeenLastCalledWith("sit");
    expect(ride({ guide: { s: 5, spans: stairs } })).toHaveBeenLastCalledWith(null);
    expect(ride({ catAvatar: false, guide: { s: 5, spans: escalator } })).toHaveBeenLastCalledWith(null);
  });

  it("does not play the synth when the rig refuses a second meow", () => {
    const sound = vi.fn();
    const e = explorer({ avatarRig: { meow: () => false, setHold() {} }, catMeowSound: sound, audio: { context: {}, master: {} } });
    e.interact();
    expect(sound).not.toHaveBeenCalled();
  });
});
