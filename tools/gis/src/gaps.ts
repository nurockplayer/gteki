import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { docsRoot, getStoredSource, readJson, writeJson } from './common.js';
import type { StationOverlapReport } from './overlap.js';
import { loadSources } from './acquire.js';
import { toolFingerprint } from './provenance.js';
import { assertOverlapReportCurrent, assertPoiInspectionCurrent, assertVintageResearchCurrent } from './inspection-evidence.js';

const STATIONS = [
  { id: 'ikebukuro', city: '13116', gml: 'plateau-13116-ubld-53394576', network: 'hokonavi-ikebukuro-walk-node-csv' },
  { id: 'shinjuku', city: '13104', gml: 'plateau-13104-ubld-53394536', network: 'hokonavi-oedo-shinjuku-network-geojson' },
] as const;

async function maybeReport(relative: string): Promise<any | null> {
  try { return await readJson(path.join(docsRoot, 'gis', relative)); } catch { return null; }
}

function valuesForSemantic(inventory: any, keys: string[]): any {
  const table = inventory?.semantic_presence;
  if (!table) return null;
  for (const key of keys) if (table[key] !== undefined) return table[key];
  return null;
}

function summarizePresence(entry: any): any {
  if (entry == null) return null;
  const ids = Array.isArray(entry.gml_ids) ? entry.gml_ids : [];
  return { status: entry.answer ?? entry.status ?? 'UNKNOWN', count: entry.count ?? null, gml_id_count: entry.gml_ids_total ?? entry.observed_count ?? ids.length, sample_gml_ids: ids.slice(0, 3) };
}

function literalFacts(inventory: any): string[] {
  const semantics = inventory?.semantic_presence;
  if (!semantics) return [];
  return Object.entries(semantics).map(([name, datum]: [string, any]) => {
    const status = datum?.answer ?? datum?.status ?? 'UNKNOWN';
    const count = datum?.count !== undefined ? ` Count in file: ${datum.count}.` : '';
    const ids = Array.isArray(datum?.gml_ids) ? datum.gml_ids : [];
    const totalIds=datum?.gml_ids_total??datum?.observed_count??ids.length;
    const samples = ids.length ? ` Example gml:id values: ${ids.slice(0, 3).join(', ')}${totalIds > 3 ? ` (${totalIds} IDs in the full external inventory; this report shows a sample)` : ''}.` : '';
    const evidence = ['floor_labels','connectivity_topology','mathematical_topology','navigable_connectivity'].includes(name) && datum?.evidence ? ` Evidence: ${datum.evidence}` : '';
    return `- ${name}: ${status}.${count}${samples}${evidence}`;
  });
}

function describeNetwork(report: any): string[] {
  if (!report) return ['- Network inspection report is unavailable; row and topology counts remain UNKNOWN.'];
  if (report.counts) {
    return [
      `- The source files contain ${report.counts.nodes} node rows and ${report.counts.links} link rows.`,
      `- Duplicate node IDs: ${report.topology?.duplicate_node_ids?.length ?? 'UNKNOWN'}; duplicate link IDs: ${report.topology?.duplicate_link_ids?.length ?? 'UNKNOWN'}.`,
      `- Dangling link references: ${report.topology?.dangling_links?.length ?? 'UNKNOWN'}; weak components: ${report.topology?.weak_component_count ?? 'UNKNOWN'}.`,
    ];
  }
  const members = report.members ?? [];
  if (members.length) return [
    ...members.map((m: any) => `- ${m.file}: ${m.feature_count} features; CRS ${JSON.stringify(m.crs)}; bbox ${JSON.stringify(m.bbox)}.`),
    ...(report.network_inventory ? [`- Combined source layers: ${report.network_inventory.feature_count} features; literal floor labels ${JSON.stringify(report.network_inventory.floor_labels_present_literally)}.`] : []),
    ...(report.topology ? [`- Combined network source topology: ${report.topology.weak_component_count} weak components, ${report.topology.dangling_links?.length ?? 'UNKNOWN'} dangling references, ${report.topology.geometry_endpoint_mismatches_over_0_5m?.length ?? 'UNKNOWN'} endpoint mismatches above 0.5 m.`] : []),
  ];
  return [`- The source report contains ${report.totals?.features ?? 'UNKNOWN'} features; spatial topology remains unverified.`];
}

