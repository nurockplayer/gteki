import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { archiveGeoJsonMemberReport, archiveGeoJsonNetworkInventory, candidateGraphFromGeoJsonInventory, inspectCsvPair, inspectGeoJsonFeatures, parseCsv } from '../src/network.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFile(path.join(here, 'fixtures', name));

describe('network source inspection', () => {
  it('detects duplicate identifiers, dangling references, self loops, components and unknown nulls', async () => {
    const [nodeBuffer, linkBuffer] = await Promise.all([fixture('network-nodes.csv'), fixture('network-links.csv')]);
    const nodes = parseCsv(nodeBuffer); const links = parseCsv(linkBuffer);
    expect(nodes.encoding).toBe('UTF-8');
    const report = inspectCsvPair(nodes.rows, links.rows, { source_id: 'synthetic', sha256: 'synthetic-hash' });
    expect(report.topology.duplicate_node_ids).toEqual(['A']);
    expect(report.topology.duplicate_link_ids).toEqual([]);
    expect(report.topology.dangling_links).toHaveLength(1);
    expect(report.topology.dangling_links![0].missing_node_ids).toEqual(['MISSING']);
    expect(report.topology.self_loops).toEqual([{ row: 2, node_id: 'A' }]);
    expect(report.topology.weak_component_count).toBe(3);
    expect(report.topology.unreferenced_node_ids).toContain('C');
    expect(report.candidate_graph.nodes.find((n: any) => n.source_native_id === 'D')?.normalized.coordinates).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.candidate_graph.nodes[0].normalized.elevation_m).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.candidate_graph.nodes.every((n: any) => n.verification === 'UNVERIFIED' && n.routable === false)).toBe(true);
    expect(report.candidate_graph.edges.every((e: any) => e.verification === 'UNVERIFIED' && e.routable === false)).toBe(true);
    expect(report.candidate_graph.edges[0].normalized.geometry).toEqual({ value: null, status: 'UNKNOWN' });
  });

  it('preserves literal CSV identifiers and floor labels without trimming into matches', () => {
    const report = inspectCsvPair(
      [
        { node_id: 'A', longitude: '139.7', latitude: '35.6', floor: ' B2 ' },
        { node_id: ' A', longitude: '139.7', latitude: '35.6', floor: ' B2 ' },
      ],
      [{ link_id: 'L', start_node_id: 'A ', end_node_id: ' A' }],
      { source_id: 'synthetic-literals', sha256: 'synthetic-hash' },
    );
    expect(report.candidate_graph.nodes.map((node: any) => node.source_native_id)).toEqual(['A', ' A']);
    expect(report.candidate_graph.nodes[1].normalized.floor_label_source).toBe(' B2 ');
    expect(report.field_statistics.node.node_id.distinct_count).toBe(2);
    expect(report.field_statistics.node.floor.distinct_values).toEqual({ ' B2 ': 2 });
    expect(report.topology.dangling_links).toEqual([{ row: 1, start_id: 'A ', end_id: ' A', missing_node_ids: ['A '] }]);
    expect(report.topology.completeness.graph_complete).toBe(true);
  });

  it('does not treat traffic-signal fields as gate or ticket fields', () => {
    const report = inspectCsvPair(
      [{ node_id: 'n1', longitude: '139.7', latitude: '35.6', floor: 'B1' }],
      [{ link_id: 'l1', start_node_id: 'n1', end_node_id: 'n1', tfc_signal: '1', tfc_s_type: '2' }],
      { source_id: 'synthetic-traffic-fields', sha256: 'synthetic-hash' },
    );
    const edge = report.candidate_graph.edges[0];
    expect(edge.raw_attributes.tfc_signal).toBe('1');
    expect(edge.raw_attributes.tfc_s_type).toBe('2');
    expect(edge.normalized.attributes.gate).toEqual({ value: null, status: 'UNKNOWN' });
    expect(edge.normalized.attributes.ticket).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.unmapped_columns.link).toEqual(expect.arrayContaining(['tfc_signal', 'tfc_s_type']));
  });

  it('parses a GeoJSON network and reports its declared assumption and anomalies', async () => {
    const raw = JSON.parse((await fixture('network.geojson')).toString('utf8'));
    expect(raw.type).toBe('FeatureCollection');
    const report = inspectGeoJsonFeatures(raw.features, { source_id: 'synthetic-network', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    expect(report.crs.status).toBe('ASSUMPTION');
    expect(report.topology.dangling_links).toEqual([{ feature_index: 1, missing_node_id: 'missing' }]);
    expect(report.topology.weak_component_count).toBe(1);
    expect(report.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
    expect(report.topology.geometry_endpoint_coverage).toEqual({ checked_links: 2, skipped_links: 1, total_links: 3, complete: false });
    expect(report.candidate_features.every((f: any) => f.verification === 'UNVERIFIED' && f.routable === false)).toBe(true);
    const completeLinks = raw.features.filter((f: any) => f.properties?.link_id !== 'e2');
    const epsg6668 = inspectGeoJsonFeatures(completeLinks, { source_id: 'synthetic-network', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:6668' } }, 'synthetic.geojson', 'network');
    expect(epsg6668.topology.geometry_endpoint_distance_method).toBe('GEOGRAPHIC_DEGREES_APPROX_METRES');
    expect(epsg6668.topology.geometry_endpoint_mismatches_over_0_5m).toHaveLength(1);
    const unsupported = inspectGeoJsonFeatures(raw.features, { source_id: 'synthetic-network', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:9999' } }, 'synthetic.geojson', 'network');
    expect(unsupported.topology.geometry_endpoint_check_status).toBe('UNKNOWN_UNSUPPORTED_CRS');
    expect(unsupported.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
  });

  it('does not claim complete endpoint checks when link geometry or referenced coordinates are missing', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'a' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'b' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
      { type: 'Feature', properties: { link_id: 'l1', start_node_id: 'a', end_node_id: 'b' }, geometry: null },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-partial', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:6668' } }, 'synthetic.geojson', 'network');
    expect(report.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
    expect(report.topology.geometry_endpoint_check_status).toBe('PARTIAL_ENDPOINT_COVERAGE');
    expect(report.topology.geometry_endpoint_coverage).toEqual({ checked_links: 0, skipped_links: 1, total_links: 1, complete: false });
  });

  it('normalizes supported GeoJSON category aliases while keeping fare fields unknown', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'n1' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'n2' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
      { type: 'Feature', properties: { link_id: 'l1', start_node_id: 'n1', end_node_id: 'n2', rt_struct: '01', vtcl_slope: '02', lev_diff: '03', tfc_signal: '4', tfc_s_type: '5' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-aliases', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:6668' } }, 'synthetic.geojson', 'network');
    const edge = report.candidate_features[2];
    expect(edge.normalized.attributes.route_structure).toEqual({ value: '01', status: 'KNOWN' });
    expect(edge.normalized.attributes.slope_class).toEqual({ value: '02', status: 'KNOWN' });
    expect(edge.normalized.attributes.step_class).toEqual({ value: '03', status: 'KNOWN' });
    expect(edge.normalized.attributes.gate).toEqual({ value: null, status: 'UNKNOWN' });
    expect(edge.normalized.attributes.ticket).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.mapped_fields.route_structure).toBe('rt_struct');
    expect(report.mapped_fields.slope_class).toBe('vtcl_slope');
    expect(report.mapped_fields.step_class).toBe('lev_diff');
    expect(report.headers).toContain('tfc_signal');
    expect(edge.raw_attributes.tfc_signal).toBe('4');
    expect(edge.raw_attributes.tfc_s_type).toBe('5');
  });

  it('keeps endpoint comparison unknown when duplicate node IDs have different coordinates', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'n1' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'n1' }, geometry: { type: 'Point', coordinates: [139.8, 35.6] } },
      { type: 'Feature', properties: { node_id: 'n2' }, geometry: { type: 'Point', coordinates: [139.81, 35.6] } },
      { type: 'Feature', properties: { link_id: 'l1', start_node_id: 'n1', end_node_id: 'n2' }, geometry: { type: 'LineString', coordinates: [[139.8, 35.6], [139.81, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-duplicate-nodes', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:6668' } }, 'synthetic.geojson', 'network');
    expect(report.topology.duplicate_node_ids).toEqual(['n1']);
    expect(report.topology.geometry_endpoint_check_status).toBe('UNKNOWN_INCOMPLETE_IDENTIFIERS');
    expect(report.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
    expect(report.topology.geometry_endpoint_coverage).toEqual({ checked_links: 0, skipped_links: 1, total_links: 1, complete: false });
  });

  it('reports partial endpoint coverage when a referenced node has no geometry coordinates', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'n1' }, geometry: null },
      { type: 'Feature', properties: { node_id: 'n2' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
      { type: 'Feature', properties: { link_id: 'l1', start_node_id: 'n1', end_node_id: 'n2' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-missing-node-geometry', sha256: 'synthetic-hash' }, { type: 'name', properties: { name: 'EPSG:6668' } }, 'synthetic.geojson', 'network');
    expect(report.topology.geometry_endpoint_check_status).toBe('PARTIAL_ENDPOINT_COVERAGE');
    expect(report.topology.geometry_endpoint_mismatches_over_0_5m).toBeNull();
    expect(report.topology.geometry_endpoint_coverage).toEqual({ checked_links: 0, skipped_links: 1, total_links: 1, complete: false });
  });

  it('normalizes blank or structurally invalid GeoJSON IDs, endpoints, and labels as unknown', async () => {
    const raw = JSON.parse((await fixture('network.geojson')).toString('utf8'));
    const features = structuredClone(raw.features);
    features[0].properties.node_id = '  ';
    features[0].properties.floor = '   ';
    features[1].properties.node_id = ['not', 'a', 'scalar id'];
    features[1].properties.floor = ' B2 ';
    features[2].properties.start_node_id = {};
    features[2].properties.end_node_id = '  ';
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-invalid', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    expect(report.candidate_features[0].source_native_id).toBeNull();
    expect(report.candidate_features[0].source_native_id_status).toBe('UNKNOWN');
    expect(report.candidate_features[0].normalized.floor_label).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.candidate_features[1].source_native_id).toBeNull();
    expect(report.candidate_features[1].normalized.floor_label).toEqual({ value: ' B2 ', status: 'KNOWN' });
    expect(report.candidate_features[2].normalized.start_node_id).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.candidate_features[2].normalized.end_node_id).toEqual({ value: null, status: 'UNKNOWN' });
    expect(report.topology.completeness.graph_complete).toBe(false);
    expect(report.topology.weak_component_count).toBeNull();
    expect(report.topology.dangling_links).toBeNull();
  });

  it('retains numeric zero as a supplied GeoJSON identifier and floor value', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 0, floor: 0 }, geometry: { type: 'Point', coordinates: [139.7, 35.68] } },
      { type: 'Feature', properties: { link_id: 0, start_node_id: 0, end_node_id: 0 }, geometry: { type: 'LineString', coordinates: [[139.7, 35.68], [139.7, 35.68]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-zero', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    expect(report.candidate_features[0].source_native_id).toBe('0');
    expect(report.candidate_features[0].normalized.floor_label).toEqual({ value: 0, status: 'KNOWN' });
    expect(report.candidate_features[1].normalized.start_node_id).toEqual({ value: '0', status: 'KNOWN' });
    expect(report.topology.self_loops).toEqual([{ feature_index: 0, node_id: '0' }]);
  });

  it('detects Shift_JIS input after strict UTF-8 decoding fails', () => {
    const ascii = Buffer.from('node_id,floor\nn1,', 'ascii');
    const shiftJisCodepoint = Buffer.from([0x81, 0x40]);
    const ending = Buffer.from('\n', 'ascii');
    const parsed = parseCsv(Buffer.concat([ascii, shiftJisCodepoint, ending]));
    expect(parsed.encoding).toBe('Shift_JIS');
    expect(parsed.rows).toHaveLength(1);
  });

  it('preserves null-geometry node membership in candidate graph export', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'a' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'b' }, geometry: null },
      { type: 'Feature', properties: { link_id: 'L', start_node_id: 'a', end_node_id: 'b' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-null-node-geometry', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    const graph = candidateGraphFromGeoJsonInventory(report);
    expect(graph.nodes.map((node: any) => node.source_native_id)).toEqual(['a', 'b']);
    expect(graph.nodes[1].geometry).toBeNull();
    expect(graph.edges.map((edge: any) => edge.source_native_id)).toEqual(['L']);
    expect(graph.edges[0].normalized.start_node_id.value).toBe('a');
    expect(graph.edges[0].normalized.end_node_id.value).toBe('b');
  });

  it('keeps a generic id on a LineString as a link ID without changing node membership', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'a' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'b' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
      { type: 'Feature', properties: { id: 'L', start_node_id: 'a', end_node_id: 'b' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-generic-link-id', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    const graph = candidateGraphFromGeoJsonInventory(report);
    expect(report.candidate_features[2].candidate_kind).toBe('link');
    expect(report.candidate_features[2].source_native_id).toBe('L');
    expect(graph.nodes.map((node: any) => node.source_native_id)).toEqual(['a', 'b']);
    expect(graph.edges.map((edge: any) => edge.source_native_id)).toEqual(['L']);
  });

  it('exports polygon, unidentified, and conflicting GeoJSON features as unknown and excludes them from topology', () => {
    const features = [
      { type: 'Feature', properties: { id: 'area' }, geometry: { type: 'Polygon', coordinates: [] } },
      { type: 'Feature', properties: {}, geometry: null },
      { type: 'Feature', properties: { node_id: { malformed: true } }, geometry: null },
      { type: 'Feature', properties: { node_id: 'ambiguous', link_id: 'also-link', start_node_id: 'a', end_node_id: 'b' }, geometry: null },
      { type: 'Feature', properties: { node_id: 'known-node' }, geometry: null },
      { type: 'Feature', properties: { link_id: 'known-link', start_node_id: 'known-node', end_node_id: 'known-node' }, geometry: null },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-unknown-features', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    const graph = candidateGraphFromGeoJsonInventory(report);
    expect(graph.nodes.map((feature: any) => feature.source_native_id)).toEqual(['known-node']);
    expect(graph.edges.map((feature: any) => feature.source_native_id)).toEqual(['known-link']);
    expect(graph.other_features).toHaveLength(4);
    expect(graph.other_features.map((feature: any) => feature.candidate_kind)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(graph.other_features.map((feature: any) => feature.source_native_id)).toEqual(['area', null, null, null]);
    expect(report.topology.completeness.classification_complete).toBe(false);
    expect(report.topology.completeness.unknown_feature_count).toBe(4);
    expect(report.topology.completeness.graph_complete).toBe(false);
    expect(report.topology.weak_component_count).toBeNull();
    expect(report.topology.dangling_links).toBeNull();
  });

  it('shares every supported node and link identifier alias across CSV and GeoJSON reports', () => {
    const nodeAliases = ['node_id', 'nodeid', 'nodeID', 'ノードID'];
    const linkAliases = ['link_id', 'linkid', 'linkID', 'リンクID'];
    for (const nodeAlias of nodeAliases) {
      for (const linkAlias of linkAliases) {
        const csv = inspectCsvPair(
          [{ [nodeAlias]: 'N' }, { [nodeAlias]: 'N' }],
          [
            { [linkAlias]: 'L', start_node_id: 'N', end_node_id: 'N' },
            { [linkAlias]: 'L', start_node_id: 'N', end_node_id: 'N' },
          ],
          { source_id: `synthetic-${nodeAlias}-${linkAlias}`, sha256: 'synthetic-hash' },
        );
        expect(csv.topology.duplicate_node_ids).toEqual(['N']);
        expect(csv.topology.duplicate_link_ids).toEqual(['L']);
        expect(csv.candidate_graph.nodes.map((feature: any) => feature.source_native_id)).toEqual(['N', 'N']);
        expect(csv.candidate_graph.edges.map((feature: any) => feature.source_native_id)).toEqual(['L', 'L']);

        const geo = inspectGeoJsonFeatures([
          { type: 'Feature', properties: { [nodeAlias]: 'N' }, geometry: null },
          { type: 'Feature', properties: { [nodeAlias]: 'N' }, geometry: null },
          { type: 'Feature', properties: { [linkAlias]: 'L', start_node_id: 'N', end_node_id: 'N' }, geometry: null },
          { type: 'Feature', properties: { [linkAlias]: 'L', start_node_id: 'N', end_node_id: 'N' }, geometry: null },
        ], { source_id: `synthetic-${nodeAlias}-${linkAlias}`, sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
        expect(geo.topology.duplicate_node_ids).toEqual(['N']);
        expect(geo.topology.duplicate_link_ids).toEqual(['L']);
        expect(geo.candidate_features.map((feature: any) => feature.source_native_id)).toEqual(['N', 'N', 'L', 'L']);
      }
    }
  });

  it('uses linkID consistently for duplicate detection, topology completeness, and normalized export', () => {
    const features = [
      { type: 'Feature', properties: { node_id: 'a' }, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: { node_id: 'b' }, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
      { type: 'Feature', properties: { linkID: 'L', start_node_id: 'a', end_node_id: 'b' }, geometry: { type: 'LineString', coordinates: [[139.7, 35.6], [139.71, 35.6]] } },
      { type: 'Feature', properties: { linkID: 'L', start_node_id: 'b', end_node_id: 'a' }, geometry: { type: 'LineString', coordinates: [[139.71, 35.6], [139.7, 35.6]] } },
    ];
    const report = inspectGeoJsonFeatures(features, { source_id: 'synthetic-camel-link-id', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    expect(report.topology.completeness.link_ids_complete).toBe(true);
    expect(report.topology.duplicate_link_ids).toEqual(['L']);
    expect(report.candidate_features.slice(2).map((link: any) => link.source_native_id)).toEqual(['L', 'L']);
  });

  it('reports categorical distributions for supported literal MLIT headers rt_struct and lev_diff', () => {
    const report = inspectCsvPair(
      [{ node_id: 'n1', longitude: '139.7', latitude: '35.6' }],
      [
        { linkID: 'l1', start_node_id: 'n1', end_node_id: 'n1', rt_struct: '01', lev_diff: '0' },
        { linkID: 'l2', start_node_id: 'n1', end_node_id: 'n1', rt_struct: '02', lev_diff: '1' },
        { linkID: 'l3', start_node_id: 'n1', end_node_id: 'n1', rt_struct: '01', lev_diff: '' },
      ],
      { source_id: 'synthetic-mlit-categories', sha256: 'synthetic-hash' },
    );
    expect(report.field_statistics.link.rt_struct.distinct_values).toEqual({ '01': 2, '02': 1 });
    expect(report.field_statistics.link.lev_diff.distinct_values).toEqual({ '0': 1, '1': 1, '(blank)': 1 });
  });

  it('counts prototype-named source categories as ordinary data values', () => {
    const properties = JSON.parse('{"node_id":"n1","route_type":"constructor"}');
    const secondProperties = JSON.parse('{"node_id":"n2","route_type":"__proto__"}');
    const report = inspectGeoJsonFeatures([
      { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [139.7, 35.6] } },
      { type: 'Feature', properties: secondProperties, geometry: { type: 'Point', coordinates: [139.71, 35.6] } },
    ], { source_id: 'synthetic-prototype-categories', sha256: 'synthetic-hash' }, null, 'synthetic.geojson', 'network');
    const expected = JSON.parse('{"__proto__":1,"constructor":1}');
    expect(report.categorical_values.route_type).toEqual(expected);
    expect(JSON.parse(JSON.stringify(report.categorical_values.route_type))).toEqual(expected);
  });

  it('keeps mapped field provenance in persisted member and combined archive inventories', () => {
    const inspected = inspectGeoJsonFeatures([
      { type: 'Feature', properties: { link_id: 'L', rt_struct: '02', lev_diff: '1' }, geometry: null },
    ], { source_id: 'synthetic-archive-map', sha256: 'synthetic-hash' }, null, 'layer.geojson', 'network');
    const member = archiveGeoJsonMemberReport('layer.geojson', inspected);
    const combined = archiveGeoJsonNetworkInventory(inspected);
    expect(member.mapped_fields.route_structure).toBe('rt_struct');
    expect(member.mapped_fields.step_class).toBe('lev_diff');
    expect(combined.mapped_fields).toEqual(member.mapped_fields);
  });
});
