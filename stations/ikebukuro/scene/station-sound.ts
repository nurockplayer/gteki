// Original procedural station sound for the shared explorer (#858 ruling): gate taps from other
// commuters, an original approach chime and speech announcements. No recordings, no bundled audio
// and no imitation of any real station melody; speech goes through the platform's own ja-JP voice,
// and the only real name spoken is the station's own. Chimes and announcements used to be out of
// scope for ambience.ts; they live here now under that ruling.
import type { Camera } from "three";

export type V3 = { x: number; y: number; z: number };

/** Speech backend. Voices are re-read on every attempt because browsers load them asynchronously. */
export interface SpeechPort {
  voices(): { lang: string }[];
  /** `onDone` fires when the utterance ends or errors; until then it may still be queued, not yet speaking. */
  speak(text: string, opts: { lang: string; volume: number; rate: number; voice: unknown }, onDone: () => void): void;
  cancel(): void;
  speaking(): boolean;
  /** Optional: drop host listeners the adapter installed (the one-shot unlock). */
  dispose?(): void;
}

export interface StationSoundOptions {
  context: AudioContext;
  destination: AudioNode;
  /** Host mute: the explorer's master gain covers the graph, but speech is not in it. */
  isMuted?: () => boolean;
  stationNameJa: string;
  /** Site positions in renderer space (scene code converts with `ctx.enuToRenderer`). */
  sites: { gates: V3[]; announce: V3[]; chime: V3[] };
  /** Default: the Web Speech adapter. `null` disables announcements. */
  speech?: SpeechPort | null;
  random?: () => number;
}

/** Gate taps: our own two-tone "ok" and single long "error", synthesized sine tones. */
export const GATE_PATTERNS = {
  ok: { frequency: 2100, taps: [0, 0.13], duration: 0.075 },
  error: { frequency: 2100, taps: [0], duration: 0.5 },
} as const;

/** Original approach motif (D5 A4 B4 F#5), unrelated to any station melody. */
export const APPROACH_CHIME = {
  notes: [
    { name: "D5", frequency: 587.33 },
    { name: "A4", frequency: 440 },
    { name: "B4", frequency: 493.88 },
    { name: "F#5", frequency: 739.99 },
  ],
  noteSpacingSeconds: 0.32,
  decaySeconds: 0.8,
} as const;

/** Our own generic sentences; only the station name is real. */
export function announcementLines(stationNameJa: string): readonly string[] {
  return [
    `本日も${stationNameJa}駅をご利用いただき、ありがとうございます。`,
    "エスカレーターをご利用の際は、手すりにおつかまりください。",
    "お荷物は、お体の近くでしっかりとお持ちください。",
    "歩きながらのスマートフォンの操作は、危険ですのでおやめください。",
  ];
}

const GATE_RANGE_M = 30;
const GATE_MEAN_INTERVAL_S = 2.5;
const GATE_ERROR_CHANCE = 1 / 25;
const GATE_MAX_CONCURRENT_TAPS = 4;
const GATE_OFFSET_M = 1.5;

const CHIME_RANGE_M = 40;
const CHIME_FIRST_MIN_S = 20;
const CHIME_FIRST_MAX_S = 60;
const CHIME_MIN_INTERVAL_S = 150;
const CHIME_MAX_INTERVAL_S = 300;

const ANNOUNCE_RANGE_M = 18;
const ANNOUNCE_CANCEL_RANGE_M = 40;
const ANNOUNCE_FIRST_MIN_S = 10;
const ANNOUNCE_FIRST_MAX_S = 30;
const ANNOUNCE_MIN_INTERVAL_S = 60;
const ANNOUNCE_MAX_INTERVAL_S = 120;
/** With no voices loaded yet, retry soon; they arrive asynchronously. */
const ANNOUNCE_VOICE_RETRY_S = 5;
/** Some browsers never fire `end`: an announcement older than this is cancelled, so mute can never miss it. */
const ANNOUNCE_MAX_SECONDS = 30;

/** Distances over hundreds of sites are refreshed a few times a second, never per frame. */
const DISTANCE_REFRESH_S = 0.25;

const distance = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

type GatePattern = (typeof GATE_PATTERNS)[keyof typeof GATE_PATTERNS];

export interface StationSound {
  update(dtSeconds: number, camera?: Camera): void;
  chimeAt(at: V3): void;
  dispose(): void;
}