export function overlapHolds(report: StationOverlapReport | null): string[] {
  if (!report) return ['Spatial-overlap report is unavailable; HOLD for any geometry/graph pairing.'];
  const plateau = new Set(report.layers.filter(layer => layer.layer_role === 'plateau_ubld').map(layer => layer.layer_id));
  const network = new Set(report.layers.filter(layer => layer.layer_role === 'hokonavi_network' || layer.layer_role === 'hokonavi_csv_pair').map(layer => layer.layer_id));
  const pairs = report.pairs.filter(pair => (plateau.has(pair.layer_a) && network.has(pair.layer_b)) || (plateau.has(pair.layer_b) && network.has(pair.layer_a)));
  if (report.pairs.some(pair => pair.bbox_relation === 'UNKNOWN'))
    return ['At least one source-layer bbox relationship is UNKNOWN because CRS or bbox evidence is incomplete; HOLD for any geometry/graph pairing.'];
  if (plateau.size === 1 && network.size > 0 && pairs.length === network.size && pairs.every(pair => pair.bbox_relation === 'DISJOINT'))
    return ['The only acquired PLATEAU underground file does not spatially cover the acquired Hokonavi indoor network: every compared source-layer bbox is disjoint. HOLD for any geometry/graph pairing. Bbox evidence does not establish feature connectivity.'];
  if (!pairs.length)
    return ['The PLATEAU/network bbox relationship is UNKNOWN because source CRS or bbox evidence is incomplete; HOLD for any geometry/graph pairing.'];
  return ['Any bbox intersection establishes envelope overlap only; HOLD for geometry/graph pairing until feature alignment, floor correspondence and operator evidence are established.'];
}

function describeOverlap(report: StationOverlapReport | null): string[] {
  if (!report) return ['- Spatial-overlap report: UNKNOWN.'];
  const plateau = new Set(report.layers.filter(layer => layer.layer_role === 'plateau_ubld').map(layer => layer.layer_id));
  return [
    `- ${report.interpretation_limit}`,
    ...report.layers.map(layer => `- ${layer.layer_id}: source CRS ${layer.source_crs ?? 'UNKNOWN'}, axis order ${layer.bbox_axis_order}, bbox ${JSON.stringify(layer.source_crs_bbox)}.`),
    ...report.pairs.filter(pair => plateau.has(pair.layer_a) || plateau.has(pair.layer_b)).map(pair => `- ${pair.layer_a} / ${pair.layer_b}: ${pair.bbox_relation}; projected bbox-boundary separation approximation ${pair.minimum_separation_m ?? 'UNKNOWN'} m.`),
    `- Complete computed layer-pair table: ../overlap/${report.station_id}.json. ${report.method}`,
  ];
}

