import { expect,it } from 'vitest';
import { compareNetworkRepresentations } from '../src/r1.js';

it.each(['nodes','links'] as const)('excludes missing, null and blank %s identifiers and counts each side',role=>{
  const field=role==='nodes'?'node_id':'link_id';
  const invalid=[{},{[field]:undefined},{[field]:null},{[field]:''},{[field]:'  '}];
  const valid=[{[field]:'undefined'},{[field]:'null'},{[field]:'N'}];
  const csv=[...invalid,...valid],geo=[...invalid,...valid].map(properties=>({properties}));
  const r=role==='nodes'?compareNetworkRepresentations(csv,[],geo,[]):compareNetworkRepresentations([],csv,[],geo);
  expect(r[role]).toMatchObject({matched_unique_ids:3,unavailable_ids:{csv:5,geojson:5},equal_shared_attribute_rows:3,csv_only_ids:0,geojson_only_ids:0,duplicate_csv_ids:[],duplicate_geojson_ids:[]});
});

it.each(['nodes','links'] as const)('excludes container, boolean and non-finite %s identifiers',role=>{
  const field=role==='nodes'?'node_id':'link_id';
  const rows=[false,true,[],[1],{},NaN,Infinity,Number.MAX_SAFE_INTEGER+1].map(id=>({[field]:id}));
  const features=rows.map(properties=>({properties}));
  const r=role==='nodes'?compareNetworkRepresentations(rows,[],features,[]):compareNetworkRepresentations([],rows,[],features);
  expect(r[role]).toMatchObject({matched_unique_ids:0,unavailable_ids:{csv:8,geojson:8},equal_shared_attribute_rows:0});
});

it.each([
  {name:'false',value:false},{name:'true',value:true},{name:'empty array',value:[]},{name:'numeric array',value:[0]},
  {name:'object',value:{}},{name:'empty string',value:''},{name:'whitespace',value:' '},
  {name:'null',value:null},{name:'missing',value:undefined},{name:'hexadecimal',value:'0x0'},
  {name:'NaN',value:NaN},{name:'infinity',value:Infinity},{name:'overflow',value:'1e309'},
])('counts non-comparable numeric attributes and coordinates: $name',({value})=>{
  for(const [left,right] of [[value,value],[value,0],[0,value]]){
    const result=compareNetworkRepresentations([{node_id:'N',lon:left,lat:0,floor:left}],[{link_id:'L',distance:left}],
      [{properties:{node_id:'N',lon:right,lat:0,floor:right},geometry:{type:'Point',coordinates:[right,0]}}],
      [{properties:{link_id:'L',distance:right}}]);
    expect(result.nodes).toMatchObject({matched_unique_ids:1,equal_shared_attribute_rows:0,non_comparable_shared_attribute_rows:1,non_comparable_by_shared_field:{floor:1,lon:1},equal_coordinates:0,different_or_unavailable_coordinates:1});
    expect(result.links).toMatchObject({matched_unique_ids:1,equal_shared_attribute_rows:0,non_comparable_shared_attribute_rows:1,non_comparable_by_shared_field:{distance:1}});
  }
});

it('accepts decimal strings without equating invalid nonnumeric attributes or inherited fields',()=>{
  const csv=[{node_id:'N',lon:'+1.397e2',lat:'35.7',floor:'-1.0'}];
  const geo=[{properties:{node_id:'N',lon:139.7,lat:35.7,floor:-1},geometry:{type:'Point',coordinates:[139.7,35.7]}}];
  expect(compareNetworkRepresentations(csv,[],geo,[]).nodes).toMatchObject({equal_shared_attribute_rows:1,equal_coordinates:1,non_comparable_shared_attribute_rows:0});
  const bad=compareNetworkRepresentations([],[{link_id:'L',rank:['SAA']}],[],[{properties:{link_id:'L',rank:'SAA'}}]);
  expect(bad.links).toMatchObject({equal_shared_attribute_rows:0,non_comparable_shared_attribute_rows:1});
  const inherited=compareNetworkRepresentations([{node_id:'constructor'}],[],[{properties:Object.create({node_id:'constructor'})}],[]);
  expect(inherited.nodes).toMatchObject({matched_unique_ids:0,unavailable_ids:{csv:0,geojson:1}});
});
