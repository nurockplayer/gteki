type Position = { x: number; y: number; z: number };

export interface StationAudio {
  /** Call from a user gesture. Resumes the context; repeated calls are safe. */
  start(): Promise<void>;
  setMuted(m: boolean): void;
  get muted(): boolean;
  /** ENU metres; heading is clockwise from north, in radians. */
  update(
    dt: number,
    listener: Position & { heading: number },
    state: {
      speed: number;
      onStairs: boolean;
      onEscalator: boolean;
      levelLabel: string;
      ceilingHeight: number;
    },
  ): void;
  addEscalator(id: string, a: Position, b: Position): void;
  gateBeep(at: Position): void;
  uiClick(): void;
  /** Original three-note cue, unrelated to any station melody. */
  arrivalChime(): void;
  dispose(): void;
}

/** All buffers, including the room impulse, are synthesized locally. */
export function createStationAudio(): StationAudio {
  let context: AudioContext | undefined;
  let starting: Promise<void> | undefined;
  let disposed = false;
  let started = false;
  let mutePreference = false;
  let master: GainNode;
  let bus: GainNode;
  let roomFilter: BiquadFilterNode;
  let windGain: GainNode;
  let white: AudioBuffer | undefined;
  let brown: AudioBuffer | undefined;
  let clatter: AudioBuffer | undefined;
  let reverbs: [ConvolverNode, ConvolverNode];
  let wet: [GainNode, GainNode];
  let activeReverb = 0;
  let reverbKey = "";
  let lastReverbChange = -Infinity;
  let stepPhase = 0;
  let windPhase = Math.random() * 100;
  let windPeriod = 90 + Math.random() * 60;
  const nodes = new Set<AudioNode>();
  const sources = new Set<AudioScheduledSourceNode>();
  const escalators = new Map<string, { a: Position; b: Position; panner?: PannerNode }>();
  const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
  const own = <T extends AudioNode>(node: T): T => { nodes.add(node); return node; };
  const audible = () => started && !mutePreference && !disposed && context?.state === "running";

  function smooth(param: AudioParam, value: number, time = 0.15): void {
    param.setTargetAtTime(value, context!.currentTime, time);
  }

  function gain(value: number): GainNode {
    const node = own(context!.createGain());
    node.gain.value = value;
    return node;
  }

  function filter(type: BiquadFilterType, frequency: number, q = 0.5): BiquadFilterNode {
    const node = own(context!.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  }

  function release(list: AudioNode[]): void {
    for (const node of list) {
      node.disconnect();
      nodes.delete(node);
    }
  }

  function play(source: AudioScheduledSourceNode, when: number, duration?: number, cleanup: AudioNode[] = []): void {
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      release([source, ...cleanup]);
      source.onended = null;
    };
    source.start(when);
    if (duration !== undefined) source.stop(when + duration);
  }

  function oscillator(frequency: number): OscillatorNode {
    const node = own(context!.createOscillator());
    node.type = "sine";
    node.frequency.value = frequency;
    return node;
  }

  function noiseBuffer(seconds: number, kind: "white" | "brown" | "clatter"): AudioBuffer {
    const ctx = context!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const noise = Math.random() * 2 - 1;
      low = (low + noise * 0.02) / 1.02;
      const pulse = (i / ctx.sampleRate * 3) % 1;
      data[i] = kind === "brown" ? low * 3.5
        : kind === "clatter" ? noise * Math.exp(-pulse * 32) * Math.min(1, pulse * 180)
        : noise;
    }
    // Blend the end into the beginning to avoid a click at the loop boundary.
    const seam = Math.min(512, Math.floor(data.length / 4));
    for (let i = 0; i < seam; i++) {
      const mix = i / (seam - 1);
      const index = data.length - seam + i;
      data[index] = data[index]! * (1 - mix) + data[0]! * mix;
    }
    return buffer;
  }

  function loop(buffer: AudioBuffer, destination: AudioNode): void {
    const source = own(context!.createBufferSource());
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    play(source, context!.currentTime);
  }

  function modulate(param: AudioParam, frequency: number, amount: number): void {
    const lfo = oscillator(frequency);
    const depth = gain(amount);
    lfo.connect(depth).connect(param);
    play(lfo, context!.currentTime);
  }

  function place(panner: PannerNode, at: Position): void {
    const x = finite(at.x);
    const y = finite(at.z);
    const z = -finite(at.y);
    if (panner.positionX) {
      smooth(panner.positionX, x, 0.03);
      smooth(panner.positionY, y, 0.03);
      smooth(panner.positionZ, z, 0.03);
    } else {
      panner.setPosition(x, y, z);
    }
  }

  function spatial(at: Position): PannerNode {
    const panner = own(context!.createPanner());
    try { panner.panningModel = "HRTF"; } catch { panner.panningModel = "equalpower"; }
    panner.distanceModel = "inverse";
    panner.refDistance = 3;
    panner.maxDistance = 40;
    panner.rolloffFactor = 1.5;
    // Initial placement must be immediate, before any one-shot starts.
    if (panner.positionX) {
      panner.positionX.value = finite(at.x);
      panner.positionY.value = finite(at.z);
      panner.positionZ.value = -finite(at.y);
    } else panner.setPosition(finite(at.x), finite(at.z), -finite(at.y));
    panner.connect(bus);
    return panner;
  }

  function attachEscalator(entry: { a: Position; b: Position; panner?: PannerNode }): void {
    if (entry.panner) return;
    const panner = spatial({
      x: (entry.a.x + entry.b.x) / 2,
      y: (entry.a.y + entry.b.y) / 2,
      z: (entry.a.z + entry.b.z) / 2,
    });
    entry.panner = panner;
    const motor = gain(0.027);
    motor.connect(panner);
    for (const frequency of [62, 117]) {
      const tone = oscillator(frequency);
      tone.connect(motor);
      play(tone, context!.currentTime);
    }
    modulate(motor.gain, 0.73, 0.003);
    const mechanical = filter("bandpass", 650, 0.65);
    const steps = gain(0.033);
    mechanical.connect(steps).connect(panner);
    loop(clatter!, mechanical);
  }

  function impulse(decay: number, depth: number): AudioBuffer {
    const ctx = context!;
    const buffer = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * decay), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      const color = 0.3 / (1 + depth * 0.12);
      for (let i = 0; i < data.length; i++) {
        low += color * ((Math.random() * 2 - 1) - low);
        const t = i / ctx.sampleRate;
        data[i] = low * Math.min(1, t / 0.012) * Math.exp(-7 * t / decay);
      }
    }
    return buffer;
  }

  function updateRoom(depth: number, height: number): void {
    smooth(roomFilter.frequency, 1050 - depth * 85, 1);
    const decay = Math.round(clamp(0.65 + height * 0.16 + depth * 0.12, 0.8, 3.5) * 4) / 4;
    const key = `${decay}:${Math.round(depth)}`;
    const now = context!.currentTime;
    if (key === reverbKey || now - lastReverbChange < 1) return;
    const next = activeReverb === 0 ? 1 : 0;
    reverbs[next].buffer = impulse(decay, depth);
    wet[next].gain.cancelScheduledValues(now);
    wet[next].gain.setValueAtTime(0, now);
    wet[next].gain.linearRampToValueAtTime(0.12 + depth * 0.012, now + 0.4);
    wet[activeReverb]!.gain.cancelScheduledValues(now);
    wet[activeReverb]!.gain.setValueAtTime(wet[activeReverb]!.gain.value, now);
    wet[activeReverb]!.gain.linearRampToValueAtTime(0, now + 0.4);
    activeReverb = next;
    lastReverbChange = now;
    reverbKey = key;
  }

  function build(): void {
    const ctx = context!;
    master = gain(0);
    bus = gain(1);
    const compressor = own(ctx.createDynamicsCompressor());
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.3;
    bus.connect(master);
    master.connect(compressor).connect(ctx.destination);
    reverbs = [own(ctx.createConvolver()), own(ctx.createConvolver())];
    wet = [gain(0), gain(0)];
    for (let i = 0; i < 2; i++) bus.connect(reverbs[i]!).connect(wet[i]!).connect(master);
    white = noiseBuffer(3, "white");
    brown = noiseBuffer(8, "brown");
    clatter = noiseBuffer(4, "clatter");

    const roomHighpass = filter("highpass", 38);
    roomFilter = filter("lowpass", 850);
    const room = gain(0.11);
    roomHighpass.connect(roomFilter).connect(room).connect(bus);
    loop(brown, roomHighpass);
    modulate(room.gain, 0.065, 0.015);
    const hvac = gain(0.016);
    hvac.connect(bus);
    for (const frequency of [57, 113]) {
      const tone = oscillator(frequency);
      tone.connect(hvac);
      play(tone, ctx.currentTime);
    }
    modulate(hvac.gain, 0.09, 0.003);
    const crowdFilter = filter("bandpass", 560, 0.7);
    const crowdLowpass = filter("lowpass", 1400);
    const crowd = gain(0.025);
    crowdFilter.connect(crowdLowpass).connect(crowd).connect(bus);
    loop(white, crowdFilter);
    modulate(crowd.gain, 0.12, 0.008);

    const windHighpass = filter("highpass", 28);
    const windLowpass = filter("lowpass", 210);
    windGain = gain(0);
    windHighpass.connect(windLowpass).connect(windGain).connect(bus);
    loop(brown, windHighpass);
    updateRoom(3, 3);
    for (const entry of escalators.values()) attachEscalator(entry);
  }

  function burst(when: number, duration: number, frequency: number, volume: number): void {
    const source = own(context!.createBufferSource());
    source.buffer = white!;
    const color = filter("bandpass", frequency, 0.55);
    const envelope = gain(0);
    source.connect(color).connect(envelope).connect(bus);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(volume, when + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    play(source, when, duration + 0.01, [color, envelope]);
  }

  function tone(when: number, frequency: number, duration: number, volume: number, output: AudioNode, cleanup: AudioNode[] = []): void {
    const source = oscillator(frequency);
    const envelope = gain(0);
    source.connect(envelope).connect(output);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(volume, when + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    play(source, when, duration + 0.02, [envelope, ...cleanup]);
  }

  function teardown(): void {
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
    }
    sources.clear();
    if (reverbs) for (const reverb of reverbs) reverb.buffer = null;
    release([...nodes]);
    white = brown = clatter = undefined;
    for (const entry of escalators.values()) delete entry.panner;
    const ctx = context;
    context = undefined;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    reverbKey = "";
    lastReverbChange = -Infinity;
  }

  const api: StationAudio = {
    start() {
      if (disposed) return Promise.resolve();
      if (starting) return starting;
      try {
        if (!context) {
          const Constructor = (globalThis as typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }).AudioContext ?? (globalThis as typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }).webkitAudioContext;
          if (!Constructor) return Promise.resolve();
          context = new Constructor();
          build();
        }
        const ctx = context;
        // Invoke resume synchronously inside the gesture, before yielding.
        starting = ctx.resume().then(() => {
          if (disposed || context !== ctx) return;
          started = true;
          smooth(master.gain, mutePreference ? 0 : 0.55, 0.08);
        }).catch(() => {
          // A denied gesture can be retried on the next start().
        }).finally(() => { starting = undefined; });
        return starting;
      } catch {
        teardown();
        return Promise.resolve();
      }
    },
    setMuted(m) {
      mutePreference = m;
      if (context && started) smooth(master.gain, m ? 0 : 0.55, 0.04);
      stepPhase = 0;
    },
    get muted() { return !started || mutePreference; },
    update(dt, listener, state) {
      if (disposed || !context || !started || context.state !== "running") return;
      const delta = clamp(finite(dt), 0, 0.25);
      const ear = context.listener;
      const heading = finite(listener.heading);
      if (ear.positionX) {
        smooth(ear.positionX, finite(listener.x), 0.025);
        smooth(ear.positionY, finite(listener.z), 0.025);
        smooth(ear.positionZ, -finite(listener.y), 0.025);
        smooth(ear.forwardX, Math.sin(heading), 0.025);
        smooth(ear.forwardY, 0, 0.025);
        smooth(ear.forwardZ, -Math.cos(heading), 0.025);
        ear.upX.value = 0; ear.upY.value = 1; ear.upZ.value = 0;
      } else {
        ear.setPosition(finite(listener.x), finite(listener.z), -finite(listener.y));
        ear.setOrientation(Math.sin(heading), 0, -Math.cos(heading), 0, 1, 0);
      }
      // A long escalator radiates along its length: use its closest point.
      for (const entry of escalators.values()) {
        if (!entry.panner) continue;
        const dx = entry.b.x - entry.a.x;
        const dy = entry.b.y - entry.a.y;
        const dz = entry.b.z - entry.a.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const t = length2 > 0 ? clamp(((listener.x - entry.a.x) * dx
          + (listener.y - entry.a.y) * dy + (listener.z - entry.a.z) * dz) / length2, 0, 1) : 0;
        place(entry.panner, { x: entry.a.x + dx * t, y: entry.a.y + dy * t, z: entry.a.z + dz * t });
      }
      const depth = clamp(Number(/B\s*(\d+)/i.exec(state.levelLabel)?.[1] ?? 0), 0, 8);
      updateRoom(depth, clamp(finite(state.ceilingHeight, 3), 1.5, 12));
      windPhase += delta;
      if (windPhase >= windPeriod) {
        windPhase = 0;
        windPeriod = 90 + Math.random() * 60;
      }
      const swell = windPhase < 28 ? Math.sin(Math.PI * windPhase / 28) ** 2 : 0;
      smooth(windGain.gain, depth === 6 ? 0.19 * swell : 0, 1.8);
      const speed = clamp(finite(state.speed), 0, 7);
      if (!audible() || speed < 0.12 || state.onEscalator) { stepPhase = 0; return; }
      const cadence = speed <= 1.4 ? 1.8 * speed / 1.4 : Math.min(3.4, 1.8 + (speed - 1.4) / 2.1);
      stepPhase += delta * cadence;
      if (stepPhase >= 1) {
        stepPhase %= 1; // Never emit a catch-up volley after a stalled frame.
        const now = context.currentTime;
        const weight = state.onStairs ? 1.25 : 1;
        burst(now, 0.065, state.onStairs ? 470 : 850, 0.085 * weight);
        burst(now + 0.065, 0.04, state.onStairs ? 1000 : 1700, 0.035 * weight);
      }
    },
    addEscalator(id, a, b) {
      if (disposed) return;
      const existing = escalators.get(id);
      if (existing) {
        existing.a = { ...a }; existing.b = { ...b };
        return;
      }
      const entry = { a: { ...a }, b: { ...b } };
      escalators.set(id, entry);
      if (context) attachEscalator(entry);
    },
    gateBeep(at) {
      if (!audible()) return;
      const panner = spatial(at);
      const now = context!.currentTime;
      tone(now, 2100, 0.075, 0.055, panner);
      tone(now + 0.13, 2100, 0.075, 0.055, panner, [panner]);
    },
    uiClick() {
      if (audible()) tone(context!.currentTime, 720, 0.035, 0.035, master);
    },
    arrivalChime() {
      if (!audible()) return;
      const now = context!.currentTime;
      // An original rising major-sixth motif, with a soft, pure-sine attack.
      [523.25, 659.25, 880].forEach((frequency, i) => {
        tone(now + i * 0.19, frequency, 0.75, 0.07, bus);
        tone(now + i * 0.19, frequency * 2, 0.3, 0.009, bus);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      teardown();
      escalators.clear();
    },
  };
  return api;
}
