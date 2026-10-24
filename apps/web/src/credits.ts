import type { Source } from "@gteki/schema";
import type { Strings } from "./i18n.ts";

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
export function sourceCredit(s: Source): SourceCredit {
  return {
    title: s.title,
    href: safeHref(s.url),
    license: s.license ? { name: s.license.name, href: safeHref(s.license.url) } : null,
    attribution: s.attribution,
    modified: s.modified,
  };
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
  decision: { label: string; href: string | null } | null;
}

/** null unless rights is owner override; only an http(s) decision can be linked. */
export function overrideCredit(s: Source, t: Pick<Strings, "rightsReusable" | "rightsOwnerOverride" | "rightsReference" | "rightsRestricted" | "rightsUnverified" | "rightsDecision">): OverrideCredit | null {
  if (s.rights !== "PUBLISHED_UNDER_OWNER_OVERRIDE") return null;
  return {
    text: rightsLabel(s.rights, t),
    decision: s.override ? { label: `${t.rightsDecision} ${s.override.date}`, href: safeHref(s.override.decision) } : null,
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
