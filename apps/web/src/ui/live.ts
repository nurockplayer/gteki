import type { RouteFailure, RouteResult } from "@gteki/navigation";
import type { Strings } from "../i18n.ts";

/** One short sentence for a route result: the summary when found, the no-route heading otherwise. */
export function routeLiveMessage(t: Strings, r: RouteResult | RouteFailure): string {
  if (!r.ok) return t.noRoute;
  return t.routeFound(Math.round(r.totalLengthM), Math.max(1, Math.round(r.estimatedSeconds / 60)));
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
