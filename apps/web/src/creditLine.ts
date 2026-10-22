import type { Asset, Source } from "@gteki/schema";
import { sourceCredit, type SourceCredit } from "./credits.ts";

/** The part of a station bundle the credit line reads. */
export interface CreditBundle {
  sources: readonly Source[];
  assets?: readonly Asset[];
}

const norm = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * The sources whose data is drawn in the explorer, in bundle order.
 * - Facts-only sources are evidence for facts; nothing derived from them is drawn.
 * - A station with visual assets draws exactly the sources those assets cite (collision-only assets are invisible).
 * - A station without visual assets (graph-only) is drawn from the graph, so every non-facts-only source counts.
 */
export function drawnSources(bundle: CreditBundle): Source[] {
  const usable = bundle.sources.filter((s) => s.usage !== "facts-only");
  const visual = (bundle.assets ?? []).filter((a) => a.role === "visual" || a.role === "visual+collision");
  if (!visual.length) return usable;
  const cited = new Set(visual.flatMap((a) => a.sourceIds));
  return usable.filter((s) => cited.has(s.id));
}

export interface CreditGroup {
  /** The shared attribution text (whitespace-normalised). */
  attribution: string;
  sources: Source[];
}

/** Group sources whose attribution text is identical (ignoring whitespace), in order of first appearance. */
export function groupByAttribution(sources: readonly Source[]): CreditGroup[] {
  const groups = new Map<string, CreditGroup>();
  for (const s of sources) {
    const key = norm(s.attribution);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.sources.push(s);
    else groups.set(key, { attribution: key, sources: [s] });
  }
  return [...groups.values()];
}

/** Distinct licences of a group (by name and link), in order. */
export function groupLicenses(sources: readonly Source[]): NonNullable<SourceCredit["license"]>[] {
  const seen = new Set<string>();
  const out: NonNullable<SourceCredit["license"]>[] = [];
  for (const s of sources) {
    const l = sourceCredit(s).license;
    if (!l) continue;
    const key = `${l.name}\n${l.href ?? ""}`;
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
