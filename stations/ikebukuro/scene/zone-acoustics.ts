import type { AcousticZone } from "@gteki/scene-api";

// Art direction, not measured.
export const ZONE_ACOUSTICS: Record<AcousticZone, { wet: number; wetLowpassHz: number; openness: number }> = {
  outdoor: { wet: 0.02, wetLowpassHz: 6000, openness: 1 },
  concourse: { wet: 0.22, wetLowpassHz: 5000, openness: 0.9 },
  platform: { wet: 0.3, wetLowpassHz: 3500, openness: 0.8 },
  passage: { wet: 0.28, wetLowpassHz: 2500, openness: 0.4 },
};

export function createZoneAcoustics(context: AudioContext, destination: AudioNode) {
  const input = context.createGain();
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  const convolver = context.createConvolver();
  const wet = context.createGain();
  const length = Math.floor(context.sampleRate * 1.4);
  const impulse = context.createBuffer(1, length, context.sampleRate);
  const samples = impulse.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    samples[i] = (seed / 4294967296 * 2 - 1) * Math.exp(-6 * i / length);
  }
  convolver.buffer = impulse;
  wet.gain.value = ZONE_ACOUSTICS.passage.wet;
  lowpass.frequency.value = ZONE_ACOUSTICS.passage.wetLowpassHz;
  input.connect(destination);
  input.connect(lowpass).connect(convolver).connect(wet).connect(destination);
  return {
    input,
    setZone(zone: AcousticZone) {
      wet.gain.setTargetAtTime(ZONE_ACOUSTICS[zone].wet, context.currentTime, 1.2);
      lowpass.frequency.setTargetAtTime(ZONE_ACOUSTICS[zone].wetLowpassHz, context.currentTime, 1.2);
    },
    dispose() {
      setTimeout(() => {
        input.disconnect();
        lowpass.disconnect();
        convolver.disconnect();
        wet.disconnect();
      }, 600);
    },
  };
}
