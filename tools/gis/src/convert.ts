import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { scanCityGml, loadCodelists, isCitySemantic, type CityInventory, type CityFeature, type CodelistInput } from './citygml.js';
import { docsRoot, getStoredSource, getStoreRoot, writeJson, TOOL_VERSION } from './common.js';
import { loadFrame, toLocal, toGltf, fromGltf, type Frame, type Point3 } from './crs.js';
import { triangulate } from './triangulate.js';
import { assertBboxLocal } from './filters.js';
import { toolFingerprint } from './provenance.js';

type BBox = { min: Point3; max: Point3 };
const grow = (box: BBox | null, p: Point3): BBox => box ? { min:box.min.map((v,i)=>Math.min(v,p[i])) as Point3,max:box.max.map((v,i)=>Math.max(v,p[i])) as Point3 } : {min:[...p],max:[...p]};
export interface ConversionOptions { ids?: string[]; bboxLocal?: [number,number,number,number]; maxPolygons?: number }
export interface SemanticInputs { tool_version:string; tool_input_sha256:string; dictionary_sha256:string; codelist_inputs:CodelistInput[] }
export async function conversionSemanticInputs(codelists:Map<string,string>):Promise<SemanticInputs> {
  const entries=[...codelists].sort(([a],[b])=>a<b?-1:a>b?1:0);
  const inputs=(codelists as Map<string,string>&{inputs?:CodelistInput[]}).inputs??[];
  return {tool_version:TOOL_VERSION,tool_input_sha256:await toolFingerprint(),dictionary_sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    codelist_inputs:[...inputs].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)};
}
export function conversionRunId(sourceId:string,sourceSha256:string,frame:Frame,filters:ConversionOptions,semanticInputs:SemanticInputs):string {
  const digest=createHash('sha256').update(JSON.stringify({frame,ids:filters.ids??null,bboxLocal:filters.bboxLocal??null,maxPolygons:filters.maxPolygons??null,semanticInputs})).digest('hex').slice(0,20);
  return `${sourceId}-${sourceSha256.slice(0,8)}-${frame.frame_id}-${digest}`;
}
interface ObjectGeometry { feature: CityFeature; positions:number[]; normals:number[]; indices:number[]; lods:Set<string>; source_polygons:number; matched_polygons:number; converted_polygons:number; skipped_degenerate:number; skipped_limit:number; skipped_bbox:number; suppressed_solid_uses:number;
  geometry_uses:Array<{definition_id:string|null;use:string;context:string;orientation:string;disposition:string}> }
const colours: Record<string, [number,number,number,number]> = {
  floor:[0.65,0.67,0.68,1], wall:[0.77,0.76,0.73,1], ceiling:[0.86,0.86,0.84,1],
  closure:[0.57,0.6,0.62,1],door:[0.52,0.61,0.65,1],installation:[0.62,0.59,0.53,1],other:[0.7,0.7,0.7,1]
};
function surfaceClass(type:string):string {
  if (/Floor|Ground/i.test(type)) return 'floor'; if(/Wall/i.test(type))return 'wall'; if(/Ceiling|Roof/i.test(type))return 'ceiling';
  if(/Closure/i.test(type))return 'closure'; if(/Door|Window/i.test(type))return 'door'; if(/Installation/i.test(type))return 'installation'; return 'other';
}

