/**
 * GTEki station contract v0.1 — renderer-neutral truth for routing, search and coverage.
 *
 * Rules encoded here (see docs/architecture.md, docs/acceptance.md):
 * - Geometry, traversable graph and POI search locations are separate entities.
 * - `null` means UNKNOWN. It never defaults to true/false/0.
 * - Only `verification: "verified"` edges enter real-world routing; `synthetic`
 *   data is allowed only in bundles flagged `station.synthetic === true` (fixtures).
 * - Floors are operator-scoped; no cross-operator floor equivalence is implied by labels.
 * - Coordinates are station-local metres around `station.origin`: x east, y north on the ENU
 *   tangent plane; z = source height minus origin height (no curvature term, so a TP height stays
 *   a TP height when origin.hM = 0). Renderer frame (glTF / Three.js / Godot, Y-up): (x, z, -y).
 *
 * File layout (station-owned; shared core only reads): stations/<id>/gteki/
 *   station.json → StationManifestFile, graph.json → GraphFile, pois.json → PoiFile,
 *   optional scene.ts (see @gteki/scene-api). `composeBundle` joins them into a StationBundle.
 */

export const SCHEMA_VERSION = "gteki.station/0.1" as const;

/** Tri-state: null = UNKNOWN (no evidence). */
export type Tri = boolean | null;

export type LangCode = "ja" | "ja-Hrkt" | "ja-Latn" | "en" | "zh-Hant" | "zh-Hans" | "ko" | (string & {});

export interface LocalizedText {
  lang: LangCode;
  text: string;
}

export type RightsStatus = "REUSABLE_WITH_CONDITIONS" | "REFERENCE_ONLY" | "RESTRICTED" | "UNVERIFIED";

export interface Source {
  id: string;
  title: string;
  publisher: string;
  /** Human-facing landing page. */
  url: string;
  /** Exact resource URL(s) that were downloaded, if any. */
  downloadUrls?: string[];
  license: { name: string; url: string } | null;
  rights: RightsStatus;
  /**
   * How GTEki uses the source. "facts-only": cited only as evidence for facts (a passage is
   * public, an exit number, a gate identity); nothing derived from it is distributed.
   * Omitted = "data" (contents or derivatives may ship).
   */
  usage?: "data" | "facts-only";
  /**
   * The Owner decision that permits using this source (#26 per-source clearance record). A real
   * facts-only source must carry one; the web UI shows the #26 credit line for every facts-only source.
   */
  decision?: { url: string; date: string };
  /** Credit line to display wherever derived data is shown. */
  attribution: string;
  /** True when GTEki modified/derived the data (must be disclosed for PDL/CC BY). */
  modified: boolean;
  retrievedAt: string | null;
  /** sha256 of each downloaded file, keyed by file name. */
  sha256?: Record<string, string>;
  datasetDate: string | null;
  /**
   * Last day the source declares its *data* valid (e.g. a temporary closure notice). After it, routes
   * depending on the source are stale. Not a publication/availability period or a licence term: record
   * those in `notes` (and coverage gaps), since they never make the data wrong.
   */
  validUntil?: string | null;
  notes?: string;
}

export interface EvidenceRef {
  sourceIds: string[];
  /** e.g. "source-attribute:route_type", "spatial-join:space.toll", "field-survey", "synthetic-fixture". */
  method: string;
  /** ISO date the evidence was checked by GTEki. */
  checkedDate: string;
  note?: string;
}

export interface GeoOrigin {
  lat: number;
  lon: number;
  /** Ellipsoidal/orthometric height of the origin; null when unknown. */
  hM: number | null;
  datum: "JGD2011";
  /** CRS of the source lat/lon, e.g. EPSG:6668 (JGD2011 geographic 2D), EPSG:6697 (+ JGD2011 height). */
  crs: string;
}

export interface Operator {
  id: string;
  names: LocalizedText[];
}

