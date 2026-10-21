import { relatedIdentity } from './related.js';
import { isDeepStrictEqual } from 'node:util';
import { POI_SOURCES, RIGHTS_SOURCES } from './poi.js';
import { verifyEvidence, evaluateRights, evaluateRightsRecords } from './rights.js';
import { projectRights, rightsScopeMarkdown } from './rights-view.js';
import { verifyStoredFile, getStoreRoot } from './common.js';
import { readdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot,readJson,writeJson } from './common.js';
import { toolFingerprint } from './provenance.js';
import { GAP_STATION_IDS, projectPoiContent, rightsRelevant } from './gaps.js';
const root=join(docsRoot,'gis');
function networkSourceHashes(report:any):Array<[string,string]>{
  const pairs:Array<[string,string]>=[];
  for(const [idKey,shaKey] of [['source_id','source_sha256'],['node_source_id','node_sha256'],['link_source_id','link_sha256']])
    if(typeof report[idKey]==='string'&&typeof report[shaKey]==='string'){
      // CSV pairs are reported as "node_id+link_id" with "node_sha+link_sha"; compare member by member.
      const ids=report[idKey].split('+'),shas=report[shaKey].split('+');
      if(ids.length===shas.length)ids.forEach((id:string,i:number)=>pairs.push([id,shas[i]!]));else pairs.push([report[idKey],report[shaKey]]);
    }
  for(const input of report.input_sources??[])if(typeof input.source_id==='string'&&typeof input.sha256==='string')pairs.push([input.source_id,input.sha256]);
  return pairs;
}

