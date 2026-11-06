import { describe, expect, it } from "vitest";
import type { InteractableSpec } from "@gteki/scene-api";
import { InteractionController } from "./interaction.ts";

const anchor = { x: 0, y: 0, z: 0 };
const fixtures: InteractableSpec[] = [
  { id: "shop", layer: "fictional", simulated: true, kind: "shop", anchor, radiusM: 2, steps: [{ id: "look", seconds: 1 }, { id: "give", seconds: 1 }], reward: "bag", once: true },
  { id: "machine", layer: "fictional", simulated: true, kind: "vending", anchor: { x: 10, y: 0, z: 0 }, radiusM: 1, steps: [{ id: "choose", seconds: 0.5 }, { id: "dispense", seconds: 0.5 }], reward: "can" },
];
const input = (position = anchor, moving = false, mode = "walk") => ({ position, moving, mode });

describe("InteractionController", () => {
  it("runs steps, grants once, and hides prompts outside walk mode", () => {
    const controller = new InteractionController(fixtures);
    expect(controller.update(0, input()).nearId).toBe("shop");
    expect(controller.update(0, input()).nearKind).toBe("shop");
    expect(controller.start().step).toBe("look");
    expect(controller.update(1, input()).step).toBe("give");
    expect(controller.update(1, input())).toMatchObject({ phase: "done", items: ["bag"], unavailable: "already-done" });
    expect(controller.start().phase).toBe("done");
    expect(controller.update(0, input(anchor, false, "overview")).nearId).toBeNull();
    expect(controller.update(0, input(anchor, false, "overview")).nearKind).toBeNull();
  });

  it("cancels on movement and supports another kind with its own steps", () => {
    const controller = new InteractionController(fixtures);
    controller.update(0, input());
    controller.start();
    expect(controller.update(0.5, input(anchor, true))).toMatchObject({ phase: "idle", interrupted: true, items: [] });
    expect(controller.update(0, input({ x: 10, y: 0, z: 0 })).nearKind).toBe("vending");
    expect(controller.start().step).toBe("choose");
    expect(controller.update(1, input({ x: 10, y: 0, z: 0 }))).toMatchObject({ phase: "done", items: ["can"] });
  });
});
