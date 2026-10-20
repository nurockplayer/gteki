import type { Edge, StationBundle } from "./index.ts";
import { SCHEMA_VERSION } from "./index.ts";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  ref?: string;
}

const ROUTABLE_MODES = new Set(["walk", "stairs", "escalator", "elevator", "ramp", "moving_walkway", "gate"]);

/** Structural + truth-rule validation. Errors must block publishing a bundle. */
export function validateBundle(b: StationBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, ref?: string) => issues.push({ level: "error", code, message, ref });
  const warn = (code: string, message: string, ref?: string) => issues.push({ level: "warning", code, message, ref });

  if (b.schema !== SCHEMA_VERSION) err("schema.version", `expected ${SCHEMA_VERSION}, got ${String(b.schema)}`);
  if (b.station.frame !== "ENU") err("station.frame", "station frame must be ENU");

  const sourceIds = new Set<string>();
  for (const s of b.sources) {
    if (sourceIds.has(s.id)) err("source.dup", `duplicate source id`, s.id);
    sourceIds.add(s.id);
    if (!b.station.synthetic && s.rights !== "REUSABLE_WITH_CONDITIONS")
      warn("source.rights", `source rights ${s.rights}; must not feed published geometry/data`, s.id);
  }

  const operatorIds = new Set(b.station.operators.map((o) => o.id));
  const floorIds = new Set<string>();
  for (const f of b.floors) {
    if (floorIds.has(f.id)) err("floor.dup", "duplicate floor id", f.id);
    floorIds.add(f.id);
    if (!operatorIds.has(f.operatorId)) err("floor.operator", `unknown operator ${f.operatorId}`, f.id);
    for (const l of f.sourceLabels) if (!sourceIds.has(l.sourceId)) err("floor.source", `unknown source ${l.sourceId}`, f.id);
    if (f.elevationM === null && f.elevationSource === "measured")
      err("floor.elevation", "measured elevation cannot be null", f.id);
    if (f.elevationM !== null && f.elevationSource === "symbolic")
      err("floor.elevation", "symbolic elevation must keep elevationM null", f.id);
  }

  const nodeIds = new Set<string>();
  for (const n of b.nodes) {
    if (nodeIds.has(n.id)) err("node.dup", "duplicate node id", n.id);
    nodeIds.add(n.id);
    if (!floorIds.has(n.floorId)) err("node.floor", `unknown floor ${n.floorId}`, n.id);
    if (!Number.isFinite(n.position.x) || !Number.isFinite(n.position.y)) err("node.position", "non-finite xy", n.id);
    for (const r of n.sourceRefs) if (!sourceIds.has(r.sourceId)) err("node.source", `unknown source ${r.sourceId}`, n.id);
  }

  const edgeIds = new Set<string>();
  const checkEvidence = (e: Edge, ev: Edge["geometryEvidence"] | null, label: string) => {
    if (!ev) return;
    for (const s of ev.sourceIds) if (!sourceIds.has(s)) err("edge.evidence", `${label}: unknown source ${s}`, e.id);
  };
  for (const e of b.edges) {
    if (edgeIds.has(e.id)) err("edge.dup", "duplicate edge id", e.id);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) err("edge.from", `unknown node ${e.from}`, e.id);
    if (!nodeIds.has(e.to)) err("edge.to", `unknown node ${e.to}`, e.id);
    if (e.from === e.to) err("edge.loop", "self-loop", e.id);
    if (!ROUTABLE_MODES.has(e.mode)) err("edge.mode", `unknown mode ${e.mode}`, e.id);
    if (e.lengthM !== null && !(e.lengthM >= 0)) err("edge.length", "negative/NaN length", e.id);
    if (e.verification === "synthetic" && !b.station.synthetic)
      err("edge.synthetic", "synthetic edge in a non-synthetic bundle", e.id);
    if (e.verification === "verified" && !e.accessEvidence)
      warn("edge.access", "verified edge without access evidence; access facts are UNKNOWN", e.id);
    checkEvidence(e, e.geometryEvidence, "geometryEvidence");
    checkEvidence(e, e.accessEvidence, "accessEvidence");
    if (e.crossesFareBoundary === true && e.paid === false)
      err("edge.fare", "fare-boundary edge cannot be marked fully unpaid", e.id);
  }

  for (const p of b.pois) {
    if (p.floorId !== null && !floorIds.has(p.floorId)) err("poi.floor", `unknown floor ${p.floorId}`, p.id);
    if (p.names.length === 0) err("poi.name", "POI without a name", p.id);
    for (const c of p.connectorNodeIds) if (!nodeIds.has(c)) err("poi.connector", `unknown node ${c}`, p.id);
    for (const s of p.evidence.sourceIds) if (!sourceIds.has(s)) err("poi.evidence", `unknown source ${s}`, p.id);
    if (p.connectorNodeIds.length === 0) warn("poi.unroutable", "POI has no verified connector; search-only", p.id);
  }

  for (const a of b.coverage.areas) {
    if (a.floorId !== null && !floorIds.has(a.floorId)) err("coverage.floor", `unknown floor ${a.floorId}`, a.id);
  }

  return issues;
}
