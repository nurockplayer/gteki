import type { StationBundle } from "@gteki/schema";
import type { PolylinePoint } from "@gteki/navigation";

export type SpawnOrigin = { kind: "node"; nodeId: string } | { kind: "poi" };

/** Heading in compass degrees: 0 = north, 90 = east, clockwise, matching Explorer.walkFrom. */
export function spawnHeading(
  bundle: Pick<StationBundle, "spawnHeadings"> | null,
  origin: SpawnOrigin | null,
  polyline: readonly Pick<PolylinePoint, "x" | "y">[],
): number {
  if (origin?.kind === "node") {
    const heading = bundle?.spawnHeadings?.[origin.nodeId];
    if (heading !== undefined) return heading;
  }

  for (let i = 1; i < polyline.length; i++) {
    const from = polyline[i - 1]!;
    const to = polyline[i]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.hypot(dx, dy) > 0) return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  return 0;
}
