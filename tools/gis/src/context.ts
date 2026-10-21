import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { docsRoot, getStoredSource, getStoreRoot, packageRoot, readJson, repoRoot, writeJson, TOOL_VERSION, type SourceManifest } from './common.js';
import { loadFrame, toGltf, fromGltf, type Point3 } from './crs.js';
import { stationEnuProjector, stationLocal, isStationEnuFrame, STATION_ENU_FRAME_ID_PATTERN, type StationEnuFrame } from './station-enu.js';
import { scanContextFeatures, type ContextFeatureRecord, type ContextKind, type ContextScanSummary, type LodDigit } from './context-scan.js';
import { triangulate } from './triangulate.js';
import { toolFingerprint } from './provenance.js';

/** Bump when the selection or LOD rules change; part of the run id. */
export const CONTEXT_POLICY_VERSION = 'context-v1';
export const CONTEXT_ROLE = 'context';
/** Every glTF node role word the explorer (packages/scene-api roleOf) acts on. Context node names must never match one. */
export const EXPLORER_ROLE_WORDS = ['floor', 'stairs_ramps', 'walkable', 'ramp', 'stairs', 'wall', 'walls', 'barriers', 'barrier', 'transport', 'collider', 'camera_blocker', 'sign', 'signs', 'signage'] as const;

export const SELECTION_RULE = 'A top-level bldg:Building / tran:Road is selected when the XY bounding box of all its polygon vertices (every LOD) in the station frame intersects the closed disc of radius R around the frame origin. Selected features are converted whole; geometry is never cut at the window edge.';
export const LOD_POLICY = 'Buildings: LOD2 where the building has lod2Solid or a lod2MultiSurface boundary (all inline LOD2 polygons incl. installations), else LOD1; LOD0 is never converted; one LOD per building (a building whose LOD2 solid references do not all resolve to its own inline LOD2 polygons falls back to LOD1, never a mix). Roads: LOD3 only, because LOD1/LOD2 road geometry is flat at z=0; roads without LOD3 height are excluded and counted; no ground height is ever synthesised.';

const MATERIALS: Record<string, [number, number, number, number]> = {
  building_wall: [0.78, 0.76, 0.72, 1], building_roof: [0.55, 0.5, 0.48, 1], building_other: [0.7, 0.69, 0.67, 1], road_surface: [0.36, 0.37, 0.39, 1],
};

export interface ContextInput { sourceId: string; sourceSha256: string; kind: ContextKind; path: string; attributionText: string }
export interface ContextBuildArgs { frame: StationEnuFrame; radiusM: number; inputs: ContextInput[]; outputPath: string }
export type ExclusionReason =
  | 'missing_gml_id' | 'duplicate_gml_id' | 'no_polygon_geometry'
  | 'building_lod0_only_not_converted' | 'building_lod2_unresolved_refs_and_no_lod1'
  | 'road_no_lod3_lod1_lod2_flat_z0' | 'road_lod3_flat_z0' | 'no_convertible_polygons';
interface SourceCounts {
  source_id: string; source_sha256: string; kind: ContextKind; features_in_source: number; outside_window: number; selected: number; converted: number;
  excluded: Partial<Record<ExclusionReason, number>>; lod_used: Record<string, number>; lod2_fallback_to_lod1: number; unresolved_refs_in_drawn_lod: number; skipped_degenerate_polygons: number;
  footprint_scan: ContextScanSummary; collect_pass_top_level_features: number;
}
interface Built {
  gml_id: string; kind: ContextKind; type: 'Building' | 'Road'; source: ContextInput; lod_used: string; lod_fallback: string | null;
  groups: Map<string, { positions: number[]; normals: number[]; indices: number[] }>; polygons_converted: number; polygons_degenerate: number; unresolved_refs: number;
}

