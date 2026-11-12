import { beforeEach, describe, expect, it, vi } from "vitest";
import { Explorer } from "./explorer.ts";
import { InteractionController } from "./interaction.ts";
import type { InteractableSpec } from "@gteki/scene-api";

// Keep catSound's pure helpers real; only the WebAudio tap is replaced.
vi.mock("./catSound.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catSound.ts")>();
  return { ...actual, playPawStep: vi.fn() };
});
import { playPawStep } from "./catSound.ts";

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
    pawCarriedM: 0,
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

describe("Explorer.stepPaws", () => {
  beforeEach(() => {
    vi.mocked(playPawStep).mockClear();
  });

  it("never steps for the human avatar", () => {
    const e = explorer({ catAvatar: false, mode: "walk", audio: { context: {}, master: {} } });
    e.stepPaws(0.1, 5);
    expect(playPawStep).not.toHaveBeenCalled();
  });

  it("does not step before the audio context exists", () => {
    const e = explorer({ audio: null, mode: "walk" });
    e.stepPaws(0.1, 5);
    expect(playPawStep).not.toHaveBeenCalled();
  });

  it("does not queue taps while the audio context is still suspended", () => {
    const e = explorer({ mode: "walk", audio: { context: { state: "suspended" }, master: {} } });
    e.stepPaws(0.1, 5);
    expect(playPawStep).not.toHaveBeenCalled();
  });

  it("taps the tile under the walking cat once a step is due", () => {
    const e = explorer({ mode: "walk", audio: { context: { state: "running" }, master: {} } });
    e.stepPaws(0.1, 5); // 0.5 m of travel: two steps due, one tap per frame
    expect(playPawStep).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playPawStep).mock.calls[0]![2]).toBe("tile");
    expect(e.pawCarriedM).toBeCloseTo(0);
  });

  it("does not tap before a step is due and carries the distance", () => {
    const e = explorer({ mode: "walk", audio: { context: { state: "running" }, master: {} } });
    e.stepPaws(0.1, 1); // 0.1 m of travel, under one paw step
    expect(playPawStep).not.toHaveBeenCalled();
    expect(e.pawCarriedM).toBeCloseTo(0.1);
  });
});
