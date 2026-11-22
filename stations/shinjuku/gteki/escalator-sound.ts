// Original synthesized escalator sound (J11): no recordings and no imitation of any real machine.
import type { V3 } from "../../ikebukuro/scene/station-sound.ts";

/** Run endpoints and listener positions are in the renderer frame (Y up). */
export function createEscalatorSound({ context, destination, runs, recorded, isMuted = () => false }: {
  context: AudioContext; destination: AudioNode; recorded?: AudioBuffer; runs: { a: V3; b: V3 }[]; isMuted?: () => boolean;
}) {
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const pulse = (i / context.sampleRate * 3) % 1;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-pulse * 32) * Math.min(1, pulse * 180);
  }
  const seam = Math.min(512, Math.floor(data.length / 4));
  for (let i = 0; i < seam; i++) {
    const mix = i / (seam - 1), index = data.length - seam + i;
    data[index] = data[index]! * (1 - mix) + data[0]! * mix;
  }
  const master = context.createGain();
  master.gain.value = isMuted() ? 0 : 1;
  master.connect(destination);
  const nodes: AudioNode[] = [master];
  const sources: AudioScheduledSourceNode[] = [];
  const entries = runs.map(({ a, b }) => {
    const panner = context.createPanner();
    panner.panningModel = "equalpower"; panner.distanceModel = "inverse";
    panner.refDistance = 3; panner.maxDistance = 40; panner.rolloffFactor = 1.5;
    panner.positionX.value = (a.x + b.x) / 2;
    panner.positionY.value = (a.y + b.y) / 2;
    panner.positionZ.value = (a.z + b.z) / 2;
    panner.connect(master);
    if (recorded) {
      const source = context.createBufferSource(); source.buffer = recorded; source.loop = true;
      const gain = context.createGain(); gain.gain.value = 0.65;
      source.connect(gain).connect(panner); source.start(); sources.push(source); nodes.push(source, gain, panner);
      return { a, b, panner };
    }
    const motor = context.createGain(); motor.gain.value = 0.027; motor.connect(panner);
    for (const frequency of [62, 117]) {
      const tone = context.createOscillator(); tone.type = "sine"; tone.frequency.value = frequency;
      tone.connect(motor); tone.start(); sources.push(tone); nodes.push(tone);
    }
    const lfo = context.createOscillator(); lfo.frequency.value = 0.73;
    const depth = context.createGain(); depth.gain.value = 0.003;
    lfo.connect(depth).connect(motor.gain); lfo.start(); sources.push(lfo);
    const mechanical = context.createBiquadFilter();
    mechanical.type = "bandpass"; mechanical.frequency.value = 650; mechanical.Q.value = 0.65;
    const steps = context.createGain(); steps.gain.value = 0.033;
    const clatter = context.createBufferSource(); clatter.buffer = buffer; clatter.loop = true;
    clatter.connect(mechanical).connect(steps).connect(panner); clatter.start(); sources.push(clatter);
    nodes.push(panner, motor, lfo, depth, mechanical, steps, clatter);
    return { a, b, panner };
  });
  let nearestDistance: number | null = null;
  let disposed = false;
  return {
    // Nominal motor + mechanical gain per run, before spatial attenuation and modulation.
    info: () => ({ gain: entries.length ? master.gain.value * (recorded ? 0.65 : 0.027 + 0.033) : 0, nearestDistance, runs: entries.length }),
    update(listener: V3) {
      if (disposed) return;
      master.gain.value = isMuted() ? 0 : 1;
      let nearest = Infinity;
      for (const { a, b, panner } of entries) {
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const t = length2 ? Math.max(0, Math.min(1, ((listener.x - a.x) * dx + (listener.y - a.y) * dy + (listener.z - a.z) * dz) / length2)) : 0;
        const x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
        panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
        nearest = Math.min(nearest, Math.hypot(listener.x - x, listener.y - y, listener.z - z));
      }
      nearestDistance = entries.length ? nearest : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) source.stop();
      for (const node of nodes) node.disconnect();
    },
  };
}
