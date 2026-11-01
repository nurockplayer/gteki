/** Compare allowed fallback edge IDs. Metadata changes never authorize a new edge. */
export function fallbackDiff(allowed: readonly { edgeId: string }[], actual: readonly { edgeId: string }[]) {
  const allowedIds = new Set(allowed.map(entry => entry.edgeId));
  const actualIds = new Set(actual.map(entry => entry.edgeId));
  return {
    added: [...actualIds].filter(id => !allowedIds.has(id)).sort(),
    removed: [...allowedIds].filter(id => !actualIds.has(id)).sort(),
    duplicateAllowed: allowedIds.size !== allowed.length,
    duplicateActual: actualIds.size !== actual.length,
    grew: actual.length > allowed.length,
  };
}
