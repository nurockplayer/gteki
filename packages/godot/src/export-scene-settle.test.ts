import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { StationScene } from "@gteki/scene-api";
import { settleScene } from "./export-scene.ts";

const scene = (settled?: () => Promise<void>) => ({ root: new THREE.Group(), dispose: () => {}, ...(settled ? { settled } : {}) }) as unknown as StationScene & { settled?: () => Promise<void> };

describe("settleScene (StationScene.settled before export)", () => {
  it("resolves at once for a station without settled()", async () => {
    await expect(settleScene(scene(), "test", 10)).resolves.toBeUndefined();
  });

  it("waits for the station's background loads", async () => {
    let done = false;
    await settleScene(scene(() => new Promise((ok) => setTimeout(() => { done = true; ok(); }, 5))), "test", 1_000);
    expect(done).toBe(true);
  });

  it("fails rather than exporting a partial scene when settled() never resolves in time", async () => {
    await expect(settleScene(scene(() => new Promise(() => {})), "ikebukuro", 20)).rejects.toThrow(/station ikebukuro: scene did not settle within 20 ms/);
  });

  it("passes a settled() rejection through", async () => {
    await expect(settleScene(scene(() => Promise.reject(new Error("catalog failed"))), "test", 1_000)).rejects.toThrow(/catalog failed/);
  });
});