async function reports(directory:string):Promise<any[]>{const files=(await readdir(join(root,directory))).filter(f=>f.endsWith('.json')).sort();return Promise.all(files.map(f=>readJson(join(root,directory,f))));}
const acquisitions=await reports('acquisitions'),inventories=(await reports('inventory')).filter(i=>i.totals),allConversions=await reports('conversions'),networks=await reports('networks'),overlaps=await reports('overlap'),crsReports=await reports('crs');
// Only receipts produced by the current tool fingerprint describe this candidate; older ones are history.
const snapshot=await toolFingerprint();
const poi=await reports('poi'),rights=await reports('rights'),gaps=await reports('gaps');
// Refuse to summarize unless the current real run completed cleanly with this exact tool fingerprint and every
// inventory/network report was produced from the currently recorded acquisition bytes.
const runReceipt=await readJson<any>(join(root,'real-run.json'));
const summaryProblems:string[]=[];
// Only the conversion receipts recorded by this real run describe it; anything else on disk is out-of-band.
const conversionCommands=(Array.isArray(runReceipt.commands)?runReceipt.commands:[]).filter((c:any)=>/ citygml-to-glb /.test(c.command));
const runConversionIds=new Set<string>(conversionCommands.map((c:any)=>c.conversion_run_id).filter((id:unknown):id is string=>typeof id==='string'));
if(conversionCommands.some((c:any)=>typeof c.conversion_run_id!=='string'))summaryProblems.push('real-run.json has a conversion command without a recorded conversion_run_id');
const conversions=allConversions.filter(row=>runConversionIds.has(row.run_id)&&row.semantic_inputs?.tool_input_sha256===snapshot);
for(const id of runConversionIds)if(!conversions.some(row=>row.run_id===id))summaryProblems.push(`conversion receipt ${id} recorded by real-run.json is missing or has another fingerprint`);
if(conversions.length!==allConversions.length)console.error(`Ignoring ${allConversions.length-conversions.length} conversion receipt(s) not produced by the current real run`);
if(!runReceipt.completed_at)summaryProblems.push('real-run.json has no completed_at');
if(!Array.isArray(runReceipt.commands)||runReceipt.commands.length===0||runReceipt.commands.some((c:any)=>c.exit_code!==0))summaryProblems.push('real-run.json records a failed or missing command');
if(runReceipt.tool_input_sha256!==snapshot)summaryProblems.push(`real-run.json fingerprint ${runReceipt.tool_input_sha256} differs from current ${snapshot}`);
const acquiredSha=new Map(acquisitions.map((a:any)=>[a.source_id,a.sha256]));
for(const inventory of inventories)if(acquiredSha.get(inventory.source_id)!==inventory.source_sha256)summaryProblems.push(`inventory ${inventory.source_id} does not match the recorded acquisition`);
for(const network of networks)if(network.tool_input_sha256!==snapshot)summaryProblems.push(`network report ${network.source_id} has a stale tool fingerprint`);
for(const network of networks)for(const [sourceId,sha] of networkSourceHashes(network))if(acquiredSha.get(sourceId)!==sha)summaryProblems.push(`network report ${network.source_id} input ${sourceId} does not match the recorded acquisition`);
for(const overlap of overlaps){if(overlap.tool_input_sha256!==snapshot)summaryProblems.push(`overlap ${overlap.station_id} has a stale tool fingerprint`);for(const [id,sha] of networkSourceHashes(overlap))if(acquiredSha.get(id)!==sha)summaryProblems.push(`overlap ${overlap.station_id} has stale source ${id}`);}
if(runReceipt.invalidated)summaryProblems.push(`real-run.json was invalidated by an out-of-band command: ${runReceipt.invalidated.by_command}`);
for(const conversion of conversions)if(acquiredSha.get(conversion.source_id)!==conversion.source_sha256)summaryProblems.push(`conversion ${conversion.run_id} does not match the recorded acquisition`);
for(const report of crsReports)if(acquiredSha.get(report.frame?.source_id)!==report.frame?.source_sha256)summaryProblems.push(`CRS report ${report.frame?.frame_id} does not match the recorded acquisition`);
for(const [expected,rows,label] of [[POI_SOURCES,poi,'POI'],[RIGHTS_SOURCES,rights,'rights']] as const){
  if(rows.length!==expected.length || expected.some(id=>!rows.some(row=>row.source_id===id)))summaryProblems.push(`${label} report set is incomplete or unexpected`);
  for(const row of rows){
    if(row.tool_input_sha256!==snapshot)summaryProblems.push(`${label} ${row.source_id} has stale tool fingerprint`);
    if(acquiredSha.get(row.source_id)!==row.source_sha256)summaryProblems.push(`${label} ${row.source_id} has stale source hash`);
    for(const input of row.input_sources??[])if(acquiredSha.get(input.source_id)!==input.sha256)summaryProblems.push(`${label} ${row.source_id} has stale input ${input.source_id}`);
  }
}
for(const row of poi)try{await verifyStoredFile(join(getStoreRoot(),row.detail.store_path),row.detail.sha256,row.detail.bytes);}catch(error){summaryProblems.push(`POI detail ${row.source_id}: ${String(error)}`);}
for(const report of rights)if(report.identity_checks?.length){
  try{
    const actual=await relatedIdentity(report.source_id);
    if(!isDeepStrictEqual(actual,report.identity_checks))summaryProblems.push(`Stale identity checks: ${report.source_id}`);
    for(const identity of actual){const row=report.records.find((r:any)=>r.layer===identity.member);if(!row||!isDeepStrictEqual(row.origin,identity.origin))summaryProblems.push(`Origin/identity mismatch: ${report.source_id}/${identity.member}`);}
  }catch(error){summaryProblems.push(`Identity verification failed: ${String(error)}`);}
}
for(const report of rights){
  const evaluated=evaluateRightsRecords(report.records);
  if(evaluated.some((row:any,i:number)=>row.verdict!==report.records[i].verdict))summaryProblems.push(`Mixed-scope source clearance: ${report.source_id}`);
}
for(const report of rights)for(const row of report.records){
  if(evaluateRights(row).verdict!==row.verdict)summaryProblems.push(`Rights verdict changed: ${report.source_id}/${row.layer}`);
  for(const item of row.evidence)try{await verifyEvidence(item);}catch(error){summaryProblems.push(String(error));}
}
const gapStations=gaps.map(gap=>gap.station_id);
for(const id of GAP_STATION_IDS)if(gapStations.filter(station=>station===id).length!==1)summaryProblems.push(`Gap packet for ${id} is missing or duplicated`);
for(const id of gapStations)if(!GAP_STATION_IDS.includes(id))summaryProblems.push(`Unexpected gap packet: ${String(id)}`);
for(const gap of gaps){
  if(gap.tool_input_sha256!==snapshot)summaryProblems.push(`Gap ${gap.station_id} has stale fingerprint`);
  // Match gap-packet's manifest order, independent of the filesystem's sorted report names.
  const expectedPoi=POI_SOURCES.map(id=>poi.find(report=>report.source_id===id)).filter(Boolean).map(report=>projectPoiContent(report,gap.station_id)).filter(Boolean);
  const admittedPoiIds=new Set<string>(expectedPoi.map((report:any)=>report.source_id));
  const expectedRights=RIGHTS_SOURCES.flatMap(id=>{
    const report=rights.find(report=>report.source_id===id);
    return report&&rightsRelevant(report,gap.station_id,admittedPoiIds)?report.records.map((row:any)=>projectRights(report,row)):[];
  });
  if(!isDeepStrictEqual(gap.resource_rights,expectedRights))summaryProblems.push(`Gap ${gap.station_id} drops or changes rights scope/exclusions`);
  if(!isDeepStrictEqual(gap.poi_content,expectedPoi))summaryProblems.push(`Gap ${gap.station_id} drops or changes POI content`);
  for(const row of gap.resource_rights??[])if(acquiredSha.get(row.source_id)!==row.source_sha256)summaryProblems.push(`Gap ${gap.station_id} has stale rights input ${row.source_id}`);
  for(const row of gap.poi_content??[])if(acquiredSha.get(row.source_id)!==row.source_sha256)summaryProblems.push(`Gap ${gap.station_id} has stale POI input ${row.source_id}`);
}
const runCommands=new Set((runReceipt.commands??[]).map((c:any)=>c.command));
for(const id of POI_SOURCES)if(!runCommands.has(`pnpm --dir tools/gis gis inspect-poi ${id}`))summaryProblems.push(`Missing current-run POI inspection: ${id}`);
for(const command of ['rights-report','gap-packet'])if(!runCommands.has(`pnpm --dir tools/gis gis ${command}`))summaryProblems.push(`Missing current-run command: ${command}`);
if(summaryProblems.length){console.error(`Summary not written:\n- ${summaryProblems.join('\n- ')}`);process.exit(1);}
const previous=await readJson<any>(join(root,'history','phase1','real-data-summary.json'));
const fullConversion=(rows:any[],source:string)=>rows.find(row=>row.source_id===source&&!row.filters?.ids?.length&&!row.filters?.bboxLocal&&row.filters?.maxPolygons===undefined);
const changesFromPhase1=inventories.map(inventory=>{
  const before=previous.inventories.find((row:any)=>row.source_id===inventory.source_id),oldFull=fullConversion(previous.conversions,inventory.source_id),newFull=fullConversion(conversions,inventory.source_id);
  return {source_id:inventory.source_id,inventory_polygons:{before:before?.totals.polygon_count??null,after:inventory.totals.polygon_count},
    full_conversion_polygons:{before:oldFull?.totals.polygons_converted??null,after:newFull?.totals.polygons_converted??null},
    full_conversion_triangles:{before:oldFull?.totals.triangles??null,after:newFull?.totals.triangles??null},geometry_references:inventory.geometry_reference_summary??null};
});
const networkSummary=networks.map(r=>({source_id:r.source_id,counts:r.counts??{features:r.totals?.features??r.feature_count??r.network_inventory?.feature_count??null,layers:r.members?.length??null},
  duplicate_node_ids:r.topology?.duplicate_node_ids?.length??null,duplicate_link_ids:r.topology?.duplicate_link_ids?.length??null,dangling_links:r.topology?.dangling_links?.length??null,
  self_loops:r.topology?.self_loops?.length??null,weak_components:r.topology?.weak_component_count??null,endpoint_mismatches:r.topology?.geometry_endpoint_mismatches_over_0_5m?.length??null,
  endpoint_check_status:r.topology?.geometry_endpoint_check_status??'UNKNOWN',
  endpoint_coverage:r.topology?.geometry_endpoint_coverage??null,
  floor_label_value_hash_distribution:r.network_inventory?.floor_label_value_hash_distribution??r.members?.flatMap((m:any)=>m.floor_label_value_hash_distribution??[])??(r.field_statistics?.node?.floor?.distinct_values?Object.keys(r.field_statistics.node.floor.distinct_values).sort():null),
  csv_in_out:r.field_statistics?.node?.in_out??null,csv_elevation:r.field_statistics?.node?.elevation??null,
  attribute_decoding:r.attribute_decoding??null,crs:r.crs??null,distance_consistency:r.distance_consistency??null,representation_comparison:r.csv_comparison??r.geojson_comparison??null,metric_status:r.topology?.metric_status??null,
  csv_route_structure:r.field_statistics?.link?.rt_struct??null,csv_step_class:r.field_statistics?.link?.lev_diff??null})).map(n=>({...n,endpoint_mismatches:/UNKNOWN/.test(n.endpoint_check_status)?null:n.endpoint_mismatches}));