export function createStationSound(opts: StationSoundOptions): StationSound {
  const { context, destination } = opts;
  const random = opts.random ?? Math.random;
  const isMuted = opts.isMuted ?? (() => false);
  const speech = opts.speech === undefined ? webSpeechPort() : opts.speech;
  const gates = opts.sites.gates;
  const announce = opts.sites.announce;
  const chimes = opts.sites.chime;
  const lines = announcementLines(opts.stationNameJa);

  let disposed = false;
  let time = 0;
  let distancesAt = -Infinity;
  let listener: V3 = { x: 0, y: 0, z: 0 };
  const gateDistance = gates.map(() => Infinity);
  const announceDistance = announce.map(() => Infinity);
  const chimeDistance = chimes.map(() => Infinity);
  const gateNextAt = gates.map(() => 0);
  let nextChimeAt = CHIME_FIRST_MIN_S + random() * (CHIME_FIRST_MAX_S - CHIME_FIRST_MIN_S);
  let nextSpeechAt = ANNOUNCE_FIRST_MIN_S + random() * (ANNOUNCE_FIRST_MAX_S - ANNOUNCE_FIRST_MIN_S);
  let lineIndex = 0;
  let speakingAt: V3 | null = null;
  let spokeAtTime = 0;
  let utterance = 0;
  const activeTaps = new Set<OscillatorNode>();

  function setParam(param: AudioParam, value: number): void {
    try { param.setTargetAtTime(value, context.currentTime, 0.025); } catch { param.value = value; }
  }

  function updateListener(camera: Camera): void {
    const p = camera.position;
    listener = { x: p.x, y: p.y, z: p.z };
    const e = camera.matrixWorld.elements;
    let fx = -(e[8] ?? 0), fy = -(e[9] ?? 0), fz = -(e[10] ?? 0);
    const len = Math.hypot(fx, fy, fz) || 1;
    fx /= len; fy /= len; fz /= len;
    const ear = context.listener;
    if (ear.positionX) {
      setParam(ear.positionX, listener.x);
      setParam(ear.positionY, listener.y);
      setParam(ear.positionZ, listener.z);
      setParam(ear.forwardX, fx);
      setParam(ear.forwardY, fy);
      setParam(ear.forwardZ, fz);
      ear.upX.value = 0; ear.upY.value = 1; ear.upZ.value = 0;
    } else {
      ear.setPosition(listener.x, listener.y, listener.z);
      ear.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  function refreshDistances(): void {
    for (let i = 0; i < gates.length; i++) gateDistance[i] = distance(listener, gates[i]!);
    for (let i = 0; i < announce.length; i++) announceDistance[i] = distance(listener, announce[i]!);
    for (let i = 0; i < chimes.length; i++) chimeDistance[i] = distance(listener, chimes[i]!);
  }

  /** Nearest site within `range`; returns its index and distance. */
  function nearest(positions: V3[], distances: number[], range: number): { index: number; distance: number } {
    let index = -1;
    let best = range;
    for (let i = 0; i < positions.length; i++) {
      const d = distances[i] ?? Infinity;
      if (d <= best) { best = d; index = i; }
    }
    return { index, distance: best };
  }

  function pannerAt(at: V3): PannerNode {
    const panner = context.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 3;
    panner.connect(destination);
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y;
      panner.positionZ.value = at.z;
    } else panner.setPosition(at.x, at.y, at.z);
    return panner;
  }

  /** One sine tone with a click-free envelope; the caller owns release and disposal. */
  function tone(startAt: number, frequency: number, duration: number, out: AudioNode, peak: number, softDecay: boolean): { osc: OscillatorNode; gain: GainNode } {
    const osc = context.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, startAt);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.008);
    if (softDecay) gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    else {
      gain.gain.setValueAtTime(peak, startAt + Math.max(0.012, duration - 0.03));
      gain.gain.linearRampToValueAtTime(0, startAt + duration);
    }
    osc.connect(gain).connect(out);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
    return { osc, gain };
  }

  function playGate(pattern: GatePattern, at: V3): void {
    const panner = pannerAt(at);
    const now = context.currentTime;
    let remaining = pattern.taps.length;
    for (const offset of pattern.taps) {
      const { osc, gain } = tone(now + offset, pattern.frequency, pattern.duration, panner, 0.12, false);
      activeTaps.add(osc);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        activeTaps.delete(osc);
        if (--remaining <= 0) panner.disconnect();
      };
    }
  }

  function playChime(at: V3): void {
    const panner = pannerAt(at);
    const now = context.currentTime;
    let remaining = APPROACH_CHIME.notes.length;
    APPROACH_CHIME.notes.forEach((note, i) => {
      const { osc, gain } = tone(now + i * APPROACH_CHIME.noteSpacingSeconds, note.frequency, APPROACH_CHIME.decaySeconds, panner, 0.09, true);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        if (--remaining <= 0) panner.disconnect();
      };
    });
  }

  function update(dtSeconds: number, camera?: Camera): void {
    if (disposed || !camera) return;
    if (context.state !== "running") return;
    const delta = Number.isFinite(dtSeconds) ? Math.min(Math.max(dtSeconds, 0), 1) : 0;
    time += delta;
    updateListener(camera);
    if (time >= distancesAt + DISTANCE_REFRESH_S) {
      distancesAt = time;
      refreshDistances();
    }
    const muted = isMuted();

    // Ambient commuters: a tap now and then from every gate the listener can hear.
    if (!muted) {
      for (let i = 0; i < gates.length; i++) {
        if ((gateDistance[i] ?? Infinity) > GATE_RANGE_M) continue;
        if (time < (gateNextAt[i] ?? 0)) continue;
        gateNextAt[i] = time + GATE_MEAN_INTERVAL_S * 2 * random();
        const pattern = random() < GATE_ERROR_CHANCE ? GATE_PATTERNS.error : GATE_PATTERNS.ok;
        if (activeTaps.size + pattern.taps.length > GATE_MAX_CONCURRENT_TAPS) continue;
        const site = gates[i]!;
        playGate(pattern, {
          x: site.x + (random() * 2 - 1) * GATE_OFFSET_M,
          y: site.y + (random() * 2 - 1) * GATE_OFFSET_M * 0.2,
          z: site.z + (random() * 2 - 1) * GATE_OFFSET_M,
        });
      }
    }

    // Approach chime at the nearest platform, when one is in earshot.
    if (time >= nextChimeAt) {
      nextChimeAt = time + CHIME_MIN_INTERVAL_S + random() * (CHIME_MAX_INTERVAL_S - CHIME_MIN_INTERVAL_S);
      if (!muted) {
        const site = nearest(chimes, chimeDistance, CHIME_RANGE_M);
        if (site.index >= 0) playChime(chimes[site.index]!);
      }
    }

    // Speech: cancel when muted or once the listener has walked away from the site.
    if (speakingAt) {
      if (muted || distance(listener, speakingAt) > ANNOUNCE_CANCEL_RANGE_M) {
        speech?.cancel();
        speakingAt = null;
      } else if (time - spokeAtTime > ANNOUNCE_MAX_SECONDS) {
        speech?.cancel();
        speakingAt = null;
      }
    }

    if (speech && !muted && !speakingAt && !speech.speaking() && time >= nextSpeechAt) {
      const site = nearest(announce, announceDistance, ANNOUNCE_RANGE_M);
      if (site.index >= 0) {
        // No Japanese voice = no speech at all: never fall back to a default voice.
        const voice = speech.voices().find((v) => v.lang.toLowerCase().startsWith("ja"));
        if (voice) {
          const volume = 0.7 * Math.max(0.15, Math.min(1, 1 - site.distance / 30));
          // A cancelled utterance reports its end late: only the current one may clear speakingAt.
          const mine = ++utterance;
          speakingAt = announce[site.index]!;
          spokeAtTime = time;
          speech.speak(lines[lineIndex % lines.length]!, { lang: "ja-JP", volume, rate: 0.95, voice }, () => {
            if (mine === utterance) speakingAt = null;
          });
          lineIndex += 1;
          nextSpeechAt = time + ANNOUNCE_MIN_INTERVAL_S + random() * (ANNOUNCE_MAX_INTERVAL_S - ANNOUNCE_MIN_INTERVAL_S);
        } else nextSpeechAt = time + ANNOUNCE_VOICE_RETRY_S;
      }
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // The speech queue is document-global: cancel only this station's own in-flight utterance.
    if (speakingAt) speech?.cancel();
    speakingAt = null;
    speech?.dispose?.();
    for (const osc of activeTaps) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
    activeTaps.clear();
  }

  return { update, dispose, chimeAt(at) {
    if (!disposed && context.state === "running" && !isMuted() && distance(listener, at) <= CHIME_RANGE_M) playChime(at);
  } };
}

