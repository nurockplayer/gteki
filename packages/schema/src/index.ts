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
 *   optional tenants.json → TenantFile (a store's own brand directory; #419),
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

export type RightsStatus = "REUSABLE_WITH_CONDITIONS" | "PUBLISHED_UNDER_OWNER_OVERRIDE" | "REFERENCE_ONLY" | "RESTRICTED" | "UNVERIFIED";

export interface Source {
  id: string;
  title: string;
  publisher: string;
  /** Human-facing landing page. */
  url: string;
  /** Exact resource URL(s) that were downloaded, if any. */
  downloadUrls?: string[];
  /**
   * Licence label, either a legacy plain string or localized text. Every localized entry must state the same
   * licence/status; the UI's controlled rights label is authoritative for the source's rights status.
   */
  license: { name: string | LocalizedText[]; url: string } | null;
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
  /**
   * Required when `rights` is PUBLISHED_UNDER_OWNER_OVERRIDE (#130): the Owner decision that lets the
   * source ship although its licence is unconfirmed. `decision` is an issue/comment URL or `#ref`.
   */
  override?: { decision: string; date: string };
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

export interface StationIdentity {
  /** Short place name without 駅 or a line qualifier. Requires ja and en; ja-Hrkt recommended. */
  names: LocalizedText[];
  /** Plain orientation facts, shown together only when every side has evidence. */
  sides?: {
    side: "east" | "west" | "north" | "south";
    exit: LocalizedText[];
    landmark: LocalizedText[];
    evidence: EvidenceRef;
    /** Confirmed requires at least two independent source publishers. */
    verification: "confirmed" | "unverified";
  }[];
}

export interface Station {
  id: string;
  names: LocalizedText[];
  identity?: StationIdentity;
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

/**
 * Opening hours exactly as a source printed them (OD-32). This is text, not a timetable: the app shows the
 * page's own wording and never parses it into open/closed state. `status: "UNKNOWN"` records a page that was
 * read and printed no hours, so a later check can tell "not looked at" from "looked at, nothing printed".
 */
export interface HoursText {
  /** The page's own wording, line breaks kept. Absent only when the page printed no hours (status UNKNOWN). */
  text?: string;
  /** The official page the text was read from (http/https). */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the page was read. */
  retrievedAt: string;
  /** Whose word it is: the merchant's own listing, a dated official page, or an official page with no date. */
  basis: "merchant" | "dated-official" | "undated-official";
  status: "OK" | "UNKNOWN";
}

/**
 * Hours that belong to a whole building or a floor range rather than one shop (OD-32), e.g. 「ルミネ池袋
 * B1～7F 11:00～21:00」. Building-level rows exist because the page prints one block for many shops; they never
 * override a shop's own hours.
 */
export interface BuildingHours extends HoursText {
  /** The building or facility as its own page names it. */
  building: LocalizedText[];
  /** The floor range the row covers, as printed (e.g. "B1～7F"); null for a whole-building row. */
  floorRange: string | null;
  /** The page's own caveat, e.g. 「店舗により異なる場合あり」. */
  note?: LocalizedText[];
}

/**
 * An approximate representative point (e.g. the area-weighted centroid of the source polygon that names the
 * POI). It exists so search can show roughly where a place is when no surveyed position is available; it is
 * never a routing target and never shown as a precise pin.
 */
export interface ApproximatePosition {
  east: number;           // metres, station frame x
  north: number;          // metres, station frame y
  uncertaintyM: number;   // > 0, the ± radius shown to users
  method: string;         // how it was derived, e.g. "area_weighted_centroid"
  navigationUse: "NOT_FOR_ROUTING";
  floor: "UNVERIFIED";    // the POI's floorId is a label match, not surveyed
}

export interface Poi {
  id: string;
  category: PoiCategory;
  names: LocalizedText[];
  /** Search aliases incl. kana / romaji / common shorthand. */
  aliases: LocalizedText[];
  floorId: string | null;
  /** Display location (may be a centroid); NOT a routing target. */
  displayPosition: Vec3N | null;
  /**
   * Approximate representative point for search display only (e.g. a centroid of a source polygon): station
   * frame metres, east/north on the ENU plane, no height. NOT a routing target, never a connector, never a
   * displayPosition, never drawn as a precise pin.
   */
  approximatePosition?: ApproximatePosition;
  /** Verified graph nodes that physically give access to the POI. Empty => not routable. */
  connectorNodeIds: string[];
  /** Whether this POI is inside the fare-paid area. */
  paid: Tri;
  evidence: EvidenceRef;
  /** Human-facing freshness/limits, e.g. operating hours text from source. */
  notes?: LocalizedText[];
  /** Opening hours as an official page printed them (OD-32); shown with the date it was read. */
  hours?: HoursText;
}

export type CoverageStatus = "routable" | "visual_only" | "unverified" | "excluded";

/**
 * Coverage text as station data: either the legacy plain string (one language, whatever the source used) or
 * localized text in the POI-name shape. Clients show the requested language, then ja, then any entry, and take
 * the plain string as-is; they never translate it (#259).
 */
export type CoverageText = string | LocalizedText[];

export interface CoverageArea {
  id: string;
  floorId: string | null;
  status: CoverageStatus;
  label: LocalizedText[];
  /** Polygon rings in ENU (x,y); optional for coarse descriptors. */
  polygon?: { x: number; y: number }[];
  sourceIds: string[];
  note?: CoverageText;
}

export interface CoverageGap {
  id: string;
  floorId: string | null;
  zone: CoverageText;
  missingFact: CoverageText;
  approximateExtent?: CoverageText;
  sourceDate?: string | null;
  fieldWorkNeeded: CoverageText;
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
  /**
   * Optional lighter-weight variant of `uri` (same scene, smaller textures; e.g. a `PROFILE=mobile` kit
   * bundle). The explorer loads it instead of `uri` on the low quality tier. Same rules as `uri`; it
   * shares the asset's `sourceIds` and rights, and a production build publishes it as a declared file.
   */
  uriMobile?: string;
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
  /** Plain-word, user-facing summary; `derivation` remains the full provenance record (#26). */
  derivationSummary?: LocalizedText[];
}

/**
 * A non-code data file (JSON, CSV, …) that station code reads or inlines into the bundle without it being a
 * runtime asset (render geometry, signage tables, crowd lanes). Declaring it gives it the same source and
 * rights gate as an asset; a production build refuses inlined data that no `dataFiles[]`/`assets[]` entry declares.
 */
export interface DataFile {
  id: string;
  /** Path relative to the station folder stations/<id>/ (not gteki/): canonical, no "..", no scheme. */
  path: string;
  /** Sources the data is derived from; their rights gate public distribution. */
  sourceIds: string[];
  /** True when GTEki generated or modified the data. */
  modified: boolean;
  /**
   * True when GTEki wrote the file itself (config, not derived from any source). Then sourceIds must be empty
   * and derivation must say so; it is never credited.
   */
  authored?: boolean;
  /**
   * How it was made, naming the generating script. Required and non-empty when `modified` is true, when any
   * cited source is facts-only (the data then states facts without reproducing the source; #186/#26), or when
   * the file is `authored`.
   */
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
  /** Compass heading in degrees: 0 = north, 90 = east, clockwise. */
  spawnHeadings?: Record<string, number>;
  assets?: Asset[];
  dataFiles?: DataFile[];
  /** Brands listed by stores' own directories (optional `gteki/tenants.json`). Facts only, never routing targets. */
  tenants?: Tenant[];
  /** Whole-building / floor-range hours printed by an official page (OD-32), shared by many shops. */
  buildingHours?: BuildingHours[];
}

/** stations/<id>/gteki/station.json */
export interface StationManifestFile {
  schema: typeof SCHEMA_VERSION;
  station: Station;
  sources: Source[];
  floors: Floor[];
  coverage: Coverage;
  spawnNodeIds?: string[];
  /** Compass heading in degrees: 0 = north, 90 = east, clockwise. */
  spawnHeadings?: Record<string, number>;
  assets?: Asset[];
  dataFiles?: DataFile[];
  /** Whole-building / floor-range hours printed by an official page (OD-32). */
  buildingHours?: BuildingHours[];
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

/** stations/<id>/gteki/tenants.json (optional, #419). */
export const TENANTS_SCHEMA_VERSION = "gteki.tenants/0.1" as const;

/**
 * A brand listed by a store's own directory. Facts only: never a routing target, never positioned.
 * Everything the directory states beyond name, floor and category (hours, "open now", logos, layouts) is left out.
 */
export interface Tenant {
  /** `tenant-<store>-<n>`, stable, never reused. */
  id: string;
  /** The store POI that lists it (an existing POI in this bundle, category "shop"). */
  poiId: string;
  /** Brand name exactly as printed (`ja`, whatever the script). No invented translation. */
  names: LocalizedText[];
  /** Only variants the source itself prints (e.g. its kana). */
  aliases: LocalizedText[];
  /**
   * The store's own floor label as printed ("8F", "B1", "本館 2F"). Free text, NOT a station `floorId`:
   * store floors are never equated with station floors (docs/core/contract.md).
   */
  floorLabel: LocalizedText[];
  /** The directory's category as printed, if any (婦人服, レストラン …). Display/filter only. */
  category?: LocalizedText[];
  /** The directory that prints this listing; `facts-only` sources only (the UI marks it unverified). */
  evidence: EvidenceRef;
}

/** stations/<id>/gteki/tenants.json */
export interface TenantFile {
  schema: typeof TENANTS_SCHEMA_VERSION;
  tenants: Tenant[];
}

export { ASSET_FILE_EXT, DATA_FILE_EXT, PUBLICATION_RULE_CODES, dataFileFactsOnlySources, isCanonicalAssetPath, validateBundle, type ValidationIssue } from "./validate.ts";
export { checkShape, composeBundle, parseStationFiles, type ParseResult } from "./parse.ts";
export { parseHm, isOpenAt, type LocalTime } from "./hours.ts";
