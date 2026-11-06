// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { strings } from "../i18n.ts";
import { InteractionPrompt } from "./interactionPrompt.ts";

it("shows the simulation, starts from its button, and reports the held item and unavailable state", () => {
  const start = vi.fn(), announce = vi.fn();
  const prompt = new InteractionPrompt(() => strings("en"), start, announce);
  const state = { nearId: "shop", phase: "idle" as const, step: null, unavailable: null, items: [], interrupted: false };
  prompt.render(state);
  expect(prompt.el.textContent).toContain("Simulated shop (not a real store)");
  prompt.button.click();
  expect(start).toHaveBeenCalledOnce();
  prompt.render({ ...state, phase: "done", unavailable: "already-done", items: ["paper-bag"] });
  expect(prompt.button.disabled).toBe(true);
  expect(prompt.el.textContent).toContain("Already received");
  expect(prompt.el.textContent).toContain("Held: paper bag");
  expect(announce).toHaveBeenCalled();
});

it("shows the keyboard hint only without a touch pointer", () => {
  const state = { nearId: "shop", phase: "idle" as const, step: null, unavailable: null, items: [], interrupted: false };
  const prompt = new InteractionPrompt(() => strings("en"), () => {}, () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
  prompt.render(state);
  expect(prompt.button.textContent).toBe("Look inside");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  prompt.render(state);
  expect(prompt.button.textContent).toBe("Look inside (E)");
  vi.unstubAllGlobals();
});
