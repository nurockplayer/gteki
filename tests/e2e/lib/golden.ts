/** Largest share of pixels in a 16-level-per-channel RGB bucket. */
export function flatRatio(rgba: ArrayLike<number>): number {
  const buckets = new Uint32Array(4096);
  let largest = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const bucket = (rgba[i]! >> 4) * 256 + (rgba[i + 1]! >> 4) * 16 + (rgba[i + 2]! >> 4);
    largest = Math.max(largest, ++buckets[bucket]!);
  }
  return rgba.length ? largest / (rgba.length / 4) : 0;
}

export type Metric = "voidRatio" | "stationShare" | "flatRatio" | "nearBlack" | `feature:${string}`;
export function evaluateCheck(metric: Metric, value: number, threshold: number, known?: Partial<Record<Metric, string>>) {
  const passes = (metric === "stationShare" || metric.startsWith("feature:")) ? value >= threshold : value <= threshold;
  return { metric, value, threshold, status: passes ? "pass" : known?.[metric] ? "known" : "fail", issue: passes ? undefined : known?.[metric] };
}
