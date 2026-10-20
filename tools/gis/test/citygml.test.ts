import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { parseCodelistXml, scanCityGml } from '../src/citygml.js';
import { smallestRoom } from '../src/selection.js';

const fixture = fileURLToPath(new URL('./fixtures/tiny-citygml.xml', import.meta.url));

describe('CityGML inventory', () => {
  it('streams semantic features, raw values, polygon metrics, and group targets', async () => {
    const polygons: Array<{ owner_key: string; rings: number[][][] }> = [];
    const inventory = await scanCityGml(fixture, {
      source_id: 'synthetic-citygml',
      source_sha256: 'a'.repeat(64),
      codelists: new Map([['IntBuildingInstallation_function|EF_25', 'synthetic installation']]),
      onPolygon: polygon => polygons.push(polygon),
    });

    expect(inventory.verification).toBe('UNVERIFIED');
    expect(inventory.namespaces.gml).toBe('http://www.opengis.net/gml');
    expect(inventory.srs_names).toEqual(['http://www.opengis.net/def/crs/EPSG/0/6697']);
    expect(inventory.envelope).toEqual({ lower: [35.72, 139.7, 2], upper: [35.73, 139.71, 5], raw_lower: '35.72 139.70 2', raw_upper: '35.73 139.71 5', srsName: 'http://www.opengis.net/def/crs/EPSG/0/6697', axis_order: 'latitude,longitude,height' });
    expect(inventory.crs_inheritance).toMatch(/sole CityModel boundedBy gml:Envelope/);

    const room = inventory.features.find(feature => feature.gml_id === 'room-synthetic');
    expect(room).toMatchObject({
      source_native_id: 'room-synthetic', source_id: 'synthetic-citygml', source_sha256: 'a'.repeat(64),
      verification: 'UNVERIFIED', polygon_count: 2, interior_ring_count: 1, degenerate_polygon_count: 1,
      function_code: 'EF_25', function_label: 'synthetic installation', raw_uro_attributes: { 'uro:lodType': ['synthetic-value'] },
    });
    expect(room?.parent_gml_id).toBeNull();
    expect(inventory.features.map(feature => feature.gml_id)).toEqual(expect.arrayContaining(['floor-synthetic', 'door-synthetic', 'installation-synthetic', 'group-synthetic']));
    expect(inventory.group_memberships).toEqual([
      { relation: 'groupMember', from_gml_id: 'group-synthetic', target: 'room-synthetic', resolves: true },
      { relation: 'parent', from_gml_id: 'group-synthetic', target: 'missing-target', resolves: false },
    ]);
    expect(inventory.semantic_presence.floors.status).toBe('PRESENT');
    expect(inventory.semantic_presence.doors.status).toBe('PRESENT');
    expect(inventory.semantic_presence.elevators.status).toBe('UNKNOWN');
    expect(inventory.semantic_presence.ticket_gates_paid_area_boundary.status).toBe('UNKNOWN');
    expect(inventory.codelist_resolution).toEqual([{ code: 'EF_25', code_space: 'IntBuildingInstallation_function.xml', label: 'synthetic installation', status: 'RESOLVED' }]);
    expect(polygons).toHaveLength(4);
    expect(polygons[0]?.owner_key).toBe('room-synthetic');
    expect(polygons[0]?.rings).toHaveLength(2);
    expect(inventory.totals.degenerate_polygon_count).toBe(1);
  });

  it('leaves a missing codelist label null and rejects a non-6697 axis declaration', async () => {
    const noLabels = await scanCityGml(fixture, { source_id: 'synthetic-citygml', codelists: new Map() });
    expect(noLabels.features.find(feature => feature.gml_id === 'installation-synthetic')?.function_label).toBeNull();
    expect(noLabels.codelist_resolution[0]).toMatchObject({ label: null, status: 'UNRESOLVED' });
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-citygml-'));
    try {
      const invalid = join(directory, 'wrong-crs.xml');
      const xml = await readFile(fixture, 'utf8');
      await writeFile(invalid, xml.replaceAll('EPSG/0/6697', 'EPSG/0/4326'));
      await expect(scanCityGml(invalid)).rejects.toThrow(/expected EPSG:6697/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('resolves literal code names from the synthetic codelist and rejects DTD declarations', async () => {
    const codelistPath = fileURLToPath(new URL('./fixtures/IntBuildingInstallation_function.xml', import.meta.url));
    const xml = await readFile(codelistPath, 'utf8');
    expect(parseCodelistXml('IntBuildingInstallation_function.xml', xml).get('IntBuildingInstallation_function|EF_25')).toBe('synthetic installation');
    expect(() => parseCodelistXml('unsafe.xml', '<!DOCTYPE x [<!ENTITY x "bad">]><x>&x;</x>')).toThrow(/DOCTYPE declarations are forbidden/);
  });

  it('keeps combined stair/ramp categories and physical door grouping ambiguous',async()=>{
    const inventory=await scanCityGml(fixture,{codelists:new Map([['IntBuildingInstallation_function|EF_25','synthetic 階段および傾斜路（スロープ）エレメント']])});
    expect(inventory.semantic_presence.stairs).toMatchObject({status:'UNKNOWN',count:null});
    expect(inventory.semantic_presence.ramps).toMatchObject({status:'UNKNOWN',count:null});
    expect(inventory.semantic_presence.stairs_or_ramps_category).toMatchObject({status:'PRESENT',count:2});
    expect(inventory.semantic_presence.door_representation).toMatchObject({status:'UNKNOWN',count:null,observed_count:1});
  });

  it('rejects duplicate gml:id values anywhere in the XML stream', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-citygml-'));
    try {
      const duplicate = join(directory, 'duplicate-id.xml');
      const xml = (await readFile(fixture, 'utf8')).replace('gml:id="door-synthetic"', 'gml:id="room-synthetic"');
      await writeFile(duplicate, xml);
      await expect(scanCityGml(duplicate)).rejects.toThrow(/Duplicate gml:id room-synthetic/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('isolates anonymous semantic ownership and geometry names from identified parents', async () => {
    const ownershipFixture = fileURLToPath(new URL('./fixtures/ownership-namespace-xlink.xml', import.meta.url));
    const polygons: Array<{ owner_key: string; geometry_use: string; geometry_context: string; definition_id: string | null; orientation: string; rings: number[][][] }> = [];
    const inventory = await scanCityGml(ownershipFixture, {
      source_id: 'synthetic-ownership', source_sha256: 'b'.repeat(64),
      codelists: new Map([['IntBuildingInstallation_function|EF_ELEVATOR_SYNTHETIC', 'elevator']]),
      codelist_inputs: [{ source_id: 'synthetic-codelist', sha256: 'c'.repeat(64), member: 'synthetic.xml', member_sha256: 'd'.repeat(64) }],
      onPolygon: polygon => polygons.push(polygon),
    });
    const room = inventory.features.find(feature => feature.gml_id === 'ownership-room');
    const anonymousInstall = inventory.features.find(feature => feature.local_type === 'IntBuildingInstallation');
    const floor = inventory.features.find(feature => feature.gml_id === 'ownership-floor');
    expect(room).toMatchObject({ gml_id: 'ownership-room', source_native_id: 'ownership-room', names: ['literal room name'], function_code: null, polygon_count: 1, resolved_use_count: 1 });
    expect(room?.bbox_lat_lon_height).not.toBeNull();
    expect(anonymousInstall).toMatchObject({ gml_id: null, source_native_id: null, identity_status: 'UNKNOWN', parent_object_key: 'ownership-room', function_code: 'EF_ELEVATOR_SYNTHETIC', inline_definition_count: 1, names: null });
    expect(anonymousInstall?.raw_uro_attributes).toEqual({ 'uro:srcDescription': ['synthetic nested survey note'] });
    expect(anonymousInstall?.object_key).toMatch(/^anonymous:IntBuildingInstallation:/);
    expect(floor).toMatchObject({ polygon_count: 1, resolved_use_count: 1 });
    expect(inventory.features.some(feature => feature.gml_id === 'evil-room')).toBe(false);
    expect(inventory.codelist_inputs).toEqual([{ source_id: 'synthetic-codelist', sha256: 'c'.repeat(64), member: 'synthetic.xml', member_sha256: 'd'.repeat(64) }]);
    expect(inventory.geometry_reference_summary).toMatchObject({ total: 4, resolved: 2, unresolved: 2, signed_reverse: 1, by_context: { solid: 3, boundary: 1 } });
    expect(inventory.totals).toMatchObject({ polygon_definition_count: 1, geometry_use_count: 3, polygon_count: 3 });
    expect(smallestRoom(inventory)).toMatchObject({ gml_id: 'ownership-room', subtree_polygon_count: 1 });
    expect(inventory.unsupported_geometry_references).toContainEqual(expect.objectContaining({ target: 'missing-polygon', owner_gml_id: 'ownership-room', context: 'solid' }));
    expect(inventory.unsupported_geometry_references).toContainEqual(expect.objectContaining({ target: 'missing-solid', owner_gml_id: 'ownership-room', context: 'solid' }));
    expect(polygons).toHaveLength(3);
    const signedRoomUse = polygons.find(polygon => polygon.owner_key === 'ownership-room');
    expect(signedRoomUse).toMatchObject({ geometry_use: 'reference', geometry_context: 'solid', definition_id: 'shared-polygon', orientation: '-' });
    expect(signedRoomUse?.rings[0]?.[1]).toEqual([35.722, 139.7, 2]);
    expect(polygons.find(polygon => polygon.owner_key === 'ownership-floor')).toMatchObject({ geometry_context: 'boundary', orientation: '+' });
    expect(inventory.semantic_presence.door_representation.status).toBe('UNKNOWN');
  });

  it('composes nested OrientableSurface signs and rejects unsupported signs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-orientation-'));
    try {
      const source = await readFile(fileURLToPath(new URL('./fixtures/ownership-namespace-xlink.xml', import.meta.url)), 'utf8');
      const nested = join(directory, 'nested.xml');
      await writeFile(nested, source
        .replace('<gml:OrientableSurface orientation="-"><gml:baseSurface', '<gml:OrientableSurface orientation="-"><gml:OrientableSurface orientation="-"><gml:baseSurface')
        .replace('<gml:baseSurface xlink:href="#shared-polygon"/></gml:OrientableSurface>', '<gml:baseSurface xlink:href="#shared-polygon"/></gml:OrientableSurface></gml:OrientableSurface>'));
      const nestedUses: Array<{ owner_key: string; geometry_use: string; orientation: string; rings: number[][][] }> = [];
      await scanCityGml(nested, { onPolygon: polygon => nestedUses.push(polygon) });
      expect(nestedUses.find(use => use.owner_key === 'ownership-room')).toMatchObject({ geometry_use: 'reference', orientation: '+' });
      expect(nestedUses.find(use => use.owner_key === 'ownership-room')?.rings[0]?.[1]).toEqual([35.720, 139.702, 2]);

      const invalid = join(directory, 'invalid-sign.xml');
      await writeFile(invalid, source.replace('orientation="-"', 'orientation="--"'));
      await expect(scanCityGml(invalid)).rejects.toThrow(/Unsupported GML OrientableSurface orientation/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects collisions between source gml:id and anonymous processing keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-object-key-'));
    try {
      const source = await readFile(fileURLToPath(new URL('./fixtures/ownership-namespace-xlink.xml', import.meta.url)), 'utf8');
      const collision = join(directory, 'collision.xml');
      await writeFile(collision, source.replace('<core:cityObjectMember>\n    <Room', '<core:cityObjectMember><Room gml:id="anonymous:IntBuildingInstallation:0000001"/></core:cityObjectMember>\n  <core:cityObjectMember>\n    <Room'));
      await expect(scanCityGml(collision)).rejects.toThrow(/Duplicate internal CityGML object key anonymous:IntBuildingInstallation:0000001/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps blank IDs and an immediate anonymous parent unknown instead of borrowing an ancestor ID',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'gteki-gis-anonymous-parent-'));
    try{
      // SYNTHETIC semantic nesting added by hand; no source station data.
      const source=await readFile(fileURLToPath(new URL('./fixtures/ownership-namespace-xlink.xml',import.meta.url)),'utf8');
      const path=join(directory,'anonymous-parent.xml');
      await writeFile(path,source.replace('</Room>','<boundedBy><WallSurface gml:id=" "><opening><Door gml:id="synthetic-child-door"/></opening></WallSurface></boundedBy></Room>'));
      const inventory=await scanCityGml(path),wall=inventory.features.find(f=>f.local_type==='WallSurface')!,door=inventory.features.find(f=>f.gml_id==='synthetic-child-door')!;
      expect(wall).toMatchObject({gml_id:null,source_native_id:null,identity_status:'UNKNOWN',parent_gml_id:'ownership-room'});
      expect(door.parent_gml_id).toBeNull();expect(door.parent_object_key).toBe(wall.object_key);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it('reports floor labels only from literal floor forms or dedicated fields', async () => {
    const labelsFixture = fileURLToPath(new URL('./fixtures/literal-floor-topology.xml', import.meta.url));
    const inventory = await scanCityGml(labelsFixture);
    expect(inventory.semantic_presence.floor_labels).toMatchObject({ status: 'PRESENT', count: 2, gml_ids: ['literal-name-room', 'literal-field-room'] });
    expect(inventory.floor_label_observations).toEqual([
      { object_key: 'literal-name-room', gml_id: 'literal-name-room', field: 'gml:name', value: '架空駅_B1地下通路', source: 'gml:name' },
      { object_key: 'literal-field-room', gml_id: 'literal-field-room', field: 'uro:floorName', value: 'B2', source: 'uro-attribute' },
    ]);
    const genericOnly = await mkdtemp(join(tmpdir(), 'gteki-gis-floor-label-'));
    try {
      const path = join(genericOnly, 'generic-only.xml');
      const xml = (await readFile(labelsFixture, 'utf8'))
        .replace('架空駅_B1地下通路', '駅構内の地下通路')
        .replace('<uro:floorName>B2</uro:floorName>', '<uro:srcDescription>地下通路</uro:srcDescription>');
      await writeFile(path, xml);
      const noExplicitLabel = await scanCityGml(path);
      expect(noExplicitLabel.semantic_presence.floor_labels).toMatchObject({ status: 'UNKNOWN', count: null, observed_count: 0 });
      expect(noExplicitLabel.floor_label_observations).toEqual([]);
    } finally { await rm(genericOnly, { recursive: true, force: true }); }
  });

  it.each([
    ['B2', 'PRESENT'],
    ['地下2階', 'PRESENT'],
    ['階段室', 'UNKNOWN'],
    ['地下通路', 'UNKNOWN'],
  ] as const)('classifies standalone Room name %s from its literal form', async (name, expectedStatus) => {
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-floor-form-'));
    try {
      const path = join(directory, 'standalone-name.xml');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- SYNTHETIC hand-written test input. -->\n<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gml="http://www.opengis.net/gml"><core:cityObjectMember><bldg:Room gml:id="standalone-room"><gml:name>${name}</gml:name></bldg:Room></core:cityObjectMember></core:CityModel>`;
      await writeFile(path, xml);
      const inventory = await scanCityGml(path);
      expect(inventory.semantic_presence.floor_labels.status).toBe(expectedStatus);
      expect(inventory.semantic_presence.floor_labels.count).toBe(expectedStatus === 'PRESENT' ? 1 : null);
      expect(inventory.floor_label_observations.map(observation => observation.value)).toEqual(expectedStatus === 'PRESENT' ? [name] : []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('counts floor-label presence by semantic object while preserving every literal name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gteki-gis-floor-object-count-'));
    try {
      const path = join(directory, 'two-names-one-room.xml');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- SYNTHETIC hand-written test input. -->\n<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gml="http://www.opengis.net/gml"><core:cityObjectMember><bldg:Room gml:id="multi-label-room"><gml:name>B2</gml:name><gml:name>地下2階</gml:name></bldg:Room></core:cityObjectMember></core:CityModel>`;
      await writeFile(path, xml);
      const inventory = await scanCityGml(path);
      expect(inventory.semantic_presence.floor_labels).toMatchObject({ status: 'PRESENT', count: 1, observed_count: 1, gml_ids: ['multi-label-room'] });
      expect(inventory.floor_label_observations.map(observation => observation.value)).toEqual(['B2', '地下2階']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('records GML mathematical topology while keeping navigable connectivity unknown', async () => {
    const labelsFixture = fileURLToPath(new URL('./fixtures/literal-floor-topology.xml', import.meta.url));
    const inventory = await scanCityGml(labelsFixture);
    expect(inventory.mathematical_topology_observations).toEqual([
      { element: 'TopoComplex', gml_id: 'topo-complex-synthetic', parent_topology_gml_id: null, namespace_uri: 'http://www.opengis.net/gml' },
      { element: 'Node', gml_id: 'topo-node-synthetic', parent_topology_gml_id: 'topo-complex-synthetic', namespace_uri: 'http://www.opengis.net/gml' },
    ]);
    expect(inventory.mathematical_topology_observations.some(observation => observation.gml_id === 'not-gml-topology')).toBe(false);
    expect(inventory.semantic_presence.mathematical_topology).toMatchObject({ status: 'PRESENT', count: 2, gml_ids: ['topo-complex-synthetic', 'topo-node-synthetic'] });
    expect(inventory.semantic_presence.connectivity_topology).toMatchObject({ status: 'UNKNOWN', count: null, observed_count: 2 });
    expect(inventory.semantic_presence.navigable_connectivity).toMatchObject({ status: 'UNKNOWN', count: null });
    expect(inventory.semantic_presence.navigable_connectivity.evidence).toMatch(/no route edges are inferred/);
  });

  it('records a namespace-qualified directed topology reference without inferring navigable connectivity',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'gteki-gis-topology-reference-'));
    try{
      const path=join(directory,'topology-reference.xml');
      await writeFile(path,'<!-- SYNTHETIC hand-written topology observation, not station data. --><gml:directedEdge xmlns:gml="http://www.opengis.net/gml" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#synthetic-unresolved-edge"/>');
      const inventory=await scanCityGml(path);
      expect(inventory.mathematical_topology_observations).toEqual([{element:'directedEdge',gml_id:null,parent_topology_gml_id:null,namespace_uri:'http://www.opengis.net/gml'}]);
      expect(inventory.geometry_reference_summary.total).toBe(0);
      expect(inventory.semantic_presence.connectivity_topology.status).toBe('UNKNOWN');
      expect(inventory.semantic_presence.navigable_connectivity.status).toBe('UNKNOWN');
    }finally{await rm(directory,{recursive:true,force:true});}
  });
});