type SpeechGlobal = typeof globalThis & {
  speechSynthesis?: {
    getVoices(): SpeechSynthesisVoice[];
    speak(utterance: SpeechSynthesisUtterance): void;
    cancel(): void;
    readonly speaking: boolean;
  };
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

/**
 * Thin Web Speech adapter. iOS only starts speaking after a gesture, so the first
 * pointerdown/keydown/touchend speaks an empty, silent utterance once.
 */
export function webSpeechPort(): SpeechPort | null {
  const scope = globalThis as SpeechGlobal;
  const synth = scope.speechSynthesis;
  const Utterance = scope.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== "function") return null;

  const gestures = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = (): void => {
    remove();
    try {
      const utterance = new Utterance("");
      utterance.volume = 0;
      synth.speak(utterance);
    } catch { /* speech unavailable */ }
  };
  function remove(): void {
    for (const gesture of gestures) removeEventListener(gesture, unlock);
  }
  for (const gesture of gestures) addEventListener(gesture, unlock);

  return {
    voices: () => synth.getVoices(),
    speak: (text, o, onDone) => {
      const utterance = new Utterance(text);
      utterance.lang = o.lang;
      utterance.volume = o.volume;
      utterance.rate = o.rate;
      if (o.voice) utterance.voice = o.voice as SpeechSynthesisVoice;
      utterance.onend = onDone;
      utterance.onerror = onDone;
      synth.speak(utterance);
    },
    cancel: () => synth.cancel(),
    speaking: () => synth.speaking,
    dispose: remove,
  };
}
