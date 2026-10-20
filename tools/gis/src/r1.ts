import { readFile } from 'node:fs/promises';
import { getStoredSource } from './common.js';
import { distanceConsistency } from './geodesic.js';
import { codebooks,codebookInputs } from './attributes.js';
import { decimalNumber,literalIdentifier,literalText,ownValue } from './values.js';

type Row=Record<string,any>;
const empty=(value:unknown)=>value==null||typeof value==='string'&&value.trim()==='';
const numeric=new Set(['lat','lon','floor','elevation','distance','rt_struct','route_type','direction','width','vtcl_slope','lev_diff','tfc_signal','tfc_s_type','brail_tile','elevator','roof','tfc_restr']);
function equalValue(a:unknown,b:unknown,field:string):boolean|null {
  if(numeric.has(field)){
    const left=decimalNumber(a),right=decimalNumber(b);
    return left===null||right===null?null:left===right;
  }
  if(empty(a)||empty(b))return empty(a)&&empty(b);
  const left=literalText(a),right=literalText(b);
  return left===null||right===null?null:left===right;
}
export function compareNetworkRepresentations(csvNodes:Row[],csvLinks:Row[],geoNodes:any[],geoLinks:any[]) {
  function compare(csv:Row[],features:any[],idField:string){
    const geo=features.map(f=>f.properties??{}),csvHeaders=new Set(csv.flatMap(Object.keys)),geoHeaders=new Set(geo.flatMap((r:Row)=>Object.keys(r)));
    const shared=[...csvHeaders].filter(f=>geoHeaders.has(f)).sort(),byId=new Map<string,Row[]>();
    const identifier=(row:Row)=>literalIdentifier(ownValue(row,idField));
    for(const row of geo){const id=identifier(row);if(id===null)continue;byId.set(id,[...(byId.get(id)??[]),row]);}
    const csvIds=csv.map(identifier).filter((id):id is string=>id!==null),geoIds=geo.map(identifier).filter((id):id is string=>id!==null);
    const duplicates=(ids:string[])=>[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))].sort();
    let matching=0,equal=0,differing=0,nonComparable=0,coordinateEqual=0,coordinateDifferent=0;
    const differences:Record<string,number>=Object.fromEntries(shared.map(f=>[f,0])),unavailable:Record<string,number>=Object.fromEntries(shared.map(f=>[f,0])),samples:Array<unknown>=[];
    const coords=new Map<string,unknown>();
    for(const feature of features){const id=identifier(feature.properties??{});if(id!==null)coords.set(id,feature.geometry?.type==='Point'?feature.geometry.coordinates:null);}
    for(const row of csv){const id=identifier(row);if(id===null)continue;const candidates=byId.get(id);if(candidates?.length!==1||csvIds.filter(v=>v===id).length!==1)continue;
      matching++;const other=candidates[0]!,comparisons=shared.map(field=>({field,equal:equalValue(ownValue(row,field),ownValue(other,field),field)}));
      const changed=comparisons.filter(v=>v.equal===false).map(v=>v.field),notComparable=comparisons.filter(v=>v.equal===null).map(v=>v.field);
      for(const field of changed)differences[field]!++;
      for(const field of notComparable)unavailable[field]!++;
      if(notComparable.length)nonComparable++;else if(changed.length)differing++;else equal++;
      if((changed.length||notComparable.length)&&samples.length<10)samples.push({id,fields:changed,...(notComparable.length?{non_comparable_fields:notComparable}:{})});
      if(idField==='node_id'){
        const p=coords.get(id),lon=decimalNumber(ownValue(row,'lon')),lat=decimalNumber(ownValue(row,'lat'));
        if(Array.isArray(p)&&p.length>=2&&lon!==null&&lat!==null&&lon===decimalNumber(p[0])&&lat===decimalNumber(p[1]))coordinateEqual++;else coordinateDifferent++;
      }
    }
    return {csv_rows:csv.length,geojson_features:geo.length,shared_fields:shared,csv_only_fields:[...csvHeaders].filter(f=>!geoHeaders.has(f)).sort(),geojson_only_fields:[...geoHeaders].filter(f=>!csvHeaders.has(f)).sort(),matched_unique_ids:matching,unavailable_ids:{csv:csv.length-csvIds.length,geojson:geo.length-geoIds.length},csv_only_ids:csvIds.filter(id=>!geoIds.includes(id)).length,geojson_only_ids:geoIds.filter(id=>!csvIds.includes(id)).length,duplicate_csv_ids:duplicates(csvIds),duplicate_geojson_ids:duplicates(geoIds),equal_shared_attribute_rows:equal,different_shared_attribute_rows:differing,non_comparable_shared_attribute_rows:nonComparable,differences_by_shared_field:differences,non_comparable_by_shared_field:unavailable,difference_samples:samples,...(idField==='node_id'?{equal_coordinates:coordinateEqual,different_or_unavailable_coordinates:coordinateDifferent}:{})};
  }
  return {nodes:compare(csvNodes,geoNodes,'node_id'),links:compare(csvLinks,geoLinks,'link_id'),method:'Join unique literal IDs; unavailable IDs are excluded and counted per side. Shared numeric fields accept only finite numbers or decimal numeric strings; invalid values are non-comparable. Other scalar fields use exact text; blank/null both absent. Raw attributes are retained unchanged. Node CSV lon/lat compared exactly with GeoJSON Point coordinates. No CSV link geometry is available for a polyline equality check.'};
}
export async function r1GeoEvidence(){
  await codebookInputs();
  const [node,link]=await Promise.all(['node','link'].map(role=>getStoredSource(`hokonavi-ikebukuro-walk-${role}-geojson`)));
  const [nodes,links]=await Promise.all([node!,link!].map(async source=>JSON.parse(await readFile(source.path,'utf8'))));
  if(nodes.type!=='FeatureCollection'||links.type!=='FeatureCollection'||!Array.isArray(nodes.features)||!Array.isArray(links.features))throw new Error('Expected R1 node/link GeoJSON FeatureCollections');
  if(Object.hasOwn(nodes,'crs')||Object.hasOwn(links,'crs'))throw new Error('R1 now declares a CRS; reassess the bounded inference instead of overriding it');
  const distance=distanceConsistency(links.features);
  const crs={value:'EPSG:6668',status:'INFERRED_FROM_SPEC',evidence:[
    ...codebooks.map(book=>({source_id:book.spec_source_id,sha256:book.spec_sha256,section:'2.2',printed_page:book.version==='2018-03'?5:4,observation:'Specification requires geographic JGD2011; applicability to this historical dataset is unresolved.'})),
    {source_ids:[node!.record.source_id,link!.record.source_id],observation:'crs member presence',node_has_crs:Object.hasOwn(nodes,'crs'),link_has_crs:Object.hasOwn(links,'crs')},
    {source:'RFC 7946 §4',status:'ASSUMPTION_ONLY',observation:'Absent crs member suggests default longitude/latitude WGS84 degrees under RFC 7946, only if conformant. This does not identify JGD2011.'},
    {source_ids:[link!.record.source_id],observation:'GRS80 polyline vs literal distance',result:distance.result,statistics:distance},
  ],note:'Spec-based inference only, not file-declared or geodetically verified. Distance consistency cannot identify a datum. All metrics relying on this CRS are conditional.'};
  const bbox=(features:any[]):number[]|null=>{
    const points:number[][]=[];
    const visit=(v:any):void=>{if(Array.isArray(v)&&v.length>=2&&v.slice(0,2).every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)))points.push(v);else if(Array.isArray(v))v.forEach(visit);};
    features.forEach(f=>visit(f.geometry?.coordinates));
    return points.length?[Math.min(...points.map(p=>p[0]!)),Math.min(...points.map(p=>p[1]!)),Math.max(...points.map(p=>p[0]!)),Math.max(...points.map(p=>p[1]!))]:null;
  };
  return {node:node!,link:link!,nodes,links,distance,crs,node_bbox:bbox(nodes.features),link_bbox:bbox(links.features)};
}
