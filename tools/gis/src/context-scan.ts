import { createReadStream } from 'node:fs';
import { SaxesParser } from 'saxes';
import type { SaxesAttributeNS, SaxesTagNS } from 'saxes';

/**
 * Bounded two-pass streaming scanner for PLATEAU `bldg:Building` and `tran:Road` top-level features (CityGML 2.0).
 *
 * It never builds a DOM and never keeps an inventory of every polygon:
 *  - `footprint` mode records, per top-level feature, only its gml:id, its station-frame XY bbox (every polygon vertex of
 *    every LOD, so selection does not depend on which LOD is later drawn), polygon counts per LOD and the LOD property names;
 *  - `collect` mode additionally retains the polygons of the features the caller selected by gml:id, whole, and hands each to
 *    `onFeature` as soon as it closes so the caller can triangulate and discard it. Non-selected features are skipped without
 *    parsing their coordinates. Textures (`app:*`) are never read.
 * Only inline `gml:Polygon` definitions are retained. `xlink:href` solid/multi-surface members are only recorded so the caller
 * can check that every reference resolves to an inline polygon of the same feature and LOD (each surface is then drawn once).
 */

const GML_URIS = new Set(['http://www.opengis.net/gml', 'http://www.opengis.net/gml/3.2']);
const XLINK = 'http://www.w3.org/1999/xlink';
const NS_BLDG = /^http:\/\/www\.opengis\.net\/citygml\/building\/\d+\.\d+$/;
const NS_TRAN = /^http:\/\/www\.opengis\.net\/citygml\/transportation\/\d+\.\d+$/;
const NS_CITYGML = /^http:\/\/www\.opengis\.net\/citygml\/\d+\.\d+$/;
const EPSG6697 = /(?:EPSG\/0\/6697|EPSG::6697|EPSG:6697)$/;
const SURFACE_LOCALS = new Set(['WallSurface', 'RoofSurface', 'GroundSurface', 'OuterCeilingSurface', 'OuterFloorSurface', 'ClosureSurface', 'BuildingInstallation', 'TrafficArea', 'AuxiliaryTrafficArea']);
/** GML elements a Polygon-based surface/solid legitimately contains; any other gml element inside a lodN property is counted as unsupported. */
const SUPPORTED_GML = new Set(['MultiSurface', 'surfaceMember', 'surfaceMembers', 'CompositeSurface', 'Solid', 'exterior', 'interior', 'Polygon', 'LinearRing', 'posList', 'pos', 'OrientableSurface', 'baseSurface']);

export type ContextKind = 'bldg' | 'tran';
export type LodDigit = 0 | 1 | 2 | 3 | 4;
export interface RetainedPolygon { lod: LodDigit; lod_property: string; surface: string | null; polygon_id: string | null; rings: number[][][] }
export interface ContextRef { lod: LodDigit; lod_property: string; target: string }
export interface ContextFeatureRecord {
  gml_id: string | null;
  type: 'Building' | 'Road';
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  polygons_by_lod: Record<LodDigit, number>;
  lod_properties: string[];
  /** Min/max source height of the polygons of each LOD digit (EPSG:6697 height, not station z). */
  height_range_by_lod: Partial<Record<LodDigit, [number, number]>>;
  refs: ContextRef[];
  /** Only in collect mode and only for retained features. */
  polygons?: RetainedPolygon[];
}
export interface ContextScanSummary {
  envelope: { srsName: string | null; lower: number[]; upper: number[] } | null;
  srs_names: string[];
  top_level_features: number;
  other_top_level_elements: Record<string, number>;
  polygons_without_lod: number;
  unconsumed_coordinate_elements: Record<string, number>;
  unsupported_geometry_elements: Record<string, number>;
  external_href_count: number;
}
export interface ContextScanOptions {
  kind: ContextKind;
  mode: 'footprint' | 'collect';
  /** footprint mode: projects (lat, lon, height) into station x/y/z. */
  project?: (lat: number, lon: number, h: number) => [number, number, number];
  /** collect mode: which top-level gml:ids to retain whole. */
  retain?: (gmlId: string) => boolean;
  onFeature: (record: ContextFeatureRecord) => void;
}

interface PolyAcc { id: string | null; lod: LodDigit | null; lodProperty: string; surface: string | null; negative: boolean; rings: number[][][]; open: boolean }
interface Frame {
  uri: string; local: string;
  lod: { digit: LodDigit; property: string } | null;
  surface: string | null; negative: boolean;
  collect: boolean; text: string;
  poly: PolyAcc | null; ring: number[][] | null;
  srsDimension: string | null;
}
interface FeatureAcc { record: ContextFeatureRecord; retained: boolean; lodProps: Set<string> }

