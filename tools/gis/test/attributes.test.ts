import { expect,it } from 'vitest';
import { attributeDecoding,codebooks,literalCooccurrences,rankCrossCheck } from '../src/attributes.js';
import { inspectCsvPair,inspectGeoJsonFeatures } from '../src/network.js';

it('checks both versions and keeps the applicable version unknown even with one compatible candidate',()=>{
  const node={node_id:'N',floor:'-1.5',in_out:'3'},link={link_id:'L',start_id:'N',end_id:'N',rank:'ZZZ',width:'1',vtcl_slope:'8',lev_diff:'5',rt_struct:'5'};
  const report=inspectCsvPair([node],[link],{source_id:'synthetic',sha256:'synthetic'});
  const d=report.attribute_decoding;
  expect(d.fields.link.vtcl_slope.versions['2018-03'].undefined_codes).toEqual(['8']);
  expect(d.spec_version_compatibility['2018-03'].compatible).toBe(false);
  expect(d.spec_version_compatibility['2024-07'].compatible).toBe(true);
  expect(d.applicable_spec_version).toMatchObject({value:null,status:'UNKNOWN',candidates:['2024-07']});
  expect(d.fields.link.rt_struct.versions['2024-07'].decoded_label_counts).toEqual({'地下通路':1});
  expect(report.candidate_graph.edges[0]!.raw_attributes).toEqual(link);
  expect(report.candidate_graph.edges[0]!.verification).toBe('UNVERIFIED');expect(report.candidate_graph.routable).toBe(false);
  expect(d.literal_cooccurrences.rt_struct_5_7_by_endpoint_floors).toEqual([{rt_struct:'5',start_floor:'-1.5',end_floor:'-1.5',count:1}]);
});
it('keeps blank codes absent, literal padding undefined, nonnumeric floors unknown and prototype names safe',()=>{
  const d=attributeDecoding([{floor:'B1',in_out:'constructor'}],[{width:'01',roof:'',rt_struct:'__proto__'}]);
  expect(d.fields.link.width.versions['2024-07'].undefined_codes).toEqual(['01']);
  expect(d.fields.link.roof.versions['2024-07'].undefined_codes).toEqual([]);
  expect(d.fields.node.floor.versions['2024-07'].compatible).toBe(false);
  expect(d.fields.link.rt_struct.literal_value_distribution).toEqual(JSON.parse('{"__proto__":1}'));
  expect(d.applicable_spec_version.candidates).toEqual([]);
});
it('reports survey, trace, unknown methods and uncheckable rank without corrections',()=>{
  const result=rankCrossCheck([
    {rank:'CAA',width:1,vtcl_slope:2,lev_diff:2},
    {rank:'ZAA',width:1,vtcl_slope:2,lev_diff:2},
    {rank:'CAA',width:1,vtcl_slope:2,lev_diff:2,r_method:'111'},
    {rank:'CAA',width:1,vtcl_slope:2,lev_diff:2,r_method:'211'},
    {rank:'XXX',width:99,vtcl_slope:99,lev_diff:99},
    {rank:'',width:4,vtcl_slope:1,lev_diff:1},
  ]);
  expect(result).toMatchObject({consistent:1,inconsistent:1,not_checkable:1,method_unknown:3});
});
it('uses the same literal decoding for GeoJSON while preserving numeric raw values',()=>{
  const properties={link_id:'L',vtcl_slope:3,lev_diff:1};
  const r=inspectGeoJsonFeatures([{properties,geometry:null}],{source_id:'synthetic',sha256:'synthetic'},null,'synthetic.geojson','network');
  expect(r.candidate_features[0].raw_attributes).toEqual(properties);
  expect(r.attribute_decoding.fields.link.vtcl_slope.versions['2018-03'].decoded_label_counts).toEqual({'5％より大きい（起点より終点が低い）':1});
  expect(r.attribute_decoding.fields.link.vtcl_slope.versions['2024-07'].decoded_label_counts).toEqual({'5％より大きい～8％以下（起点より終点が高い）':1});
});
it('does not invent the missing 2018 waterway label',()=>{
  const d=attributeDecoding([],[{waterway:2}]);
  expect(d.fields.link.waterway.versions['2018-03']).toMatchObject({compatible:true,decoded_label_counts:{},defined_codes_without_label_count:1});
  expect(codebooks[0]!.link.waterway!.codes['2']).toMatchObject({label:null,transcription_check:'MANUAL'});
});

