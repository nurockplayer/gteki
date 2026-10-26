/**
 * The Shinjuku (E27) station bundle, loaded from the shared-contract files in ../gteki/
 * through the core's fail-closed parser (shape check + truth-rule validation).
 */
import { parseStationFiles, type StationBundle, type ValidationIssue } from "@gteki/schema";
import manifest from "../gteki/station.json" with { type: "json" };
import graph from "../gteki/graph.json" with { type: "json" };
import pois from "../gteki/pois.json" with { type: "json" };
import tenants from "../gteki/tenants.json" with { type: "json" };

export function loadShinjukuBundle(): { bundle: StationBundle; issues: ValidationIssue[] } {
  const parsed = parseStationFiles(manifest, graph, pois, tenants);
  if (!parsed.ok) throw new Error(`Shinjuku station files failed validation: ${parsed.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
  return { bundle: parsed.bundle, issues: parsed.issues };
}
