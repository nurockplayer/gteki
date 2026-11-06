import { describe, expect, it, vi } from "vitest";
import { createZoneAcoustics, ZONE_ACOUSTICS } from "./zone-acoustics.ts";

function audio() {
  const node = () => ({ connect: vi.fn(function (this: unknown, target: unknown) { return target; }), disconnect: vi.fn() });
  const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
  const input = { ...node(), gain: param() };
  const wet = { ...node(), gain: param() };
  const lowpass = { ...node(), type: "", frequency: param() };
  const convolver = { ...node(), buffer: null };
  const destination = node();
  const context = {
    currentTime: 4, sampleRate: 100,
    createGain: vi.fn().mockReturnValueOnce(input).mockReturnValueOnce(wet),
    createBiquadFilter: () => lowpass,
    createConvolver: () => convolver,
    createBuffer: () => ({ getChannelData: () => new Float32Array(140) }),
  } as unknown as AudioContext;
  return { context, input, wet, lowpass, convolver, destination };
}

describe("zone acoustics", () => {
  it("targets zone values and connects dry and convolved paths", () => {
    const a = audio();
    const acoustics = createZoneAcoustics(a.context, a.destination as unknown as AudioNode);
    expect(a.wet.gain.value).toBe(ZONE_ACOUSTICS.passage.wet);
    expect(a.lowpass.frequency.value).toBe(ZONE_ACOUSTICS.passage.wetLowpassHz);
    acoustics.setZone("outdoor");
    acoustics.setZone("platform");
    for (const zone of ["outdoor", "platform"] as const) {
      expect(a.wet.gain.setTargetAtTime).toHaveBeenCalledWith(ZONE_ACOUSTICS[zone].wet, 4, 1.2);
      expect(a.lowpass.frequency.setTargetAtTime).toHaveBeenCalledWith(ZONE_ACOUSTICS[zone].wetLowpassHz, 4, 1.2);
    }
    expect(a.input.connect).toHaveBeenCalledWith(a.destination);
    expect(a.input.connect).toHaveBeenCalledWith(a.lowpass);
    expect(a.lowpass.connect).toHaveBeenCalledWith(a.convolver);
    expect(a.convolver.connect).toHaveBeenCalledWith(a.wet);
    expect(a.wet.connect).toHaveBeenCalledWith(a.destination);
  });

  it("gives outdoor the least wet and passage the lowest lowpass", () => {
    for (const zone of ["concourse", "platform", "passage"] as const) expect(ZONE_ACOUSTICS.outdoor.wet).toBeLessThan(ZONE_ACOUSTICS[zone].wet);
    for (const zone of ["outdoor", "concourse", "platform"] as const) expect(ZONE_ACOUSTICS.passage.wetLowpassHz).toBeLessThan(ZONE_ACOUSTICS[zone].wetLowpassHz);
  });
});
