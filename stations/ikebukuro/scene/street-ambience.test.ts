import { describe, expect, it, vi } from "vitest";
import { createStreetAmbience, streetLevel } from "./street-ambience.ts";

function audio() {
  const node = () => ({ connect: vi.fn(function (this: unknown, target: unknown) { return target; }), disconnect: vi.fn() });
  const param = () => ({
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const master = { ...node(), gain: param() };
  const bedGain = { ...node(), gain: param() };
  const lfoGain = { ...node(), gain: param() };
  const toneBus = { ...node(), gain: param() };
  const bed = { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn() };
  const lfo = { ...node(), type: "", frequency: param(), start: vi.fn(), stop: vi.fn() };
  const bedLp = { ...node(), type: "", frequency: param() };
  const destination = node();
  const context = {
    currentTime: 4, sampleRate: 100,
    createGain: vi.fn()
      .mockReturnValueOnce(master).mockReturnValueOnce(bedGain).mockReturnValueOnce(lfoGain).mockReturnValueOnce(toneBus),
    createBufferSource: () => bed,
    createBiquadFilter: () => bedLp,
    createOscillator: () => lfo,
    createBuffer: () => ({ getChannelData: () => new Float32Array(600) }),
  } as unknown as AudioContext;
  return { context, master, bed, lfo, destination };
}

describe("street ambience", () => {
  it("maps zones to street level", () => {
    expect(streetLevel("outdoor")).toBe(1);
    expect(streetLevel("concourse")).toBe(0.12);
    expect(streetLevel("platform")).toBe(0);
    expect(streetLevel("passage")).toBe(0);
  });

  it("starts silent and fades the master to the zone level", () => {
    const a = audio();
    const street = createStreetAmbience(a.context, a.destination as unknown as AudioNode);
    expect(a.master.gain.value).toBe(0);
    street.setZone("outdoor");
    street.setZone("passage");
    expect(a.master.gain.setTargetAtTime).toHaveBeenCalledWith(1, 4, 1.5);
    expect(a.master.gain.setTargetAtTime).toHaveBeenCalledWith(0, 4, 1.5);
    expect(a.master.connect).toHaveBeenCalledWith(a.destination);
  });
});
