// Original synthesized train sound (#870): no recordings and no imitation of any real train or door chime.
import type { V3 } from "../../ikebukuro/scene/station-sound.ts";

type Track = { tt: number; headway: number; stop: V3; stopEnds: [V3, V3]; pos: V3 | null };
type Cue = "approach" | "brake" | "doorOpen" | "doorClose";

export function trainSoundCues(prevTt: number, tt: number, headway: number): Cue[] {
  const gap = (tt - prevTt + headway) % headway;
  if (gap > 2) return [];
  const cues: [Cue, number][] = [["approach", headway - 12], ["brake", 8], ["doorOpen", 16], ["doorClose", 35]];
  return cues.filter(([, at]) => { const d = (at - prevTt + headway) % headway; return d > 0 && d <= gap; }).sort((a, b) => (a[1] - prevTt + headway) % headway - (b[1] - prevTt + headway) % headway).map(([cue]) => cue);
}

export function rumbleLevel(tt: number): number {
  if (tt < 14) return 0.08 + 0.18 * (1 - tt / 14);
  if (tt < 40) return 0.04;
  if (tt < 54) return 0.08 + 0.18 * ((tt - 40) / 14);
  return 0;
}
export function rumbleCutoffHz(tt: number): number { return 180 + rumbleLevel(tt) * 1800; }

export function createTrainSound({ context, destination, chimeAt, isMuted = () => false }: { context: AudioContext; destination: AudioNode; chimeAt: (at: V3) => void; isMuted?: () => boolean }) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
  const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
  const filter = context.createBiquadFilter(); filter.type = "lowpass";
  const gain = context.createGain(); gain.gain.value = 0;
  const panner = context.createPanner(); panner.panningModel = "equalpower"; panner.distanceModel = "inverse"; panner.refDistance = 3;
  source.connect(filter).connect(gain).connect(panner).connect(destination); source.start();
  const prev: number[] = [];
  let disposed = false;
  function position(p: PannerNode, at: V3) { if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; } else p.setPosition(at.x, at.y, at.z); }
  function oneShot(cue: Cue, at: V3) {
    if (cue === "approach") { chimeAt(at); return; }
    const pan = context.createPanner(); pan.panningModel = "equalpower"; pan.distanceModel = "inverse"; pan.refDistance = 3; position(pan, at); pan.connect(destination);
    const now = context.currentTime;
    const duration = cue === "brake" ? 1.2 : 0.18;
    const noise = context.createBufferSource(); noise.buffer = buffer;
    const bp = context.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = cue === "brake" ? 900 : 500;
    const g = context.createGain(); g.gain.setValueAtTime(cue === "brake" ? 0.08 : 0.025, now); g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(bp).connect(g).connect(pan); noise.start(now); noise.stop(now + duration); noise.onended = () => { noise.disconnect(); bp.disconnect(); g.disconnect(); if (cue === "brake") pan.disconnect(); };
    if (cue !== "brake") for (const [i, frequency] of (cue === "doorOpen" ? [520, 660] : [660, 520]).entries()) {
      const osc = context.createOscillator(); const tone = context.createGain(); const start = now + i * 0.16;
      osc.type = "sine"; osc.frequency.setValueAtTime(frequency, start); tone.gain.setValueAtTime(0.05, start); tone.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(tone).connect(pan); osc.start(start); osc.stop(start + 0.2); osc.onended = () => { osc.disconnect(); tone.disconnect(); if (i === 1) pan.disconnect(); };
    }
  }
  return {
    update(tracks: Track[], listener: V3) {
      if (disposed) return;
      let nearest: Track | undefined; let distance = Infinity;
      tracks.forEach((track, i) => {
        if (prev[i] !== undefined) for (const cue of trainSoundCues(prev[i]!, track.tt, track.headway)) {
          const offset = cue === "brake" && track.pos ? { x: track.pos.x - track.stop.x, y: track.pos.y - track.stop.y, z: track.pos.z - track.stop.z } : { x: 0, y: 0, z: 0 };
          const [a, b] = track.stopEnds;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const lengthSquared = dx * dx + dy * dy + dz * dz;
          const along = lengthSquared ? Math.max(0, Math.min(1, ((listener.x - a.x - offset.x) * dx + (listener.y - a.y - offset.y) * dy + (listener.z - a.z - offset.z) * dz) / lengthSquared)) : 0;
          const at = { x: a.x + along * dx + offset.x, y: a.y + along * dy + offset.y, z: a.z + along * dz + offset.z };
          if (context.state === "running" && !isMuted() && Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z) <= 40) oneShot(cue, at);
        }
        prev[i] = track.tt;
        if (track.pos) { const d = Math.hypot(track.pos.x - listener.x, track.pos.y - listener.y, track.pos.z - listener.z); if (d < distance) { distance = d; nearest = track; } }
      });
      if (nearest?.pos) position(panner, nearest.pos);
      gain.gain.setTargetAtTime(nearest ? rumbleLevel(nearest.tt) : 0, context.currentTime, 0.1);
      filter.frequency.setTargetAtTime(nearest ? rumbleCutoffHz(nearest.tt) : 180, context.currentTime, 0.1);
    },
    dispose() { if (disposed) return; disposed = true; source.stop(); source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); },
  };
}