export async function gapPacket(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const fingerprint=await toolFingerprint();
  const rights=await Promise.all(loadSources().map(s=>readJson<any>(path.join(docsRoot,'gis','rights',`${s.source_id}.json`))));
  const poiIds=['toei-stores-shinjuku-csv','toei-stores-shinjuku-nishiguchi-csv','tokyo-shinjuku-facilities-zip','tokyo-shinjuku-facilities-spec-pdf','plateau-13104-related-2025','plateau-13116-related-2025'];
  const pois=await Promise.all(poiIds.map(id=>readJson<any>(path.join(docsRoot,'gis','poi',`${id}.json`))));
  const vintage=await readJson<any>(path.join(docsRoot,'gis','vintages','shinjuku-2023.json'));
  for(const [index,poi] of pois.entries())await assertPoiInspectionCurrent(poi,poiIds[index]!,{fingerprint});
  await assertVintageResearchCurrent(vintage,{fingerprint});
  for(const r of [...rights,...pois,vintage])if(r.tool_input_sha256!==fingerprint)throw new Error('Gap packet input has a stale tool fingerprint');
  const overlaps = new Map<string, StationOverlapReport | null>();
  for (const station of STATIONS) {
    const overlap = await maybeReport(`overlap/${station.id}.json`) as StationOverlapReport | null;
    if (overlap) await assertOverlapReportCurrent(overlap, station.id, { fingerprint });
    overlaps.set(station.id, overlap);
  }
  const inputs = new Map<string, string>();
  for (const report of [...rights, ...pois, vintage, ...overlaps.values()].filter(Boolean)) {
    for (const input of report.input_sources ?? []) {
      if ((await getStoredSource(input.source_id)).record.sha256 !== input.sha256) throw new Error(`Stale gap packet input SHA-256: ${input.source_id}`);
      inputs.set(input.source_id, input.sha256);
    }
    if (report.source_id && report.source_sha256) {
      if ((await getStoredSource(report.source_id)).record.sha256 !== report.source_sha256) throw new Error(`Stale gap packet source SHA-256: ${report.source_id}`);
      inputs.set(report.source_id, report.source_sha256);
    }
  }
  for (const station of STATIONS) for (const id of [station.gml, station.network]) {
    const source = await getStoredSource(id); inputs.set(id, source.record.sha256);
  }
  for (const station of STATIONS) {
    const stationRights=rights.filter(r=>r.station_ids.includes(station.id)).map(r=>({source_id:r.source_id,source_sha256:r.source_sha256,licence:r.licence,resource_licence:r.resource_licence,publish_gate:r.publish_gate}));
    const stationPois=pois.filter(r=>r.station_ids.includes(station.id)).map(r=>({source_id:r.source_id,source_sha256:r.source_sha256,format:r.format,row_count:r.row_count??null,members:r.members?.map((m:any)=>({file:m.file,feature_count:m.feature_count??null,geometry_type_counts:m.geometry_type_counts??null})),verification:'UNVERIFIED',routable:false}));
    const inventory = await maybeReport(`inventory/${station.gml}.inventory.json`);
    const network = await maybeReport(`networks/${station.network}.json`);
    const overlap = overlaps.get(station.id)!;
    const semanticFacts = literalFacts(inventory);
    const relevant = {
      floors: summarizePresence(valuesForSemantic(inventory, ['floors'])),
      floor_labels: summarizePresence(valuesForSemantic(inventory, ['floor_labels'])),
      doors: summarizePresence(valuesForSemantic(inventory, ['doors'])),
      vertical_circulation: Object.fromEntries(['stairs', 'escalators', 'elevators', 'ramps'].map((key) => [key, summarizePresence(valuesForSemantic(inventory, [key]))])),
      paid_boundary: summarizePresence(valuesForSemantic(inventory, ['ticket_gates_paid_area_boundary'])),
      explicit_connectivity: summarizePresence(valuesForSemantic(inventory, ['connectivity_topology'])),
      mathematical_topology: summarizePresence(valuesForSemantic(inventory, ['mathematical_topology'])),
      navigable_connectivity: summarizePresence(valuesForSemantic(inventory, ['navigable_connectivity'])),
    };
    const holds = [];
    holds.push('All exact-resource publication gates remain HOLD; package and site declarations do not clear third-party or individual-law scope.');
    holds.push('POI, facility and source route availability does not establish current access, floor correspondence or navigable connectivity.');
    if (!inventory) holds.push('CityGML inventory is unavailable; hold routing claims pending a file-based inventory.');
    else {
      if (relevant.paid_boundary === null || (relevant.paid_boundary?.answer ?? relevant.paid_boundary?.status) !== 'PRESENT') holds.push('Paid/unpaid boundary is not evidenced as present in the available PLATEAU underground-building file; HOLD for routing across fare boundaries.');
      if (relevant.explicit_connectivity === null || (relevant.explicit_connectivity?.answer ?? relevant.explicit_connectivity?.status) !== 'PRESENT') holds.push('Explicit connectivity is not established by the available CityGML inventory; HOLD for route generation.');
      holds.push('Floor-to-elevation mapping remains UNKNOWN even when literal floor labels are present; do not derive elevation from labels.');
    }
    if (!network) holds.push('Network inspection is unavailable; HOLD for joining any candidate network to geometry.');
    holds.push(...overlapHolds(overlap));
    holds.push(overlap?.mesh_coverage?.hold??'Mesh-catalog coverage UNKNOWN; HOLD for geometry/network pairing.');
    if(network?.attribute_decoding)holds.push('Applicable walking-network specification version remains UNKNOWN; decoded labels and rank checks are literal consistency evidence only.');
    if(station.id==='ikebukuro')holds.push('R1 CRS is INFERRED_FROM_SPEC; all endpoint and overlap metrics relying on it are CONDITIONAL_ON_INFERRED_CRS. Distance evidence cannot identify the datum.');
    const markdown = [
      `# ${station.id[0]!.toUpperCase()}${station.id.slice(1)} evidence-gap packet`,
      '',
      'This packet is generated from the current inventory and network report files. Missing reports and fields are UNKNOWN.',
      '',
      '## What the source files report',
      ...(inventory ? [`- CityGML source: ${station.gml}.`, ...semanticFacts] : ['- CityGML inventory: unavailable; contents UNKNOWN.']),
      ...describeNetwork(network),
      '',
      '## Spatial bbox comparison',
      ...describeOverlap(overlap),
      '',
      '## Literal codes and catalog coverage',
      `- Applicable specification: ${JSON.stringify(network?.attribute_decoding?.applicable_spec_version??{value:null,status:'UNKNOWN'})}.`,
      `- Version compatibility: ${JSON.stringify(network?.attribute_decoding?.spec_version_compatibility??null)}.`,
      `- Rank consistency: ${JSON.stringify(network?.attribute_decoding?.rank_cross_check_2024??null)}.`,
      `- Literal co-occurrences: ${JSON.stringify(network?.attribute_decoding?.literal_cooccurrences??null)}.`,
      `- Mesh coverage: ${JSON.stringify(overlap?.mesh_coverage??null)}.`,
      `- Conditional R1 bbox containment: ${JSON.stringify(overlap?.r1_bbox_containment??null)}.`,
      '',
      '## UNKNOWN and survey questions',
      '- What are the operator-specific floor names and their surveyed elevations? Obtain a source or field survey; labels alone do not establish height.',
      '- Where do paid-area boundaries, ticket gates, and permitted transfers lie in the current station configuration?',
      '- Which doors, stairs, elevators, escalators, and ramps are currently open and accessible to passengers?',
      '- Do source geometries and network links match current conditions, and what survey date and tolerance support that claim?',
      '- Which operators and station areas are in scope? Keep each operator layer separate until an authorized mapping is evidenced.',
      '',
      '## POI, rights and vintage evidence',
      ...stationPois.map(p=>`- ${p.source_id}: ${p.row_count??'see member inventories'} rows/features; UNVERIFIED / routable:false.`),
      '- Exact-resource rights: all HOLD. See ../rights/README.md for acquisition hashes, declaration scopes and clearance requirements.',
      ...(station.id==='shinjuku'?['- 2023 v4/v3 directory and exact member evidence: ../vintages/shinjuku-2023.json. Nominal mesh tests and actual geometry bboxes are separate.','- 新宿 S01/E27 and 新宿西口 E01 remain separate station identities; no location-text geocoding or identity join.']:[]),
      '',
      '## HOLD items',
      ...holds.map((h) => `- ${h}`),
      '- All normalized network and geometry records remain UNVERIFIED; no output from this lane establishes a passenger route.',
      '',
    ].join('\n');
    const document = {
      station_id: station.id,
      tool_input_sha256:fingerprint,
      input_sources:[...inputs].map(([source_id,sha256])=>({source_id,sha256})),
      rights:stationRights,poi_availability:stationPois,
      plateau_2023_vintage:station.id==='shinjuku'?vintage:null,
      source_ids: { citygml: station.gml, network: station.network },
      input_status: { citygml_inventory: inventory ? 'AVAILABLE' : 'UNKNOWN', network_report: network ? 'AVAILABLE' : 'UNKNOWN' },
      semantic_presence: relevant,
      semantic_presence_rows: semanticFacts,
      literal_floor_label_evidence: inventory?.floor_label_observations ?? null,
      attribute_decoding:network?.attribute_decoding??null,
      distance_consistency:network?.distance_consistency??null,
      representation_comparison:network?.geojson_comparison??network?.csv_comparison??null,
      mesh_coverage:overlap?.mesh_coverage??null,
      r1_bbox_containment:overlap?.r1_bbox_containment??null,
      network_summary: network ? (network.counts ?? network.totals ?? null) : null,
      spatial_overlap: overlap ? { report: `overlap/${station.id}.json`, layer_count: overlap.layers.length, pair_count: overlap.pairs.length,
        pair_relations: Object.fromEntries(['INTERSECTS','DISJOINT','UNKNOWN'].map(relation => [relation,overlap.pairs.filter(pair => pair.bbox_relation === relation).length])),
        interpretation_limit: overlap.interpretation_limit } : null,
      holds,
      unknowns: ['vertical datum interpretation', 'floor-to-elevation mapping', 'operator boundaries', 'paid/unpaid status', 'currency with current station configuration', 'survey accuracy and date','applicable walking-network spec version','vintages outside the bounded 2023 v4/v3 inspection','feature correspondence','R1 datum verification','exact resource and third-party-original rights','undeclared GeoJSON CRS'],
    };
    await writeJson(path.join(docsRoot, 'gis', 'gaps', `${station.id}.json`), document);
    await writeFile(path.join(docsRoot, 'gis', 'gaps', `${station.id}.md`), markdown, 'utf8');
    results[station.id] = document;
  }
  return results;
}