for(const overlap of overlaps)if(acquiredSha.get(overlap.mesh_coverage?.catalog?.source_id)!==overlap.mesh_coverage?.catalog?.sha256)throw new Error(`Mesh coverage ${overlap.station_id} has stale catalog inputs`);
const overlapSummary=overlaps.map(report=>{const plateau=new Set(report.layers.filter((layer:any)=>layer.layer_role==='plateau_ubld').map((layer:any)=>layer.layer_id));return {station_id:report.station_id,layer_count:report.layers.length,pair_count:report.pairs.length,method:report.method,interpretation_limit:report.interpretation_limit,mesh_coverage:report.mesh_coverage??null,r1_bbox_containment:report.r1_bbox_containment??null,plateau_pairs:report.pairs.filter((pair:any)=>plateau.has(pair.layer_a)||plateau.has(pair.layer_b))};});
const result={tool_input_sha256:snapshot,verification:'UNVERIFIED',navigation_use:'NOT_FOR_ROUTING',
  poi:poi.map(row=>({source_id:row.source_id,source_sha256:row.source_sha256,members:row.members.map((m:any)=>({file:m.file,row_count:m.row_count??null,populated_row_count:m.populated_row_count??null,feature_count:m.feature_count??null,crs:m.crs,bbox:m.bbox})),coordinates:row.coordinates,routable:false})),
  rights:rights.flatMap(report=>report.records.map((row:any)=>projectRights(report,row))),
  acquisitions:acquisitions.map(r=>({source_id:r.source_id,bytes:r.bytes,sha256:r.sha256,size_check:r.size_check})),
  inventories:inventories.map(i=>({source_id:i.source_id,source_sha256:i.source_sha256,totals:i.totals,feature_type_counts:i.feature_type_counts??Object.fromEntries([...new Set(i.features.map((f:any)=>f.type))].map(t=>[String(t),i.features.filter((f:any)=>f.type===t).length])),
    semantic_presence:Object.fromEntries(Object.entries(i.semantic_presence).map(([key,value]:[string,any])=>[key,{status:value.status,count:value.count,observed_count:value.observed_count??value.count}])),
    codelist_resolution:i.codelist_resolution,codelist_inputs:i.codelist_inputs??[],geometry_reference_summary:i.geometry_reference_summary??null,feature_tree:i.feature_tree??null})),
  conversions:conversions.map(r=>({run_id:r.run_id,source_id:r.source_id,filters:r.filters,totals:r.totals,validation:r.validation,elapsed_ms:r.elapsed_ms,peak_rss_bytes:r.peak_rss_bytes})),networks:networkSummary,
  changes_from_phase1:changesFromPhase1,overlap:overlapSummary,crs_controls:crsReports.map(report=>({frame_id:report.frame.frame_id,independent_reference:report.independent_reference,max_independent_control_error_m:report.max_independent_control_error_m,independent_controls:report.independent_controls}))};
