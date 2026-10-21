import type { EvidenceRef } from "@gteki/schema";
import type { RouteFailure, RouteProfile, RouteResult, Router } from "./index.ts";

/**
 * Explaining a `no_path`: which of the traveller's own restrictive options made the router refuse.
 * It only re-asks the router with options relaxed; it never changes what the router answers.
 */

/** The profile options that can make a route refuse (each one the traveller switched on). */
export type NoPathOption = "stepFree" | "unpaidOnly" | "strictHours" | "avoidModes";

/**
 * What the relaxed route says about the fact the option filters on:
 * - "unknown": it uses edges whose relevant fact is UNKNOWN (unsurveyed, e.g. wheelchair access unevidenced),
 *   and none of its edges is evidently against the option. Never read this as "known inaccessible".
 * - "known": the edges that break the option do so by a known fact (stairs/escalator for step-free,
 *   a known fare-gate crossing, an avoided mode); no relevant fact on the route is UNKNOWN.
 * - "mixed": both. A flat edge that is known to be inaccessible cannot be told from an accessible one in a
 *   `RouteResult`, so "unknown" only says UNKNOWN edges are on the route found, not that nothing else is known-not.
 * Hours: `require_known` only ever excludes UNKNOWN hours, so it is always "unknown".
 */
export type NoPathEvidence = "unknown" | "known" | "mixed";

export interface NoPathOptionCause {
  option: NoPathOption;
  evidence: NoPathEvidence;
}

export type NoPathCause =
  /** Relaxing each listed option alone finds a route (every one is sufficient on its own). */
  | { kind: "option"; options: NoPathOptionCause[] }
  /** No single option is enough, but relaxing all of `options` together finds a route. */
  | { kind: "combination"; options: NoPathOption[] }
  /** Even with every option relaxed there is no route: the verified graph does not connect the points. */
  | { kind: "none" }
  /** A retry hit `search_limit`: which option is responsible is UNKNOWN, never guessed. */
  | { kind: "unknown" };

/** The options this profile restricts with; only these can be responsible. */
function enabledOptions(profile: RouteProfile): NoPathOption[] {
  const options: NoPathOption[] = [];
  if (profile.stepFree) options.push("stepFree");
  if (profile.fare === "unpaid_only") options.push("unpaidOnly");
  if (profile.hours === "require_known") options.push("strictHours");
  if (profile.avoidModes && profile.avoidModes.length > 0) options.push("avoidModes");
  return options;
}

/** The profile with these options relaxed (everything else, including `at`, `today` and closures, kept). */
function relax(profile: RouteProfile, options: readonly NoPathOption[]): RouteProfile {
  const out: RouteProfile = { ...profile };
  if (options.includes("stepFree")) out.stepFree = false;
  if (options.includes("unpaidOnly")) out.fare = "ticketed";
  if (options.includes("strictHours")) out.hours = "warn_unknown";
  if (options.includes("avoidModes")) delete out.avoidModes;
  return out;
}

function hasUnknown(route: RouteResult, kinds: readonly string[]): boolean {
  return route.unknowns.some((u) => kinds.includes(u.kind) && u.edgeIds.length > 0);
}

/** What `route`, found with `option` relaxed, says about the fact `option` filters on. */
function evidenceOf(option: NoPathOption, route: RouteResult): NoPathEvidence {
  if (option === "strictHours") return "unknown";
  if (option === "avoidModes") return "known";
  const unknown = option === "stepFree"
    ? hasUnknown(route, ["wheelchair", "steps", "access_evidence"])
    : hasUnknown(route, ["paid", "fare_boundary", "access_evidence"]);
  const against = option === "stepFree"
    ? route.steps.some((s) => s.mode === "stairs" || s.mode === "escalator")
    : route.crossesFareBoundary === true;
  // The router needed this option relaxed, so some edge breaks it; with nothing UNKNOWN on the route that is a known fact.
  if (unknown && against) return "mixed";
  return unknown ? "unknown" : "known";
}

/**
 * Explains a `no_path` by re-asking `attempt` (a route query under a given profile) with the options in
 * `profile` relaxed. Call it only after `attempt(profile)` failed with `no_path`.
 *
 * Extra `attempt` calls: at most (enabled options) + 1, and 0 when no restrictive option is enabled; the
 * "all relaxed together" retry is skipped when only one option is enabled (it is that option's own retry).
 * Any retry that returns `search_limit` makes the cause `unknown`.
 */
export function explainNoPathWith(attempt: (profile: RouteProfile) => RouteResult | RouteFailure, profile: RouteProfile): NoPathCause {
  const enabled = enabledOptions(profile);
  if (enabled.length === 0) return { kind: "none" };
  const sufficient: NoPathOptionCause[] = [];
  for (const option of enabled) {
    const retry = attempt(relax(profile, [option]));
    if (retry.ok) sufficient.push({ option, evidence: evidenceOf(option, retry) });
    else if (retry.reason === "search_limit") return { kind: "unknown" };
  }
  if (sufficient.length > 0) return { kind: "option", options: sufficient };
  if (enabled.length === 1) return { kind: "none" };
  const all = attempt(relax(profile, enabled));
  if (all.ok) return { kind: "combination", options: enabled };
  return all.reason === "search_limit" ? { kind: "unknown" } : { kind: "none" };
}

/** `explainNoPathWith` for a plain `router.route(from, to, …)` query. */
export function explainNoPath(
  router: Router,
  from: string | string[],
  to: string | string[],
  profile: RouteProfile,
  endpointEvidence?: readonly EvidenceRef[],
): NoPathCause {
  return explainNoPathWith((p) => router.route(from, to, p, endpointEvidence), profile);
}
