import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { docsRoot, readJson, writeJson } from './common.js';
import type { StationOverlapReport } from './overlap.js';

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
  if (plateau.size === 1 && network.size > 0 && pairs.length === network.size && pairs.every(pair => pair.bbox_relation === 'DISJOINT'))
    return ['The only acquired PLATEAU underground file does not spatially cover the acquired Hokonavi indoor network: every compared source-layer bbox is disjoint. HOLD for any geometry/graph pairing. Bbox evidence does not establish feature connectivity.'];
  if (!pairs.length || pairs.some(pair => pair.bbox_relation === 'UNKNOWN'))
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
  for (const station of STATIONS) {
    const inventory = await maybeReport(`inventory/${station.gml}.inventory.json`);
    const network = await maybeReport(`networks/${station.network}.json`);
    const overlap = await maybeReport(`overlap/${station.id}.json`) as StationOverlapReport | null;
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
    if (!inventory) holds.push('CityGML inventory is unavailable; hold routing claims pending a file-based inventory.');
    else {
      if (relevant.paid_boundary === null || (relevant.paid_boundary?.answer ?? relevant.paid_boundary?.status) !== 'PRESENT') holds.push('Paid/unpaid boundary is not evidenced as present in the available PLATEAU underground-building file; HOLD for routing across fare boundaries.');
      if (relevant.explicit_connectivity === null || (relevant.explicit_connectivity?.answer ?? relevant.explicit_connectivity?.status) !== 'PRESENT') holds.push('Explicit connectivity is not established by the available CityGML inventory; HOLD for route generation.');
      holds.push('Floor-to-elevation mapping remains UNKNOWN even when literal floor labels are present; do not derive elevation from labels.');
    }
    if (!network) holds.push('Network inspection is unavailable; HOLD for joining any candidate network to geometry.');
    holds.push(...overlapHolds(overlap));
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
      '## UNKNOWN and survey questions',
      '- What are the operator-specific floor names and their surveyed elevations? Obtain a source or field survey; labels alone do not establish height.',
      '- Where do paid-area boundaries, ticket gates, and permitted transfers lie in the current station configuration?',
      '- Which doors, stairs, elevators, escalators, and ramps are currently open and accessible to passengers?',
      '- Do source geometries and network links match current conditions, and what survey date and tolerance support that claim?',
      '- Which operators and station areas are in scope? Keep each operator layer separate until an authorized mapping is evidenced.',
      '',
      '## HOLD items',
      ...holds.map((h) => `- ${h}`),
      '- All normalized network and geometry records remain UNVERIFIED; no output from this lane establishes a passenger route.',
      '',
    ].join('\n');
    const document = {
      station_id: station.id,
      source_ids: { citygml: station.gml, network: station.network },
      input_status: { citygml_inventory: inventory ? 'AVAILABLE' : 'UNKNOWN', network_report: network ? 'AVAILABLE' : 'UNKNOWN' },
      semantic_presence: relevant,
      semantic_presence_rows: semanticFacts,
      literal_floor_label_evidence: inventory?.floor_label_observations ?? null,
      network_summary: network ? (network.counts ?? network.totals ?? null) : null,
      spatial_overlap: overlap ? { report: `overlap/${station.id}.json`, layer_count: overlap.layers.length, pair_count: overlap.pairs.length,
        pair_relations: Object.fromEntries(['INTERSECTS','DISJOINT','UNKNOWN'].map(relation => [relation,overlap.pairs.filter(pair => pair.bbox_relation === relation).length])),
        interpretation_limit: overlap.interpretation_limit } : null,
      holds,
      unknowns: ['vertical datum interpretation', 'floor-to-elevation mapping', 'operator boundaries', 'paid/unpaid status', 'currency with current station configuration', 'survey accuracy and date'],
    };
    await writeJson(path.join(docsRoot, 'gis', 'gaps', `${station.id}.json`), document);
    await writeFile(path.join(docsRoot, 'gis', 'gaps', `${station.id}.md`), markdown, 'utf8');
    results[station.id] = document;
  }
  return results;
}
