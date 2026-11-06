// The cat avatar's synthesized sounds (WebAudio only, no recordings, so no licensing questions):
// a meow that fits the rig's MEOW_SECONDS clip and soft paw taps on the surface underfoot.
// Style follows stations/ikebukuro/scene/ambience.ts: pure helpers first, nodes built inline.
import type { StationZone } from "./zones.ts";

/** Meow glide: up into the vowel, then down, well inside catMeow.ts's MEOW_SECONDS clip. */
export const MEOW_GLIDE_S = 0.55;
export const MEOW_HZ = { start: 600, peak: 900, end: 550 } as const;

/** One paw step per this much ground travelled. */
export const PAW_STEP_M = 0.25;

export type PawSurface = "tile" | "pavement" | "stairs";

/**
 * The surface under the cat's paws. The station data has no floor material, so this is the simple
 * reading of "floor type": stairs when on a stair span, pavement outdoors, tile everywhere else.
 */
export function pawSurface(zone: StationZone, onStairs: boolean): PawSurface {
  if (onStairs) return "stairs";
  return zone === "outdoor" ? "pavement" : "tile";
}

/** Turn the distance walked into whole paw steps and keep the remainder for the next frame. */
export function advancePaws(carriedM: number, movedM: number): { carriedM: number; steps: number } {
  const total = carriedM + movedM;
  const steps = Math.floor(total / PAW_STEP_M);
  return { carriedM: total - steps * PAW_STEP_M, steps };
}

/** One shared noise buffer per context: a paw tap must not allocate on every step. */
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

function sharedNoise(ctx: AudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  noiseBuffers.set(ctx, buf);
  return buf;
}

/** The cat's meow: a sawtooth gliding 600 → 900 → 550 Hz through a band-pass, attack and release. */
export function playCatMeow(context: AudioContext, destination: AudioNode): void {
  const at = context.currentTime;
  const osc = context.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(MEOW_HZ.start, at);
  osc.frequency.linearRampToValueAtTime(MEOW_HZ.peak, at + MEOW_GLIDE_S * 0.4);
  osc.frequency.linearRampToValueAtTime(MEOW_HZ.end, at + MEOW_GLIDE_S);
  const body = context.createBiquadFilter();
  body.type = "bandpass";
  body.frequency.value = 1200;
  body.Q.value = 1.2;
  const g = context.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.12, at + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, at + MEOW_GLIDE_S);
  osc.connect(body).connect(g).connect(destination);
  osc.start(at);
  osc.stop(at + MEOW_GLIDE_S);
}

/** A soft paw tap: a short filtered noise burst, quiet enough to sit under the station bed. */
export function playPawStep(context: AudioContext, destination: AudioNode, surface: PawSurface): void {
  const at = context.currentTime;
  const src = context.createBufferSource();
  src.buffer = sharedNoise(context);
  const bp = context.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = surface === "pavement" ? 900 : 2400;
  bp.Q.value = 1.2;
  const g = context.createGain();
  const peak = surface === "stairs" ? 0.05 : 0.04;
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0005, at + 0.05);
  src.connect(bp).connect(g).connect(destination);
  src.start(at);
  src.stop(at + 0.06);
}
