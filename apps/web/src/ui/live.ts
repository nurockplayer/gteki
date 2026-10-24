import type { RouteFailure, RouteResult } from "@gteki/navigation";
import type { Strings } from "../i18n.ts";

/** A route's unknown-fact kind in plain words (#203 B5): the card's badges and the live message share it. */
export function unknownLabel(t: Strings, kind: string): string {
  const label: Record<string, string> = { hours: t.unknownHours, wheelchair: t.unknownWheelchair, steps: t.unknownSteps, paid: t.unknownPaid, fare_boundary: t.unknownFare, access_evidence: t.unknownAccess };
  return label[kind] ?? kind;
}

/**
 * Why a route's freshness is stale (true) or unknown (null), in the card's own words — the badge says the
 * state, this says the cause. Null when the freshness is fresh.
 */
export function freshnessReason(t: Strings, r: RouteResult): string | null {
  if (r.stale === true) return r.expiredSourceIds?.length ? `${t.expired}: ${r.expiredSourceIds.join(", ")}` : `${t.oldestSource} ${r.oldestSourceDate ?? "?"}`;
  if (r.stale === null) return r.undatedSourceIds?.length ? `${t.undatedSources}: ${r.undatedSourceIds.join(", ")}` : `${t.oldestSource} ${r.oldestSourceDate ?? "?"}`;
  return null;
}

/**
 * One short announcement for a route result: the summary when found, the no-route heading otherwise. When the
 * route is stale or its freshness unknown, or some facts are unknown, it also says so (the same strings the
 * card uses) — a screen-reader user should not hear a route as fully known (#203 B5).
 */
export function routeLiveMessage(t: Strings, r: RouteResult | RouteFailure, failureText?: string): string {
  // A failure may add the card's own explanation (e.g. a shop with no directions), so sight and sound agree.
  if (!r.ok) return failureText ? joinLive([t.noRoute, failureText], t) : t.noRoute;
  const parts = [t.routeFound(Math.round(r.totalLengthM), Math.max(1, Math.round(r.estimatedSeconds / 60)))];
  if (r.stale === true) parts.push(t.stale);
  else if (r.stale === null) parts.push(t.freshnessUnknown);
  const reason = freshnessReason(t, r);
  if (reason) parts.push(reason);
  // Each unknown kind once, without counts: this is read aloud, not scanned.
  for (const kind of new Set((r.unknowns ?? []).map((u) => unknownLabel(t, u.kind)))) parts.push(kind);
  return joinLive(parts, t);
}

/** The search result count, or the empty-results message. */
export function searchLiveMessage(t: Strings, count: number): string {
  return count === 0 ? t.noResults : t.searchCount(count);
}

/** Messages raised in one burst, deduplicated and joined into one announcement. */
export function joinLive(messages: readonly string[], t: Strings): string {
  return [...new Set(messages.filter(Boolean))].join(t.liveSeparator);
}

/** Visually hidden polite live region. Messages raised within one burst are announced together; the region is cleared first so a repeated text is read again. */
export class LiveRegion {
  readonly el = document.createElement("div");
  private pending: string[] = [];
  private timer = 0;

  constructor(private readonly strings: () => Strings) {
    this.el.className = "sr-only";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    this.el.setAttribute("aria-atomic", "true");
  }

  announce(text: string): void {
    if (!text) return;
    this.pending.push(text);
    if (this.timer) return;
    this.el.textContent = "";
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.el.textContent = joinLive(this.pending, this.strings());
      this.pending = [];
    }, 60);
  }
}
