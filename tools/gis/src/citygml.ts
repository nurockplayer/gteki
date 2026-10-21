import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { relative, resolve, sep } from 'node:path';
import { SaxesParser } from 'saxes';
import type { SaxesAttributeNS, SaxesTagNS } from 'saxes';
import { docsRoot, getStoredSource, getStoreRoot, writeJson } from './common.js';
import { readZip } from './zip.js';
import { project, type Point3 } from './crs.js';

export interface CityPolygon {
  owner_key: string;
  owner_type: string;
  parent_gml_id: string | null;
  lod: string | null;
  rings: number[][][];
  geometry_use: 'inline' | 'reference';
  geometry_context: 'boundary' | 'solid' | 'other';
  definition_id: string | null;
  orientation: '+' | '-';
  function_code: string | null;
  function_code_space: string | null;
  function_label: string | null;
}

export interface CityFeature {
  object_key: string;
  parent_object_key: string | null;
  gml_id: string | null;
  source_native_id: string | null;
  identity_status: 'PRESENT' | 'UNKNOWN';
  namespace_uri: string;
  local_type: string;
  source_id: string;
  source_sha256: string;
  verification: 'UNVERIFIED';
  type: string;
  parent_gml_id: string | null;
  names: string[] | null;
  function_code: string | null;
  function_code_space: string | null;
  function_label: string | null;
  class_code: string | null;
  class_code_space: string | null;
  usage_code: string | null;
  usage_code_space: string | null;
  field_statuses: { names: 'PRESENT' | 'UNKNOWN'; function_code: 'PRESENT' | 'UNKNOWN'; class_code: 'PRESENT' | 'UNKNOWN'; usage_code: 'PRESENT' | 'UNKNOWN'; function_label: 'PRESENT' | 'UNKNOWN' | 'UNRESOLVED'; height: 'PRESENT' | 'UNKNOWN' };
  lod_geometry_properties: string[];
  polygon_count: number;
  inline_definition_count: number;
  resolved_use_count: number;
  polygon_definition_ids: string[];
  inline_polygon_definition_ids: string[];
  ring_count: number;
  interior_ring_count: number;
  vertex_count: number;
  bbox_lat_lon_height: { min: number[]; max: number[] } | null;
  height_range: [number, number] | null;
  degenerate_polygon_count: number;
  degenerate_polygon_reasons: { fewer_than_3_distinct_vertices: number; projected_zero_area: number };
  unclosed_ring_count: number;
  raw_uro_attributes: Record<string, string[]>;
}

export interface CityInventory {
  source_id: string;
  source_sha256: string;
  verification: 'UNVERIFIED';
  namespaces: Record<string, string>;
  schema_location: string | null;
  srs_names: string[];
  srs_dimensions: string[];
  envelope: { lower: number[]; upper: number[]; raw_lower: string; raw_upper: string; srsName: string | null; axis_order: 'latitude,longitude,height' } | null;
  crs_inheritance: string | null;
  creation_dates: string[];
  codelist_inputs: CodelistInput[];
  codelist_status: 'LOADED' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
  geometry_reference_summary: { total: number; resolved: number; unresolved: number; unsupported_external: number; signed_reverse: number; by_context: Record<string, number> };
  geometry_totals: { polygon_definitions: number; resolved_uses: number; boundary_uses: number; solid_uses: number; other_uses: number; polygon_records_counted: number };
  unsupported_geometry_references: Array<{ target: string; owner_gml_id: string | null; context: 'boundary' | 'solid' | 'other'; reason: string }>;
  features: CityFeature[];
  floor_label_observations: Array<{ object_key: string; gml_id: string | null; field: string; value: string; source: 'gml:name' | 'uro-attribute' }>;
  mathematical_topology_observations: Array<{ element: string; gml_id: string | null; parent_topology_gml_id: string | null; namespace_uri: string }>;
  group_memberships: Array<{ relation: 'groupMember' | 'parent'; from_gml_id: string | null; target: string; resolves: boolean }>;
  codelist_resolution: Array<{ code: string; code_space: string | null; label: string | null; status: 'RESOLVED' | 'UNRESOLVED' }>;
  semantic_presence: Record<string, { status: 'PRESENT' | 'ABSENT_IN_FILE' | 'UNKNOWN'; count: number | null; observed_count: number; gml_ids: string[]; evidence: string }>;
  unknowns: string[];
  totals: { feature_count: number; polygon_count: number; polygon_definition_count: number; geometry_use_count: number; ring_count: number; interior_ring_count: number; vertex_count: number; degenerate_polygon_count: number; degenerate_polygon_reasons: { fewer_than_3_distinct_vertices: number; projected_zero_area: number }; unclosed_ring_count: number; bbox_lat_lon_height: { min: number[]; max: number[] } | null; height_range: [number, number] | null };
}

export interface CityInventorySummary extends Omit<CityInventory, 'features' | 'semantic_presence' | 'group_memberships' | 'unsupported_geometry_references'> {
  feature_tree: { store_path: string; sha256: string; bytes: number; feature_count: number };
  feature_type_counts: Record<string, number>;
  compact_features: Array<Pick<CityFeature, 'gml_id' | 'type' | 'parent_gml_id' | 'names' | 'function_code' | 'function_code_space' | 'function_label'>>;
  compact_features_total: number;
  semantic_presence: Record<string, { status: 'PRESENT' | 'ABSENT_IN_FILE' | 'UNKNOWN'; count: number | null; observed_count: number; gml_ids: string[]; gml_ids_total: number; gml_ids_truncated: boolean; unidentified_object_count: number; evidence: string }>;
  group_memberships: CityInventory['group_memberships'];
  group_membership_count: number;
  group_memberships_truncated: boolean;
  unsupported_geometry_references: { count: number; sample: CityInventory['unsupported_geometry_references']; truncated: boolean };
}

export interface ScanCityGmlOptions {
  source_id?: string;
  source_sha256?: string;
  codelists?: Map<string, string>;
  codelist_inputs?: CodelistInput[];
  onPolygon?: (polygon: CityPolygon) => void;
}

export interface CodelistInput { source_id: string; sha256: string; member: string; member_sha256: string }
export interface CodelistData extends Map<string, string> { inputs: CodelistInput[]; status: 'LOADED' | 'UNAVAILABLE' | 'NOT_APPLICABLE' }

type Attrs = Record<string, string>;
interface FeatureBuilder { feature: CityFeature; semantic: boolean }
interface RingBuilder { points: number[][]; dimension: number; srsName: string | null }
interface PolygonBuilder { rings: RingBuilder[]; owner: FeatureBuilder | null; lod: string | null; id: string | null; use: 'inline' | 'reference'; context: 'boundary' | 'solid' | 'other'; orientation: '+' | '-'; }
interface GeometryReference { target: string; owner: FeatureBuilder | null; lod: string | null; context: 'boundary' | 'solid' | 'other'; orientation: '+' | '-'; }
interface Frame { qname: string; local: string; uri: string; prefix: string; attrs: Attrs; attrUris: Record<string,string>; text: string; feature: FeatureBuilder | null; semanticOwner: FeatureBuilder | null; uroPropertyOwner: FeatureBuilder | null; ring: RingBuilder | null; polygon: PolygonBuilder | null; isCityModelEnvelope: boolean; }

