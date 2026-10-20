import type { Edge, Floor, StationBundle } from "./index.ts";
import { SCHEMA_VERSION } from "./index.ts";
import { parseHm } from "./hours.ts";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  ref?: string;
}

const ROUTABLE_MODES = new Set(["walk", "stairs", "escalator", "elevator", "ramp", "moving_walkway", "gate"]);
const VERTICAL_MODES = new Set(["stairs", "escalator", "elevator", "ramp"]);
const NODE_KINDS = new Set(["junction", "exit", "ticket_gate", "platform", "elevator", "stair_end", "escalator_end", "ramp_end", "facility", "unknown"]);
const VERIFICATIONS = new Set(["verified", "geometry_only", "unverified", "synthetic"]);
const DIRECTIONS = new Set(["both", "forward"]);
const GEOMETRY_Z = new Set(["measured", "source", "symbolic"]);
const ASSET_ROLES = new Set(["visual", "collision", "visual+collision"]);
const POI_CATEGORIES = new Set(["exit", "ticket_gate", "platform", "elevator", "escalator", "stairs", "toilet", "shop", "locker", "atm", "service", "transfer", "other"]);
const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
/** Polyline endpoints further than this from their node are reported. */
const ENDPOINT_TOLERANCE_M = 1;

/**
 * A walk/gate edge that changes floor is only plausible at landings (one end on an
 * intermediate floor, or adjacent ordinals of one operator) or at an inter-operator
 * transfer, where floors are operator-scoped by design. Same-operator jumps between
 * non-adjacent or unordered floors hide an undocumented vertical connector.
 */
function floorChangeSeverity(a: Floor, b: Floor): "warning" | "error" {
  if (a.operatorId !== b.operatorId || a.intermediate || b.intermediate) return "warning";
  if (a.operatorId === b.operatorId && a.ordinal !== null && b.ordinal !== null && Math.abs(a.ordinal - b.ordinal) <= 1) return "warning";
  return "error";
}

