import { afterEach,expect,it,vi } from 'vitest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { join,relative } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeIO } from '@gltf-transform/core';
import { triangulate } from '../src/triangulate.js';
import { convertCityGmlFile,citygmlToGlb } from '../src/convert.js';
import { IX_PROJ,project,CRS_6697,type Frame } from '../src/crs.js';
import * as common from '../src/common.js';
import * as crs from '../src/crs.js';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as citygml from '../src/citygml.js';
import { conversionRunId,conversionSemanticInputs } from '../src/convert.js';
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});

it('triangulates a hand-written SYNTHETIC polygon with a hole, preserving area and winding',()=>{
  const result=triangulate([[[0,0,0],[4,0,0],[4,4,0],[0,4,0],[0,0,0]],[[1,1,0],[1,3,0],[3,3,0],[3,1,0],[1,1,0]]])!;
  let area=0;for(let i=0;i<result.indices.length;i+=3){const [a,b,c]=result.indices.slice(i,i+3).map(j=>result.positions[j]);const signed=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;expect(signed).toBeGreaterThan(0);area+=signed;}
  expect(area).toBeCloseTo(12,10);expect(result.indices.length/3).toBe(8);
});
it('skips degenerate and unclosed rings instead of repairing source geometry',()=>{
  expect(triangulate([[[0,0,0],[1,0,0],[2,0,0],[0,0,0]]])).toBeNull();
  expect(triangulate([[[0,0,0],[1,0,0],[0,1,0]]])).toBeNull();
});
it('retains distinct GLBs and sidecars when either frame parameters or its ID changes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-frames-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.7,139.7,0]);
  let frame:Frame={frame_id:'synthetic-frame',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.7,139.7,0],upper:[35.701,139.701,3],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC test frame'};
  const fixturePath=fileURLToPath(new URL('fixtures/tiny-citygml.xml',import.meta.url));
  // Isolate only acquisition/frame lookup and doc destination; exercise real conversion and GLB/sidecar writes.
  vi.spyOn(common,'getStoredSource').mockResolvedValue({path:fixturePath,record:{source_id:sourceId,sha256:sha},source:{attribution_text:'SYNTHETIC fixture'}} as Awaited<ReturnType<typeof common.getStoredSource>>);
  vi.spyOn(common,'getStoreRoot').mockReturnValue(dir);
  vi.spyOn(crs,'loadFrame').mockImplementation(async()=>structuredClone(frame));
  const originalWrite=common.writeJson;
  vi.spyOn(common,'writeJson').mockImplementation(async(path,value)=>originalWrite(path.startsWith(common.docsRoot)?join(dir,'docs',relative(common.docsRoot,path)):path,value));
  const first=await citygmlToGlb(sourceId,frame.frame_id),firstBytes=await readFile(join(dir,first.store_path));
  frame={...frame,origin_E:frame.origin_E+1};
  const second=await citygmlToGlb(sourceId,frame.frame_id);
  frame={...frame,frame_id:'different-synthetic-frame'};
  const third=await citygmlToGlb(sourceId,frame.frame_id);
  expect(new Set([first.store_path,second.store_path,third.store_path]).size).toBe(3);
  expect(await readFile(join(dir,first.store_path))).toEqual(firstBytes);
  const sidecars=await Promise.all([first,second,third].map(async result=>JSON.parse(await readFile(join(dir,result.sidecar_path),'utf8'))));
  expect(sidecars[0].frame.origin_E).toBe(E);expect(sidecars[1].frame.origin_E).toBe(E+1);expect(sidecars[2].frame.frame_id).toBe('different-synthetic-frame');
  for(const sidecar of sidecars)expect(sidecar.validation.status).toBe('PASS');
});
it('writes and re-reads a SYNTHETIC GLB with counts, source bbox and required extras',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-glb-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.7,139.7,0]);
  const frame:Frame={frame_id:'synthetic',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.7,139.7,0],upper:[35.701,139.701,3],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC test origin'};
  const path=fileURLToPath(new URL('fixtures/tiny-citygml.xml',import.meta.url)),outputPath=join(dir,'synthetic.glb');
  const report=await convertCityGmlFile({path,sourceId,sourceSha256:sha,frame,outputPath,attributionText:'SYNTHETIC hand-written fixture'});
  expect(report.validation.status).toBe('PASS');expect(report.totals.triangles).toBe(12);expect(report.totals.nodes).toBe(5);expect(report.totals.skipped_degenerate).toBe(1);expect(report.validation.bbox_max_error_m).toBeLessThan(0.001);
  const document=await new NodeIO().readBinary(await readFile(outputPath));
  for(const node of document.getRoot().listNodes()){expect(node.getExtras().gml_id).toBe(node.getName());expect(node.getExtras().source_sha256).toBe(sha);expect(node.getExtras().verification).toBe('UNVERIFIED');expect(node.getExtras().function_label??null).toBeNull();}
  expect(document.getRoot().listNodes().find(node=>node.getName()==='door-synthetic')?.getMesh()).toBeNull();
});

