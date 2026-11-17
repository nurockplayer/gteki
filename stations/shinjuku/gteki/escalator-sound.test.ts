import { expect, it } from "vitest";
import { createEscalatorSound } from "./escalator-sound.ts";

it("places each panner at the closest point beside, before and past a run, and reports the nearest distance", () => {
  const param = () => ({ value: 0 });
  const node = () => ({ connect: (next: unknown) => next, disconnect() {}, start() {}, stop() {} });
  const panners: PannerNode[] = [];
  const context = {
    sampleRate: 100,
    createBuffer: () => ({ getChannelData: () => new Float32Array(400) }),
    createBufferSource: node,
    createOscillator: () => ({ ...node(), frequency: param() }),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), frequency: param(), Q: param() }),
    createPanner: () => {
      const panner = { ...node(), positionX: param(), positionY: param(), positionZ: param() } as unknown as PannerNode;
      panners.push(panner); return panner;
    },
  } as unknown as AudioContext;
  const sound = createEscalatorSound({ context, destination: {} as AudioNode, runs: [
    { a: { x: 0, y: 0, z: 0 }, b: { x: 10, y: 5, z: -10 } },
    { a: { x: 100, y: 0, z: 0 }, b: { x: 110, y: 5, z: -10 } },
  ] });
  const at = () => ({ x: panners[0]!.positionX.value, y: panners[0]!.positionY.value, z: panners[0]!.positionZ.value });
  sound.update({ x: 6, y: 2.5, z: -4 });
  expect(at()).toEqual({ x: 5, y: 2.5, z: -5 });
  expect(sound.info().nearestDistance).toBeCloseTo(Math.sqrt(2));
  sound.update({ x: -2, y: -1, z: 2 });
  expect(at()).toEqual({ x: 0, y: 0, z: 0 });
  expect(sound.info().nearestDistance).toBe(3);
  sound.update({ x: 12, y: 6, z: -12 });
  expect(at()).toEqual({ x: 10, y: 5, z: -10 });
  expect(sound.info()).toEqual({ gain: 0.06, nearestDistance: 3, runs: 2 });
  sound.dispose();
});
