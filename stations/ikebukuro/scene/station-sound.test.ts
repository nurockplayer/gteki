// Decision logic of the station sound layer, driven through a stub AudioContext, a stub speech
// port and an injected random source: no real audio and no browser are involved.
import { describe, expect, it } from "vitest";
import type { Camera } from "three";
import { GATE_PATTERNS, createStationSound, type SpeechPort, type V3 } from "./station-sound.ts";

const AT: V3 = { x: 0, y: 0, z: 0 };
const far = (x: number): V3 => ({ x, y: 0, z: 0 });

const param = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
});

type Tone = { frequency: number; startAt: number; stopAt: number };

function fakeContext(state: AudioContextState = "running") {
  const tones: Tone[] = [];
  const listener = {
    positionX: param(), positionY: param(), positionZ: param(),
    forwardX: param(), forwardY: param(), forwardZ: param(),
    upX: param(), upY: param(), upZ: param(),
    setPosition() {},
    setOrientation() {},
  };
  const context = {
    state,
    currentTime: 0,
    listener,
    createOscillator() {
      const tone: Tone = { frequency: 0, startAt: 0, stopAt: 0 };
      tones.push(tone);
      return {
        type: "",
        frequency: { ...param(), setValueAtTime(value: number) { tone.frequency = value; } },
        connect: (node: unknown) => node,
        disconnect() {},
        start(at: number) { tone.startAt = at; },
        stop(at?: number) { tone.stopAt = at ?? tone.startAt; },
        onended: null as (() => void) | null,
      };
    },
    createGain() {
      return { gain: param(), connect: (node: unknown) => node, disconnect() {} };
    },
    createPanner() {
      return {
        panningModel: "", distanceModel: "", refDistance: 0,
        positionX: param(), positionY: param(), positionZ: param(),
        connect: (node: unknown) => node,
        disconnect() {},
        setPosition() {},
      };
    },
  };
  return { context: context as unknown as AudioContext, tones };
}

const destination = {} as AudioNode;

/** Identity matrix: the camera looks down -Z. */
const camera = (x = 0, y = 0, z = 0): Camera =>
  ({ position: { x, y, z }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } }) as unknown as Camera;

function fakeSpeech(voices: { lang: string }[] = [{ lang: "ja-JP" }]) {
  const said: { text: string; opts: { lang: string; volume: number; rate: number; voice: unknown } }[] = [];
  const state = { speaking: false, cancels: 0 };
  const dones: (() => void)[] = [];
  const port: SpeechPort = {
    voices: () => voices,
    speak: (text, opts, onDone) => { said.push({ text, opts }); dones.push(onDone); state.speaking = true; },
    cancel: () => { state.cancels += 1; state.speaking = false; },
    speaking: () => state.speaking,
  };
  return { port, said, state, dones };
}

function run(sound: { update(dt: number, camera?: Camera): void }, seconds: number, view = camera()): void {
  for (let i = 0; i < seconds; i++) sound.update(1, view);
}