it('P2-6 retains separate artifacts and dictionary member provenance when semantic inputs change',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-dictionaries-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.7,139.7,0]);
  const frame:Frame={frame_id:'synthetic-frame',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.7,139.7,0],upper:[35.73,139.71,5],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC semantic input regression'};
  const fixturePath=fileURLToPath(new URL('fixtures/tiny-citygml.xml',import.meta.url));
  const dictionaryXml=await readFile(new URL('fixtures/IntBuildingInstallation_function.xml',import.meta.url),'utf8');
  const dictionaries=[dictionaryXml,dictionaryXml.replace('synthetic installation','synthetic revised installation')].map(xml=>{
    const map=citygml.parseCodelistXml('IntBuildingInstallation_function.xml',xml);
    const digest=createHash('sha256').update(xml).digest('hex');
    return Object.assign(map,{inputs:[{source_id:'synthetic-dictionary',sha256:digest,member:'IntBuildingInstallation_function.xml',member_sha256:digest}]});
  });
  let active=dictionaries[0];
  vi.spyOn(citygml,'loadCodelists').mockImplementation(async()=>active as Awaited<ReturnType<typeof citygml.loadCodelists>>);
  vi.spyOn(common,'getStoredSource').mockResolvedValue({path:fixturePath,record:{source_id:sourceId,sha256:sha},source:{attribution_text:'SYNTHETIC fixture'}} as Awaited<ReturnType<typeof common.getStoredSource>>);
  vi.spyOn(common,'getStoreRoot').mockReturnValue(dir);vi.spyOn(crs,'loadFrame').mockResolvedValue(frame);
  const originalWrite=common.writeJson;
  vi.spyOn(common,'writeJson').mockImplementation(async(path,value)=>originalWrite(path.startsWith(common.docsRoot)?join(dir,'docs',relative(common.docsRoot,path)):path,value));
  const first=await citygmlToGlb(sourceId,frame.frame_id),firstBytes=await readFile(join(dir,first.store_path));
  active=dictionaries[1];
  const second=await citygmlToGlb(sourceId,frame.frame_id);
  expect(second.store_path).not.toBe(first.store_path);expect(await readFile(join(dir,first.store_path))).toEqual(firstBytes);
  for(const [index,result] of [first,second].entries()){
    const sidecar=JSON.parse(await readFile(join(dir,result.sidecar_path),'utf8'));
    expect(sidecar.codelist_inputs).toEqual(dictionaries[index].inputs);
    const document=await new NodeIO().readBinary(await readFile(join(dir,result.store_path)));
    expect(document.getRoot().listNodes().find(node=>node.getName()==='installation-synthetic')?.getExtras().function_label).toBe(index===0?'synthetic installation':'synthetic revised installation');
  }
  const semantic=await conversionSemanticInputs(active);
  expect(conversionRunId(sourceId,sha,frame,{},semantic)).not.toBe(conversionRunId(sourceId,sha,frame,{},{...semantic,tool_input_sha256:'b'.repeat(64)}));
});

it('P2-2 preserves boundary winding separately from a reversed Room solid reference through GLB readback',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-signed-uses-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.7,139.7,0]);
  const frame:Frame={frame_id:'synthetic',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.7,139.7,0],upper:[35.701,139.701,1],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC signed-use regression'};
  const path=fileURLToPath(new URL('fixtures/phase2-solid-reference.xml',import.meta.url));
  const inventory=await citygml.scanCityGml(path,{source_id:sourceId,source_sha256:sha});
  const room=inventory.features.find(f=>f.gml_id==='synthetic-room-use')!;
  expect(room.polygon_count).toBe(1);expect(room.bbox_lat_lon_height).not.toBeNull();
  expect(inventory.geometry_reference_summary).toMatchObject({total:1,resolved:1,signed_reverse:1});
  const full=await convertCityGmlFile({path,sourceId,sourceSha256:sha,frame,outputPath:join(dir,'full.glb'),attributionText:'SYNTHETIC',inventory});
  const bounded=await convertCityGmlFile({path,sourceId,sourceSha256:sha,frame,outputPath:join(dir,'room.glb'),attributionText:'SYNTHETIC',inventory,options:{ids:['synthetic-room-use']}});
  expect(full.totals.polygons_converted).toBe(1);expect(full.totals.solid_uses_represented_by_selected_boundaries).toBe(1);
  expect(bounded.totals.polygons_converted).toBe(1);expect(bounded.totals.solid_uses_represented_by_selected_boundaries).toBe(0);
  const io=new NodeIO(),fullGlb=await io.readBinary(await readFile(join(dir,'full.glb'))),roomGlb=await io.readBinary(await readFile(join(dir,'room.glb')));
  const boundaryNormal=fullGlb.getRoot().listNodes().find(n=>n.getName()==='synthetic-boundary')!.getMesh()!.listPrimitives()[0].getAttribute('NORMAL')!.getElement(0,[0,0,0]);
  const roomNormal=roomGlb.getRoot().listNodes()[0].getMesh()!.listPrimitives()[0].getAttribute('NORMAL')!.getElement(0,[0,0,0]);
  expect(boundaryNormal.reduce((sum,value,index)=>sum+value*roomNormal[index],0)).toBeCloseTo(-1,6);
  expect(full.per_object.find(f=>f.gml_id==='synthetic-room-use')!.geometry_uses[0]).toMatchObject({definition_id:'synthetic-polygon',orientation:'-',context:'solid',disposition:'REPRESENTED_BY_SELECTED_BOUNDARY'});
});

