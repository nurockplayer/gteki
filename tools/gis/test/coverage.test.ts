import { expect,it } from 'vitest';
import { meshCode,meshBounds,bboxMeshes } from '../src/mesh.js';
import { catalogCoverage,r1BboxContainment,segmentIntersectsBbox } from '../src/coverage.js';
import { compareNetworkRepresentations } from '../src/r1.js';

it('implements JIS X 0410 hierarchy for the Tokyo Tower mesh and the PLATEAU file-name mesh',()=>{
  // Tokyo Tower location, standard regional mesh 53393599. Formula: 40′/1°, 5′/7.5′, 30″/45″.
  // Published mesh reference: Statistics Bureau regional-mesh explanatory material (see method notes).
  expect(meshCode(139.745433,35.658581,1)).toBe('5339');
  expect(meshCode(139.745433,35.658581,2)).toBe('533935');
  expect(meshCode(139.745433,35.658581)).toBe('53393599');
  const b=meshBounds('53394536');
  expect(b[0]).toBeCloseTo(139.7,10);expect(b[1]).toBeCloseTo(35.6916666666667,10);
  expect(b[2]).toBeCloseTo(139.7125,10);expect(b[3]).toBeCloseTo(35.7,10);
  expect(meshCode((b[0]+b[2])/2,(b[1]+b[3])/2)).toBe('53394536');
  expect(bboxMeshes([139.6983,35.6868,139.6996,35.6890])).toEqual(['53394525']);
});
it('includes both sides of a closed bbox touching an exact boundary',()=>{
  const b=meshBounds('53394536');
  expect(bboxMeshes([b[0],b[1]+0.001,b[0],b[1]+0.002])).toEqual(['53394535','53394536']);
  expect(()=>meshCode(35,139)).toThrow();expect(()=>meshBounds('53394836')).toThrow();
});
it('does not equate nominal mesh with actual acquired coverage or extrapolate older vintages',()=>{
  const r=catalogCoverage({cities:[{cityCode:'A',year:2025,files:{ubld:[{code:'53394536',url:'synthetic'}]}}]},{source_id:'synthetic',sha256:'synthetic'},[{layer_id:'e',bbox_jgd2011_lon_lat:[139.6983,35.6868,139.6996,35.6890],metric_status:'KNOWN'}],{'A:53394536':{source_id:'synthetic-gml',source_sha256:'synthetic',bbox:[139.698,35.6907,139.7036,35.695],envelope:null}});
  expect(r.any_catalogued_nominal_mesh_touches_hokonavi_bbox_meshes).toBe(false);
  expect(r.catalogued_ubld_files[0].actual_bbox_within_nominal_mesh).toBe(false);
  expect(r.older_vintages.status).toBe('UNKNOWN');expect(r.hold).toContain('HOLD');
});
it('counts bbox containment and crossing segments conditionally without treating a link bbox as an intersection',()=>{
  const node=(floor:unknown,in_out:unknown,p:number[])=>({properties:{floor,in_out},geometry:{type:'Point',coordinates:p}});
  const link=(code:number,p:number[][])=>({properties:{rt_struct:code},geometry:{type:'LineString',coordinates:p}});
  const r=r1BboxContainment([node(-1,3,[139.5,35.5]),node(0,1,[138,34])],[link(5,[[138,35.5],[141,35.5]]),link(7,[[139.9,36.2],[140.2,35.9]])],[139,35,140,36]);
  expect(r).toMatchObject({nodes_inside:1,metric_status:'CONDITIONAL_ON_INFERRED_CRS',nodes_inside_by_literal_floor_and_in_out:[{floor:'-1',in_out:'3',count:1}]});
  expect(r.links_rt_struct_5_7?.map(v=>v.intersecting_bbox)).toEqual([1,0]);
  expect(segmentIntersectsBbox([139,36],[140,36],[139,35,140,36])).toBe(true);
});
it('compares unique IDs, numeric shared attributes and exact node coordinates while reporting differences',()=>{
  const r=compareNetworkRepresentations([{node_id:'N',lon:'139.7',lat:'35.7',floor:'-1.0',extra:''}],[],[{properties:{node_id:'N',lon:139.7,lat:35.7,floor:-1},geometry:{type:'Point',coordinates:[139.7,35.7]}}],[]);
  expect(r.nodes).toMatchObject({matched_unique_ids:1,equal_shared_attribute_rows:1,equal_coordinates:1,csv_only_fields:['extra']});
  const different=compareNetworkRepresentations([{node_id:'N',floor:0}],[],[{properties:{node_id:'N',floor:-1},geometry:null}],[]);
  expect(different.nodes.differences_by_shared_field.floor).toBe(1);
});

it('ignores inherited acquired-coverage entries',()=>{
  const acquired=Object.create({'A:53394536':{source_id:'inherited',source_sha256:'inherited',bbox:[139.7,35.7,139.71,35.71],envelope:null}});
  const result=catalogCoverage({cities:[{cityCode:'A',files:{ubld:[{code:'53394536',url:'synthetic'}]}}]},{source_id:'synthetic',sha256:'synthetic'},[],acquired);
  expect(result.catalogued_ubld_files[0]).toMatchObject({acquired_source_id:null,acquired_sha256:null,actual_acquired_geometry_bbox_lon_lat:null,actual_bbox_status:'UNKNOWN'});
});

it.each([false,true,[],['53394536'],{},'',null,undefined])('rejects nonliteral catalog and mesh codes %j',value=>{
  const evidence={source_id:'synthetic',sha256:'synthetic'};
  expect(()=>catalogCoverage({cities:[{cityCode:'A',files:{ubld:[{code:value}]}}]},evidence,[],{})).toThrow();
  expect(()=>catalogCoverage({cities:[{cityCode:value,files:{ubld:[{code:'53394536'}]}}]},evidence,[],{})).toThrow();
  expect(()=>meshBounds(value as any)).toThrow('Invalid mesh code');
});

it('does not coerce container route structures or floor labels into containment evidence',()=>{
  const geometry={type:'LineString',coordinates:[[139.1,35.5],[139.9,35.5]]};
  const nodes=[{properties:{floor:[-1],in_out:[3]},geometry:{type:'Point',coordinates:[139.5,35.5]}}];
  const result=r1BboxContainment(nodes,[{properties:{rt_struct:[5]},geometry},{properties:{rt_struct:[7]},geometry}],[139,35,140,36]);
  expect(result.nodes_inside_by_literal_floor_and_in_out).toEqual([{floor:'(unavailable)',in_out:'(unavailable)',count:1}]);
  expect(result.links_rt_struct_5_7?.map(row=>row.total_links)).toEqual([0,0]);
});
