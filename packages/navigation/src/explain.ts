import type { Edge, EvidenceRef, Poi, StationBundle } from "@gteki/schema";
import type { RouteFailure, RouteProfile, RouteResult, Router } from "./index.ts";
import { routeBetween, type RouteEndpoint } from "./poi.ts";

/**
 * Explaining a `no_path`: which of the traveller's own restrictive options made the router refuse.
 * It only re-asks the router with options relaxed; it never changes what the router answers.
 */

/** The profile options that can make a route refuse (each one the traveller switched on). */
export type NoPathOption = "stepFree" | "unpaidOnly" | "strictHours" | "avoidModes";

/**
 * What the refusing edges of the relaxed route say about the fact the option filters on. Only edges the
 * option itself refuses count (traversable with the option relaxed, not with it on):
 * - "unknown": every refusing edge refuses on an UNKNOWN fact (unsurveyed, e.g. wheelchair access unevidenced).
 *   Never read this as "known inaccessible".
 * - "known": every refusing edge refuses on a known fact (stairs/escalator, a recorded inaccessible or fare-gate
 *   edge, an avoided mode).
 * - "mixed": both.
 * Hours: `require_known` only ever excludes UNKNOWN hours, so it is always "unknown".
 */
export type NoPathEvidence = "unknown" | "known" | "mixed";

export interface NoPathOptionCause {
  option: NoPathOption;
  /** null when no refusing edge could be found on the route (say nothing about the facts). */
  evidence: NoPathEvidence | null;
  /** False when some edge of the route could not be checked (not in the edge list), so the refusal can't be fully attributed. */
  complete: boolean;
}

export interface NoPathEndpoint {
  end: "origin" | "destination";
  /** The POI's `paid` flag: true = inside the ticket gates, null = not known to be outside. */
  paid: true | null;
}

export type NoPathCause =
  /** Relaxing each listed option alone finds a route (every one is sufficient on its own). */
  | { kind: "option"; options: NoPathOptionCause[] }
  /** No single option is enough, but relaxing all of `options` together finds a route. */
  | { kind: "combination"; options: NoPathOption[] }
  /** `unpaid_only` refuses the origin and/or destination POI itself (not known to be outside the paid area), whatever the passages are. */
  | { kind: "endpoint"; ends: NoPathEndpoint[] }
  /** Even with every option in `relaxed` off (none when no option was on) there is no route: the verified graph does not connect the points. */
  | { kind: "none"; relaxed: NoPathOption[] }
  /** A retry hit `search_limit` and none succeeded: which option is responsible is UNKNOWN, never guessed. */
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

/** The profile without a departure time: edge traversability then depends on the options only, not on waits. */
function untimed(profile: RouteProfile): RouteProfile {
  const { at: _at, ...rest } = profile;
  return rest;
}

/** Whether `edge` is refused by `option` on a known fact (true) or an UNKNOWN one (false); mirrors the router's rules. */
function refusesOnKnownFact(option: NoPathOption, edge: Edge): boolean {
  // Without accessEvidence every access flag is UNKNOWN to the router.
  const access = edge.accessEvidence ? edge : { paid: null, crossesFareBoundary: null, wheelchair: null, steps: null };
  switch (option) {
    case "stepFree": return edge.mode === "stairs" || edge.mode === "escalator" || access.wheelchair === false || access.steps === true;
    case "unpaidOnly": return access.paid === true || access.crossesFareBoundary === true;
    case "strictHours": return false;
    case "avoidModes": return true;
  }
}

/** What the edges of `route` (found with `option` relaxed) that `option` itself refuses say about the fact it filters on. */
function causeOf(option: NoPathOption, route: RouteResult, profile: RouteProfile, edges: ReadonlyMap<string, Edge>, router: Router): NoPathOptionCause {
  const original = untimed(profile);
  const relaxed = untimed(relax(profile, [option]));
  let known = false;
  let unknown = false;
  let complete = true;
  for (const step of route.steps) {
    const edge = edges.get(step.edgeId);
    if (!edge) { complete = false; continue; }
    if (router.isTraversable(edge, original)) continue; // not refused: not a blocker
    if (!router.isTraversable(edge, relaxed)) { complete = false; continue; } // refusal not down to this option
    if (refusesOnKnownFact(option, edge)) known = true; else unknown = true;
  }
  return { option, evidence: known && unknown ? "mixed" : known ? "known" : unknown ? "unknown" : null, complete };
}

export interface NoPathContext {
  router: Router;
  /** The bundle's edges (or the bundle): what the route's steps are looked up in. */
  bundle: Pick<StationBundle, "edges">;
}

/**
 * Explains a `no_path` by re-asking `attempt` (a route query under a given profile) with the options in
 * `profile` relaxed. Call it only after `attempt(profile)` failed with `no_path`.
 *
 * Extra `attempt` calls: at most (enabled options) + 1, and 0 when no restrictive option is enabled; the
 * "all relaxed together" retry is skipped when only one option is enabled (it is that option's own retry),
 * and when a single option already works. A retry that returns `search_limit` is skipped over; the cause is
 * `unknown` only when no option succeeded and one did.
 */
export function explainNoPathWith(attempt: (profile: RouteProfile) => RouteResult | RouteFailure, profile: RouteProfile, context: NoPathContext): NoPathCause {
  const enabled = enabledOptions(profile);
  if (enabled.length === 0) return { kind: "none", relaxed: [] };
  const edges = new Map(context.bundle.edges.map((e) => [e.id, e]));
  const sufficient: NoPathOptionCause[] = [];
  let limited = false;
  for (const option of enabled) {
    const retry = attempt(relax(profile, [option]));
    if (retry.ok) sufficient.push(causeOf(option, retry, profile, edges, context.router));
    else if (retry.reason === "search_limit") limited = true;
  }
  if (sufficient.length > 0) return { kind: "option", options: sufficient };
  if (limited) return { kind: "unknown" };
  if (enabled.length === 1) return { kind: "none", relaxed: enabled };
  const all = attempt(relax(profile, enabled));
  if (all.ok) return { kind: "combination", options: enabled };
  return all.reason === "search_limit" ? { kind: "unknown" } : { kind: "none", relaxed: enabled };
}

/** `explainNoPathWith` for a plain `router.route(from, to, …)` query. */
export function explainNoPath(
  router: Router,
  bundle: Pick<StationBundle, "edges">,
  from: string | string[],
  to: string | string[],
  profile: RouteProfile,
  endpointEvidence?: readonly EvidenceRef[],
): NoPathCause {
  return explainNoPathWith((p) => router.route(from, to, p, endpointEvidence), profile, { router, bundle });
}

/**
 * `explainNoPath` for a `routeBetween` query. Under `unpaid_only`, `routeBetween` itself refuses an origin or
 * destination POI that isn't known to be outside the paid area: that is reported as `endpoint` (no router
 * call), separately from the passages.
 */
export function explainNoPathBetween(router: Router, bundle: Pick<StationBundle, "edges">, from: RouteEndpoint, to: Poi, profile: RouteProfile): NoPathCause {
  if (profile.fare === "unpaid_only") {
    const ends: NoPathEndpoint[] = [];
    if (from.kind === "poi" && from.poi.paid !== false) ends.push({ end: "origin", paid: from.poi.paid });
    if (to.paid !== false) ends.push({ end: "destination", paid: to.paid });
    if (ends.length > 0) return { kind: "endpoint", ends };
  }
  return explainNoPathWith((p) => routeBetween(router, from, to, p), profile, { router, bundle });
}