export async function convertCityGmlFile(args: {
  path:string; sourceId:string; sourceSha256:string; frame:Frame; outputPath:string; attributionText:string;
  options?:ConversionOptions; inventory?:CityInventory; codelists?:Map<string,string>; semanticInputs?:SemanticInputs;
}) {
  const {path,sourceId,sourceSha256,frame,outputPath}=args, filters=args.options??{};
  if (frame.source_id !== sourceId || frame.source_sha256 !== sourceSha256) throw new Error('Frame provenance does not match source bytes');
  if (filters.maxPolygons !== undefined && (!Number.isSafeInteger(filters.maxPolygons) || filters.maxPolygons<1))throw new Error('max-polygons must be a positive integer');
  if(filters.bboxLocal!==undefined)assertBboxLocal(filters.bboxLocal);
  const semanticInputs=args.semanticInputs??await conversionSemanticInputs(args.codelists??new Map());
  const inventory=args.inventory??await scanCityGml(path,{source_id:sourceId,source_sha256:sourceSha256,codelists:args.codelists,codelist_inputs:semanticInputs.codelist_inputs});
  const featureMap=new Map(inventory.features.filter(isCitySemantic).map(f=>[f.object_key,f]));
  const byNativeId=new Map([...featureMap.values()].filter(f=>f.gml_id!==null).map(f=>[f.gml_id!,f.object_key]));
  for(const id of filters.ids??[]) if(!byNativeId.has(id))throw new Error(`Unknown semantic gml:id ${id}`);
  const selected=(id:string):boolean=> {
    if(!filters.ids?.length)return true;
    const seen=new Set<string>(); let current:string|null=id;
    while(current && !seen.has(current)){const feature=featureMap.get(current);if(feature?.gml_id!==null&&feature?.gml_id!==undefined&&filters.ids.includes(feature.gml_id))return true;seen.add(current);current=feature?.parent_object_key??null;} return false;
  };
  const objects=new Map<string,ObjectGeometry>();
  for(const f of featureMap.values()) if(selected(f.object_key)) objects.set(f.object_key,{feature:f,positions:[],normals:[],indices:[],lods:new Set(),source_polygons:f.polygon_count,matched_polygons:0,converted_polygons:0,skipped_degenerate:0,skipped_limit:0,skipped_bbox:0,suppressed_solid_uses:0,geometry_uses:[]});
  // Boundary/opening objects retain their own winding. A Room solid may reference
  // those same definitions with the opposite orientation; retain that use in the
  // sidecar without drawing a second coincident shell over selected boundaries.
  const selectedBoundaryDefinitions=new Set([...objects.values()].filter(o=>/Surface$|^(Door|Window)$/.test(o.feature.local_type)).flatMap(o=>o.feature.polygon_definition_ids));
  let sourceBBox:BBox|null=null, localBBox:BBox|null=null, matchedPolygons=0,maxPlaneDeviation=0;
  await scanCityGml(path,{source_id:sourceId,source_sha256:sourceSha256,codelists:args.codelists,codelist_inputs:semanticInputs.codelist_inputs,onPolygon:polygon=>{
    const object=objects.get(polygon.owner_key); if(!object)return;
    const use={definition_id:polygon.definition_id,use:polygon.geometry_use,context:polygon.geometry_context,orientation:polygon.orientation,disposition:'CONVERTED'};
    object.geometry_uses.push(use);
    if(polygon.geometry_use==='reference'&&polygon.geometry_context==='solid'&&polygon.definition_id!==null&&selectedBoundaryDefinitions.has(polygon.definition_id)){
      object.suppressed_solid_uses++;use.disposition='REPRESENTED_BY_SELECTED_BOUNDARY';return;
    }
    const localRings=polygon.rings.map(r=>r.map(p=>toLocal(p,frame)));
    let polygonBBox:BBox|null=null; for(const p of localRings.flat())polygonBBox=grow(polygonBBox,p);
    if(filters.bboxLocal && polygonBBox){const [minE,minN,maxE,maxN]=filters.bboxLocal;
      if(polygonBBox.max[0]<minE||polygonBBox.min[0]>maxE||polygonBBox.max[1]<minN||polygonBBox.min[1]>maxN){object.skipped_bbox++;use.disposition='OUTSIDE_BBOX';return;}}
    object.matched_polygons++;
    if(filters.maxPolygons!==undefined&&matchedPolygons>=filters.maxPolygons){object.skipped_limit++;use.disposition='POLYGON_LIMIT';return;} matchedPolygons++;
    const geometry=triangulate(localRings.map(r=>r.map(toGltf)));
    if(!geometry){object.skipped_degenerate++;use.disposition='DEGENERATE_OR_UNCLOSED';return;}
    const offset=object.positions.length/3;
    for(const p of geometry.positions){object.positions.push(...p);object.normals.push(...geometry.normal);localBBox=grow(localBBox,fromGltf(p));}
    for(const i of geometry.indices)object.indices.push(offset+i);
    for(const p of polygon.rings.flat()) sourceBBox=grow(sourceBBox,p as Point3);
    if(polygon.lod)object.lods.add(polygon.lod);
    object.converted_polygons++;maxPlaneDeviation=Math.max(maxPlaneDeviation,geometry.max_plane_deviation_m);
  }});
  const active=[...objects.values()].filter(o=>o.indices.length);
  if(!active.length)throw new Error('No convertible polygons match selection; no GLB written');
  const document=new Document(), buffer=document.createBuffer(), scene=document.createScene('UNVERIFIED raw CityGML conversion');
  const materials=Object.fromEntries(Object.entries(colours).map(([name,colour])=>[name,document.createMaterial(name).setBaseColorFactor(colour).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(false)]));
  const preserveSelectedMetadata=Boolean(filters.ids?.length)||(!filters.bboxLocal&&filters.maxPolygons===undefined);
  const included=new Set((preserveSelectedMetadata?[...objects.values()]:active).map(o=>o.feature.object_key));
  for(const object of active){let current=object.feature.parent_object_key; const seen=new Set<string>();while(current&&objects.has(current)&&!seen.has(current)){included.add(current);seen.add(current);current=objects.get(current)!.feature.parent_object_key;}}
  const nodes=new Map<string,ReturnType<Document['createNode']>>();let triangleCount=0;
  for(const object of objects.values()){
    const f=object.feature;if(!included.has(f.object_key))continue;
    const lod=[...object.lods].sort();const extras={gml_id:f.gml_id,source_native_id:f.source_native_id,identity_status:f.gml_id===null?'UNKNOWN':'PRESENT',object_key:f.object_key,
      citygml_type:f.type,citygml_namespace:f.namespace_uri,citygml_local_type:f.local_type,function_code:f.function_code,function_label:f.function_label??null,parent_gml_id:f.parent_gml_id,parent_object_key:f.parent_object_key,
      source_id:sourceId,source_sha256:sourceSha256,frame_id:frame.frame_id,lod:lod.length===1?lod[0]:lod.length?lod:null,verification:'UNVERIFIED',navigation_use:'NOT_FOR_ROUTING',geometry_status:object.indices.length?'UNVERIFIED_RAW_CONVERSION':'NO_CONVERTED_POLYGONS'};
    const node=document.createNode(f.gml_id??f.object_key).setExtras(extras);nodes.set(f.object_key,node);
    if(!object.indices.length)continue;
    const positions=document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(object.positions));
    const normals=document.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(object.normals));
    const indices=document.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(object.indices));
    const primitive=document.createPrimitive().setAttribute('POSITION',positions).setAttribute('NORMAL',normals).setIndices(indices).setMaterial(materials[surfaceClass(f.type)]);
    node.setMesh(document.createMesh(f.gml_id??f.object_key).addPrimitive(primitive));triangleCount+=object.indices.length/3;
  }
  for(const [id,node] of nodes){const parent=objects.get(id)!.feature.parent_object_key; if(parent&&nodes.has(parent))nodes.get(parent)!.addChild(node);else scene.addChild(node);}
  await mkdir(dirname(outputPath),{recursive:true});const io=new NodeIO();await writeFile(outputPath,await io.writeBinary(document));
  const reread=await io.readBinary(await readFile(outputPath));let actualTriangles=0,actualBBox:BBox|null=null;
  for(const node of reread.getRoot().listNodes()){
    const extras=node.getExtras();
    if(!Object.hasOwn(extras,'gml_id')||(typeof extras.gml_id!=='string'&&!(extras.gml_id===null&&extras.identity_status==='UNKNOWN')))throw new Error('GLB validation: node missing literal gml_id or explicit unknown identity');
    for(const primitive of node.getMesh()?.listPrimitives()??[]){actualTriangles+=(primitive.getIndices()?.getCount()??0)/3;const acc=primitive.getAttribute('POSITION')!;
      for(let i=0;i<acc.getCount();i++){const p=acc.getElement(i,[0,0,0]) as Point3;actualBBox=grow(actualBBox,fromGltf(p));}}
  }
  const expectedBBox=localBBox as BBox|null, readBBox=actualBBox as BBox|null;
  const bboxError=expectedBBox&&readBBox?Math.max(...expectedBBox.min.map((v,i)=>Math.abs(v-readBBox.min[i])),...expectedBBox.max.map((v,i)=>Math.abs(v-readBBox.max[i]))):Infinity;
  const validation={status:'PASS',node_count:reread.getRoot().listNodes().length,expected_node_count:nodes.size,triangle_count:actualTriangles,expected_triangle_count:triangleCount,bbox_max_error_m:bboxError,tolerance_m:0.001,all_nodes_have_gml_id:true};
  if(validation.node_count!==nodes.size||actualTriangles!==triangleCount||bboxError>0.001)throw new Error(`GLB readback validation failed: ${JSON.stringify(validation)}`);
  const perObject=[...objects.values()].map(o=>({object_key:o.feature.object_key,gml_id:o.feature.gml_id,source_native_id:o.feature.source_native_id,identity_status:o.feature.gml_id===null?'UNKNOWN':'PRESENT',source_id:sourceId,source_sha256:sourceSha256,verification:'UNVERIFIED',type:o.feature.type,source_polygons:o.source_polygons,
    matched_polygons:o.matched_polygons,converted_polygons:o.converted_polygons,skipped_degenerate:o.skipped_degenerate,skipped_limit:o.skipped_limit,skipped_bbox:o.skipped_bbox,
    solid_uses_represented_by_selected_boundaries:o.suppressed_solid_uses,geometry_uses:o.geometry_uses,triangles:o.indices.length/3}));
  return {source_id:sourceId,source_sha256:sourceSha256,verification:'UNVERIFIED',source_native_id:null,source_native_id_status:'unknown',frame,filters,semantic_inputs:semanticInputs,
    codelist_inputs:semanticInputs.codelist_inputs,geometry_reference_summary:inventory.geometry_reference_summary,unsupported_geometry_references:inventory.unsupported_geometry_references,
    totals:{objects_in_source:featureMap.size,objects_converted:active.length,nodes:nodes.size,polygons_in_source:inventory.totals.polygon_count,
      polygon_definitions_in_source:inventory.totals.polygon_definition_count,polygons_converted:perObject.reduce((n,o)=>n+o.converted_polygons,0),skipped_degenerate:perObject.reduce((n,o)=>n+o.skipped_degenerate,0),
      solid_uses_represented_by_selected_boundaries:perObject.reduce((n,o)=>n+o.solid_uses_represented_by_selected_boundaries,0),triangles:triangleCount},
    per_object:perObject,bbox_source_lat_lon_height:sourceBBox,bbox_local_ENU:localBBox,max_newell_plane_deviation_m:maxPlaneDeviation,
    triangulation:'Newell plane projection + earcut holes; source use orientation applied; unclosed/degenerate polygons skipped; no geometry repair',
    geometry_policy:'Boundary/opening representations retain their source orientation. Coincident solid reference uses are retained in inventory/sidecar and not drawn again when the referenced definition is already represented by a selected boundary/opening object. Other solid uses are converted with their own orientation.',
    attribution_text:args.attributionText,navigation_use:'NOT_FOR_ROUTING',geometry_status:'UNVERIFIED_RAW_CONVERSION',validation};
}

