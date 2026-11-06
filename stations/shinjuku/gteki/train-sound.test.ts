import { expect, it } from "vitest";
import { createTrainSound, rumbleLevel, trainSoundCues } from "./train-sound.ts";

it("crosses each cue once per cycle and ignores clock jumps", () => {
  const cues = [];
  for (let t = 0.25; t <= 120; t += 0.25) cues.push(...trainSoundCues(t - 0.25, t % 120, 120));
  expect(cues).toEqual(["brake", "doorOpen", "doorClose", "approach"]);
  expect(trainSoundCues(0, 10, 120)).toEqual([]);
  expect(rumbleLevel(70)).toBe(0);
  expect(rumbleLevel(5)).toBeGreaterThan(rumbleLevel(20));
});

it("chimes at the stop and skips far or muted doors", () => {
  const tones: number[] = []; const chimes: unknown[] = []; let muted = false;
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} });
  const ctx = { sampleRate: 10, currentTime: 0, state: "running", createBuffer: () => ({ getChannelData: () => new Float32Array(20) }), createBufferSource: () => ({ ...node(), start() {}, stop() {} }), createBiquadFilter: () => ({ ...node(), frequency: param() }), createGain: () => ({ ...node(), gain: param() }), createPanner: () => ({ ...node(), positionX: param(), positionY: param(), positionZ: param() }), createOscillator: () => { tones.push(1); return { ...node(), frequency: param(), start() {}, stop() {} }; } } as unknown as AudioContext;
  const sound = createTrainSound({ context: ctx, destination: {} as AudioNode, isMuted: () => muted, chimeAt: (at) => chimes.push(at) });
  const stop = { x: 0, y: 0, z: 0 }; const track = { tt: 107.75, headway: 120, stop, pos: null };
  sound.update([track], stop); track.tt = 108; sound.update([track], stop);
  expect(chimes).toEqual([stop]);
  track.tt = 15.75; sound.update([track], stop); track.tt = 16; sound.update([track], { x: 41, y: 0, z: 0 });
  track.tt = 34.75; sound.update([track], stop); muted = true; track.tt = 35; sound.update([track], stop);
  expect(tones).toHaveLength(0); sound.dispose();
});
