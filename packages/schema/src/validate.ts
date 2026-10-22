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
/** File types a station may publish next to its GLBs (same list the web build discovers). */
export const ASSET_FILE_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2|hdr|ogg|mp3|m4a|json)$/i;
/** Extensions a station may declare in `dataFiles[]`; code (.ts/.js) is never data and needs no declaration. */
export const DATA_FILE_EXT = /\.(json|geojson|csv|tsv|txt|xml|yaml|yml|bin|dat)$/i;
const CONTRACT_FILES = new Set(["station.json", "graph.json", "pois.json"]);
const CANONICAL_MESSAGE = "asset paths must be canonical slash-separated relative paths inside the station folder (no ., .. or empty segments; no colon, backslash, ? or #)";

/** Relative, canonical and URL-safe: `?` and `#` would be read as a query or fragment once served. */
export function isCanonicalAssetPath(p: string): boolean {
  return !/[:\\?#]/.test(p) && !p.startsWith("/") && !p.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
}

const COVERAGE_STATUSES = new Set(["routable", "visual_only", "unverified", "excluded"]);
const ELEVATION_SOURCES = new Set(["measured", "source-derived", "symbolic", "unknown"]);
const RIGHTS = new Set(["REUSABLE_WITH_CONDITIONS", "REFERENCE_ONLY", "RESTRICTED", "UNVERIFIED"]);
/** Polyline endpoints further than this from their node are reported. */
const ENDPOINT_TOLERANCE_M = 1;

/** Zero-padded calendar date `YYYY-MM-DD`; dates are compared as strings, so the format is load-bearing. */
export function isIsoDate(s: string): boolean {
  return isIsoDatePrefix(s) && s.length === 10;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (a source may only state its year or month); each part must be real. */
export function isIsoDatePrefix(s: string): boolean {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
/** Known polyline endpoint heights must match known node heights; routing measures the polyline's climb. */
const ENDPOINT_Z_TOLERANCE_M = 0.1;

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
const isHttpUrl = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

export function validateBundle(b: StationBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, ref?: string) => issues.push({ level: "error", code, message, ref });
  const warn = (code: string, message: string, ref?: string) => issues.push({ level: "warning", code, message, ref });

  if (b.schema !== SCHEMA_VERSION) err("schema.version", `expected ${SCHEMA_VERSION}, got ${String(b.schema)}`);
  if (b.station.frame !== "ENU") err("station.frame", "station frame must be ENU");
  // Coordinate conversion interprets the origin as JGD2011; any other datum would be silently misread.
  if (b.station.origin.datum !== "JGD2011") err("station.origin.datum", `origin datum must be JGD2011, got ${String(b.station.origin.datum)}`);
  // The origin anchors every station-local coordinate: an impossible latitude/longitude would misplace the station.
  const o = b.station.origin;
  if (!(Number.isFinite(o.lat) && o.lat >= -90 && o.lat <= 90)) err("station.origin.range", `origin latitude ${String(o.lat)} is outside -90…90`);
  if (!(Number.isFinite(o.lon) && o.lon >= -180 && o.lon <= 180)) err("station.origin.range", `origin longitude ${String(o.lon)} is outside -180…180`);
  if (o.hM !== null && !Number.isFinite(o.hM)) err("station.origin.range", `origin height ${String(o.hM)} is not finite`);

  const sourceIds = new Set<string>();
  const sourceRights = new Map(b.sources.map((s) => [s.id, s.rights]));
  const factsOnly = new Set(b.sources.filter((s) => s.usage === "facts-only").map((s) => s.id));
  /** A source that may feed published geometry: reusable and not restricted to citing facts. */
  const reusableData = (id: string) => sourceRights.get(id) === "REUSABLE_WITH_CONDITIONS" && !factsOnly.has(id);
  for (const s of b.sources) {
    if (sourceIds.has(s.id)) err("source.dup", `duplicate source id`, s.id);
    sourceIds.add(s.id);
    if (s.usage !== undefined && s.usage !== "data" && s.usage !== "facts-only") err("source.usage", `unknown usage ${String(s.usage)}`, s.id);
    if (!RIGHTS.has(s.rights)) err("source.rights.value", `unknown rights ${String(s.rights)}`, s.id);
    if (s.datasetDate !== null && !isIsoDatePrefix(s.datasetDate)) err("source.date", `datasetDate ${s.datasetDate} is not YYYY, YYYY-MM or YYYY-MM-DD`, s.id);
    if (typeof s.validUntil === "string" && !isIsoDatePrefix(s.validUntil)) err("source.date", `validUntil ${s.validUntil} is not YYYY, YYYY-MM or YYYY-MM-DD`, s.id);
    // Credits must be showable: every source names its credit line, and a data source (anything derived
    // from it may ship) names its licence with a link (CC BY / PDL 1.0 require indicating the licence).
    if (!b.station.synthetic && !(typeof s.attribution === "string" && s.attribution.trim()))
      err("source.attribution", "source without an attribution (credit line)", s.id);
    // The credited title links to the source itself, so a real source needs a reachable http(s) landing page.
    if (!b.station.synthetic && !isHttpUrl(s.url)) err("source.url", "source without an http(s) landing URL", s.id);
    if (!b.station.synthetic && s.usage !== "facts-only" && !(s.license && s.license.name.trim() && isHttpUrl(s.license.url)))
      err("source.license", "data source without a licence name and http(s) licence link", s.id);
    if (!b.station.synthetic && s.rights !== "REUSABLE_WITH_CONDITIONS" && s.usage !== "facts-only")
      warn("source.rights", `source rights ${s.rights}; must not feed published geometry/data (mark usage:"facts-only" if only cited as evidence)`, s.id);
  }

  const operatorIds = new Set(b.station.operators.map((o) => o.id));
  const floorIds = new Set<string>();
  for (const f of b.floors) {
    if (floorIds.has(f.id)) err("floor.dup", "duplicate floor id", f.id);
    floorIds.add(f.id);
    if (!operatorIds.has(f.operatorId)) err("floor.operator", `unknown operator ${f.operatorId}`, f.id);
    // Floor labels, ordinals and heights drive names and up/down in the directions: a real floor needs a source.
    if (f.sourceLabels.length === 0 && !b.station.synthetic) err("floor.source", "floor without source labels", f.id);
    for (const l of f.sourceLabels) if (!sourceIds.has(l.sourceId)) err("floor.source", `unknown source ${l.sourceId}`, f.id);
    if (f.elevationM === null && f.elevationSource === "measured")
      err("floor.elevation", "measured elevation cannot be null", f.id);
    if (!ELEVATION_SOURCES.has(f.elevationSource)) err("floor.elevation", `unknown elevationSource ${String(f.elevationSource)}`, f.id);
    if (f.elevationM !== null && (f.elevationSource === "symbolic" || f.elevationSource === "unknown"))
      err("floor.elevation", `${f.elevationSource} elevation must keep elevationM null`, f.id);
    // A known height is published and drives up/down in the directions: same rights gate as node positions,
    // and it is what the floor is drawn at (a symbolic render offset only stands in for an unknown height).
    if (f.elevationM !== null && !b.station.synthetic && !f.sourceLabels.some((l) => reusableData(l.sourceId)))
      err("floor.elevation.rights", "known elevation without a reusable data source among the floor's sources", f.id);
    if (f.elevationM !== null && f.renderElevationM !== f.elevationM)
      err("floor.renderElevation", `renderElevationM ${f.renderElevationM} differs from the known elevationM ${f.elevationM}`, f.id);
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
    if (n.sourceRefs.length === 0 && !b.station.synthetic) err("node.source", "node position without source provenance", n.id);
    for (const r of n.sourceRefs) {
      if (!sourceIds.has(r.sourceId)) err("node.source", `unknown source ${r.sourceId}`, n.id);
      // Node coordinates are drawn and measured (straight edges have no other geometry): same gate as edge geometry.
      const rights = sourceRights.get(r.sourceId);
      if (factsOnly.has(r.sourceId)) err("node.source.rights", `node position cites facts-only source ${r.sourceId}; the position would be a derivative`, n.id);
      else if (rights !== undefined && rights !== "REUSABLE_WITH_CONDITIONS" && !b.station.synthetic)
        err("node.source.rights", `node position derives from source ${r.sourceId} with rights ${rights}; it cannot ship in the public bundle`, n.id);
    }
  }

  const edgeIds = new Set<string>();
  const checkEvidence = (e: Edge, ev: Edge["geometryEvidence"] | null, label: string) => {
    if (!ev) return;
    // Evidence that names no source substantiates nothing.
    if (ev.sourceIds.length === 0) err("edge.evidence", `${label}: no source ids`, e.id);
    for (const s of ev.sourceIds) if (!sourceIds.has(s)) err("edge.evidence", `${label}: unknown source ${s}`, e.id);
    if (!isIsoDate(ev.checkedDate)) err("edge.evidence.date", `${label}: checkedDate ${ev.checkedDate} is not YYYY-MM-DD`, e.id);
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
      warn("edge.access", "verified edge without access evidence; the router treats its paid/fare/wheelchair/steps flags as UNKNOWN", e.id);
    checkEvidence(e, e.geometryEvidence, "geometryEvidence");
    // Geometry is a derivative of its sources: like assets, it ships publicly only from reusable ones.
    for (const s of e.geometryEvidence.sourceIds) {
      const rights = sourceRights.get(s);
      if (factsOnly.has(s)) err("edge.geometry.rights", `polyline geometry cites facts-only source ${s}; geometry would be a derivative`, e.id);
      else if (rights !== undefined && rights !== "REUSABLE_WITH_CONDITIONS" && !b.station.synthetic)
        err("edge.geometry.rights", `edge geometry derives from source ${s} with rights ${rights}; it cannot ship in the public bundle`, e.id);
    }
    checkEvidence(e, e.accessEvidence, "accessEvidence");
    if (e.hours) checkEvidence(e, e.hours.evidence, "hours.evidence");
    // Flags that contradict the mode are data errors (the router never treats these modes as step-free anyway).
    if (e.mode === "stairs" && e.steps === false) err("edge.access.mode", "stairs edge marked steps:false", e.id);
    if ((e.mode === "stairs" || e.mode === "escalator") && e.wheelchair === true) err("edge.access.mode", `${e.mode} edge marked wheelchair:true`, e.id);
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
      const open = parseHm(e.hours.open);
      let close = parseHm(e.hours.close);
      if (open !== null && close !== null) while (close < open) close += 1440;
      if (open === null || close === null || close === open)
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
    // A drawn polyline needs both ends; a shorter one would silently fall back to a straight node-to-node line.
    if (e.geometry !== undefined && (!Array.isArray(e.geometry) || e.geometry.length < 2))
      err("edge.geometry.points", `geometry has ${Array.isArray(e.geometry) ? e.geometry.length : 0} point(s); a polyline needs at least 2 (omit it for a straight edge)`, e.id);
    if (e.geometry && e.geometry.length >= 2 && fromNode && toNode) {
      const first = e.geometry[0]!;
      const last = e.geometry[e.geometry.length - 1]!;
      if (Math.hypot(first.x - fromNode.position.x, first.y - fromNode.position.y) > ENDPOINT_TOLERANCE_M ||
          Math.hypot(last.x - toNode.position.x, last.y - toNode.position.y) > ENDPOINT_TOLERANCE_M)
        warn("edge.geometry.endpoints", `polyline endpoints are > ${ENDPOINT_TOLERANCE_M} m from from/to nodes`, e.id);
      if (e.geometryZ !== "symbolic") {
        const zMismatch = (pz: number | null, nz: number | null) => pz !== null && nz !== null && Math.abs(pz - nz) > ENDPOINT_Z_TOLERANCE_M + 1e-9;
        if (zMismatch(first.z, fromNode.position.z) || zMismatch(last.z, toNode.position.z))
          err("edge.geometry.endpoints.z", `polyline endpoint height differs from its node by > ${ENDPOINT_Z_TOLERANCE_M} m; routing would measure a climb the drawn path does not have`, e.id);
      }
    }
  }

  for (const id of b.spawnNodeIds ?? []) if (!nodeIds.has(id)) err("spawn.node", `unknown spawn node ${id}`, id);

  const assetIds = new Set<string>();
  for (const a of b.assets ?? []) {
    if (assetIds.has(a.id)) err("asset.dup", "duplicate asset id", a.id);
    assetIds.add(a.id);
    if (a.format !== "glb") err("asset.format", `unsupported asset format ${a.format}`, a.id);
    if (!ASSET_ROLES.has(a.role)) err("asset.role", `unknown asset role ${a.role}`, a.id);
    // Canonical form only: the Web loader keys assets by their exact relative path and Godot refuses ":" and "\\".
    if (!isCanonicalAssetPath(a.uri)) err("asset.uri", CANONICAL_MESSAGE, a.id);
    else if (!a.uri.toLowerCase().endsWith(".glb")) err("asset.uri", "glb asset uri must end in .glb", a.id);
    for (const f of a.files ?? []) {
      if (!isCanonicalAssetPath(f)) err("asset.files", `${f}: ${CANONICAL_MESSAGE}`, a.id);
      else if (!ASSET_FILE_EXT.test(f) || CONTRACT_FILES.has(f)) err("asset.files", `${f}: not a publishable asset file type`, a.id);
    }
    if (a.transform !== undefined && (a.transform.length !== 16 || !a.transform.every(Number.isFinite)))
      err("asset.transform", "transform must be 16 finite numbers (column-major 4x4)", a.id);
    else if (a.transform !== undefined && (a.transform[3] !== 0 || a.transform[7] !== 0 || a.transform[11] !== 0 || a.transform[15] !== 1))
      err("asset.transform", "transform must be affine (m[3], m[7], m[11] = 0 and m[15] = 1), as Godot requires", a.id);
    for (const f of a.floorIds) if (!floorIds.has(f)) err("asset.floor", `unknown floor ${f}`, a.id);
    for (const s of a.sourceIds) {
      if (!sourceIds.has(s)) err("asset.source", `unknown source ${s}`, a.id);
      if (factsOnly.has(s)) err("asset.rights", `asset derives from facts-only source ${s}`, a.id);
      const rights = sourceRights.get(s);
      if (rights !== undefined && rights !== "REUSABLE_WITH_CONDITIONS" && !b.station.synthetic)
        err("asset.rights", `asset derives from source ${s} with rights ${rights}; it cannot ship in the public bundle`, a.id);
    }
    if (a.sourceIds.length === 0 && !b.station.synthetic) err("asset.source", "asset without source provenance", a.id);
  }

  // Data files: the same source and rights gate as assets. Contract files are loaded as data and never declared.
  const dataIds = new Set<string>();
  const dataPaths = new Set<string>();
  for (const d of b.dataFiles ?? []) {
    if (dataIds.has(d.id)) err("data.dup", "duplicate data file id", d.id);
    dataIds.add(d.id);
    if (!isCanonicalAssetPath(d.path)) err("data.path", CANONICAL_MESSAGE.replace("asset paths", "data file paths"), d.id);
    else if (!DATA_FILE_EXT.test(d.path)) err("data.path", `${d.path}: not a data file type`, d.id);
    else if (/^gteki\/(station|graph|pois)\.json$/.test(d.path)) err("data.path", `${d.path}: contract files are loaded as data and are never declared`, d.id);
    if (dataPaths.has(d.path)) err("data.dup", `${d.path}: declared twice`, d.id);
    dataPaths.add(d.path);
    for (const s of d.sourceIds) {
      if (!sourceIds.has(s)) err("data.source", `unknown source ${s}`, d.id);
      if (factsOnly.has(s)) err("data.rights", `data derives from facts-only source ${s}`, d.id);
      const rights = sourceRights.get(s);
      if (rights !== undefined && rights !== "REUSABLE_WITH_CONDITIONS" && !b.station.synthetic)
        err("data.rights", `data derives from source ${s} with rights ${rights}; it cannot ship in the public bundle`, d.id);
    }
    if (d.sourceIds.length === 0 && !b.station.synthetic) err("data.source", "data file without source provenance", d.id);
  }

  const poiIds = new Set<string>();
  for (const p of b.pois) {
    if (poiIds.has(p.id)) err("poi.dup", "duplicate POI id", p.id);
    poiIds.add(p.id);
    if (!POI_CATEGORIES.has(p.category)) err("poi.category", `unknown category ${p.category}`, p.id);
    if (p.floorId !== null && !floorIds.has(p.floorId)) err("poi.floor", `unknown floor ${p.floorId}`, p.id);
    if (p.names.length === 0) err("poi.name", "POI without a name", p.id);
    for (const c of p.connectorNodeIds) if (!nodeIds.has(c)) err("poi.connector", `unknown node ${c}`, p.id);
    if (p.evidence.sourceIds.length === 0) err("poi.evidence", "no source ids", p.id);
    for (const s of p.evidence.sourceIds) if (!sourceIds.has(s)) err("poi.evidence", `unknown source ${s}`, p.id);
    if (!isIsoDate(p.evidence.checkedDate)) err("poi.evidence.date", `checkedDate ${p.evidence.checkedDate} is not YYYY-MM-DD`, p.id);
    // A drawn position needs a reusable geometric basis among its sources (others may still evidence facts).
    if (p.displayPosition !== null && !b.station.synthetic && !p.evidence.sourceIds.some(reusableData))
      err("poi.position.rights", "displayPosition needs at least one REUSABLE_WITH_CONDITIONS data source in its evidence", p.id);
    if (p.connectorNodeIds.length === 0) warn("poi.unroutable", "POI has no verified connector; search-only", p.id);
  }

  for (const a of b.coverage.areas) {
    if (a.floorId !== null && !floorIds.has(a.floorId)) err("coverage.floor", `unknown floor ${a.floorId}`, a.id);
    if (!COVERAGE_STATUSES.has(a.status)) err("coverage.status", `unknown coverage status ${String(a.status)}`, a.id);
    if (a.sourceIds.length === 0) err("coverage.source", "coverage area without sources", a.id);
    for (const sid of a.sourceIds) if (!sourceIds.has(sid)) err("coverage.source", `unknown source ${sid}`, a.id);
    if (a.polygon && !b.station.synthetic && !a.sourceIds.some(reusableData))
      err("coverage.polygon.rights", "coverage polygon needs at least one REUSABLE_WITH_CONDITIONS data source", a.id);
  }

  return issues;
}
