import { bboxMeshes,meshBounds } from './mesh.js';
import { literalIdentifier,literalText,ownValue } from './values.js';

export function catalogCoverage(catalog:any,catalogEvidence:{source_id:string;sha256:string},layers:Array<{layer_id:string;bbox_jgd2011_lon_lat:number[]|null;metric_status:string;bbox_status?:string}>,acquired:Record<string,{source_id:string;source_sha256:string;bbox:number[]|null;envelope:number[]|null}>) {
  const hokonavi=layers.map(layer=>{
    const bbox=layer.bbox_status==='INCOMPLETE_LIMIT_REACHED'?null:layer.bbox_jgd2011_lon_lat;
    return {layer_id:layer.layer_id,metric_status:bbox?layer.metric_status:'UNKNOWN',bbox,third_meshes_touched:bboxMeshes(bbox)};
  });
  const touched=new Set(hokonavi.flatMap(layer=>layer.third_meshes_touched));
  if(!Array.isArray(catalog.cities))throw new Error('Mesh catalog has no cities');
  const files=catalog.cities.flatMap((city:any)=>(city.files?.ubld??[]).map((file:any)=>{
    const code=literalText(ownValue(file,'code')),cityCode=literalIdentifier(ownValue(city,'cityCode'));
    if(code===null||cityCode===null)throw new Error('Mesh catalog has an unavailable city or mesh code');
    const bounds=meshBounds(code),actual=ownValue(acquired,`${cityCode}:${code}`);
    const bbox=actual?.bbox??null;
    return {city_code:cityCode,catalog_year:city.year??null,url:file.url,nominal_mesh:code,nominal_mesh_bounds_lon_lat:bounds,nominal_mesh_in_hokonavi_bbox_meshes:touched.has(code),acquired_source_id:actual?.source_id??null,acquired_sha256:actual?.source_sha256??null,actual_acquired_geometry_bbox_lon_lat:bbox,declared_envelope_lon_lat:actual?.envelope??null,actual_bbox_status:bbox?'COMPUTED_FROM_ACQUIRED_GEOMETRY':'UNKNOWN',actual_bbox_within_nominal_mesh:bbox?bbox[0]!>=bounds[0]&&bbox[1]!>=bounds[1]&&bbox[2]!<=bounds[2]&&bbox[3]!<=bounds[3]:null,actual_bbox_meshes_touched:bboxMeshes(bbox)};
  }));
  const complete=hokonavi.length>0&&hokonavi.every(layer=>layer.third_meshes_touched.length>0);
  return {catalog:catalogEvidence,query_second_mesh:'533945',hokonavi_layers:hokonavi,catalogued_ubld_files:files,any_catalogued_nominal_mesh_touches_hokonavi_bbox_meshes:complete?files.some((file:any)=>file.nominal_mesh_in_hokonavi_bbox_meshes):null,status:complete?'COMPUTED_NOMINAL_MESH_ONLY':'UNKNOWN',older_vintages:{value:null,status:'UNKNOWN',note:'This endpoint returns latest catalog entries only; earlier vintages were not enumerated.'},hold:complete&&!files.some((file:any)=>file.nominal_mesh_in_hokonavi_bbox_meshes)?'HOLD: no latest catalogued nominal ubld mesh is among the Hokonavi bbox meshes. Nominal mesh is not actual coverage; older vintages UNKNOWN.':'HOLD: nominal mesh membership does not establish actual geometry coverage, feature correspondence or floor alignment.',note:'JIS X 0410 first/second/third mesh calculation; closed bboxes include cells touched at a boundary. File-name mesh is nominal. Actual geometry may extend outside it. No feature correspondence is inferred.'};
}
const validPoint=(p:any)=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const inside=(p:number[],b:number[])=>p[0]!>=b[0]!&&p[0]!<=b[2]!&&p[1]!>=b[1]!&&p[1]!<=b[3]!;
/** Closed rectangle intersection with a supplied segment; no extra network edges. */
export function segmentIntersectsBbox(a:number[],b:number[],box:number[]):boolean {
  if(!validPoint(a)||!validPoint(b))return false;
  let lo=0,hi=1;
  for(const axis of [0,1]){
    const d=b[axis]!-a[axis]!;
    if(d===0){if(a[axis]!<box[axis]!||a[axis]!>box[axis+2]!)return false;continue;}
    let t0=(box[axis]!-a[axis]!)/d,t1=(box[axis+2]!-a[axis]!)/d;
    if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return false;
  }
  return true;
}
export function r1BboxContainment(nodes:any[],links:any[],box:number[]|null) {
  if(!box)return {status:'UNKNOWN',metric_status:'UNKNOWN',note:'PLATEAU geometry bbox unavailable.'};
  const contained=nodes.filter(n=>n.geometry?.type==='Point'&&validPoint(n.geometry.coordinates)&&inside(n.geometry.coordinates,box));
  const literal=(v:unknown)=>literalText(v)??(v==null||typeof v==='string'&&v.trim()===''?'(blank)':'(unavailable)');
  const tuples=contained.map(n=>JSON.stringify({floor:literal(n.properties?.floor),in_out:literal(n.properties?.in_out)}));
  const distribution=Object.fromEntries([...new Set(tuples)].sort().map(t=>[t,tuples.filter(v=>v===t).length]));
  const byStructure=['5','7'].map(code=>{
    const selected=links.filter(l=>literal(l.properties?.rt_struct)===code);let comparable=0,intersects=0;
    for(const link of selected){
      const g=link.geometry,parts:number[][][]=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
      if(!parts.length||parts.some(part=>!Array.isArray(part)||part.length<2||part.some(p=>!validPoint(p))))continue;
      comparable++;if(parts.some(part=>part.some((p,i)=>i>0&&segmentIntersectsBbox(part[i-1]!,p,box))))intersects++;
    }
    return {rt_struct:code,total_links:selected.length,comparable_links:comparable,intersecting_bbox:intersects,skipped_links:selected.length-comparable};
  });
  const validNodes=nodes.filter(n=>n.geometry?.type==='Point'&&validPoint(n.geometry.coordinates)).length;
  return {status:'BBOX_EVIDENCE_ONLY',metric_status:'CONDITIONAL_ON_INFERRED_CRS',bbox_lon_lat:box,nodes_inside:contained.length,total_nodes:nodes.length,comparable_nodes:validNodes,skipped_nodes:nodes.length-validNodes,nodes_inside_by_literal_floor_and_in_out:Object.entries(distribution).map(([tuple,count])=>({...JSON.parse(tuple),count})),links_rt_struct_5_7:byStructure,note:'Conditional on R1 inferred EPSG:6668. Node containment and supplied polyline intersection with the PLATEAU geometry bbox only. No feature correspondence, floor match or route is established.'};
}