it('P2-3 converts equivalent default namespaces and excludes namespace lookalikes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-namespaces-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.7,139.7,0]);
  const frame:Frame={frame_id:'synthetic',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.7,139.7,0],upper:[35.73,139.71,5],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC namespace regression'};
  const fixture=fileURLToPath(new URL('fixtures/tiny-citygml.xml',import.meta.url)),xml=await readFile(fixture,'utf8');
  const defaultPath=join(dir,'default.xml'),spoofPath=join(dir,'spoof.xml');
  await writeFile(defaultPath,xml.replace('xmlns:bldg=','xmlns=').replaceAll('bldg:',''));
  await writeFile(spoofPath,xml.replace('http://www.opengis.net/citygml/building/2.0','https://unrelated.invalid/citygml/building/2.0'));
  const base=await convertCityGmlFile({path:fixture,sourceId,sourceSha256:sha,frame,outputPath:join(dir,'prefixed.glb'),attributionText:'SYNTHETIC'});
  const equivalent=await convertCityGmlFile({path:defaultPath,sourceId,sourceSha256:sha,frame,outputPath:join(dir,'default.glb'),attributionText:'SYNTHETIC'});
  expect(equivalent.totals).toEqual(base.totals);expect(equivalent.bbox_local_ENU).toEqual(base.bbox_local_ENU);
  const document=await new NodeIO().readBinary(await readFile(join(dir,'default.glb')));
  expect(document.getRoot().listNodes().find(n=>n.getName()==='room-synthetic')!.getExtras()).toMatchObject({citygml_type:'Room',citygml_local_type:'Room',citygml_namespace:'http://www.opengis.net/citygml/building/2.0'});
  await expect(convertCityGmlFile({path:spoofPath,sourceId,sourceSha256:sha,frame,outputPath:join(dir,'must-not-exist.glb'),attributionText:'SYNTHETIC'})).rejects.toThrow('No convertible polygons');
});

it('P1-1 exports an unidentified installation with null native identity without relabeling its Room',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gteki-anonymous-glb-'));dirs.push(dir);
  const sourceId='synthetic',sha='a'.repeat(64),[E,N,H]=project([35.72,139.7,2]);
  const frame:Frame={frame_id:'synthetic',source_id:sourceId,source_sha256:sha,verification:'UNVERIFIED',origin_E:E,origin_N:N,origin_H:H,
    source_envelope:{lower:[35.72,139.7,2],upper:[35.73,139.71,5],srsName:CRS_6697},horizontal_crs:'EPSG:6677',projection:IX_PROJ,vertical_datum:'TP',axis_order:'latitude longitude height',purpose:'SYNTHETIC anonymous-ownership regression'};
  const path=fileURLToPath(new URL('fixtures/ownership-namespace-xlink.xml',import.meta.url)),outputPath=join(dir,'anonymous.glb');
  const report=await convertCityGmlFile({path,sourceId,sourceSha256:sha,frame,outputPath,attributionText:'SYNTHETIC',codelists:new Map([['IntBuildingInstallation_function|EF_ELEVATOR_SYNTHETIC','synthetic elevator']])});
  expect(report.validation.status).toBe('PASS');
  const document=await new NodeIO().readBinary(await readFile(outputPath));
  const anonymous=document.getRoot().listNodes().find(n=>n.getExtras().gml_id===null)!;
  expect(anonymous.getExtras()).toMatchObject({gml_id:null,source_native_id:null,identity_status:'UNKNOWN',function_label:'synthetic elevator',parent_gml_id:'ownership-room'});
  expect(anonymous.getName()).not.toBe('ownership-room');
  expect(document.getRoot().listNodes().find(n=>n.getName()==='ownership-room')!.getExtras()).toMatchObject({function_code:null,function_label:null});
});
