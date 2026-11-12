/** Measure magenta voids and pixels changed by hiding the station root. */
export function goldenPixels(shown: Uint8Array, hidden: Uint8Array | null): { voidRatio: number; stationShare: number | null } {
  let empty = 0, changed = 0;
  for (let i = 0; i < shown.length; i += 4) {
    if (shown[i] === 255 && shown[i + 1] === 0 && shown[i + 2] === 255) empty++;
    if (hidden && (shown[i] !== hidden[i] || shown[i + 1] !== hidden[i + 1] || shown[i + 2] !== hidden[i + 2])) changed++;
  }
  return { voidRatio: empty / (shown.length / 4), stationShare: hidden ? changed / (shown.length / 4) : null };
}

/** Count pixels with an RGB channel differing by more than the capture tolerance. */
export function goldenPixelDiff(shown: Uint8Array, hidden: Uint8Array, tolerance = 3): number {
  let changed = 0;
  for (let i = 0; i < shown.length; i += 4) {
    if (Math.abs(shown[i]! - hidden[i]!) > tolerance || Math.abs(shown[i + 1]! - hidden[i + 1]!) > tolerance || Math.abs(shown[i + 2]! - hidden[i + 2]!) > tolerance) changed++;
  }
  return changed;
}