export async function citygmlToGlb(sourceId:string,frameId:string,filters:ConversionOptions={}){
  if(filters.bboxLocal!==undefined)assertBboxLocal(filters.bboxLocal);
  const started=performance.now(), stored=await getStoredSource(sourceId), frame=await loadFrame(frameId);
  const codelists=await loadCodelists(sourceId),semanticInputs=await conversionSemanticInputs(codelists);
  const runId=conversionRunId(sourceId,stored.record.sha256,frame,filters,semanticInputs);
  const relativeOutput=`out/${runId}.glb`, outputPath=join(getStoreRoot(),relativeOutput);
  const report=await convertCityGmlFile({path:stored.path,sourceId,sourceSha256:stored.record.sha256,frame,outputPath,attributionText:stored.source.attribution_text,options:filters,codelists,semanticInputs});
  const outputBytes=await readFile(outputPath), outputSha256=createHash('sha256').update(outputBytes).digest('hex');
  const sidecar={...report,run_id:runId,source_record:stored.record,source_manifest:stored.source,store_path:relativeOutput,output_sha256:outputSha256,output_bytes:outputBytes.length};
  await writeJson(outputPath.replace(/\.glb$/,'.provenance.json'),sidecar);
  const summary={run_id:runId,source_id:sourceId,source_sha256:stored.record.sha256,verification:'UNVERIFIED',frame_id:frameId,filters,store_path:relativeOutput,sidecar_path:relativeOutput.replace(/\.glb$/,'.provenance.json'),
    totals:report.totals,semantic_inputs:semanticInputs,geometry_reference_summary:report.geometry_reference_summary,geometry_policy:report.geometry_policy,
    bbox_source_lat_lon_height:report.bbox_source_lat_lon_height,bbox_local_ENU:report.bbox_local_ENU,validation:report.validation,output_sha256:outputSha256,output_bytes:outputBytes.length,
    navigation_use:report.navigation_use,geometry_status:report.geometry_status,elapsed_ms:Math.round(performance.now()-started),peak_rss_bytes:process.resourceUsage().maxRSS*1024};
  await writeJson(join(docsRoot,'gis','conversions',`${runId}.json`),summary);
  return summary;
}
