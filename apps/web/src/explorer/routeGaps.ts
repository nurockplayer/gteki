import type { V3 } from "./geometry.ts";

/** Sampling as in packages/godot route-clip-audit: every half metre of plan length, keeping each vertex. */
const STEP_M = 0.5;
/** Plan length of the floorless samples themselves; a shorter gap is a mesh seam, not unmodelled space. */
const MIN_RUN_M = 1;

/**
 * Stretches of a station-ENU route with no scene floor under them, each as a polyline that starts and
 * ends on the neighbouring floored sample (or the route's own end), so the "no model" overlay joins the
 * modelled route. Vertical pieces (lifts, under a step of plan length) only probe their ends.
 */
export function unmodelledRuns(points: readonly (V3 & { sceneGap?: boolean })[], hasFloor: (p: V3) => boolean): V3[][] {
  if (points.length < 2) return [];
  const samples: V3[] = [points[0]!];
  // A segment ending on a sceneGap point belongs to an edge the scene closes: unmodelled whatever the floor says.
  const forced: boolean[] = [false];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP_M));
    for (let k = 1; k <= n; k++) {
      samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n });
      forced.push(b.sceneGap === true && k < n);
    }
  }
  const bare = samples.map((s, i) => forced[i]! || !hasFloor(s));
  const runs: V3[][] = [];
  for (let i = 0; i < samples.length; i++) {
    if (!bare[i]) continue;
    let j = i;
    while (j + 1 < samples.length && bare[j + 1]) j++;
    let len = 0;
    for (let k = i + 1; k <= j; k++) len += Math.hypot(samples[k]!.x - samples[k - 1]!.x, samples[k]!.y - samples[k - 1]!.y);
    if (len >= MIN_RUN_M) runs.push(samples.slice(Math.max(0, i - 1), Math.min(samples.length, j + 2)));
    i = j;
  }
  return runs;
}
