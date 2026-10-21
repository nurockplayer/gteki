// Procedural station ambience (WebAudio only, no recordings, so no licensing questions):
// an HVAC/concourse bed, a distant crowd murmur and footsteps whose density follows the
// number of pedestrians near the listener. No chimes or announcements (operator melodies
// and voices are not ours to imitate).

export interface AmbienceInput {
  /** Pedestrians within ~8 m of the listener. */
  nearby: number;
  /** 0..1 openness of the space around the listener (wide hall = 1). */
  openness: number;
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const w = (s / 4294967296) * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

export function createAmbience(ctx: AudioContext, destination: AudioNode) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(destination);
  master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5); // fade in

  // HVAC / room tone: looped brown noise, low-passed.
  const bed = ctx.createBufferSource();
  bed.buffer = noiseBuffer(ctx, 6, true);
  bed.loop = true;
  const bedLp = ctx.createBiquadFilter();
  bedLp.type = "lowpass";
  bedLp.frequency.value = 320;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.16;
  bed.connect(bedLp).connect(bedGain).connect(master);
  bed.start();

  // Crowd murmur: band-passed white noise around speech formants, slowly modulated.
  const mur = ctx.createBufferSource();
  mur.buffer = noiseBuffer(ctx, 5, false);
  mur.loop = true;
  const murBp = ctx.createBiquadFilter();
  murBp.type = "bandpass";
  murBp.frequency.value = 520;
  murBp.Q.value = 0.8;
  const murGain = ctx.createGain();
  murGain.gain.value = 0.0;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.012;
  lfo.connect(lfoGain).connect(murGain.gain);
  mur.connect(murBp).connect(murGain).connect(master);
  mur.start();
  lfo.start();

  // Footsteps: short filtered noise bursts, scheduled ahead.
  const click = noiseBuffer(ctx, 0.08, false);
  const stepBus = ctx.createGain();
  stepBus.gain.value = 1.0;
  // A touch of hard-surface reflection: two short feedback-free delays.
  const d1 = ctx.createDelay(0.2), d2 = ctx.createDelay(0.2);
  d1.delayTime.value = 0.045;
  d2.delayTime.value = 0.083;
  const refl = ctx.createGain();
  refl.gain.value = 0.22;
  stepBus.connect(master);
  stepBus.connect(d1).connect(refl).connect(master);
  stepBus.connect(d2).connect(refl);

  let rate = 0; // steps per second
  let nextAt = ctx.currentTime + 0.5;
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function step(at: number) {
    const src = ctx.createBufferSource();
    src.buffer = click;
    src.playbackRate.value = 0.7 + rnd() * 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 1400 + rnd() * 1800;
    hp.Q.value = 1.4;
    const g = ctx.createGain();
    const level = 0.05 + rnd() * 0.08;
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.06);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rnd() * 1.6 - 0.8;
    src.connect(hp).connect(g).connect(pan).connect(stepBus);
    src.start(at);
    src.stop(at + 0.09);
  }

  return {
    update(input: AmbienceInput) {
      // each walker ~1.8 steps/s; distant ones are masked by the bed
      rate = Math.min(14, input.nearby * 1.8);
      murGain.gain.setTargetAtTime(0.02 + Math.min(0.05, input.nearby * 0.006) * (0.6 + 0.4 * input.openness), ctx.currentTime, 1.5);
      bedGain.gain.setTargetAtTime(0.13 + 0.06 * input.openness, ctx.currentTime, 2);
      const horizon = ctx.currentTime + 0.25;
      if (nextAt < ctx.currentTime) nextAt = ctx.currentTime;
      while (rate > 0.2 && nextAt < horizon) {
        step(nextAt);
        nextAt += (1 / rate) * (0.5 + rnd());
      }
      if (rate <= 0.2) nextAt = ctx.currentTime + 0.3;
    },
    dispose() {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => {
        for (const n of [bed, mur, lfo]) n.stop();
        master.disconnect();
      }, 600);
    },
  };
}