/** Whether a station-frame XY box meets the closed disc of radius R about the origin. */
export function bboxIntersectsDisc(box: { minX: number; minY: number; maxX: number; maxY: number }, radiusM: number): boolean {
  const dx = Math.max(box.minX, 0, -box.maxX), dy = Math.max(box.minY, 0, -box.maxY);
  return Math.hypot(dx, dy) <= radiusM;
}
export function contextNodeName(kind: ContextKind, gmlId: string): string { return kind === 'bldg' ? `ctx_bldg_${gmlId}` : `ctx_road_${gmlId}`; }
/** The explorer's role test for a node name (packages/scene-api roleOf, name branch), kept here so tests and the readback share it. */
export function explorerRoleFromName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const role of EXPLORER_ROLE_WORDS) if (lower === role || lower.startsWith(`${role}_`) || lower.startsWith(`${role}.`)) return role;
  return null;
}

const flat = (range: [number, number] | undefined): boolean => !range || (Math.abs(range[0]) < 1e-9 && Math.abs(range[1]) < 1e-9);
const bump = <K extends string>(record: Partial<Record<K, number>>, key: K): void => { record[key] = (record[key] ?? 0) + 1; };

/** Decide which LOD a feature is drawn at from pass-1 facts alone. `null` lod means excluded with `reason`. */
function planFeature(record: ContextFeatureRecord): { lod: LodDigit | null; reason?: ExclusionReason } {
  if (record.type === 'Building') {
    const has2 = record.lod_properties.some((p) => p === 'lod2Solid' || p === 'lod2MultiSurface') && record.polygons_by_lod[2] > 0;
    if (has2) return { lod: 2 };
    if (record.polygons_by_lod[1] > 0) return { lod: 1 };
    return { lod: null, reason: 'building_lod0_only_not_converted' };
  }
  if (record.polygons_by_lod[3] === 0) return { lod: null, reason: 'road_no_lod3_lod1_lod2_flat_z0' };
  if (flat(record.height_range_by_lod[3])) return { lod: null, reason: 'road_lod3_flat_z0' };
  return { lod: 3 };
}

function materialFor(kind: ContextKind, surface: string | null, normalY: number): string {
  if (kind === 'tran') return 'road_surface';
  if (surface === 'WallSurface') return 'building_wall';
  if (surface === 'RoofSurface') return 'building_roof';
  if (surface === null) return normalY > 0.7 ? 'building_roof' : 'building_wall'; // LOD1 solids carry no surface semantics
  return 'building_other';
}

function convertFeature(record: ContextFeatureRecord, plan: { lod: LodDigit }, input: ContextInput, frame: StationEnuFrame, counts: SourceCounts): Built | null {
  const polygons = record.polygons ?? [];
  let lod: LodDigit = plan.lod, fallback: string | null = null;
  const inlineIds = (digit: LodDigit): Set<string> => new Set(polygons.filter((p) => p.lod === digit && p.polygon_id !== null).map((p) => p.polygon_id!));
  const unresolvedAt = (digit: LodDigit): number => { const ids = inlineIds(digit); return record.refs.filter((r) => r.lod === digit && !ids.has(r.target)).length; };
  if (record.type === 'Building' && lod === 2 && unresolvedAt(2) > 0) {
    if (record.polygons_by_lod[1] === 0) { bump(counts.excluded, 'building_lod2_unresolved_refs_and_no_lod1'); return null; }
    lod = 1; fallback = 'LOD2 solid references did not all resolve to inline LOD2 polygons of this building; LOD1 used instead (never a mix)';
    counts.lod2_fallback_to_lod1++;
  }
  counts.unresolved_refs_in_drawn_lod += unresolvedAt(lod);
  const built: Built = { gml_id: record.gml_id!, kind: input.kind, type: record.type, source: input, lod_used: `LOD${lod}`, lod_fallback: fallback, groups: new Map(), polygons_converted: 0, polygons_degenerate: 0, unresolved_refs: unresolvedAt(lod) };
  for (const polygon of polygons) {
    if (polygon.lod !== lod) continue; // never two LODs for one feature; LOD0 is never drawn
    const rings = polygon.rings.map((ring) => ring.map((p) => toGltf(stationLocal(p, frame))));
    const geometry = triangulate(rings);
    if (!geometry) { built.polygons_degenerate++; counts.skipped_degenerate_polygons++; continue; }
    const material = materialFor(input.kind, polygon.surface, geometry.normal[1]);
    let group = built.groups.get(material);
    if (!group) { group = { positions: [], normals: [], indices: [] }; built.groups.set(material, group); }
    const offset = group.positions.length / 3;
    for (const p of geometry.positions) { group.positions.push(p[0], p[1], p[2]); group.normals.push(geometry.normal[0], geometry.normal[1], geometry.normal[2]); }
    for (const i of geometry.indices) group.indices.push(offset + i);
    built.polygons_converted++;
  }
  if (!built.polygons_converted) { bump(counts.excluded, 'no_convertible_polygons'); return null; }
  return built;
}