export interface Station {
  id: string;
  names: LocalizedText[];
  /** Station codes such as "E27"; operator-scoped. */
  codes?: { operatorId: string; code: string }[];
  operators: Operator[];
  origin: GeoOrigin;
  frame: "ENU";
  datasetVersion: string;
  generatedAt: string;
  /** True only for test fixtures / non-navigational prototypes. */
  synthetic: boolean;
}

export type ElevationSource = "measured" | "source-derived" | "symbolic" | "unknown";

export interface Floor {
  id: string;
  /** Operator whose labelling scheme this floor belongs to. */
  operatorId: string;
  /** Exact labels as published by each source; never normalised across operators. */
  sourceLabels: { operatorId: string; label: string; sourceId: string }[];
  /** Source-specific ordinal (e.g. MLIT NWD `floor`, GSI `ordinal`); comparable only within one operator. */
  ordinal: number | null;
  /** True for landings / mezzanines (e.g. MLIT ordinal -2.5). */
  intermediate: boolean;
  /** Real elevation of the walking surface in metres in the station frame; null when unknown. */
  elevationM: number | null;
  elevationSource: ElevationSource;
  /** Height used purely for rendering. Equals elevationM when known; otherwise a marked symbolic offset. */
  renderElevationM: number;
  /**
   * Station-authored human-facing names (e.g. ja "地下3階", en "B3", ja "B2–B3 中間").
   * Display only: never used to equate floors across operators; `sourceLabels` stay exact.
   */
  displayNames?: LocalizedText[];
}