const GML = 'http://www.opengis.net/gml';
const XLINK = 'http://www.w3.org/1999/xlink';
const URO = /^https:\/\/www\.geospatial\.jp\/iur\/uro\/\d+\.\d+$/;
const isGmlUri = (uri: string): boolean => uri === GML || uri === 'http://www.opengis.net/gml/3.2';
const SEMANTIC = /^(CityObjectGroup|UndergroundBuilding|Room|IntBuildingInstallation|FloorSurface|WallSurface|InteriorWallSurface|CeilingSurface|ClosureSurface|RoofSurface|GroundSurface|Door|Window)$/i;
const GML_TOPOLOGY = new Set(['TopoComplex', 'TopoPrimitive', 'TopoPoint', 'TopoCurve', 'TopoSurface', 'TopoSolid', 'TopoVolume', 'Node', 'Edge', 'Face', 'directedNode', 'directedEdge', 'directedFace', 'directedTopoSolid']);
const FLOOR_TOKEN = /(?:^|[^A-Za-z0-9])(?:B\s*[0-9０-９]+|地下\s*[0-9０-９]+\s*階|[0-9０-９]+\s*階|[0-9０-９]+\s*F)(?=$|[^A-Za-z0-9])/i;
const FLOOR_LABEL_FIELD = /^(?:floorlabel|floorname|floorno|floorlabeltext|flooridentifier|階名称|階層名)$/i;
const expectedSemanticModule = (localType: string): 'building' | 'cityobjectgroup' | 'uro' | null => {
  const local = localType.toLowerCase();
  if (local === 'cityobjectgroup') return 'cityobjectgroup';
  if (local === 'undergroundbuilding') return 'uro';
  if (/^(room|intbuildinginstallation|floorsurface|wallsurface|interiorwallsurface|ceilingsurface|closuresurface|roofsurface|groundsurface|door|window)$/.test(local)) return 'building';
  return null;
};
const semanticNamespaceMatches = (uri: string, localType: string): boolean => {
  const module = expectedSemanticModule(localType);
  if (!module) return false;
  if (module === 'uro') return URO.test(uri);
  return new RegExp(`^http://www\\.opengis\\.net/citygml/${module}/\\d+\\.\\d+$`).test(uri);
};
const isOfficialBuildingUri = (uri: string): boolean => /^http:\/\/www\.opengis\.net\/citygml\/building\/\d+\.\d+$/.test(uri);
export const isCitySemantic = (feature: Pick<CityFeature, 'namespace_uri' | 'local_type'>): boolean => SEMANTIC.test(feature.local_type) && semanticNamespaceMatches(feature.namespace_uri, feature.local_type);
const nsLocal = (qname: string): string => qname.includes(':') ? qname.slice(qname.indexOf(':') + 1) : qname;
const nsPrefix = (qname: string): string => qname.includes(':') ? qname.slice(0, qname.indexOf(':')) : '';
const getAttr = (attrs: Attrs, name: string): string | undefined => attrs[name] ?? Object.entries(attrs).find(([key]) => nsLocal(key) === name)?.[1];
const sourceGmlId = (attrs: Attrs, attrUris: Record<string,string>): string | undefined => {
  const value=Object.entries(attrs).find(([key])=>nsLocal(key)==='id'&&isGmlUri(attrUris[key]??''))?.[1];
  return value===undefined||value.trim()===''?undefined:value;
};
const numericValues = (text: string): number[] => {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  const values = tokens.map(Number);
  if (values.some(value => !Number.isFinite(value))) throw new Error(`Malformed CityGML numeric coordinate: ${text.slice(0, 120)}`);
  return values;
};
const pointBBox = (points: number[][]): { min: number[]; max: number[] } | null => {
  if (!points.length) return null;
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let i = 0; i < 3; i++) { const value = point[i]; if (value === undefined) return null; min[i] = Math.min(min[i]!, value); max[i] = Math.max(max[i]!, value); }
  return { min, max };
};
const mergeBBox = (a: { min: number[]; max: number[] } | null, b: { min: number[]; max: number[] } | null): { min: number[]; max: number[] } | null => {
  if (!a) return b ? { min: [...b.min], max: [...b.max] } : null;
  if (!b) return a;
  return { min: a.min.map((v, i) => Math.min(v, b.min[i]!)), max: a.max.map((v, i) => Math.max(v, b.max[i]!)) };
};
const closed = (points: number[][]): boolean => points.length > 1 && points[0]!.every((v, i) => Math.abs(v - points.at(-1)![i]!) < 1e-9);
const areaMagnitude = (points: number[][]): number => {
  let x = 0; let y = 0; let z = 0;
  for (let i = 0; i < points.length; i++) { const p = points[i]!; const q = points[(i + 1) % points.length]!; x += (p[1]! - q[1]!) * (p[2]! + q[2]!); y += (p[2]! - q[2]!) * (p[0]! + q[0]!); z += (p[0]! - q[0]!) * (p[1]! + q[1]!); }
  return Math.hypot(x, y, z) / 2;
};
const emptyFeature = (id: string | null, objectKey: string, parentObjectKey: string | null, type: string, namespaceUri: string, localType: string, parent: string | null, sourceId: string, sourceSha: string): CityFeature => ({ object_key: objectKey, parent_object_key: parentObjectKey, gml_id: id, source_native_id: id, identity_status: id === null ? 'UNKNOWN' : 'PRESENT', namespace_uri: namespaceUri, local_type: localType, source_id: sourceId, source_sha256: sourceSha, verification: 'UNVERIFIED', type, parent_gml_id: parent, names: null, function_code: null, function_code_space: null, function_label: null, class_code: null, class_code_space: null, usage_code: null, usage_code_space: null, field_statuses: { names: 'UNKNOWN', function_code: 'UNKNOWN', class_code: 'UNKNOWN', usage_code: 'UNKNOWN', function_label: 'UNKNOWN', height: 'UNKNOWN' }, lod_geometry_properties: [], polygon_count: 0, inline_definition_count: 0, resolved_use_count: 0, polygon_definition_ids: [], inline_polygon_definition_ids: [], ring_count: 0, interior_ring_count: 0, vertex_count: 0, bbox_lat_lon_height: null, height_range: null, degenerate_polygon_count: 0, degenerate_polygon_reasons: { fewer_than_3_distinct_vertices: 0, projected_zero_area: 0 }, unclosed_ring_count: 0, raw_uro_attributes: {} });

async function referencedPolygonTargets(path: string): Promise<Map<string, number>> {
  const targets = new Map<string, number>();
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on('doctype', () => { throw new Error('DOCTYPE declarations are forbidden in downloaded CityGML'); });
  parser.on('opentag', rawTag => {
    const tag = rawTag as SaxesTagNS;
    if (!isGmlUri(tag.uri) && !(isOfficialBuildingUri(tag.uri) && /^lod\d/i.test(tag.local))) return;
    if (isGmlUri(tag.uri) && GML_TOPOLOGY.has(tag.local)) return;
    const href = Object.values(tag.attributes as Record<string, SaxesAttributeNS>).find(attr => attr.local === 'href' && attr.uri === XLINK)?.value;
    if (href?.startsWith('#') && href.length > 1) {
      const target = href.slice(1); targets.set(target, (targets.get(target) ?? 0) + 1);
    }
  });
  const input = createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of input) parser.write(chunk);
  parser.close();
  return targets;
}