/** Structural + truth-rule validation. Errors must block publishing a bundle. */
export function validateBundle(b: StationBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, ref?: string) => issues.push({ level: "error", code, message, ref });
  const warn = (code: string, message: string, ref?: string) => issues.push({ level: "warning", code, message, ref });

  if (b.schema !== SCHEMA_VERSION) err("schema.version", `expected ${SCHEMA_VERSION}, got ${String(b.schema)}`);
  if (b.station.frame !== "ENU") err("station.frame", "station frame must be ENU");

  const sourceIds = new Set<string>();
  const sourceRights = new Map(b.sources.map((s) => [s.id, s.rights]));
  const factsOnly = new Set(b.sources.filter((s) => s.usage === "facts-only").map((s) => s.id));
  for (const s of b.sources) {
    if (sourceIds.has(s.id)) err("source.dup", `duplicate source id`, s.id);
    sourceIds.add(s.id);
    if (!b.station.synthetic && s.rights !== "REUSABLE_WITH_CONDITIONS" && s.usage !== "facts-only")
      warn("source.rights", `source rights ${s.rights}; must not feed published geometry/data (mark usage:"facts-only" if only cited as evidence)`, s.id);
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

  const floors = new Map(b.floors.map((f) => [f.id, f]));
  const nodes = new Map(b.nodes.map((n) => [n.id, n]));
  const nodeIds = new Set<string>();
  for (const n of b.nodes) {
    if (!NODE_KINDS.has(n.kind)) err("node.kind", `unknown node kind ${n.kind}`, n.id);
    if (n.renderZ !== undefined && !Number.isFinite(n.renderZ)) err("node.renderZ", "non-finite renderZ", n.id);
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
    for (const s of e.geometryEvidence.sourceIds)
      if (factsOnly.has(s)) err("edge.geometry.rights", `polyline geometry cites facts-only source ${s}; geometry would be a derivative`, e.id);
    checkEvidence(e, e.accessEvidence, "accessEvidence");
    if (e.crossesFareBoundary === true && e.paid === false)
      err("edge.fare", "fare-boundary edge cannot be marked fully unpaid", e.id);
    if (!VERIFICATIONS.has(e.verification)) err("edge.verification", `unknown verification ${e.verification}`, e.id);
    if (!DIRECTIONS.has(e.direction)) err("edge.direction", `unknown direction ${e.direction}`, e.id);
    if (e.crossesFareBoundary === true && e.mode !== "gate")
      warn("edge.fare.mode", `fare-boundary crossing on a ${e.mode} edge; model the ticket gate as a gate edge`, e.id);
    if (e.mode === "escalator" && e.direction === "both")
      warn("edge.escalator.direction", "bidirectional escalator; running direction must be evidenced", e.id);
    if (e.geometryZ !== undefined && !GEOMETRY_Z.has(e.geometryZ)) err("edge.geometryZ", `unknown geometryZ ${e.geometryZ}`, e.id);
    if (e.hours?.kind === "window") {
      if (parseHm(e.hours.open) === null || parseHm(e.hours.close) === null || e.hours.open === e.hours.close)
        err("edge.hours", `malformed hours window ${e.hours.open}–${e.hours.close}`, e.id);
      for (const d of e.hours.days ?? []) if (!WEEKDAYS.has(d)) err("edge.hours", `unknown weekday ${d}`, e.id);
    }
    const fromNode = nodes.get(e.from);
    const toNode = nodes.get(e.to);
    const fromFloor = fromNode && floors.get(fromNode.floorId);
    const toFloor = toNode && floors.get(toNode.floorId);
    if (fromFloor && toFloor && fromFloor.id !== toFloor.id && !VERTICAL_MODES.has(e.mode)) {
      const message = `${e.mode} edge changes floor ${fromFloor.id} → ${toFloor.id} without a vertical connector`;
      if (floorChangeSeverity(fromFloor, toFloor) === "error") err("floor.change.walk", message, e.id);
      else warn("floor.change.walk", `${message} (landing/adjacent; cite evidence)`, e.id);
    }
    if (e.geometry && e.geometry.length >= 2 && fromNode && toNode) {
      const first = e.geometry[0]!;
      const last = e.geometry[e.geometry.length - 1]!;
      if (Math.hypot(first.x - fromNode.position.x, first.y - fromNode.position.y) > ENDPOINT_TOLERANCE_M ||
          Math.hypot(last.x - toNode.position.x, last.y - toNode.position.y) > ENDPOINT_TOLERANCE_M)
        warn("edge.geometry.endpoints", `polyline endpoints are > ${ENDPOINT_TOLERANCE_M} m from from/to nodes`, e.id);
    }
  }

  for (const id of b.spawnNodeIds ?? []) if (!nodeIds.has(id)) err("spawn.node", `unknown spawn node ${id}`, id);

  const assetIds = new Set<string>();
  for (const a of b.assets ?? []) {
    if (assetIds.has(a.id)) err("asset.dup", "duplicate asset id", a.id);
    assetIds.add(a.id);
    if (a.format !== "glb") err("asset.format", `unsupported asset format ${a.format}`, a.id);
    if (!ASSET_ROLES.has(a.role)) err("asset.role", `unknown asset role ${a.role}`, a.id);
    if (/^[a-z][a-z0-9+.-]*:/i.test(a.uri) || a.uri.startsWith("/") || a.uri.split("/").includes(".."))
      err("asset.uri", "asset uri must be a relative path inside the station folder", a.id);
    if (a.transform !== undefined && (a.transform.length !== 16 || !a.transform.every(Number.isFinite)))
      err("asset.transform", "transform must be 16 finite numbers (column-major 4x4)", a.id);
    for (const f of a.floorIds) if (!floorIds.has(f)) err("asset.floor", `unknown floor ${f}`, a.id);
    for (const s of a.sourceIds) {
      if (!sourceIds.has(s)) err("asset.source", `unknown source ${s}`, a.id);
      if (factsOnly.has(s)) err("asset.rights", `asset derives from facts-only source ${s}`, a.id);
      const rights = sourceRights.get(s);
      if (rights && rights !== "REUSABLE_WITH_CONDITIONS" && !b.station.synthetic)
        err("asset.rights", `asset derives from source ${s} with rights ${rights}; it cannot ship in the public bundle`, a.id);
    }
    if (a.sourceIds.length === 0 && !b.station.synthetic) err("asset.source", "asset without source provenance", a.id);
  }

  const poiIds = new Set<string>();
  for (const p of b.pois) {
    if (poiIds.has(p.id)) err("poi.dup", "duplicate POI id", p.id);
    poiIds.add(p.id);
    if (!POI_CATEGORIES.has(p.category)) err("poi.category", `unknown category ${p.category}`, p.id);
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