/** Two bounded passes per source, then one GLB. No store or docs access: the CLI wrapper adds provenance around it. */
export async function buildContextGlb(args: ContextBuildArgs) {
  const { frame, radiusM, inputs, outputPath } = args;
  if (!isStationEnuFrame(frame)) throw new Error('context conversion requires a station-enu frame');
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 2000) throw new Error('radius must be a finite number of metres in (0, 2000]');
  if (!inputs.length) throw new Error('context conversion needs at least one source');
  const project = stationEnuProjector(frame.origin);
  const document = new Document(), buffer = document.createBuffer();
  const attribution = [...new Set(inputs.map((i) => i.attributionText))].join(' / ');
  document.getRoot().getAsset().copyright = attribution;
  const scene = document.createScene('UNVERIFIED NOT_FOR_ROUTING street-level context (visual only)');
  const materials = Object.fromEntries(Object.entries(MATERIALS).map(([name, colour]) => [name, document.createMaterial(name).setBaseColorFactor(colour).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true)]));
  const seenIds = new Set<string>();
  const perSource: SourceCounts[] = [];
  const perFeature: Array<Record<string, unknown>> = [];
  const selectedIds: string[] = [];
  let triangleCount = 0, nodeCount = 0;
  let localBBox: { min: Point3; max: Point3 } | null = null;
  const nodeNames: string[] = [];

  for (const input of inputs) {
    const empty = (): ContextScanSummary => ({ envelope: null, srs_names: [], top_level_features: 0, other_top_level_elements: {}, polygons_without_lod: 0, unconsumed_coordinate_elements: {}, unsupported_geometry_elements: {}, external_href_count: 0 });
    const counts: SourceCounts = { source_id: input.sourceId, source_sha256: input.sourceSha256, kind: input.kind, features_in_source: 0, outside_window: 0, selected: 0, converted: 0, excluded: {}, lod_used: {}, lod2_fallback_to_lod1: 0, unresolved_refs_in_drawn_lod: 0, skipped_degenerate_polygons: 0, footprint_scan: empty(), collect_pass_top_level_features: 0 };
    // Pass 1: ids + XY bbox + LOD facts only.
    const plans = new Map<string, { lod: LodDigit }>();
    counts.footprint_scan = await scanContextFeatures(input.path, {
      kind: input.kind, mode: 'footprint', project,
      onFeature: (record) => {
        counts.features_in_source++;
        if (record.gml_id === null) { bump(counts.excluded, 'missing_gml_id'); return; }
        if (!record.bbox) { bump(counts.excluded, 'no_polygon_geometry'); return; }
        if (!bboxIntersectsDisc(record.bbox, radiusM)) { counts.outside_window++; return; }
        counts.selected++;
        if (seenIds.has(record.gml_id) || plans.has(record.gml_id)) { bump(counts.excluded, 'duplicate_gml_id'); return; }
        const plan = planFeature(record);
        if (plan.lod === null) { bump(counts.excluded, plan.reason!); return; }
        plans.set(record.gml_id, { lod: plan.lod });
      },
    });
    // Pass 2: only the selected, convertible features are retained, converted on arrival and discarded.
    const collectScan = await scanContextFeatures(input.path, {
      kind: input.kind, mode: 'collect', retain: (id) => plans.has(id),
      onFeature: (record) => {
        const plan = record.gml_id === null ? undefined : plans.get(record.gml_id);
        if (!plan || seenIds.has(record.gml_id!)) return;
        seenIds.add(record.gml_id!);
        selectedIds.push(record.gml_id!);
        const built = convertFeature(record, plan, input, frame, counts);
        if (!built) return;
        const name = contextNodeName(input.kind, built.gml_id);
        const node = document.createNode(name).setExtras({
          gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', geometry_status: 'UNVERIFIED_RAW_CONVERSION',
          gml_id: built.gml_id, feature_type: built.type, source_id: input.sourceId, source_sha256: input.sourceSha256, lod_used: built.lod_used, lod_fallback: built.lod_fallback,
          frame_id: frame.frame_id, station_id: frame.station_id, station_json_sha256: frame.station_json_sha256, attribution_text: input.attributionText,
          height_basis: 'EPSG:6697 orthometric height as published (TP); station z = height - origin.hM; no ground height synthesised',
        });
        const mesh = document.createMesh(name);
        let triangles = 0;
        for (const [material, group] of [...built.groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          const positions = document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(group.positions));
          const normals = document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(group.normals));
          const indices = document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(group.indices));
          mesh.addPrimitive(document.createPrimitive().setAttribute('POSITION', positions).setAttribute('NORMAL', normals).setIndices(indices).setMaterial(materials[material]!));
          triangles += group.indices.length / 3;
          for (let i = 0; i < group.positions.length; i += 3) {
            const p = fromGltf([group.positions[i]!, group.positions[i + 1]!, group.positions[i + 2]!]);
            localBBox = localBBox ? { min: localBBox.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: localBBox.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
          }
        }
        node.setMesh(mesh);
        scene.addChild(node);
        nodeNames.push(name);
        triangleCount += triangles; nodeCount++;
        counts.converted++;
        counts.lod_used[built.lod_used] = (counts.lod_used[built.lod_used] ?? 0) + 1;
        perFeature.push({ gml_id: built.gml_id, node: name, type: built.type, source_id: input.sourceId, lod_used: built.lod_used, lod_fallback: built.lod_fallback, polygons_converted: built.polygons_converted, polygons_degenerate: built.polygons_degenerate, unresolved_refs: built.unresolved_refs, triangles });
      },
    });
    counts.collect_pass_top_level_features = collectScan.top_level_features;
    if (collectScan.top_level_features !== counts.footprint_scan.top_level_features || counts.converted + (counts.excluded.no_convertible_polygons ?? 0) + (counts.excluded.building_lod2_unresolved_refs_and_no_lod1 ?? 0) !== plans.size) throw new Error(`Context passes disagree for ${input.sourceId}: the source changed between passes or a selected feature went missing`);
    perSource.push(counts);
  }
  if (!nodeCount) throw new Error('No context feature was converted; no GLB written');
  scene.setExtras({
    gteki_role: CONTEXT_ROLE, navigation_use: 'NOT_FOR_ROUTING', visual_only: true, verification: 'UNVERIFIED', station_id: frame.station_id, frame_id: frame.frame_id,
    station_json_sha256: frame.station_json_sha256, window: { center_station_xy_m: [0, 0], radius_m: radiusM }, selection_rule: SELECTION_RULE, lod_policy: LOD_POLICY, policy_version: CONTEXT_POLICY_VERSION, attribution_text: attribution,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  const io = new NodeIO();
  await writeFile(outputPath, await io.writeBinary(document));

  // Readback: counts, bbox and the tagging/naming invariants are checked on the bytes just written.
  const reread = await io.readBinary(await readFile(outputPath));
  let actualTriangles = 0;
  let actual: { min: Point3; max: Point3 } | null = null;
  const names = new Set<string>();
  for (const node of reread.getRoot().listNodes()) {
    const extras = node.getExtras(), name = node.getName();
    if (explorerRoleFromName(name) !== null || !/^ctx_(bldg|road)_/.test(name)) throw new Error(`GLB validation: unsafe context node name ${name}`);
    if (names.has(name)) throw new Error(`GLB validation: duplicate node name ${name}`);
    names.add(name);
    if (extras.gteki_role !== CONTEXT_ROLE || extras.navigation_use !== 'NOT_FOR_ROUTING' || extras.visual_only !== true || extras.frame_id !== frame.frame_id || extras.station_json_sha256 !== frame.station_json_sha256 || !extras.source_id || !extras.source_sha256 || !extras.lod_used || !extras.attribution_text) throw new Error(`GLB validation: node ${name} lacks required context tags`);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      actualTriangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      const acc = primitive.getAttribute('POSITION')!;
      for (let i = 0; i < acc.getCount(); i++) {
        const p = fromGltf(acc.getElement(i, [0, 0, 0]) as Point3);
        actual = actual ? { min: actual.min.map((v, k) => Math.min(v, p[k]!)) as Point3, max: actual.max.map((v, k) => Math.max(v, p[k]!)) as Point3 } : { min: [...p], max: [...p] };
      }
    }
  }
  const expected = localBBox as { min: Point3; max: Point3 } | null, got = actual as { min: Point3; max: Point3 } | null;
  const bboxError = expected && got ? Math.max(...expected.min.map((v, i) => Math.abs(v - got.min[i]!)), ...expected.max.map((v, i) => Math.abs(v - got.max[i]!))) : Infinity;
  const validation = { status: 'PASS', node_count: names.size, expected_node_count: nodeCount, triangle_count: actualTriangles, expected_triangle_count: triangleCount, bbox_max_error_m: bboxError, tolerance_m: 0.001, all_node_names_clear_of_explorer_roles: true, all_nodes_tagged_context: true };
  if (names.size !== nodeCount || actualTriangles !== triangleCount || bboxError > 0.001) throw new Error(`GLB readback validation failed: ${JSON.stringify(validation)}`);

  const excluded: Partial<Record<ExclusionReason, number>> = {};
  for (const counts of perSource) for (const [reason, n] of Object.entries(counts.excluded)) excluded[reason as ExclusionReason] = (excluded[reason as ExclusionReason] ?? 0) + n;
  return {
    verification: 'UNVERIFIED' as const, navigation_use: 'NOT_FOR_ROUTING' as const, visual_only: true, geometry_status: 'UNVERIFIED_RAW_CONVERSION' as const,
    station_id: frame.station_id, frame, window: { center_station_xy_m: [0, 0] as [number, number], radius_m: radiusM }, selection_rule: SELECTION_RULE, lod_policy: LOD_POLICY, policy_version: CONTEXT_POLICY_VERSION,
    sources: perSource,
    totals: {
      features_in_sources: perSource.reduce((n, s) => n + s.features_in_source, 0), outside_window: perSource.reduce((n, s) => n + s.outside_window, 0), selected_in_window: perSource.reduce((n, s) => n + s.selected, 0),
      converted: nodeCount, excluded, excluded_total: Object.values(excluded).reduce((n, v) => n + v, 0), triangles: triangleCount,
      lod_used: perSource.reduce<Record<string, number>>((acc, s) => { for (const [k, v] of Object.entries(s.lod_used)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {}),
    },
    bbox_local_ENU: localBBox as { min: Point3; max: Point3 } | null, textures: 'not converted: PLATEAU texture lineage is aerial photography and its licence is unassessed',
    attribution_text: attribution, selected_gml_ids_sha256: createHash('sha256').update([...selectedIds].sort().join('\n')).digest('hex'), per_feature: perFeature, validation,
  };
}

export interface StationContextConfig { station: string; status: 'READY' | 'BLOCKED'; frame_id: string; radius_m: number; sources: string[]; blocked_reason?: string; notes?: string }
export async function loadContextConfig(station: string): Promise<StationContextConfig> {
  if (!STATION_ENU_FRAME_ID_PATTERN.test(station)) throw new Error(`Invalid station id: ${station}`);
  let config: StationContextConfig;
  try { config = await readJson<StationContextConfig>(join(packageRoot, 'sources', 'context', `${station}.json`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No context config for station ${station}`); throw error; }
  if (config.station !== station) throw new Error(`Context config station mismatch for ${station}`);
  return config;
}

const SOURCE_ID = /^plateau-(\d{5})-(bldg|tran)-(\d{8})$/;
/** CLI/store wrapper: validates the frame, resolves the stored sources and writes the GLB, sidecar and receipt. */
export async function contextGlb(station: string, options: { radiusM?: number; sourceIds?: string[]; frameId?: string } = {}) {
  const started = performance.now();
  const config = await loadContextConfig(station);
  if (config.status === 'BLOCKED') throw new Error(`Context for ${station} is blocked: ${config.blocked_reason ?? 'no reason recorded'}`);
  const radiusM = options.radiusM ?? config.radius_m;
  const sourceIds = options.sourceIds?.length ? options.sourceIds : config.sources;
  const frame = await loadFrame(options.frameId ?? config.frame_id);
  if (!isStationEnuFrame(frame) || frame.station_id !== station) throw new Error(`Frame ${options.frameId ?? config.frame_id} is not a station-enu frame for ${station}`);
  // station.json is read-only input. The frame must still describe its origin; a changed hash with the same origin is recorded, not fatal.
  const stationBytes = await readFile(join(repoRoot, frame.station_json_path));
  const stationNow = JSON.parse(stationBytes.toString('utf8')) as { station?: { origin?: { lat?: number; lon?: number; hM?: number | null; crs?: string } } };
  const o = stationNow.station?.origin;
  if (!o || o.lat !== frame.origin.lat || o.lon !== frame.origin.lon || o.hM !== frame.origin.hM || o.crs !== frame.origin.crs) throw new Error(`${frame.station_json_path} origin no longer matches frame ${frame.frame_id}; regenerate it with station-frame`);
  const stationJsonShaNow = createHash('sha256').update(stationBytes).digest('hex');
  const inputs: ContextInput[] = [];
  const manifests: Array<{ record: unknown; source: SourceManifest }> = [];
  for (const id of sourceIds) {
    const match = SOURCE_ID.exec(id);
    if (!match) throw new Error(`${id} is not a PLATEAU bldg/tran mesh source`);
    const stored = await getStoredSource(id);
    if (!stored.source.station_ids.includes(station)) throw new Error(`${id} is not declared for station ${station}`);
    inputs.push({ sourceId: id, sourceSha256: stored.record.sha256, kind: match[2] as ContextKind, path: stored.path, attributionText: stored.source.attribution_text });
    manifests.push({ record: stored.record, source: stored.source });
  }
  const fingerprint = await toolFingerprint();
  const digest = createHash('sha256').update(JSON.stringify({ frame, radiusM, sources: inputs.map((i) => [i.sourceId, i.sourceSha256]), policy: CONTEXT_POLICY_VERSION, fingerprint })).digest('hex').slice(0, 20);
  const runId = `context-${station}-r${radiusM}-${frame.frame_id}-${digest}`;
  const relativeOutput = `out/${runId}.glb`, outputPath = join(getStoreRoot(), relativeOutput);
  const report = await buildContextGlb({ frame, radiusM, inputs, outputPath });
  const outputBytes = await readFile(outputPath), outputSha256 = createHash('sha256').update(outputBytes).digest('hex');
  const { per_feature, ...summaryBody } = report;
  const sidecar = { ...report, run_id: runId, tool_version: TOOL_VERSION, tool_input_sha256: fingerprint, station_json_sha256_now: stationJsonShaNow, station_json_changed_since_frame: stationJsonShaNow !== frame.station_json_sha256,
    source_records: manifests.map((m) => m.record), source_manifests: manifests.map((m) => m.source), store_path: relativeOutput, output_sha256: outputSha256, output_bytes: outputBytes.length };
  await writeJson(outputPath.replace(/\.glb$/, '.provenance.json'), sidecar);
  const summary = {
    run_id: runId, ...summaryBody, per_feature_count: per_feature.length, tool_version: TOOL_VERSION, tool_input_sha256: fingerprint,
    station_json_sha256_now: stationJsonShaNow, station_json_changed_since_frame: stationJsonShaNow !== frame.station_json_sha256,
    store_path: relativeOutput, sidecar_path: relativeOutput.replace(/\.glb$/, '.provenance.json'), output_sha256: outputSha256, output_bytes: outputBytes.length,
    elapsed_ms: Math.round(performance.now() - started), peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
  };
  // Context receipts live beside, not inside, docs/gis/conversions so real-run/summarize never mistake them for ubld conversions.
  await writeJson(join(docsRoot, 'gis', 'context', `${runId}.json`), summary);
  return summary;
}