it('keeps unprinted intermediate weekday labels null while accepting the printed 1–7 range',()=>{
  const d=attributeDecoding([],[{no_serv_d:'1237'},{no_serv_d:'17'},{no_serv_d:'71'}]);
  expect(d.fields.link.no_serv_d.versions['2024-07']).toMatchObject({compatible:false,undefined_codes:['71'],defined_codes_without_label_count:1,decoded_label_counts:{'月曜日 / 日曜日':1}});
});

it.each(['constructor','__proto__','toString'])('treats prototype-name code %s as undefined in decoding and not-checkable in every rank component',code=>{
  const links=[{rank:'SAA',width:code,vtcl_slope:code,lev_diff:code,roof:code}];
  const decoded=attributeDecoding([{in_out:code}],links);
  for(const version of ['2018-03','2024-07']){
    for(const field of ['width','vtcl_slope','lev_diff','roof'])expect(decoded.fields.link[field].versions[version]).toMatchObject({compatible:false,undefined_codes:[code],decoded_label_counts:{}});
    expect(decoded.fields.node.in_out.versions[version]).toMatchObject({compatible:false,undefined_codes:[code],decoded_label_counts:{}});
  }
  expect(rankCrossCheck(links)).toMatchObject({consistent:0,inconsistent:0,not_checkable:1,component_counts:{width:{not_checkable:1},vtcl_slope:{not_checkable:1},lev_diff:{not_checkable:1}}});
});

it('rejects malformed own codebook labels and rank mappings',()=>{
  const book=codebooks[1]!,labels=book.link.width!.codes,mapping=book.rank_cross_check!.method_rules['1']!.code_to_letters.width!;
  const labelDescriptor=Object.getOwnPropertyDescriptor(labels,'4')!,mappingDescriptor=Object.getOwnPropertyDescriptor(mapping,'4')!;
  try{
    Object.defineProperty(labels,'4',{value:{label:true},configurable:true});
    Object.defineProperty(mapping,'4',{value:{includes:()=>true},configurable:true});
    const d=attributeDecoding([],[{width:4,rank:'SAA',vtcl_slope:2,lev_diff:2,r_method:'111'}]);
    expect(d.fields.link.width.versions['2024-07']).toMatchObject({compatible:false,undefined_codes:['4'],decoded_label_counts:{}});
    expect(d.rank_cross_check_2024).toMatchObject({consistent:0,not_checkable:1});
  }finally{
    Object.defineProperty(labels,'4',labelDescriptor);Object.defineProperty(mapping,'4',mappingDescriptor);
  }
});

it('does not inherit labels for method or weekday digits',()=>{
  const fields=[codebooks[1]!.link.r_method!,codebooks[1]!.link.no_serv_d!],originals=fields.map(field=>field.codes);
  try{
    fields.forEach(field=>{field.codes=Object.create(field.codes);});
    const d=attributeDecoding([],[{r_method:'111',no_serv_d:'17'}]);
    for(const field of ['r_method','no_serv_d'])expect(d.fields.link[field].versions['2024-07']).toMatchObject({decoded_label_counts:{},defined_codes_without_label_count:1});
  }finally{fields.forEach((field,i)=>{field.codes=originals[i]!;});}
});

it.each([false,true,[],[1],{},''])('keeps nonnumeric floor %j unknown and container codes undefined',value=>{
  const d=attributeDecoding([{floor:value,in_out:value}],[{width:value,rank:['SAA'],rt_struct:[5]}]);
  expect(d.literal_cooccurrences).toMatchObject({nonzero_floor_nodes:0,unknown_floor_nodes:1,rt_struct_5_7_by_endpoint_floors:[]});
  expect(d.rank_cross_check_2024).toMatchObject({consistent:0,not_checkable:1});
  expect(d.fields.node.in_out.versions['2024-07'].decoded_label_counts).toEqual({});
  expect(d.fields.link.width.versions['2024-07'].decoded_label_counts).toEqual({});
});

