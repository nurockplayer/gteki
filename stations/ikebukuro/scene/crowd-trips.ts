// Trips for the ambient crowd (#627): each commuter walks to a chosen exit or ticket gate instead of
// picking a random edge at every junction. Pure graph logic over the verified edge lengths, no three.js
// and no route data of its own; crowd.ts builds one table at build time and reuses the paths it already
// has. Game simulation, not passenger data.

export interface TripEdge {
  from: string;
  to: string;
  length: number;
}

/** One dead-end's row: distance to it from every node, and the path to take from a node on the shortest way there. */
export interface TripRow {
  dist: Map<string, number>;
  next: Map<string, number>;
}

export interface TripTable {
  /** Nodes on exactly one path, in path order (exits, gate ends). */
  deadEnds: readonly string[];
  row(dest: string): TripRow | undefined;
}

/**
 * Dijkstra from each dead-end over the two-way paths. Rows are keyed by the dead-end node the walker is
 * heading to; `next.get(node)` is the path index that leads there from `node`.
 */
export function buildTripTable(paths: readonly TripEdge[]): TripTable {
  const nodes: string[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();
  const adjacency = new Map<string, { to: string; path: number; length: number }[]>();
  const node = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      nodes.push(id);
      adjacency.set(id, []);
    }
  };
  paths.forEach((p, i) => {
    node(p.from);
    node(p.to);
    degree.set(p.from, (degree.get(p.from) ?? 0) + 1);
    degree.set(p.to, (degree.get(p.to) ?? 0) + 1);
    const length = Math.max(0, p.length);
    adjacency.get(p.from)!.push({ to: p.to, path: i, length });
    adjacency.get(p.to)!.push({ to: p.from, path: i, length });
  });
  const deadEnds = nodes.filter((n) => degree.get(n) === 1);
  const rows = new Map<string, TripRow>();
  for (const start of deadEnds) {
    const dist = new Map<string, number>([[start, 0]]);
    const next = new Map<string, number>();
    const done = new Set<string>();
    for (;;) {
      let at: string | null = null;
      let best = Infinity;
      for (const n of nodes) {
        if (done.has(n)) continue;
        const d = dist.get(n);
        if (d !== undefined && d < best) {
          best = d;
          at = n;
        }
      }
      if (at === null) break;
      done.add(at);
      for (const e of adjacency.get(at)!) {
        const d = best + e.length;
        if (d < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, d);
          next.set(e.to, e.path);
        }
      }
    }
    rows.set(start, { dist, next });
  }
  return { deadEnds, row: (dest) => rows.get(dest) };
}

/**
 * A destination the walker can reach without turning back: a dead-end strictly closer through the node
 * ahead than through the node behind. With probability `toGate` a ticket gate if one qualifies, else a
 * non-gate dead-end; null when nothing qualifies. `exclude` names dead-ends that are never candidates
 * (a full gate line, for one): they are skipped entirely, not reclassified as non-gates.
 */
export function pickDestination(
  table: TripTable,
  ahead: string,
  behind: string,
  gates: readonly string[],
  toGate: number,
  rand: () => number,
  exclude: readonly string[] = [],
): string | null {
  const gateSet = new Set(gates);
  const eligible = (d: string): boolean => {
    if (exclude.includes(d)) return false;
    const row = table.row(d);
    if (!row) return false;
    const a = row.dist.get(ahead);
    const b = row.dist.get(behind);
    return a !== undefined && b !== undefined && a < b;
  };
  let gateCount = 0;
  let otherCount = 0;
  for (const d of table.deadEnds) {
    if (!eligible(d)) continue;
    if (gateSet.has(d)) gateCount++;
    else otherCount++;
  }
  const wantGate = gateCount > 0 && rand() < toGate;
  const count = wantGate ? gateCount : otherCount || gateCount;
  if (count === 0) return null;
  let k = Math.floor(rand() * count);
  for (const d of table.deadEnds) {
    if (!eligible(d) || (wantGate ? !gateSet.has(d) : otherCount > 0 && gateSet.has(d))) continue;
    if (k-- === 0) return d;
  }
  return null;
}

/** Minimum remaining distance (m) for the person behind: one queue gap clear of the person ahead. */
export function queueLimit(remainingAhead: number, gap: number): number {
  return remainingAhead + gap;
}
