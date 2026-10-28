import type { RouteStep } from "@gteki/navigation";
import type { StationBundle } from "@gteki/schema";

/** Source titles behind the not-verified edges of the given steps, in step order, deduped. */
export function unverifiedSources(
  bundle: StationBundle,
  steps: readonly RouteStep[],
  stepIndexes?: readonly number[],
): string[] | null {
  const sources = new Map(bundle.sources.map((source) => [source.id, source.title]));
  const indexes = stepIndexes ?? steps.map((_, index) => index);
  const titles = new Set<string>();
  let hasUnverified = false;

  for (const index of indexes) {
    const step = steps[index];
    const edge = step && bundle.edges.find((candidate) => candidate.id === step.edgeId);
    // A synthetic demo edge is labelled as synthetic elsewhere; only unverified and geometry-only edges count here.
    if (!edge || edge.verification === "verified" || edge.verification === "synthetic") continue;
    hasUnverified = true;
    for (const sourceId of edge.geometryEvidence.sourceIds) titles.add(sources.get(sourceId) ?? sourceId);
  }

  return hasUnverified ? [...titles] : null;
}