await writeJson(join(root,'real-data-summary.json'),result);
const lines=['# Real-data run summary','','Generated from acquisition, inventory, conversion and network JSON; no counts are manually maintained. All results are UNVERIFIED and NOT_FOR_ROUTING.','',`Tool-input SHA-256: \`${snapshot}\` (src, source manifest, codebooks, frames, synthetic tests/fixtures, package/lock/workspace/TypeScript configuration; sorted relative names plus exact bytes).`,'','## Acquisitions','','| Source | Bytes | SHA-256 | Size check |','| --- | ---: | --- | --- |',...result.acquisitions.map(r=>`| ${r.source_id} | ${r.bytes} | ${r.sha256} | ${r.size_check} |`),'','## CityGML inventories','','| Source | Objects | Polygons | Rings / holes | Vertices | Degenerate / unclosed |','| --- | ---: | ---: | ---: | ---: | ---: |',...result.inventories.map(i=>`| ${i.source_id} | ${i.totals.feature_count} | ${i.totals.polygon_count} | ${i.totals.ring_count} / ${i.totals.interior_ring_count} | ${i.totals.vertex_count} | ${i.totals.degenerate_polygon_count} / ${i.totals.unclosed_ring_count} |`),'','## Conversion readback','','| Run | Polygons | Triangles | Nodes | Bbox error m | Time ms | Peak RSS bytes |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |',...result.conversions.map(c=>`| ${c.run_id} | ${c.totals.polygons_converted} | ${c.totals.triangles} | ${c.totals.nodes} | ${c.validation.bbox_max_error_m} | ${c.elapsed_ms} | ${c.peak_rss_bytes} |`),'','## Network observations','',...networkSummary.flatMap(n=>[`### ${n.source_id}`,'',`Counts: ${JSON.stringify(n.counts)}. Duplicate nodes/links: ${n.duplicate_node_ids??'UNKNOWN'} / ${n.duplicate_link_ids??'UNKNOWN'}; dangling references: ${n.dangling_links??'UNKNOWN'}; self-loops: ${n.self_loops??'UNKNOWN'}; weak components: ${n.weak_components??'UNKNOWN'}.`,`Endpoint comparisons: ${n.endpoint_check_status}; metric status: ${n.metric_status??n.endpoint_check_status}; mismatches: ${n.endpoint_mismatches??'UNKNOWN'}. Coverage: ${JSON.stringify(n.endpoint_coverage)}.`,`Source floor labels (value_sha256, count): ${JSON.stringify(n.floor_label_value_hash_distribution)}.`,`CSV in_out: ${JSON.stringify(n.csv_in_out)}; elevation: ${JSON.stringify(n.csv_elevation)}.`, `Applicable spec: ${JSON.stringify(n.attribute_decoding?.applicable_spec_version??null)}; compatibility ${JSON.stringify(n.attribute_decoding?.spec_version_compatibility??null)}.`,`Rank check: ${JSON.stringify(n.attribute_decoding?.rank_cross_check_2024??null)}.`,`Literal co-occurrences: ${JSON.stringify(n.attribute_decoding?.literal_cooccurrences??null)}.`,`Distance consistency: ${JSON.stringify(n.distance_consistency)}.`,`Representation equality: ${JSON.stringify(n.representation_comparison)}.`,'']),'## Open questions','','Both stations require current-world checks of paid/unpaid boundaries, operator access, floor/elevation mapping, connectors and source currency. Geometry and source links have not been joined. See generated per-station gap packets.',''];
lines.splice(lines.indexOf('## Open questions'),0,'## Resource rights and POI content','','Rights assess reuse only; all publish gates remain HOLD, all POI inventories remain non-routable. See rights/README.md and poi/*.json.',...result.rights.map(row=>`- ${row.source_id}${row.layer ? ` / ${row.layer}` : ''}: ${row.verdict}; ${row.reason}. ${rightsScopeMarkdown(row)}`),'','## Changes from Phase 1','','| Source | Inventory polygon uses before → after | Full polygons before → after | Full triangles before → after |','| --- | ---: | ---: | ---: |',...changesFromPhase1.map(change=>`| ${change.source_id} | ${change.inventory_polygons.before} → ${change.inventory_polygons.after} | ${change.full_conversion_polygons.before} → ${change.full_conversion_polygons.after} | ${change.full_conversion_triangles.before} → ${change.full_conversion_triangles.after} |`),'',...changesFromPhase1.map(change=>`${change.source_id} geometry-reference accounting: ${JSON.stringify(change.geometry_references)}.`),'','## Source bbox overlap','','BBox evidence only; no feature correspondence or connection is established. See the complete per-layer tables under overlap/.','',...overlapSummary.flatMap(report=>[`### ${report.station_id}`,'',`${report.layer_count} source layers; ${report.pair_count} computed pairs. ${report.method}`,`Mesh catalog coverage: ${JSON.stringify(report.mesh_coverage)}.`,`Conditional R1 bbox containment: ${JSON.stringify(report.r1_bbox_containment)}.`,...report.plateau_pairs.map((pair:any)=>`- ${pair.layer_a} / ${pair.layer_b}: ${pair.bbox_relation}; minimum projected separation ${pair.minimum_separation_m??'UNKNOWN'} m; ${pair.metric_status}.`),'']),'## Independent GSI controls','',...result.crs_controls.map(report=>`- ${report.frame_id}: maximum absolute E/N control error ${report.max_independent_control_error_m} m (required ≤ 0.0005 m).`),'');
await writeFile(join(root,'real-data-summary.md'),lines.join('\n'));
console.log(JSON.stringify({tool_input_sha256:snapshot,acquisitions:acquisitions.length,inventories:inventories.length,conversions:conversions.length,networks:networks.length}));