describe("station sound", () => {
  it("stays silent while the context is suspended", () => {
    const { context, tones } = fakeContext("suspended");
    const speech = fakeSpeech();
    const sound = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [AT], announce: [AT], chime: [AT] }, speech: speech.port, random: () => 0 });
    run(sound, 120);
    expect(tones).toHaveLength(0);
    expect(speech.said).toHaveLength(0);
    sound.dispose();
  });

  it("fires gate taps only for gates within 30 m of the listener", () => {
    const { context, tones } = fakeContext();
    const sound = createStationSound({ context, destination, stationNameJa: "池袋", sites: { gates: [far(100)], announce: [], chime: [] }, speech: null, random: () => 0.5 });
    run(sound, 20);
    expect(tones).toHaveLength(0);
    sound.update(1, camera(100));
    expect(tones.length).toBeGreaterThan(0);
    sound.dispose();
  });

  it("picks the gate pattern from the injected random at the 1/25 error rate", () => {
    const error = fakeContext();
    const errorSound = createStationSound({ context: error.context, destination, stationNameJa: "池袋", sites: { gates: [AT], announce: [], chime: [] }, speech: null, random: () => 0 });
    errorSound.update(1, camera());
    expect(error.tones).toHaveLength(GATE_PATTERNS.error.taps.length);
    expect(error.tones[0]!.stopAt - error.tones[0]!.startAt).toBeCloseTo(GATE_PATTERNS.error.duration + 0.02, 5);

    const ok = fakeContext();
    const okSound = createStationSound({ context: ok.context, destination, stationNameJa: "池袋", sites: { gates: [AT], announce: [], chime: [] }, speech: null, random: () => 0.5 });
    okSound.update(1, camera());
    expect(ok.tones).toHaveLength(GATE_PATTERNS.ok.taps.length);
    expect(ok.tones[1]!.startAt - ok.tones[0]!.startAt).toBeCloseTo(0.13, 5);
    errorSound.dispose();
    okSound.dispose();
  });

  it("never speaks when the port has no Japanese voice", () => {
    const { context } = fakeContext();
    const speech = fakeSpeech([{ lang: "en-US" }]);
    const sound = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: speech.port, random: () => 0 });
    run(sound, 60);
    expect(speech.said).toHaveLength(0);
    sound.dispose();
  });

  it("speaks only inside 18 m, with the distance volume, and respects the cooldown", () => {
    const { context } = fakeContext();
    const speech = fakeSpeech();
    const sound = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: speech.port, random: () => 0 });
    run(sound, 40, camera(25));
    expect(speech.said).toHaveLength(0);
    sound.update(1, camera());
    expect(speech.said).toHaveLength(1);
    expect(speech.said[0]!.text).toContain("新宿駅");
    expect(speech.said[0]!.opts).toMatchObject({ lang: "ja-JP", rate: 0.95 });
    expect(speech.said[0]!.opts.volume).toBeCloseTo(0.7, 5);

    // The utterance ends; the next one waits for the 60 s cooldown.
    speech.state.speaking = false;
    speech.dones.at(-1)!();
    run(sound, 59, camera());
    expect(speech.said).toHaveLength(1);
    sound.update(1, camera());
    expect(speech.said).toHaveLength(2);
    sound.dispose();
  });

  it("cancels speech and stops tapping while muted", () => {
    const { context, tones } = fakeContext();
    const speech = fakeSpeech();
    let muted = false;
    const sound = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [AT], announce: [AT], chime: [] }, speech: speech.port, random: () => 0, isMuted: () => muted });
    run(sound, 10, camera());
    expect(speech.said).toHaveLength(1);

    muted = true;
    const tapsBefore = tones.length;
    sound.update(1, camera());
    expect(speech.state.cancels).toBe(1);
    run(sound, 30, camera());
    expect(speech.said).toHaveLength(1);
    expect(tones).toHaveLength(tapsBefore);
    sound.dispose();
  });

  it("mute cancels an announcement that is queued but not yet speaking", () => {
    const { context } = fakeContext();
    const speech = fakeSpeech();
    let muted = false;
    const sound = createStationSound({ context, destination, isMuted: () => muted, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: speech.port, random: () => 0 });
    run(sound, 12);
    expect(speech.said).toHaveLength(1);
    speech.state.speaking = false; // Web Speech: pending, not started.
    sound.update(0.1, camera());
    muted = true;
    sound.update(0.1, camera());
    expect(speech.state.cancels).toBe(1);
    sound.dispose();
  });

  it("a cancelled utterance's late end doesn't release the next one", () => {
    const { context } = fakeContext();
    const speech = fakeSpeech();
    let muted = false;
    const sound = createStationSound({ context, destination, isMuted: () => muted, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: speech.port, random: () => 0 });
    run(sound, 12);
    muted = true;
    sound.update(0.1, camera());
    muted = false;
    speech.state.speaking = false;
    run(sound, 61);
    expect(speech.said).toHaveLength(2);
    speech.dones[0]!();
    muted = true;
    sound.update(0.1, camera());
    expect(speech.state.cancels).toBe(2);
    sound.dispose();
  });

  it("cancels speech on dispose, and only the speech it started", () => {
    const { context } = fakeContext();
    const speech = fakeSpeech();
    const sound = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: speech.port, random: () => 0 });
    run(sound, 10, camera());
    expect(speech.said).toHaveLength(1);
    sound.dispose();
    expect(speech.state.cancels).toBe(1);
    run(sound, 30, camera());
    expect(speech.said).toHaveLength(1);

    // The speech queue is document-global; a station that never spoke must leave it alone.
    const other = fakeSpeech();
    const quiet = createStationSound({ context, destination, stationNameJa: "新宿", sites: { gates: [], announce: [AT], chime: [] }, speech: other.port, random: () => 0 });
    quiet.dispose();
    expect(other.state.cancels).toBe(0);
  });
});