const numeric = (text: string): number[] => {
  const values = text.trim().split(/\s+/).filter(Boolean).map(Number);
  if (values.some((v) => !Number.isFinite(v))) throw new Error(`Malformed CityGML numeric coordinate: ${text.slice(0, 120)}`);
  return values;
};
interface TagAttrs { srsName?: string; srsDimension?: string; id?: string; href?: string; orientation?: string }
/** One pass over a tag's attributes (this runs once per element of a 150 MB file). */
const readAttrs = (tag: SaxesTagNS): TagAttrs => {
  const out: TagAttrs = {};
  for (const raw of Object.values(tag.attributes as Record<string, SaxesAttributeNS>)) {
    if (raw.uri === '') {
      if (raw.local === 'srsName') out.srsName = raw.value;
      else if (raw.local === 'srsDimension') out.srsDimension = raw.value;
      else if (raw.local === 'orientation') out.orientation = raw.value;
    } else if (raw.local === 'id' && GML_URIS.has(raw.uri)) { if (raw.value.trim() !== '') out.id = raw.value; }
    else if (raw.local === 'href' && raw.uri === XLINK) out.href = raw.value;
  }
  return out;
};

export async function scanContextFeatures(path: string, options: ContextScanOptions): Promise<ContextScanSummary> {
  const wanted = options.kind === 'bldg' ? { ns: NS_BLDG, local: 'Building', type: 'Building' as const } : { ns: NS_TRAN, local: 'Road', type: 'Road' as const };
  const lodNs = options.kind === 'bldg' ? NS_BLDG : NS_TRAN;
  const footprint = options.mode === 'footprint';
  if (footprint && !options.project) throw new Error('footprint mode needs a projector');
  if (!footprint && !options.retain) throw new Error('collect mode needs a retain predicate');
  const stack: Frame[] = [];
  const srsNames = new Set<string>();
  const other: Record<string, number> = {};
  const unconsumed: Record<string, number> = {};
  const unsupported: Record<string, number> = {};
  let envelope: ContextScanSummary['envelope'] = null;
  let envelopeSeen = 0;
  let polygonsWithoutLod = 0, externalHrefs = 0, topLevel = 0;
  let feature: FeatureAcc | null = null;

  const parser = new SaxesParser({ xmlns: true, fragment: false });
  parser.on('doctype', () => { throw new Error('DOCTYPE declarations are forbidden in downloaded CityGML'); });
  parser.on('opentag', (rawTag) => {
    const tag = rawTag as SaxesTagNS;
    const parent = stack.at(-1);
    const uri = tag.uri, local = tag.local;
    const isGml = GML_URIS.has(uri);
    const attrs = readAttrs(tag);
    const srs = attrs.srsName;
    if (srs !== undefined && isGml) srsNames.add(srs);
    let lod = parent?.lod ?? null;
    let surface = parent?.surface ?? null;
    let negative = parent?.negative ?? false;
    if (feature) {
      const lodMatch = lodNs.test(uri) ? /^lod([0-4])(.+)$/.exec(local) : null;
      if (lodMatch) { lod = { digit: Number(lodMatch[1]) as LodDigit, property: local }; feature.lodProps.add(local); }
      if (lodNs.test(uri) && SURFACE_LOCALS.has(local)) surface = local;
      if (isGml && local === 'OrientableSurface') {
        const sign = attrs.orientation;
        if (sign !== undefined && sign !== '+' && sign !== '-') throw new Error(`Unsupported GML OrientableSurface orientation ${JSON.stringify(sign)}`);
        if (sign === '-') negative = !negative;
      }
    }
    const frame: Frame = { uri, local, lod, surface, negative, collect: false, text: '', poly: parent?.poly ?? null, ring: parent?.ring ?? null, srsDimension: attrs.srsDimension ?? parent?.srsDimension ?? null };
    // Top-level feature: a direct child of core:cityObjectMember.
    if (!feature && parent && NS_CITYGML.test(parent.uri) && parent.local === 'cityObjectMember') {
      if (wanted.ns.test(uri) && local === wanted.local) {
        topLevel++;
        const id = attrs.id ?? null;
        const retained = !footprint && id !== null && options.retain!(id);
        feature = {
          retained,
          lodProps: new Set(),
          record: { gml_id: id, type: wanted.type, bbox: null, polygons_by_lod: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, lod_properties: [], height_range_by_lod: {}, refs: [], ...(retained ? { polygons: [] } : {}) },
        };
      } else other[local] = (other[local] ?? 0) + 1;
    } else if (feature) {
      if (isGml && local === 'Polygon') {
        // A polygon outside any lodN property is parsed as a shell and dropped, so its coordinates are not miscounted as unconsumed.
        frame.poly = { id: attrs.id ?? null, lod: lod?.digit ?? null, lodProperty: lod?.property ?? '', surface, negative, rings: [], open: true };
        if (!lod) polygonsWithoutLod++;
        frame.ring = null;
      } else if (isGml && local === 'LinearRing' && frame.poly?.open) {
        frame.ring = [];
      } else if (isGml && (local === 'posList' || local === 'pos')) {
        if (frame.ring && frame.poly && frame.poly.lod !== null && (footprint || feature.retained)) frame.collect = true;
        else if (!frame.ring) unconsumed[local] = (unconsumed[local] ?? 0) + 1;
      } else if (isGml && lod && !SUPPORTED_GML.has(local)) {
        unsupported[local] = (unsupported[local] ?? 0) + 1;
        if (['coordinates', 'coord', 'pointRep'].includes(local)) unconsumed[local] = (unconsumed[local] ?? 0) + 1;
      }
      const href = attrs.href;
      if (href !== undefined && isGml && lod) {
        if (href.startsWith('#') && href.length > 1) feature.record.refs.push({ lod: lod.digit, lod_property: lod.property, target: href.slice(1) });
        else externalHrefs++;
      }
    } else if (isGml && local === 'Envelope' && parent?.local === 'boundedBy' && stack.length === 2) {
      envelopeSeen++;
      envelope = { srsName: srs ?? null, lower: [], upper: [] };
    } else if (isGml && (local === 'lowerCorner' || local === 'upperCorner') && envelope && envelopeSeen === 1) frame.collect = true;
    stack.push(frame);
  });
  parser.on('text', (value) => { const frame = stack.at(-1); if (frame?.collect) frame.text += value; });
  parser.on('closetag', () => {
    const frame = stack.pop();
    if (!frame) return;
    const isGml = GML_URIS.has(frame.uri);
    if (frame.collect && isGml && (frame.local === 'lowerCorner' || frame.local === 'upperCorner') && !feature && envelope) {
      (frame.local === 'lowerCorner' ? envelope.lower : envelope.upper).push(...numeric(frame.text));
      return;
    }
    if (!feature) return;
    if (frame.collect && isGml && (frame.local === 'posList' || frame.local === 'pos')) {
      const dim = Number(frame.srsDimension ?? 3);
      if (dim !== 3) throw new Error(`CityGML EPSG:6697 geometry dimension ${dim} is inconsistent with the declared 3D CRS`);
      const values = numeric(frame.text);
      if (values.length % 3 !== 0) throw new Error(`CityGML coordinate count ${values.length} is not divisible by 3`);
      const poly = frame.poly!, ring = frame.ring!;
      for (let i = 0; i < values.length; i += 3) {
        const lat = values[i]!, lon = values[i + 1]!, h = values[i + 2]!;
        if (lat < 24 || lat > 46 || lon < 122 || lon > 154) throw new Error(`EPSG:6697 serialized axis guard failed (expected latitude,longitude,height; got ${lat},${lon})`);
        if (footprint) {
          const [x, y] = options.project!(lat, lon, h);
          const box = feature.record.bbox;
          if (box) { if (x < box.minX) box.minX = x; if (x > box.maxX) box.maxX = x; if (y < box.minY) box.minY = y; if (y > box.maxY) box.maxY = y; }
          else feature.record.bbox = { minX: x, minY: y, maxX: x, maxY: y };
        }
        const range = feature.record.height_range_by_lod[poly.lod!];
        if (range) { if (h < range[0]) range[0] = h; if (h > range[1]) range[1] = h; } else feature.record.height_range_by_lod[poly.lod!] = [h, h];
        ring.push([lat, lon, h]);
      }
    } else if (isGml && frame.local === 'LinearRing' && frame.poly?.open && frame.ring) {
      frame.poly.rings.push(frame.negative ? [...frame.ring].reverse() : frame.ring);
    } else if (isGml && frame.local === 'Polygon' && frame.poly) {
      const poly = frame.poly;
      poly.open = false;
      if (poly.lod !== null) feature.record.polygons_by_lod[poly.lod]++;
      if (poly.lod !== null && feature.retained && poly.rings.length) feature.record.polygons!.push({ lod: poly.lod, lod_property: poly.lodProperty, surface: poly.surface, polygon_id: poly.id, rings: poly.rings });
    }
    // The parent frame inherited a reference to this polygon/ring builder; it must not leak to following siblings.
    if (frame.local === wanted.local && wanted.ns.test(frame.uri) && stack.length > 0 && NS_CITYGML.test(stack.at(-1)!.uri) && stack.at(-1)!.local === 'cityObjectMember') {
      feature.record.lod_properties = [...feature.lodProps].sort();
      const done = feature.record;
      feature = null;
      options.onFeature(done);
    }
  });
  const input = createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of input) parser.write(chunk);
  parser.close();
  if (envelopeSeen > 1) throw new Error('Ambiguous CityModel boundedBy Envelope CRS: expected exactly one envelope');
  const env = envelope as ContextScanSummary['envelope'];
  if (!env?.srsName) throw new Error('Missing CityModel envelope srsName; refusing to guess the CRS');
  for (const srs of new Set([...srsNames, env.srsName])) if (!EPSG6697.test(srs)) throw new Error(`Unsupported CityGML CRS ${srs}; expected EPSG:6697 (latitude, longitude, height)`);
  return {
    envelope: env, srs_names: [...srsNames].sort(), top_level_features: topLevel, other_top_level_elements: other,
    polygons_without_lod: polygonsWithoutLod, unconsumed_coordinate_elements: unconsumed, unsupported_geometry_elements: unsupported, external_href_count: externalHrefs,
  };
}
