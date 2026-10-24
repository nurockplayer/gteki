import type { Asset, Coverage, Edge, Node, Poi, Source } from "@gteki/schema";
import { rightsLabel, sourceCredit, type SourceCredit } from "./credits.ts";
import type { Lang } from "./i18n.ts";

/** The part of a station bundle the credit line reads. */
export interface CreditBundle {
  sources: readonly Source[];
  assets?: readonly Asset[];
  /** The graph the explorer also draws (route lines, nodes, coverage, POIs); omitted = nothing of it counts. */
  nodes?: readonly Node[];
  edges?: readonly Edge[];
  pois?: readonly Poi[];
  coverage?: Pick<Coverage, "areas">;
}

const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Sources that back drawn graph geometry: node positions, edge polylines, coverage polygons and POI positions.
 * Evidence that only backs a fact (an edge's access evidence, a POI without a position, an area without a polygon) is not drawn.
 */
function graphGeometrySourceIds(bundle: CreditBundle): Set<string> {
  const ids = new Set<string>();
  for (const n of bundle.nodes ?? []) for (const r of n.sourceRefs) ids.add(r.sourceId);
  for (const e of bundle.edges ?? []) if (e.geometry?.length) for (const id of e.geometryEvidence.sourceIds) ids.add(id);
  for (const p of bundle.pois ?? []) if (p.displayPosition) for (const id of p.evidence.sourceIds) ids.add(id);
  for (const a of bundle.coverage?.areas ?? []) if (a.polygon?.length) for (const id of a.sourceIds) ids.add(id);
  return ids;
}

/**
 * The sources whose data is drawn in the explorer, in bundle order.
 * - Facts-only sources are evidence for facts; nothing derived from them is drawn.
 * - A station with visual assets draws the sources those assets cite (collision-only assets are invisible), plus the
 *   sources behind the graph geometry the explorer draws over or beside the scene (see `graphGeometrySourceIds`).
 * - A station without visual assets (graph-only) is drawn from the graph, so every non-facts-only source counts.
 */
export function drawnSources(bundle: CreditBundle): Source[] {
  const usable = bundle.sources.filter((s) => s.usage !== "facts-only");
  const visual = (bundle.assets ?? []).filter((a) => a.role === "visual" || a.role === "visual+collision");
  if (!visual.length) return usable;
  const cited = new Set([...visual.flatMap((a) => a.sourceIds), ...graphGeometrySourceIds(bundle)]);
  return usable.filter((s) => cited.has(s.id));
}

export interface CreditGroup {
  /** The shared attribution text (whitespace-normalised); empty for a source with none. */
  attribution: string;
  sources: Source[];
}

/**
 * Facts-only sources always credit on their own (the #26 wording and decision link belong to one source),
 * and a source with no attribution text has nothing to merge on.
 */
const mergeable = (s: Source): boolean => s.usage !== "facts-only" && norm(s.attribution) !== "";

/** Group sources whose attribution text is identical (ignoring whitespace), in order of first appearance. Unmergeable sources are left out. */
export function groupByAttribution(sources: readonly Source[]): CreditGroup[] {
  return creditEntries(sources.filter(mergeable));
}

/**
 * What the credits dialog lists: every source exactly once, in bundle order. Sources sharing an attribution
 * merge into one entry (at the first one's position); facts-only and blank-attribution sources stay single entries.
 */
export function creditEntries(sources: readonly Source[]): CreditGroup[] {
  const entries: CreditGroup[] = [];
  const merged = new Map<string, CreditGroup>();
  for (const s of sources) {
    const attribution = norm(s.attribution);
    if (!mergeable(s)) {
      entries.push({ attribution, sources: [s] });
      continue;
    }
    const g = merged.get(attribution);
    if (g) g.sources.push(s);
    else {
      const entry = { attribution, sources: [s] };
      merged.set(attribution, entry);
      entries.push(entry);
    }
  }
  return entries;
}

/** Plain-language rights of an entry's sources, each once (#130); facts-only sources say so through their own #26 line instead. */
export function entryRightsLabels(sources: readonly Source[], t: Parameters<typeof rightsLabel>[1]): string[] {
  return [...new Set(sources.filter((s) => s.usage !== "facts-only").map((s) => rightsLabel(s.rights, t)))];
}

/** Distinct licences of a group (by safe link and rights, or by resolved name and rights when unlinked), in order. */
export function groupLicenses(sources: readonly Source[], lang: Lang = "ja"): NonNullable<SourceCredit["license"]>[] {
  const seen = new Set<string>();
  const out: NonNullable<SourceCredit["license"]>[] = [];
  for (const s of sources) {
    const l = sourceCredit(s, lang).license;
    if (!l) continue;
    const key = l.href
      ? JSON.stringify([l.href, s.rights])
      : JSON.stringify([l.name, s.rights]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** The persistent credit line: each distinct attribution once, joined with " / ". Empty when nothing is drawn. */
export function composeCreditLine(sources: readonly Source[]): string {
  return groupByAttribution(sources).map((g) => g.attribution).join(" / ");
}

/** Credit line for a station bundle. */
export function creditLineFor(bundle: CreditBundle): string {
  return composeCreditLine(drawnSources(bundle));
}
