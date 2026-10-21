import type { Source } from "@gteki/schema";

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
