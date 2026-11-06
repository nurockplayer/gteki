// Synthesized street ambience (WebAudio only, no recordings): a slow traffic bed and a quiet
// pedestrian-signal chirp that fade in as the listener leaves the concourse for the street (#861).
// The tones are ours, not a real signal's melody; it is an impression, not a surveyed recording.
import type { AcousticZone } from "@gteki/scene-api";
import { noiseBuffer } from "./ambience.ts";

/** How much street level a zone lets through: 1 outdoors, a trace in the concourse, none indoors. */
export function streetLevel(zone: AcousticZone): number {
  switch (zone) {
    case "outdoor": return 1;
    case "concourse": return 0.12;
    case "platform": return 0;
    case "passage": return 0;
  }
}

export function createStreetAmbience(ctx: AudioContext, destination: AudioNode) {
  const master = ctx.createGain();
  master.gain.value = 0; // silent indoors; setZone fades it toward the zone level
  master.connect(destination);

  // Traffic: looped brown noise, low-passed into the rumble of a street, swelling like passing cars.
  const bed = ctx.createBufferSource();
  bed.buffer = noiseBuffer(ctx, 6, true);
  bed.loop = true;
  const bedLp = ctx.createBiquadFilter();
  bedLp.type = "lowpass";
  bedLp.frequency.value = 500;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.14;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain).connect(bedGain.gain);
  bed.connect(bedLp).connect(bedGain).connect(master);
  bed.start();
  lfo.start();

  // Pedestrian signal: an original two-tone chirp, about 0.4 s on and 1 s off, quiet.
  const toneBus = ctx.createGain();
  toneBus.gain.value = 0.035;
  toneBus.connect(master);

  let target = 0;
  let nextAt = ctx.currentTime + 2;

  function chirp(at: number) {
    for (const [frequency, offset] of [[620, 0], [830, 0.2]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at + offset);
      g.gain.exponentialRampToValueAtTime(1, at + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.12);
      osc.connect(g).connect(toneBus);
      osc.start(at + offset);
      osc.stop(at + offset + 0.14);
    }
  }

  return {
    setZone(zone: AcousticZone) {
      target = streetLevel(zone);
      master.gain.setTargetAtTime(target, ctx.currentTime, 1.5);
    },
    update() {
      if (target === 0) {
        nextAt = ctx.currentTime + 0.5;
        return;
      }
      const horizon = ctx.currentTime + 0.5;
      if (nextAt < ctx.currentTime) nextAt = ctx.currentTime;
      while (nextAt < horizon) {
        chirp(nextAt);
        nextAt += 1.4;
      }
    },
    dispose() {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => {
        for (const n of [bed, lfo]) n.stop();
        master.disconnect();
      }, 600);
    },
  };
}