export interface Vec3N {
  x: number;
  y: number;
  /** null = unknown height. */
  z: number | null;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type NodeKind =
  | "junction"
  | "exit"
  | "ticket_gate"
  | "platform"
  | "elevator"
  | "stair_end"
  | "escalator_end"
  | "ramp_end"
  | "facility"
  | "unknown";

export interface SourceFeatureRef {
  sourceId: string;
  featureId: string;
}

export interface Node {
  id: string;
  floorId: string;
  position: Vec3N;
  /** Display-only height used when position.z is null (e.g. interpolated along a stair chain). Never routed on. */
  renderZ?: number;
  kind: NodeKind;
  /** MLIT in_out: outside facility / boundary / inside. */
  inOut: "outside" | "boundary" | "inside" | null;
  sourceRefs: SourceFeatureRef[];
}

export type EdgeMode = "walk" | "stairs" | "escalator" | "elevator" | "ramp" | "moving_walkway" | "gate";

export type Verification = "verified" | "geometry_only" | "unverified" | "synthetic";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type HoursSpec =
  | { kind: "always"; evidence: EvidenceRef }
  /**
   * Station-local opening window "HH:MM"–"HH:MM" (close may be after 24:00, e.g. "25:30",
   * for service past midnight). `days` omitted = every day; a holiday calendar is not modelled.
   */
  | { kind: "window"; open: string; close: string; days?: Weekday[]; evidence: EvidenceRef };

/** What the z values of an edge polyline mean. Routing never uses `symbolic` heights. */
export type GeometryZKind = "measured" | "source" | "symbolic";

export interface Edge {
  id: string;
  from: string;
  to: string;
  /** "forward" = only from → to (e.g. one-way escalator). */
  direction: "both" | "forward";
  mode: EdgeMode;
  /** Length in metres; null when the source gives none (e.g. lifts). */
  lengthM: number | null;
  /** Polyline in station ENU; endpoints coincide with node positions. */
  geometry?: Vec3N[];
  /** Provenance of the polyline z values (default "source"). */
  geometryZ?: GeometryZKind;
  /** Inside a fare-paid area. true/false/null(unknown). */
  paid: Tri;
  /** Crosses the paid/unpaid boundary (ticket gate). */
  crossesFareBoundary: Tri;
  /** Usable by a wheelchair user without assistance. */
  wheelchair: Tri;
  /** Contains steps (stairs or level difference > threshold). */
  steps: Tri;
  hours: HoursSpec | null;
  /** Explicit, evidenced closure. */
  closed: boolean;
  verification: Verification;
  geometryEvidence: EvidenceRef;
  accessEvidence: EvidenceRef | null;
  /** Raw source attributes retained for audit (codes, width class, slope class...). */
  attributes?: Record<string, string | number | boolean | null>;
}

export type PoiCategory =
  | "exit"
  | "ticket_gate"
  | "platform"
  | "elevator"
  | "escalator"
  | "stairs"
  | "toilet"
  | "shop"
  | "locker"
  | "atm"
  | "service"
  | "transfer"
  | "other";

export interface Poi {
  id: string;
  category: PoiCategory;
  names: LocalizedText[];
  /** Search aliases incl. kana / romaji / common shorthand. */
  aliases: LocalizedText[];
  floorId: string | null;
  /** Display location (may be a centroid); NOT a routing target. */
  displayPosition: Vec3N | null;
  /** Verified graph nodes that physically give access to the POI. Empty => not routable. */
  connectorNodeIds: string[];
  /** Whether this POI is inside the fare-paid area. */
  paid: Tri;
  evidence: EvidenceRef;
  /** Human-facing freshness/limits, e.g. operating hours text from source. */
  notes?: LocalizedText[];
}

export type CoverageStatus = "routable" | "visual_only" | "unverified" | "excluded";

export interface CoverageArea {
  id: string;
  floorId: string | null;
  status: CoverageStatus;
  label: LocalizedText[];
  /** Polygon rings in ENU (x,y); optional for coarse descriptors. */
  polygon?: { x: number; y: number }[];
  sourceIds: string[];
  note?: string;
}

export interface CoverageGap {
  id: string;
  floorId: string | null;
  zone: string;
  missingFact: string;
  approximateExtent?: string;
  sourceDate?: string | null;
  fieldWorkNeeded: string;
}

export interface Coverage {
  summary: LocalizedText[];
  areas: CoverageArea[];
  gaps: CoverageGap[];
  /** Latest source date that the routable graph depends on. */
  freshness: string | null;
}

export type AssetRole = "visual" | "collision" | "visual+collision";

/** A renderable asset. Geometry never establishes pedestrian connectivity; the graph does. */
export interface Asset {
  id: string;
  /** Path relative to stations/<id>/gteki/ (no "..", no scheme). */
  uri: string;
  format: "glb";
  floorIds: string[];
  /** Column-major 4x4 from asset space to the renderer frame; omitted = identity (authored in renderer frame). */
  transform?: number[];
  role: AssetRole;
  /** Sources the asset is derived from; their rights gate public distribution. */
  sourceIds: string[];
  /**
   * Further files the asset needs at runtime (lightmaps, sidecar metadata, external buffers), relative
   * like `uri`; they share its `sourceIds` and rights. A production build publishes only declared files.
   */
  files?: string[];
  /** e.g. "Blender build from PLATEAU ubld 53394576, 0.5 m grid"; disclosure of modification. */
  derivation?: string;
}

export interface StationBundle {
  schema: typeof SCHEMA_VERSION;
  station: Station;
  sources: Source[];
  floors: Floor[];
  nodes: Node[];
  edges: Edge[];
  pois: Poi[];
  coverage: Coverage;
  /** Suggested user-choosable start nodes (no indoor positioning is claimed). */
  spawnNodeIds?: string[];
  assets?: Asset[];
}

/** stations/<id>/gteki/station.json */
export interface StationManifestFile {
  schema: typeof SCHEMA_VERSION;
  station: Station;
  sources: Source[];
  floors: Floor[];
  coverage: Coverage;
  spawnNodeIds?: string[];
  assets?: Asset[];
}

/** stations/<id>/gteki/graph.json */
export interface GraphFile {
  schema: typeof SCHEMA_VERSION;
  stationId: string;
  nodes: Node[];
  edges: Edge[];
}

/** stations/<id>/gteki/pois.json */
export interface PoiFile {
  schema: typeof SCHEMA_VERSION;
  stationId: string;
  pois: Poi[];
}

export { ASSET_FILE_EXT, isCanonicalAssetPath, validateBundle, type ValidationIssue } from "./validate.ts";
export { checkShape, composeBundle, parseStationFiles, type ParseResult } from "./parse.ts";
export { parseHm, isOpenAt, type LocalTime } from "./hours.ts";