/** Two bounded SAX passes collect same-document polygon targets, then stream features and uses; no XML DOM is built. */
export async function scanCityGml(path: string, options: ScanCityGmlOptions = {}): Promise<CityInventory> {
  const referenceTargets = await referencedPolygonTargets(path);
  const polygonDefinitions = new Map<string, number[][][]>();
  const pendingReferences = new Map<string, GeometryReference[]>();
  const usedReferenceCounts = new Map<string, number>();
  const unsupportedReferences: CityInventory['unsupported_geometry_references'] = [];
  let geometryReferenceCount = 0; let resolvedReferenceCount = 0; let externalReferenceCount = 0; let reverseReferenceCount = 0;
  const referenceContexts: Record<string, number> = Object.create(null) as Record<string, number>;
  const namespaceMap: Record<string, string> = {};
  const schemaLocations = new Set<string>(); const srsNames = new Set<string>(); const dimensions = new Set<string>(); const creationDates = new Set<string>();
  const builders: FeatureBuilder[] = []; const features: CityFeature[] = []; const ids = new Set<string>(); const objectKeys = new Set<string>(); let anonymousSemanticCount = 0;
  const mathematicalTopologyObservations: CityInventory['mathematical_topology_observations'] = [];
  const memberships: CityInventory['group_memberships'] = []; const codeMap = options.codelists ?? new Map<string, string>();
  const labelFor = (code: string | null, space: string | null): string | null => {
    if (!code) return null;
    const normalizedSpace = space?.split(/[/?#]/).filter(Boolean).at(-1)?.replace(/\.xml$/i, '') ?? '';
    return codeMap.get(`${space ?? ''}|${code}`) ?? codeMap.get(`${normalizedSpace}|${code}`) ?? null;
  };
  const usedCodes = new Map<string, { code: string; space: string | null }>(); const frames: Frame[] = []; let envelope: CityInventory['envelope'] = null;
  let cityModelEnvelopeCount = 0; let cityModelEnvelopeCrs: string | null = null; let usedEnvelopeCrsFallback = false;
  let totalBBox: CityInventory['totals']['bbox_lat_lon_height'] = null; let polygonCount = 0; let ringCount = 0; let interiorRingCount = 0; let vertexCount = 0; let degenerateCount = 0; let tooFewDistinctCount = 0; let projectedZeroAreaCount = 0; let unclosedCount = 0;
  let rootSrs: string | null = null;
  let boundaryUses = 0; let solidUses = 0; let otherUses = 0;
  const addPolygonUse = (rings: number[][][], ownerBuilder: FeatureBuilder | null, lod: string | null, definitionId: string | null, geometryUse: 'inline' | 'reference', geometryContext: 'boundary' | 'solid' | 'other', orientation: '+' | '-') => {
    const orientedRings = orientation === '-' ? rings.map(ring => [...ring].reverse()) : rings;
    const points = orientedRings.flat(); const bbox = pointBBox(points);
    const distinct = new Set((orientedRings[0] ?? []).map(p => p.join(','))).size;
    const projectedOuter = (orientedRings[0] ?? []).map(point => project(point as Point3));
    const tooFewDistinct = distinct < 3;
    const zeroArea = !tooFewDistinct && areaMagnitude(projectedOuter) < 5e-11;
    const degenerate = tooFewDistinct || zeroArea;
    const opens = orientedRings.filter(r => r.length && !closed(r)).length;
    if (geometryContext === 'boundary') boundaryUses++; else if (geometryContext === 'solid') solidUses++; else otherUses++;
    if (ownerBuilder) {
      const f = ownerBuilder.feature; f.polygon_count++;
      if (geometryUse === 'inline') f.inline_definition_count++; else f.resolved_use_count++;
      if (definitionId && !f.polygon_definition_ids.includes(definitionId)) f.polygon_definition_ids.push(definitionId);
      if (geometryUse === 'inline' && definitionId && !f.inline_polygon_definition_ids.includes(definitionId)) f.inline_polygon_definition_ids.push(definitionId);
      f.ring_count += orientedRings.length; f.interior_ring_count += Math.max(0, orientedRings.length - 1); f.vertex_count += points.length;
      f.bbox_lat_lon_height = mergeBBox(f.bbox_lat_lon_height, bbox);
      if (bbox) f.height_range = f.height_range ? [Math.min(f.height_range[0], bbox.min[2]!), Math.max(f.height_range[1], bbox.max[2]!)] : [bbox.min[2]!, bbox.max[2]!];
      if (degenerate) { f.degenerate_polygon_count++; if (tooFewDistinct) f.degenerate_polygon_reasons.fewer_than_3_distinct_vertices++; else f.degenerate_polygon_reasons.projected_zero_area++; }
      f.unclosed_ring_count += opens;
      options.onPolygon?.({ owner_key: f.object_key, owner_type: f.type, parent_gml_id: f.parent_gml_id, lod, rings: orientedRings, geometry_use: geometryUse, geometry_context: geometryContext, definition_id: definitionId, orientation, function_code: f.function_code, function_code_space: f.function_code_space, function_label: labelFor(f.function_code, f.function_code_space) });
    }
    ringCount += orientedRings.length; interiorRingCount += Math.max(0, orientedRings.length - 1); vertexCount += points.length;
    if (degenerate) degenerateCount++; if (tooFewDistinct) tooFewDistinctCount++; else if (zeroArea) projectedZeroAreaCount++;
    unclosedCount += opens; totalBBox = mergeBBox(totalBBox, bbox);
  };
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on('doctype', () => { throw new Error('DOCTYPE declarations are forbidden in downloaded CityGML'); });
  parser.on('opentag', rawTag => {
    const tag = rawTag as SaxesTagNS;
    const attrs: Attrs = {}; const attrUris: Record<string, string> = {};
    for (const [key, raw] of Object.entries(tag.attributes)) {
      const value = raw as SaxesAttributeNS;
      attrs[key] = value.value;
      attrUris[key] = value.uri;
    }
    const qname = tag.name; const local = tag.local; const prefix = tag.prefix; const uri = tag.uri;
    Object.assign(namespaceMap, tag.ns);
    if (isGmlUri(uri) && local === 'OrientableSurface') {
      const sign = attrs.orientation;
      if (sign !== undefined && sign !== '+' && sign !== '-') throw new Error(`Unsupported GML OrientableSurface orientation ${JSON.stringify(sign)}; expected '+' or '-'`);
    }
    const parentFrame = frames.at(-1); const inheritedOwner = parentFrame?.semanticOwner ?? null;
    const id = sourceGmlId(attrs,attrUris);
    if (id !== undefined) {
      if (ids.has(id)) throw new Error(`Duplicate gml:id ${id}`);
      ids.add(id);
    }
    if (isGmlUri(uri) && GML_TOPOLOGY.has(local)) {
      const parentTopology = [...frames].reverse().find(frame => isGmlUri(frame.uri) && GML_TOPOLOGY.has(frame.local));
      const parentTopologyId = parentTopology ? sourceGmlId(parentTopology.attrs, parentTopology.attrUris) ?? null : null;
      mathematicalTopologyObservations.push({ element: local, gml_id: id ?? null, parent_topology_gml_id: parentTopologyId, namespace_uri: uri });
    }
    const semantic = SEMANTIC.test(local) && semanticNamespaceMatches(uri, local);
    let feature: FeatureBuilder | null = null;
    if (semantic) {
      const semanticAncestors = [...frames].reverse().filter(ancestor => ancestor.feature?.semantic).map(ancestor => ancestor.feature!.feature);
      const parentId = semanticAncestors[0]?.gml_id ?? null;
      const parentObjectKey = semanticAncestors[0]?.object_key ?? null;
      const objectKey = id ?? `anonymous:${local}:${String(++anonymousSemanticCount).padStart(7, '0')}`;
      if (objectKeys.has(objectKey)) throw new Error(`Duplicate internal CityGML object key ${objectKey}`);
      objectKeys.add(objectKey);
      feature = { feature: emptyFeature(id ?? null, objectKey, parentObjectKey, qname, uri, local, parentId, options.source_id ?? 'unknown', options.source_sha256 ?? ''), semantic: true };
      builders.push(feature); features.push(feature.feature);
    }
    // Every semantic element starts a fresh ownership scope, even when it lacks gml:id.
    // This prevents anonymous child properties from leaking into an enclosing feature.
    const semanticOwner = semantic ? feature : inheritedOwner ?? feature;
    const srsName = getAttr(attrs, 'srsName') || parentFrame?.attrs.srsName || (cityModelEnvelopeCount === 1 ? cityModelEnvelopeCrs : null);
    if (!getAttr(attrs, 'srsName') && !parentFrame?.attrs.srsName && cityModelEnvelopeCount === 1 && cityModelEnvelopeCrs) usedEnvelopeCrsFallback = true;
    const srsDimension = getAttr(attrs, 'srsDimension') ?? parentFrame?.attrs.srsDimension ?? null;
    if (getAttr(attrs, 'srsName')) { srsNames.add(getAttr(attrs, 'srsName')!); if (!rootSrs) rootSrs = getAttr(attrs, 'srsName')!; }
    if (getAttr(attrs, 'srsDimension')) dimensions.add(getAttr(attrs, 'srsDimension')!);
    const schemaLocation = getAttr(attrs, 'schemaLocation'); if (schemaLocation) schemaLocations.add(schemaLocation);
    const isCityModelEnvelope = isGmlUri(uri) && local === 'Envelope' && isGmlUri(parentFrame?.uri ?? '') && parentFrame?.local === 'boundedBy' && frames.at(-2)?.local === 'CityModel';
    if (isCityModelEnvelope) {
      envelope = { lower: [], upper: [], raw_lower: '', raw_upper: '', srsName, axis_order: 'latitude,longitude,height' };
      {
        cityModelEnvelopeCount++;
        if (cityModelEnvelopeCount === 1) cityModelEnvelopeCrs = srsName;
        else cityModelEnvelopeCrs = null;
      }
    }
    const currentPolygon = isGmlUri(uri) ? frames.at(-1)?.polygon ?? null : null;
    const reverseParity = frames.filter(f => isGmlUri(f.uri) && f.local === 'OrientableSurface' && f.attrs.orientation === '-').length % 2;
    const orientation: '+' | '-' = reverseParity ? '-' : '+';
    const context: 'boundary' | 'solid' | 'other' = semanticOwner && /(?:Floor|Wall|Ceiling|Closure|Roof|Ground)Surface$/i.test(semanticOwner.feature.local_type) ? 'boundary' : [...frames].some(f => /^lod\d+Solid$/i.test(f.local)) || (isOfficialBuildingUri(uri) && /^lod\d+Solid$/i.test(local)) ? 'solid' : 'other';
    const polygon = isGmlUri(uri) && local === 'Polygon' ? { rings: [], owner: semanticOwner, lod: [...frames].reverse().find(f => /^lod\d/i.test(f.local))?.local ?? null, id: sourceGmlId(attrs,attrUris) ?? null, use: 'inline' as const, context, orientation } : null;
    const ring = isGmlUri(uri) && local === 'LinearRing' && currentPolygon ? { points: [], dimension: Number(srsDimension) || 3, srsName } : null;
    const isGeometryElement = (frameUri: string, frameLocal: string) => (isGmlUri(frameUri) && /^(?:Polygon|LinearRing|pos|posList|coordinates|Solid|CompositeSurface|MultiSurface|OrientableSurface|surfaceMember|baseSurface|exterior|interior)$/i.test(frameLocal)) || (isOfficialBuildingUri(frameUri) && /^lod\d/i.test(frameLocal));
    const inGeometry = isGeometryElement(uri, local) || frames.some(f => isGeometryElement(f.uri, f.local));
    const uroPropertyOwner = semantic ? null : inGeometry ? null : parentFrame?.uroPropertyOwner ?? (URO.test(uri) ? semanticOwner : null);
    const frame: Frame = { qname, local, uri, prefix, attrs: { ...attrs, srsName: srsName ?? '', srsDimension: srsDimension ?? '' }, attrUris, text: '', feature, semanticOwner, uroPropertyOwner, ring, polygon: polygon ?? currentPolygon, isCityModelEnvelope };
    frames.push(frame);
    const uroOwner = URO.test(uri) ? uroPropertyOwner : null;
    if (uroOwner) {
      for (const [attr, value] of Object.entries(attrs)) if (URO.test(attrUris[attr] ?? '')) (uroOwner.feature.raw_uro_attributes[attr] ??= []).push(value);
    }
    if (/^lod\d/i.test(local) && isOfficialBuildingUri(uri) && semanticOwner) semanticOwner.feature.lod_geometry_properties.push(local);
    if (((isGmlUri(uri) && !GML_TOPOLOGY.has(local)) || isOfficialBuildingUri(uri)) && Object.entries(attrs).some(([key]) => nsLocal(key) === 'href' && attrUris[key] === XLINK)) {
      const href = Object.entries(attrs).find(([key]) => nsLocal(key) === 'href' && attrUris[key] === XLINK)?.[1] ?? '';
      geometryReferenceCount++; referenceContexts[context] = (referenceContexts[context] ?? 0) + 1; if (orientation === '-') reverseReferenceCount++;
      if (!href.startsWith('#') || href.length < 2) {
        externalReferenceCount++; unsupportedReferences.push({ target: href || 'missing xlink:href', owner_gml_id: semanticOwner?.feature.gml_id ?? null, context, reason: 'Only same-document fragment geometry references are resolved.' });
      } else {
      const target = href.slice(1); const ref: GeometryReference = { target, owner: semanticOwner, lod: /^lod\d/i.test(local) ? local : [...frames].reverse().find(f => /^lod\d/i.test(f.local))?.local ?? null, context, orientation };
        const definition = polygonDefinitions.get(target);
        if (definition) {
          addPolygonUse(definition, ref.owner, ref.lod, target, 'reference', ref.context, ref.orientation);
          resolvedReferenceCount++; usedReferenceCounts.set(target, (usedReferenceCounts.get(target) ?? 0) + 1);
          if (usedReferenceCounts.get(target) === referenceTargets.get(target)) polygonDefinitions.delete(target);
        } else (pendingReferences.get(target) ?? (pendingReferences.set(target, []), pendingReferences.get(target)!)).push(ref);
      }
    }
    if ((local === 'groupMember' || local === 'parent') && /cityobjectgroup/.test(uri)) {
      const target = Object.entries(attrs).find(([key]) => nsLocal(key) === 'href' && attrUris[key] === XLINK)?.[1]; if (target) memberships.push({ relation: local, from_gml_id: inheritedOwner?.feature.gml_id ?? null, target: target.startsWith('#') ? target.slice(1) : target, resolves: false });
    }
  });
  parser.on('text', value => { const frame = frames.at(-1); if (frame && (['name', 'function', 'class', 'usage', 'lowerCorner', 'upperCorner', 'creationDate', 'posList', 'pos', 'coordinates'].includes(frame.local) || /\/uro\/\d+\.\d+$/.test(frame.uri))) frame.text += value; });
  parser.on('cdata', value => { const frame = frames.at(-1); if (frame) frame.text += value; });
  parser.on('closetag', () => {
    const frame = frames.pop(); if (!frame) return;
    const parentFrame = frames.at(-1); const owner = frame.semanticOwner;
    const activeEnvelope = [...frames].reverse().find(ancestor => ancestor.local === 'Envelope');
    if (isGmlUri(frame.uri) && frame.local === 'lowerCorner' && envelope && activeEnvelope?.isCityModelEnvelope) { envelope.lower = numericValues(frame.text); envelope.raw_lower = frame.text; }
    if (isGmlUri(frame.uri) && frame.local === 'upperCorner' && envelope && activeEnvelope?.isCityModelEnvelope) { envelope.upper = numericValues(frame.text); envelope.raw_upper = frame.text; }
    if (frame.local === 'creationDate' && frame.text.trim()) creationDates.add(frame.text.trim());
    const codeField = frame.local === 'function' || frame.local === 'class' || frame.local === 'usage' ? frame.local : null;
    if (codeField && owner && isOfficialBuildingUri(frame.uri) && parentFrame?.feature?.semantic && isCitySemantic(parentFrame.feature.feature) && frame.text.trim()) {
      const value = frame.text.trim(); const codeSpace = getAttr(frame.attrs, 'codeSpace') ?? null;
      const codeKey = `${codeField}_code` as 'function_code' | 'class_code' | 'usage_code';
      const spaceKey = `${codeField}_code_space` as 'function_code_space' | 'class_code_space' | 'usage_code_space';
      owner.feature[codeKey] ??= value; owner.feature[spaceKey] ??= codeSpace;
      if (codeField === 'function') usedCodes.set(`${codeSpace ?? ''}|${value}`, { code: value, space: codeSpace });
    }
    if (frame.local === 'name' && frame.uri === GML && owner && parentFrame?.feature?.semantic && frame.text.trim()) (owner.feature.names ??= []).push(frame.text.trim());
    if (URO.test(frame.uri) && frame.uroPropertyOwner && frame.text.trim()) (frame.uroPropertyOwner.feature.raw_uro_attributes[frame.qname] ??= []).push(frame.text.trim());
    if (isGmlUri(frame.uri) && ['posList', 'pos', 'coordinates'].includes(frame.local) && parentFrame?.ring) {
      // EPSG:6697 is a 3D CRS. When GML omits srsDimension, tuple grouping comes from that declared CRS; all three ordinates must still be present.
      const values = numericValues(frame.text); const dim = Number(getAttr(frame.attrs, 'srsDimension') ?? parentFrame.ring.dimension) || 3;
      if (values.length % dim !== 0) throw new Error(`CityGML coordinate count ${values.length} is not divisible by dimension ${dim}`);
      if (dim !== 3) throw new Error(`CityGML EPSG:6697 geometry dimension ${dim} is inconsistent with the declared 3D CRS`);
      for (let i = 0; i + dim - 1 < values.length; i += dim) {
        if (dim < 3) throw new Error(`CityGML coordinate dimension ${dim} has no height; refusing to invent one`);
        const tuple = values.slice(i, i + dim); const point = [tuple[0]!, tuple[1]!, tuple[2]!];
        const serializedCrs = frame.attrs.srsName || parentFrame.ring.srsName;
        if (!serializedCrs || !/(?:EPSG\/0\/6697|EPSG::6697|EPSG:6697)$/.test(serializedCrs)) throw new Error(`Unsupported or missing CityGML coordinate CRS ${serializedCrs ?? 'unknown'}; expected EPSG:6697`);
        const [lat, lon] = point;
        if (lat! < 24 || lat! > 46 || lon! < 122 || lon! > 154) throw new Error(`EPSG:6697 serialized axis guard failed (expected latitude,longitude,height; got ${lat},${lon})`);
        parentFrame.ring.points.push(point);
      }
    }
    if (frame.ring && frame.polygon) frame.polygon.rings.push(frame.ring);
    if (isGmlUri(frame.uri) && frame.local === 'Polygon' && frame.polygon) {
      const poly = frame.polygon; polygonCount++;
      const rings = poly.rings.map(r => r.points);
      addPolygonUse(rings, poly.owner, poly.lod, poly.id, 'inline', poly.context, poly.orientation);
      if (poly.id && referenceTargets.has(poly.id)) {
        const waiting = pendingReferences.get(poly.id) ?? [];
        for (const ref of waiting) {
          addPolygonUse(rings, ref.owner, ref.lod, poly.id, 'reference', ref.context, ref.orientation);
          resolvedReferenceCount++; usedReferenceCounts.set(poly.id, (usedReferenceCounts.get(poly.id) ?? 0) + 1);
        }
        pendingReferences.delete(poly.id);
        if ((usedReferenceCounts.get(poly.id) ?? 0) < (referenceTargets.get(poly.id) ?? 0)) polygonDefinitions.set(poly.id, rings);
      }
    }
    if (frame.feature && frame.feature.semantic) frame.feature.feature.function_label = labelFor(frame.feature.feature.function_code, frame.feature.feature.function_code_space);
    if (frame.feature) { const index = builders.lastIndexOf(frame.feature); if (index >= 0) builders.splice(index, 1); }
  });
  const input = createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of input) parser.write(chunk);
  parser.close();
  const epsg6697 = (srs: string) => /(?:EPSG\/0\/6697|EPSG::6697|EPSG:6697)$/.test(srs);
  if (rootSrs && !epsg6697(rootSrs)) throw new Error(`Unsupported CityGML CRS ${rootSrs}; expected EPSG:6697`);
  for (const srs of srsNames) if (!epsg6697(srs)) throw new Error(`Inconsistent CityGML CRS ${srs}; expected EPSG:6697`);
  if (cityModelEnvelopeCount > 1) throw new Error('Ambiguous CityModel boundedBy Envelope CRS: expected exactly one envelope for CRS inheritance');
  const checkedEnvelope = envelope as CityInventory['envelope'];
  if (checkedEnvelope) {
    if (!checkedEnvelope.srsName || !epsg6697(checkedEnvelope.srsName)) throw new Error(`Unsupported or missing envelope CRS ${checkedEnvelope.srsName ?? 'unknown'}; expected EPSG:6697`);
    for (const corner of [checkedEnvelope.lower, checkedEnvelope.upper]) {
      if (corner.length !== 3) throw new Error('EPSG:6697 envelope corners must contain latitude, longitude, and height');
      if (corner[0]! < 24 || corner[0]! > 46 || corner[1]! < 122 || corner[1]! > 154) throw new Error(`EPSG:6697 envelope axis guard failed (expected latitude,longitude,height; got ${corner})`);
    }
  }
  for (const [target, refs] of pendingReferences) for (const ref of refs) unsupportedReferences.push({ target, owner_gml_id: ref.owner?.feature.gml_id ?? null, context: ref.context, reason: 'Same-document target did not resolve to a streamed gml:Polygon definition.' });
  const labels = new Set(features.map(f => f.gml_id).filter((id): id is string => id !== null)); for (const member of memberships) member.resolves = labels.has(member.target);
  const resolvedCodes = [...usedCodes.values()].sort((a, b) => `${a.space}|${a.code}`.localeCompare(`${b.space}|${b.code}`)).map(({ code, space }) => { const normalizedSpace = space?.split(/[/?#]/).filter(Boolean).at(-1)?.replace(/\.xml$/i, '') ?? ''; const label = codeMap.get(`${space ?? ''}|${code}`) ?? codeMap.get(`${normalizedSpace}|${code}`) ?? null; return { code, code_space: space, label, status: (label ? 'RESOLVED' : 'UNRESOLVED') as 'RESOLVED' | 'UNRESOLVED' }; });
  for (const feature of features) {
    feature.field_statuses = {
      names: feature.names?.length ? 'PRESENT' : 'UNKNOWN',
      function_code: feature.function_code !== null ? 'PRESENT' : 'UNKNOWN',
      class_code: feature.class_code !== null ? 'PRESENT' : 'UNKNOWN',
      usage_code: feature.usage_code !== null ? 'PRESENT' : 'UNKNOWN',
      function_label: feature.function_code === null ? 'UNKNOWN' : feature.function_label === null ? 'UNRESOLVED' : 'PRESENT',
      height: feature.height_range === null ? 'UNKNOWN' : 'PRESENT',
    };
  }
  const semantic = (test: RegExp) => features.filter(f => isCitySemantic(f) && test.test(f.local_type));
  const idsOf = (list: CityFeature[]) => list.map(f => f.gml_id).filter((id): id is string => id !== null);
  const presence = (key: string, list: CityFeature[], evidence: string, unknownWhenAbsent = false): CityInventory['semantic_presence'][string] => ({ status: list.length ? 'PRESENT' : unknownWhenAbsent ? 'UNKNOWN' : 'ABSENT_IN_FILE', count: list.length ? list.length : unknownWhenAbsent ? null : 0, observed_count: list.length, gml_ids: idsOf(list), evidence });
  const floorLabelObservations: CityInventory['floor_label_observations'] = [];
  for (const feature of features) {
    for (const value of feature.names ?? []) if (FLOOR_TOKEN.test(value)) floorLabelObservations.push({ object_key: feature.object_key, gml_id: feature.gml_id, field: 'gml:name', value, source: 'gml:name' });
    for (const [field, values] of Object.entries(feature.raw_uro_attributes)) {
      if (!FLOOR_LABEL_FIELD.test(nsLocal(field))) continue;
      for (const value of values) if (value.trim()) floorLabelObservations.push({ object_key: feature.object_key, gml_id: feature.gml_id, field, value, source: 'uro-attribute' });
    }
  }
  const floorLabelFeatureKeys = new Set(floorLabelObservations.map(observation => observation.object_key));
  const floorLabelFeatures = features.filter(feature => floorLabelFeatureKeys.has(feature.object_key));
  const doors = semantic(/Door$/i); const windows = semantic(/Window$/i); const install = semantic(/IntBuildingInstallation/i);
  const broadStairRamp = (label: string) => /stair|階段/i.test(label) && /ramp|傾斜路|スロープ/i.test(label);
  const explicitKinds = (pattern: RegExp, excludeCombinedStairRamp=false) => features.filter(f => (isCitySemantic(f) && pattern.test(f.local_type)) || resolvedCodes.some(c => pattern.test(c.label ?? '') && !(excludeCombinedStairRamp && broadStairRamp(c.label ?? '')) && f.function_code === c.code && f.function_code_space === c.code_space));
  const combinedStairRamp = features.filter(f => resolvedCodes.some(c => broadStairRamp(c.label ?? '') && f.function_code === c.code && f.function_code_space === c.code_space));
  const finalBBox = totalBBox as { min: number[]; max: number[] } | null;
  const totalHeight: [number, number] | null = finalBBox ? [finalBBox.min[2]!, finalBBox.max[2]!] : null;
  const source_id = options.source_id ?? 'unknown'; const source_sha256 = options.source_sha256 ?? '';
  return {
    source_id, source_sha256, verification: 'UNVERIFIED', namespaces: namespaceMap, crs_inheritance: usedEnvelopeCrsFallback ? 'Geometry without srsName inherits the CRS from the sole CityModel boundedBy gml:Envelope.' : null,
    schema_location: [...schemaLocations].join(' ') || null, srs_names: [...srsNames].sort(), srs_dimensions: [...dimensions].sort(), envelope, creation_dates: [...creationDates].sort(),
    features, floor_label_observations: floorLabelObservations, mathematical_topology_observations: mathematicalTopologyObservations, group_memberships: memberships, codelist_resolution: resolvedCodes, codelist_inputs: options.codelist_inputs ?? (options.codelists as CodelistData | undefined)?.inputs ?? [], codelist_status: (options.codelists as CodelistData | undefined)?.status ?? (options.codelists ? 'LOADED' : 'NOT_APPLICABLE'),
    unsupported_geometry_references: unsupportedReferences,
    geometry_reference_summary: { total: geometryReferenceCount, resolved: resolvedReferenceCount, unresolved: unsupportedReferences.length - externalReferenceCount, unsupported_external: externalReferenceCount, signed_reverse: reverseReferenceCount, by_context: referenceContexts },
    geometry_totals: { polygon_definitions: polygonCount, resolved_uses: resolvedReferenceCount, boundary_uses: boundaryUses, solid_uses: solidUses, other_uses: otherUses, polygon_records_counted: polygonCount + resolvedReferenceCount },
    semantic_presence: {
      floors: presence('floors', semantic(/^FloorSurface$/i), `FloorSurface feature count ${semantic(/^FloorSurface$/i).length}; IDs sample: ${semantic(/^FloorSurface$/i).slice(0, 20).map(f => f.gml_id ?? 'unidentified').join(', ') || 'none'}`),
      doors: presence('doors', doors, `Door element count ${doors.length}; IDs sample: ${idsOf(doors).slice(0, 20).join(', ') || 'none'}`),
      windows: presence('windows', windows, `Window element count ${windows.length}; IDs sample: ${idsOf(windows).slice(0, 20).join(', ') || 'none'}`),
      door_representation: { status: 'UNKNOWN', count: null, observed_count: doors.length, gml_ids: idsOf(doors), evidence: `${doors.length} bldg:Door semantic objects observed (${doors.reduce((sum,f)=>sum+f.polygon_count,0)} owned geometry uses). Source text does not establish one Door object per physical opening versus a per-room aggregate.` },
      stairs: presence('stairs', explicitKinds(/stair|階段/i,true), 'Unambiguous explicit element type or resolved label only; combined stair/ramp categories do not establish an individual facility type.', true),
      escalators: presence('escalators', explicitKinds(/escalator|エスカレーター/i), 'Explicit element type or resolved function label only.', true),
      elevators: presence('elevators', explicitKinds(/elevator|lift|エレベーター/i), 'Explicit element type or resolved function label only.', true),
      ramps: presence('ramps', explicitKinds(/ramp|スロープ/i,true), 'Unambiguous explicit element type or resolved label only; combined stair/ramp categories do not establish an individual facility type.', true),
      stairs_or_ramps_category: presence('stairs_or_ramps_category',combinedStairRamp,'Resolved codelist category combines stairs and ramps; these are source semantic groups, not a count of individual stairs or ramps.'),
      ticket_gates_paid_area_boundary: presence('ticket gates / paid-area boundary', features.filter(f => isCitySemantic(f) && /^(?:TicketGate|Gate|FareGate|Turnstile|PaidAreaBoundary)$/i.test(f.local_type)), 'Explicit CityGML namespace element types only; no inference from geometry.', true),
      connectivity_topology: mathematicalTopologyObservations.length ? { status: 'UNKNOWN', count: null, observed_count: mathematicalTopologyObservations.length, gml_ids: [...new Set(mathematicalTopologyObservations.map(observation => observation.gml_id).filter((id): id is string => id !== null))], evidence: `GML mathematical topology elements were observed (${mathematicalTopologyObservations.map(observation => observation.element).join(', ')}); their navigable connectivity meaning is unknown.` } : { status: 'ABSENT_IN_FILE', count: 0, observed_count: 0, gml_ids: [], evidence: 'No namespace-qualified GML mathematical topology elements were observed in this file.' },
      mathematical_topology: { status: mathematicalTopologyObservations.length ? 'PRESENT' : 'ABSENT_IN_FILE', count: mathematicalTopologyObservations.length, observed_count: mathematicalTopologyObservations.length, gml_ids: [...new Set(mathematicalTopologyObservations.map(observation => observation.gml_id).filter((id): id is string => id !== null))], evidence: mathematicalTopologyObservations.length ? 'Namespace-qualified GML mathematical topology elements were observed; see mathematical_topology_observations for literal elements and IDs.' : 'No namespace-qualified GML mathematical topology elements were observed.' },
      navigable_connectivity: { status: 'UNKNOWN', count: null, observed_count: mathematicalTopologyObservations.length, gml_ids: [...new Set(mathematicalTopologyObservations.map(observation => observation.gml_id).filter((id): id is string => id !== null))], evidence: 'Mathematical topology element presence alone does not establish navigable edges or route connectivity; no route edges are inferred.' },
      floor_labels: { status: floorLabelFeatures.length ? 'PRESENT' : 'UNKNOWN', count: floorLabelFeatures.length || null, observed_count: floorLabelFeatures.length, gml_ids: [...new Set(floorLabelFeatures.map(feature => feature.gml_id).filter((id): id is string => id !== null))], evidence: floorLabelObservations.length ? `Literal floor-label evidence (${floorLabelFeatures.length} semantic objects): ${floorLabelObservations.map(observation => `gml:id=${observation.gml_id ?? 'unknown'} object_key=${observation.object_key} ${observation.field}=${JSON.stringify(observation.value)}`).join('; ')}.` : 'No explicit floor form or dedicated floor-label source field was observed; generic words such as 階段室 or 地下通路 do not establish a floor label.' },
      installations: presence('installations', install, `IntBuildingInstallation feature count ${install.length}; IDs sample: ${idsOf(install).slice(0, 20).join(', ') || 'none'}`),
    },
    unknowns: ['Vertical datum interpretation beyond declared EPSG:6697', 'Floor-to-elevation mapping', 'Operator and management boundaries', 'Paid/unpaid area boundaries unless explicit source elements exist', 'Currency versus the documented 2023 survey date', 'Current real-world condition and route connectivity'],
    totals: { feature_count: features.length, polygon_count: polygonCount + resolvedReferenceCount, polygon_definition_count: polygonCount, geometry_use_count: polygonCount + resolvedReferenceCount, ring_count: ringCount, interior_ring_count: interiorRingCount, vertex_count: vertexCount, degenerate_polygon_count: degenerateCount, degenerate_polygon_reasons: { fewer_than_3_distinct_vertices: tooFewDistinctCount, projected_zero_area: projectedZeroAreaCount }, unclosed_ring_count: unclosedCount, bbox_lat_lon_height: finalBBox, height_range: totalHeight },
  };
}

/** Parse one XML dictionary and key labels by its filename stem plus literal code. */
export function parseCodelistXml(fileName: string, xml: string | Buffer): Map<string, string> {
  const map = new Map<string, string>();
  const parser = new SaxesParser();
  let inDefinition = false; let code: string | null = null; let label: string | null = null; let text = ''; let active: string | null = null;
  const codeSpace = fileName.split('/').at(-1)!.replace(/\.xml$/i, '');
  parser.on('doctype', () => { throw new Error('DOCTYPE declarations are forbidden in codelists'); });
  parser.on('opentag', tag => {
    const local = nsLocal(tag.name);
    if (local === 'Definition' || local === 'definition') { inDefinition = true; code = null; label = null; }
    if (inDefinition && (local === 'description' || local === 'name')) { active = local; text = ''; }
  });
  parser.on('text', value => { if (active) text += value; });
  parser.on('closetag', tag => {
    const local = nsLocal(tag.name);
    if (active === local) { if (text.trim()) { if (local === 'name') code = text.trim(); else if (local === 'description') label = text.trim(); } active = null; }
    if ((local === 'Definition' || local === 'definition') && code && label) { map.set(`${codeSpace}|${code}`, label); inDefinition = false; }
  });
  parser.write(typeof xml === 'string' ? xml : xml.toString('utf8')).close();
  return map;
}

export async function loadCodelists(sourceId: string): Promise<CodelistData> {
  const city = sourceId.includes('13116') ? '13116' : sourceId.includes('13104') ? '13104' : null;
  if (!city) return Object.assign(new Map<string, string>(), { inputs: [], status: 'NOT_APPLICABLE' as const });
  const codelistSourceId = `plateau-${city}-codelists`;
  try { await access(join(docsRoot, 'gis', 'acquisitions', `${codelistSourceId}.json`)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.assign(new Map<string, string>(), { inputs: [], status: 'UNAVAILABLE' as const });
    throw error;
  }
  const { path, record } = await getStoredSource(codelistSourceId);
  const map = new Map<string, string>(); const inputs: CodelistInput[] = [];
    // Official dictionaries can contain large enumerations; retain explicit ZIP limits while allowing the catalog's full archive.
    const files = await readZip(path, { maxEntryBytes: 128_000_000, maxTotalBytes: 512_000_000 });
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.xml') || !/function/i.test(file.name)) continue;
      inputs.push({ source_id: record.source_id, sha256: record.sha256, member: file.name, member_sha256: createHash('sha256').update(file.data).digest('hex') });
      for (const [key, label] of parseCodelistXml(file.name, file.data)) map.set(key, label);
    }
  return Object.assign(map, { inputs: inputs.sort((a, b) => a.member.localeCompare(b.member)), status: 'LOADED' as const });
}

/** Exact extracted vintage members use the same scanner, without borrowing another vintage's dictionaries. */
export async function inspectCityGmlPath(path: string, options: { source_id: string; source_sha256: string }): Promise<CityInventory> {
  return scanCityGml(path, options);
}

export async function inspectCityGml(sourceId: string): Promise<CityInventory> {
  const stored = await getStoredSource(sourceId);
  const codelists = await loadCodelists(sourceId);
  const inventory = await scanCityGml(stored.path, { source_id: sourceId, source_sha256: stored.record.sha256, codelists });
  const detailBytes = Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  const detailSha256 = createHash('sha256').update(detailBytes).digest('hex');
  const detailStorePath = join(getStoreRoot(), 'out', `${sourceId}-${detailSha256}.inventory-detail.json`);
  await mkdir(dirname(detailStorePath), { recursive: true });
  await writeFile(detailStorePath, detailBytes);
  const typeCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const feature of inventory.features) typeCounts[feature.type] = (typeCounts[feature.type] ?? 0) + 1;
  const selectedCompact = inventory.features.filter(feature => /Room|CityObjectGroup/i.test(feature.type) || (feature.names?.length ?? 0) > 0 || feature.function_code !== null || feature.class_code !== null || feature.usage_code !== null);
  const compactFeatures = selectedCompact.slice(0, 500).map(({ gml_id, type, parent_gml_id, names, function_code, function_code_space, function_label }) => ({ gml_id, type, parent_gml_id, names, function_code, function_code_space, function_label }));
  const detailRelative = relative(getStoreRoot(), detailStorePath).split(sep).join('/');
  const summary: CityInventorySummary = {
    ...inventory,
    feature_tree: { store_path: detailRelative, sha256: detailSha256, bytes: detailBytes.length, feature_count: inventory.features.length },
    feature_type_counts: typeCounts,
    compact_features: compactFeatures,
    compact_features_total: selectedCompact.length,
    semantic_presence: Object.fromEntries(Object.entries(inventory.semantic_presence).map(([key, value]) => [key, { ...value, gml_ids: value.gml_ids.slice(0, 50), gml_ids_total: value.gml_ids.length, gml_ids_truncated: value.gml_ids.length > 50, unidentified_object_count: value.observed_count - value.gml_ids.length }])),
    group_memberships: inventory.group_memberships.slice(0, 100),
    group_membership_count: inventory.group_memberships.length,
    group_memberships_truncated: inventory.group_memberships.length > 100,
    unsupported_geometry_references: { count: inventory.unsupported_geometry_references.length, sample: inventory.unsupported_geometry_references.slice(0, 50), truncated: inventory.unsupported_geometry_references.length > 50 },
  };
  delete (summary as unknown as Partial<CityInventory>).features;
  const out = join(docsRoot, 'gis', 'inventory'); await mkdir(out, { recursive: true });
  await writeJson(join(out, `${sourceId}.inventory.json`), summary);
  const md = inventoryMarkdown(summary);
  await writeFile(join(out, `${sourceId}.md`), md, 'utf8');
  return inventory;
}

export async function loadInventoryDetail(sourceId: string): Promise<CityInventory> {
  const summary = await import('./common.js').then(({ readJson }) => readJson<CityInventorySummary>(join(docsRoot, 'gis', 'inventory', `${sourceId}.inventory.json`)));
  const relativePath = summary.feature_tree.store_path;
  if (!relativePath.startsWith('out/') || relativePath.split('/').some(part => part === '..' || part === '')) throw new Error(`Unsafe inventory detail path: ${relativePath}`);
  const fullPath = resolve(getStoreRoot(), relativePath);
  const rel = relative(getStoreRoot(), fullPath);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Inventory detail path escapes store: ${relativePath}`);
  const bytes = await readFile(fullPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== summary.feature_tree.sha256 || bytes.length !== summary.feature_tree.bytes) throw new Error(`Inventory detail integrity check failed for ${sourceId}`);
  const inventory = JSON.parse(bytes.toString('utf8')) as CityInventory;
  if (inventory.source_id !== sourceId || inventory.source_sha256 !== summary.source_sha256 || inventory.features.length !== summary.feature_tree.feature_count) throw new Error(`Inventory detail identity mismatch for ${sourceId}`);
  return inventory;
}

function inventoryMarkdown(inv: CityInventorySummary): string {
  const rows = Object.entries(inv.semantic_presence).map(([name, entry]) => `| ${name} | ${entry.status} | ${entry.count ?? 'unknown'} | ${entry.evidence.replaceAll('|', '\\|')} |`).join('\n');
  const types = Object.entries(inv.feature_type_counts).sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => `| ${type} | ${count} |`).join('\n');
  const features = inv.compact_features.map(feature => `| ${feature.gml_id} | ${feature.type} | ${feature.names?.join('; ') || 'unknown'} | ${feature.function_code ?? 'unknown'} | ${feature.function_label ?? 'unknown'} |`).join('\n');
  const codelists = inv.codelist_inputs.map(input => `- ${input.source_id} SHA-256 \`${input.sha256}\`, member \`${input.member}\` SHA-256 \`${input.member_sha256}\``).join('\n') || '- No codelist members loaded.';
  return `# CityGML inventory: ${inv.source_id}\n\nVerification: \`${inv.verification}\` · SHA-256: \`${inv.source_sha256}\`\n\n- Features: ${inv.totals.feature_count}\n- Polygon definitions: ${inv.totals.polygon_definition_count}\n- Resolved geometry uses: ${inv.geometry_reference_summary.resolved} (inventory polygon records counted: ${inv.totals.polygon_count})\n- Rings / interior rings: ${inv.totals.ring_count} / ${inv.totals.interior_ring_count}\n- Vertices: ${inv.totals.vertex_count}\n- SRS: ${inv.srs_names.join(', ') || 'unknown'}; serialized coordinates are interpreted as latitude, longitude, height only for EPSG:6697.\n- Envelope: ${JSON.stringify(inv.envelope)}\n- Geometry CRS fallback: ${inv.crs_inheritance ?? 'none'}\n- Unsupported geometry references: ${inv.unsupported_geometry_references.count} (${inv.unsupported_geometry_references.truncated ? 'sample truncated' : 'all shown in full detail'})\n- Full feature detail: store path \`${inv.feature_tree.store_path}\`, SHA-256 \`${inv.feature_tree.sha256}\`, ${inv.feature_tree.bytes} bytes.\n\n## Codelist inputs\n\nStatus: \`${inv.codelist_status}\`\n\n${codelists}\n\n## Feature type counts\n\n| Type | Count |\n| --- | ---: |\n${types}\n\n## Compact room, name, code, and group table\n\nShowing ${inv.compact_features.length} of ${inv.compact_features_total} matching records. The full tree is in the store detail file above.\n\n| gml:id | Type | Literal names | Function code | Resolved label |\n| --- | --- | --- | --- | --- |\n${features}\n\n## Semantic presence\n\n| Item | Status | Count | Evidence |\n| --- | --- | ---: | --- |\n${rows}\n\n## Unknowns\n\n${inv.unknowns.map(x => `- ${x}`).join('\n')}\n`;
}