it('excludes invalid endpoint identifiers from literal floor joins',()=>{
  const nodes=[{node_id:'undefined',floor:-1},{node_id:'null',floor:-2},{node_id:'',floor:-3},{node_id:[1],floor:-4},{node_id:1,floor:-5}];
  const links=[{}, {start_id:null,end_id:null}, {start_id:'',end_id:' '}, {start_id:[1],end_id:true}].map(row=>({...row,rt_struct:5}));
  expect(literalCooccurrences(nodes,links).rt_struct_5_7_by_endpoint_floors).toEqual([{rt_struct:'5',start_floor:'(unknown)',end_floor:'(unknown)',count:4}]);
});

it.each([
  {field:'width',rank:'CAA',width:1,vtcl_slope:2,lev_diff:2},
  {field:'vtcl_slope',rank:'ABA',width:2,vtcl_slope:2,lev_diff:2},
  {field:'lev_diff',rank:'AAB',width:2,vtcl_slope:2,lev_diff:2},
])('applies independent survey versus trace rules for $field',({field,...attributes})=>{
  const survey=rankCrossCheck([{...attributes,link_id:'native-survey',r_method:'111'}]);
  const trace=rankCrossCheck([{...attributes,link_id:'native-trace',r_method:{width:'211',vtcl_slope:'121',lev_diff:'112'}[field]}]);
  expect(survey).toMatchObject({consistent:0,inconsistent:1,not_checkable:0,method_unknown:0});
  expect(survey.component_counts[field]).toMatchObject({inconsistent:1,inconsistent_link_ids:['native-survey']});
  expect(trace).toMatchObject({consistent:1,inconsistent:0,not_checkable:0,method_unknown:0});
  expect(trace.component_counts[field]).toMatchObject({consistent:1});
});

it.each([
  {r_method:'222',state:'consistent'},
  {r_method:'111',state:'inconsistent'},
  ...[undefined,null,'',' ','000','9?0',false,{}].map(r_method=>({r_method,state:'method_unknown'})),
])('checks the p22 ABB slope/step readings with method $r_method as $state',({r_method,state})=>{
  const row={link_id:'source-2cm',width:2,vtcl_slope:2,lev_diff:2,rank:'ABB',r_method};
  const before=structuredClone(row),result=rankCrossCheck([row]);
  expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[r_method==='222'?'not_checkable':state]:1});
  expect(row).toEqual(before);
  for(const field of ['vtcl_slope','lev_diff'])expect(result.component_counts[field]).toMatchObject({[state]:1});
  expect(result.component_counts.width).toMatchObject({[r_method==='222'?'not_checkable':r_method==='111'?'consistent':'method_unknown']:1});
});

it('reads partial and mixed method digits independently in width, slope, step order',()=>{
  const result=rankCrossCheck([{link_id:'mixed',width:1,vtcl_slope:3,lev_diff:2,rank:'CBB',r_method:'21'}]);
  expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:1,component_counts:{
    width:{consistent:1},vtcl_slope:{consistent:1},lev_diff:{method_unknown:1},
  }});
});

it('keeps unknown-method observations outside the survey/trace union inconsistent',()=>{
  const result=rankCrossCheck([{link_id:'outside-union',width:2,vtcl_slope:2,lev_diff:2,rank:'SZZ'}]);
  expect(result).toMatchObject({inconsistent:1,method_unknown:0});
  for(const field of ['width','vtcl_slope','lev_diff'])expect(result.component_counts[field]).toMatchObject({inconsistent:1,inconsistent_link_ids:['outside-union']});
});

