import type { LocalizedText, Source } from "@gteki/schema";
import type { Strings } from "./i18n.ts";
import { coverageText, type Lang } from "./i18n.ts";

/** A source's credit as shown to users: link, licence (with its link) and the modification notice. */
export interface SourceCredit {
  title: string;
  /** Landing page, only when it is an http(s) URL (station data never becomes a script link). */
  href: string | null;
  license: { name: string; href: string | null } | null;
  attribution: string;
  modified: boolean;
}

export function safeHref(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** CC BY and PDL 1.0 attribution must name the licence and say when the data was modified. */
export function sourceCredit(s: Source, lang: Lang = "ja"): SourceCredit {
  return {
    title: s.title,
    href: safeHref(s.url),
    license: s.license ? { name: coverageText(s.license.name, lang), href: safeHref(s.license.url) } : null,
    attribution: s.attribution,
    modified: s.modified,
  };
}

/** Render model for an asset provenance row; without a summary it preserves the legacy full text. */
export function assetDerivationPresentation(
  derivation: string,
  summary: LocalizedText[] | undefined,
  lang: Lang,
  detailsLabel: string,
): { text: string; details: string | null; detailsLabel: string | null } {
  if (!summary?.length) return { text: derivation, details: null, detailsLabel: null };
  return { text: coverageText(summary, lang), details: derivation, detailsLabel };
}

/** The extra line a facts-only source carries instead of a licence: the #26 wording and, when safe, the decision link. */
export interface FactsOnlyCredit {
  text: string;
  decision: { label: string; href: string } | null;
}

/** null unless `usage === "facts-only"`; the decision link needs `decision.url` to be an http(s) URL. */
export function factsOnlyCredit(s: Source, t: Pick<Strings, "factsOnly" | "rightsDecision">): FactsOnlyCredit | null {
  if (s.usage !== "facts-only") return null;
  const href = safeHref(s.decision?.url);
  return {
    text: t.factsOnly,
    decision: s.decision && href ? { label: `${t.rightsDecision} ${s.decision.date}`, href } : null,
  };
}

export interface OverrideCredit {
  text: string;
  decisions: { label: string; href: string | null }[];
}

/** null unless a source has owner-override rights; only http(s) decisions can be linked. */
export function overrideCredits(sources: readonly Source[], t: Pick<Strings, "rightsReusable" | "rightsOwnerOverride" | "rightsReference" | "rightsRestricted" | "rightsUnverified" | "rightsDecision">): OverrideCredit | null {
  const overrides = sources.filter((s) => s.rights === "PUBLISHED_UNDER_OWNER_OVERRIDE");
  if (!overrides.length) return null;
  const seen = new Set<string>();
  const decisions: OverrideCredit["decisions"] = [];
  for (const s of overrides) {
    if (!s.override) continue;
    const key = JSON.stringify([s.override.decision, s.override.date]);
    if (seen.has(key)) continue;
    seen.add(key);
    const href = safeHref(s.override.decision);
    const reference = href || !/^#\d+$/.test(s.override.decision) ? "" : ` ${s.override.decision}`;
    decisions.push({ label: `${t.rightsDecision}${reference} ${s.override.date}`, href });
  }
  return {
    text: rightsLabel("PUBLISHED_UNDER_OWNER_OVERRIDE", t),
    decisions,
  };
}

/** Human wording for a source's rights status (#130); an unknown value reads as unverified rather than leaking the enum. */
export function rightsLabel(rights: Source["rights"], t: Pick<Strings, "rightsReusable" | "rightsOwnerOverride" | "rightsReference" | "rightsRestricted" | "rightsUnverified">): string {
  switch (rights) {
    case "REUSABLE_WITH_CONDITIONS": return t.rightsReusable;
    case "PUBLISHED_UNDER_OWNER_OVERRIDE": return t.rightsOwnerOverride;
    case "REFERENCE_ONLY": return t.rightsReference;
    case "RESTRICTED": return t.rightsRestricted;
    default: return t.rightsUnverified;
  }
}