it('does not guess undefined trace width Z or X readings, but retains underlined slope/step Z',()=>{
  const uncheckable=rankCrossCheck([{link_id:'trace-undefined',width:1,vtcl_slope:99,lev_diff:99,rank:'ZXX',r_method:'222'}]);
  expect(uncheckable).toMatchObject({not_checkable:1,not_checkable_link_ids:['trace-undefined']});
  for(const field of ['width','vtcl_slope','lev_diff'])expect(uncheckable.component_counts[field]).toMatchObject({not_checkable:1,not_checkable_link_ids:['trace-undefined']});
  expect(rankCrossCheck([{width:1,vtcl_slope:7,lev_diff:5,rank:'CZZ',r_method:'222'}])).toMatchObject({consistent:1});
  expect(rankCrossCheck([{width:99,vtcl_slope:99,lev_diff:99,rank:'XXX',r_method:'111'}])).toMatchObject({consistent:1});
  expect(rankCrossCheck([{width:99,vtcl_slope:99,lev_diff:99,rank:'XXX'}])).toMatchObject({method_unknown:1});
});

it('includes zero and nested upper thresholds for trace slope and step with supported width C',()=>{
  for(const rank of ['CAA','CBB','CCC'])expect(rankCrossCheck([{width:1,vtcl_slope:1,lev_diff:1,rank,r_method:'222'}])).toMatchObject({consistent:1});
  expect(rankCrossCheck([{width:1,vtcl_slope:3,lev_diff:3,rank:'CCC',r_method:'222'}])).toMatchObject({consistent:1});
  expect(rankCrossCheck([{width:1,vtcl_slope:5,lev_diff:4,rank:'CBB',r_method:'222'}])).toMatchObject({inconsistent:1});
});

it.each([
  {r_method:'222',slope:'not_checkable',step:'not_checkable',state:'not_checkable'},
  {r_method:'221',slope:'not_checkable',step:'consistent',state:'not_checkable'},
  {r_method:'212',slope:'consistent',step:'not_checkable',state:'not_checkable'},
  {r_method:'211',slope:'consistent',step:'consistent',state:'consistent'},
  ...[undefined,null,'','000','2?0'].map(r_method=>({r_method,slope:'method_unknown',step:'method_unknown',state:'method_unknown'})),
])('checks CSS zero readings independently with method $r_method as $state',({r_method,slope,step,state})=>{
  const row={link_id:'zero-readings',width:1,vtcl_slope:1,lev_diff:1,rank:'CSS',r_method};
  const before=structuredClone(row),result=rankCrossCheck([row]);
  expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[state]:1,
    component_counts:{width:{[r_method?.startsWith('2')?'consistent':'method_unknown']:1},vtcl_slope:{[slope]:1},lev_diff:{[step]:1}}});
  for(const [field,componentState] of [['vtcl_slope',slope],['lev_diff',step]]){
    expect(result.component_counts[field!]!.not_checkable_link_ids).toEqual(componentState==='not_checkable'?['zero-readings']:[]);
  }
  expect(result.not_checkable_link_ids).toEqual(state==='not_checkable'?['zero-readings']:[]);
  expect(row).toEqual(before);
});

it('retains survey S for exact-zero slope and step',()=>{
  expect(rankCrossCheck([
    {width:1,vtcl_slope:1,lev_diff:1,rank:'ZSS',r_method:'111'},
    {width:3,vtcl_slope:1,lev_diff:1,rank:'SSS',r_method:'111'},
  ])).toMatchObject({consistent:2,inconsistent:0,not_checkable:0,method_unknown:0,
    component_counts:{width:{consistent:2},vtcl_slope:{consistent:2},lev_diff:{consistent:2}}});
});

it.each([
  {field:'vtcl_slope',rank:'CSA',codes:[1,2,3,4,5,6,7,8,99,0,'unsupported']},
  {field:'lev_diff',rank:'CAS',codes:[1,2,3,4,5,99,0,'unsupported']},
])('keeps the non-underlined trace S not-checkable for every $field code',({field,rank,codes})=>{
  for(const code of codes){
    const result=rankCrossCheck([{link_id:'unsupported-S',width:1,vtcl_slope:1,lev_diff:1,rank,r_method:'222',[field]:code}]);
    expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:1,method_unknown:0,not_checkable_link_ids:['unsupported-S']});
    expect(result.component_counts[field]).toMatchObject({consistent:0,inconsistent:0,not_checkable:1,method_unknown:0,not_checkable_link_ids:['unsupported-S']});
  }
});

it.each([
  {field:'vtcl_slope',rank:'CSA',codes:[1,2,3,4,5,6,7,8,99]},
  {field:'lev_diff',rank:'CAS',codes:[1,2,3,4,5,99]},
])('accepts unknown-method S only from the supported zero survey reading for $field',({field,rank,codes})=>{
  for(const r_method of [undefined,'','000','2?0'])for(const code of codes){
    const result=rankCrossCheck([{width:1,vtcl_slope:1,lev_diff:1,rank,r_method,[field]:code}]);
    const state=code===1?'method_unknown':'inconsistent';
    expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[state]:1});
    expect(result.component_counts[field]).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[state]:1});
  }
});

it.each([1,2,3,4,99,0,'unsupported'])('checks trace width code %s only when code 1 has the supported C reading',width=>{
  for(const letter of ['S','A','C','Z','X']){
    const state=width===1&&letter==='C'?'consistent':'not_checkable';
    const row={link_id:'trace-width',width,rank:`${letter}AA`,r_method:'222',vtcl_slope:1,lev_diff:1};
    const before=structuredClone(row),result=rankCrossCheck([row]);
    expect(result).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[state]:1,
      component_counts:{width:{[state]:1},vtcl_slope:{consistent:1},lev_diff:{consistent:1}}});
    if(state==='not_checkable')expect(result.component_counts.width!.not_checkable_link_ids).toEqual(['trace-width']);
    expect(row).toEqual(before);
  }
});

it.each([
  {width:1,accepted:['Z','C']}, {width:2,accepted:['A']}, {width:3,accepted:['S']},
  {width:4,accepted:['S']}, {width:99,accepted:['X']},
])('uses only supported width readings in the unknown-method union for code $width',({width,accepted})=>{
  for(const letter of ['S','A','C','Z','X']){
    const result=rankCrossCheck([{width,rank:`${letter}SS`,vtcl_slope:1,lev_diff:1}]);
    const state=accepted.includes(letter)?'method_unknown':'inconsistent';
    expect(result.component_counts.width).toMatchObject({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,[state]:1});
    expect(result).toMatchObject({[state]:1});
  }
});

it.each(['inconsistent','not_checkable'] as const)('caps native link IDs at 100 with explicit truncation for %s components',state=>{
  const rows=Array.from({length:102},(_,link_id)=>({link_id,width:2,vtcl_slope:2,lev_diff:2,rank:state==='inconsistent'?'SAA':'AXA',r_method:state==='inconsistent'?'111':'222'}));
  const result=rankCrossCheck(rows),field=state==='inconsistent'?'width':'vtcl_slope';
  for(const target of [result,result.component_counts[field]!]){
    expect(target[state]).toBe(102);
    expect(target[`${state}_link_ids`]).toEqual(Array.from({length:100},(_,id)=>String(id)));
    expect(target[`${state}_link_ids_truncated`]).toBe(2);
    expect(target[`${state}_link_ids_unavailable`]).toBe(0);
  }
});

it('counts unavailable native IDs without inventing IDs and preserves partial component evidence',()=>{
  const result=rankCrossCheck([{width:2,vtcl_slope:2,lev_diff:2,rank:'SXZ',r_method:'122'}]);
  expect(result).toMatchObject({not_checkable:1,not_checkable_link_ids:[],not_checkable_link_ids_unavailable:1,component_counts:{
    width:{inconsistent:1,inconsistent_link_ids:[],inconsistent_link_ids_unavailable:1},
    vtcl_slope:{not_checkable:1,not_checkable_link_ids_unavailable:1},
    lev_diff:{inconsistent:1,inconsistent_link_ids_unavailable:1},
  }});
});
