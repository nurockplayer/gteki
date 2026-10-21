import { readdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot,readJson,writeJson } from './common.js';
import { toolFingerprint } from './provenance.js';
import { loadSources } from './acquire.js';
import { verifyVintageEvidence } from './vintage.js';
import { verifyPoiEvidence } from './poi.js';
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
const poi=await reports('poi'),rights=await reports('rights'),vintage=await readJson<any>(join(root,'vintages','shinjuku-2023.json'));
// Only receipts produced by the current tool fingerprint describe this candidate; older ones are history.
const snapshot=await toolFingerprint();
// Refuse to summarize unless the current real run completed cleanly with this exact tool fingerprint and every
// inventory/network report was produced from the currently recorded acquisition bytes.
const runReceipt=await readJson<any>(join(root,'real-run.json'));
const summaryProblems:string[]=[];
const vintageIntegrity=await verifyVintageEvidence(vintage);
if(vintageIntegrity.status!=='PASS')summaryProblems.push(...vintageIntegrity.errors);
for(const report of poi){const integrity=await verifyPoiEvidence(report);if(integrity.status!=='PASS')summaryProblems.push(...integrity.errors);}
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
// The offline vintage verifier above checks exact extracted bytes and their archive
// lineage. Derived member rights retain their own identity rather than borrowing
// the package snapshot hash as the member hash.
if(vintageIntegrity.status==='PASS')for(const member of vintage.selected_member_records)acquiredSha.set(`vintage-member-${member.sha256.slice(0,16)}`,member.sha256);
for(const source of loadSources())if(!acquiredSha.has(source.source_id)||!rights.some(r=>r.source_id===source.source_id))summaryProblems.push(`Missing acquisition or rights report ${source.source_id}`);
for(const report of [...poi,...rights,vintage]){
  if(report.tool_input_sha256!==snapshot)summaryProblems.push(`POI/rights/vintage report ${report.source_id} has a stale tool fingerprint`);
  for(const [id,sha] of networkSourceHashes(report))if(acquiredSha.get(id)!==sha)summaryProblems.push(`POI/rights/vintage report ${report.source_id} has stale source ${id}`);
}
for(const id of ['toei-stores-shinjuku-csv','toei-stores-shinjuku-nishiguchi-csv','tokyo-shinjuku-facilities-zip','tokyo-shinjuku-facilities-spec-pdf','plateau-13104-related-2025','plateau-13116-related-2025'])if(!poi.some(r=>r.source_id===id))summaryProblems.push(`Missing POI report ${id}`);
for(const command of ['inspect-vintages','rights',...poi.map(r=>`inspect-poi ${r.source_id}`)])if(!runReceipt.commands?.some((c:any)=>c.command===`pnpm --dir tools/gis gis ${command}`&&c.exit_code===0))summaryProblems.push(`Missing successful real-run command ${command}`);
for(const inventory of inventories)if(acquiredSha.get(inventory.source_id)!==inventory.source_sha256)summaryProblems.push(`inventory ${inventory.source_id} does not match the recorded acquisition`);
for(const network of networks)if(network.tool_input_sha256!==snapshot)summaryProblems.push(`network report ${network.source_id} has a stale tool fingerprint`);
for(const network of networks)for(const [sourceId,sha] of networkSourceHashes(network))if(acquiredSha.get(sourceId)!==sha)summaryProblems.push(`network report ${network.source_id} input ${sourceId} does not match the recorded acquisition`);
for(const overlap of overlaps){if(overlap.tool_input_sha256!==snapshot)summaryProblems.push(`overlap ${overlap.station_id} has a stale tool fingerprint`);for(const [id,sha] of networkSourceHashes(overlap))if(acquiredSha.get(id)!==sha)summaryProblems.push(`overlap ${overlap.station_id} has stale source ${id}`);}
if(runReceipt.invalidated)summaryProblems.push(`real-run.json was invalidated by an out-of-band command: ${runReceipt.invalidated.by_command}`);
for(const conversion of conversions)if(acquiredSha.get(conversion.source_id)!==conversion.source_sha256)summaryProblems.push(`conversion ${conversion.run_id} does not match the recorded acquisition`);
for(const report of crsReports)if(acquiredSha.get(report.frame?.source_id)!==report.frame?.source_sha256)summaryProblems.push(`CRS report ${report.frame?.frame_id} does not match the recorded acquisition`);
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
  floor_labels:r.network_inventory?.floor_labels_present_literally??r.members?.flatMap((m:any)=>m.floor_labels_present_literally??[])??(r.field_statistics?.node?.floor?.distinct_values?Object.keys(r.field_statistics.node.floor.distinct_values).sort():null),
  csv_in_out:r.field_statistics?.node?.in_out??null,csv_elevation:r.field_statistics?.node?.elevation??null,
  attribute_decoding:r.attribute_decoding??null,crs:r.crs??null,distance_consistency:r.distance_consistency??null,representation_comparison:r.csv_comparison??r.geojson_comparison??null,metric_status:r.topology?.metric_status??null,
  csv_route_structure:r.field_statistics?.link?.rt_struct??null,csv_step_class:r.field_statistics?.link?.lev_diff??null})).map(n=>({...n,endpoint_mismatches:/UNKNOWN/.test(n.endpoint_check_status)?null:n.endpoint_mismatches}));
for(const overlap of overlaps)if(acquiredSha.get(overlap.mesh_coverage?.catalog?.source_id)!==overlap.mesh_coverage?.catalog?.sha256)throw new Error(`Mesh coverage ${overlap.station_id} has stale catalog inputs`);
const overlapSummary=overlaps.map(report=>{const plateau=new Set(report.layers.filter((layer:any)=>layer.layer_role==='plateau_ubld').map((layer:any)=>layer.layer_id));return {station_id:report.station_id,layer_count:report.layers.length,pair_count:report.pairs.length,method:report.method,interpretation_limit:report.interpretation_limit,mesh_coverage:report.mesh_coverage??null,r1_bbox_containment:report.r1_bbox_containment??null,plateau_pairs:report.pairs.filter((pair:any)=>plateau.has(pair.layer_a)||plateau.has(pair.layer_b))};});
const result={tool_input_sha256:snapshot,verification:'UNVERIFIED',navigation_use:'NOT_FOR_ROUTING',
  poi:poi.map(r=>({source_id:r.source_id,source_sha256:r.source_sha256,station_ids:r.station_ids,format:r.format,row_count:r.row_count??null,headers:r.headers??null,coordinate_fields:r.coordinate_fields??null,members:r.members?.map((m:any)=>({file:m.file,kind:m.kind,feature_count:m.feature_count??null,geometry_type_counts:m.geometry_type_counts??null,bbox:m.bbox??null,bbox_status:m.bbox_status??null,bbox_counts:m.bbox_counts??null,raw_coordinates_bbox:m.raw_coordinates_bbox??null,crs:m.crs??null,crs_status:m.crs_status??null,property_keys:m.property_keys??null}))??null,verification:r.verification,routable:r.routable})),
  rights:rights.map(r=>({source_id:r.source_id,source_sha256:r.source_sha256,licence:r.licence,resource_licence:r.resource_licence,file_embedded_licence:r.file_embedded_licence,publish_gate:r.publish_gate})),plateau_2023_vintage:vintage,
  acquisitions:acquisitions.map(r=>({source_id:r.source_id,bytes:r.bytes,sha256:r.sha256,size_check:r.size_check})),
  inventories:inventories.map(i=>({source_id:i.source_id,source_sha256:i.source_sha256,totals:i.totals,feature_type_counts:i.feature_type_counts??Object.fromEntries([...new Set(i.features.map((f:any)=>f.type))].map(t=>[String(t),i.features.filter((f:any)=>f.type===t).length])),
    semantic_presence:Object.fromEntries(Object.entries(i.semantic_presence).map(([key,value]:[string,any])=>[key,{status:value.status,count:value.count,observed_count:value.observed_count??value.count}])),
    codelist_resolution:i.codelist_resolution,codelist_inputs:i.codelist_inputs??[],geometry_reference_summary:i.geometry_reference_summary??null,feature_tree:i.feature_tree??null})),
  conversions:conversions.map(r=>({run_id:r.run_id,source_id:r.source_id,filters:r.filters,totals:r.totals,validation:r.validation,elapsed_ms:r.elapsed_ms,peak_rss_bytes:r.peak_rss_bytes})),networks:networkSummary,
  changes_from_phase1:changesFromPhase1,overlap:overlapSummary,crs_controls:crsReports.map(report=>({frame_id:report.frame.frame_id,independent_reference:report.independent_reference,max_independent_control_error_m:report.max_independent_control_error_m,independent_controls:report.independent_controls}))};
await writeJson(join(root,'real-data-summary.json'),result);
const lines=['# Real-data run summary','','Generated from acquisition, inventory, conversion and network JSON; no counts are manually maintained. All results are UNVERIFIED and NOT_FOR_ROUTING.','',`Tool-input SHA-256: \`${snapshot}\` (src, source manifest, codebooks, frames, synthetic tests/fixtures, package/lock/workspace/TypeScript configuration; sorted relative names plus exact bytes).`,'','## Acquisitions','','| Source | Bytes | SHA-256 | Size check |','| --- | ---: | --- | --- |',...result.acquisitions.map(r=>`| ${r.source_id} | ${r.bytes} | ${r.sha256} | ${r.size_check} |`),'','## CityGML inventories','','| Source | Objects | Polygons | Rings / holes | Vertices | Degenerate / unclosed |','| --- | ---: | ---: | ---: | ---: | ---: |',...result.inventories.map(i=>`| ${i.source_id} | ${i.totals.feature_count} | ${i.totals.polygon_count} | ${i.totals.ring_count} / ${i.totals.interior_ring_count} | ${i.totals.vertex_count} | ${i.totals.degenerate_polygon_count} / ${i.totals.unclosed_ring_count} |`),'','## Conversion readback','','| Run | Polygons | Triangles | Nodes | Bbox error m | Time ms | Peak RSS bytes |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |',...result.conversions.map(c=>`| ${c.run_id} | ${c.totals.polygons_converted} | ${c.totals.triangles} | ${c.totals.nodes} | ${c.validation.bbox_max_error_m} | ${c.elapsed_ms} | ${c.peak_rss_bytes} |`),'','## Network observations','',...networkSummary.flatMap(n=>[`### ${n.source_id}`,'',`Counts: ${JSON.stringify(n.counts)}. Duplicate nodes/links: ${n.duplicate_node_ids??'UNKNOWN'} / ${n.duplicate_link_ids??'UNKNOWN'}; dangling references: ${n.dangling_links??'UNKNOWN'}; self-loops: ${n.self_loops??'UNKNOWN'}; weak components: ${n.weak_components??'UNKNOWN'}.`,`Endpoint comparisons: ${n.endpoint_check_status}; metric status: ${n.metric_status??n.endpoint_check_status}; mismatches: ${n.endpoint_mismatches??'UNKNOWN'}. Coverage: ${JSON.stringify(n.endpoint_coverage)}.`,`Literal source floor labels: ${JSON.stringify(n.floor_labels)}.`,`CSV in_out: ${JSON.stringify(n.csv_in_out)}; elevation: ${JSON.stringify(n.csv_elevation)}.`, `Applicable spec: ${JSON.stringify(n.attribute_decoding?.applicable_spec_version??null)}; compatibility ${JSON.stringify(n.attribute_decoding?.spec_version_compatibility??null)}.`,`Rank check: ${JSON.stringify(n.attribute_decoding?.rank_cross_check_2024??null)}.`,`Literal co-occurrences: ${JSON.stringify(n.attribute_decoding?.literal_cooccurrences??null)}.`,`Distance consistency: ${JSON.stringify(n.distance_consistency)}.`,`Representation equality: ${JSON.stringify(n.representation_comparison)}.`,'']),'## Open questions','','Both stations require current-world checks of paid/unpaid boundaries, operator access, floor/elevation mapping, connectors and source currency. Geometry and source links have not been joined. See generated per-station gap packets.',''];
lines.splice(lines.indexOf('## Open questions'),0,'## Changes from Phase 1','','| Source | Inventory polygon uses before → after | Full polygons before → after | Full triangles before → after |','| --- | ---: | ---: | ---: |',...changesFromPhase1.map(change=>`| ${change.source_id} | ${change.inventory_polygons.before} → ${change.inventory_polygons.after} | ${change.full_conversion_polygons.before} → ${change.full_conversion_polygons.after} | ${change.full_conversion_triangles.before} → ${change.full_conversion_triangles.after} |`),'',...changesFromPhase1.map(change=>`${change.source_id} geometry-reference accounting: ${JSON.stringify(change.geometry_references)}.`),'','## Source bbox overlap','','BBox evidence only; no feature correspondence or connection is established. See the complete per-layer tables under overlap/.','',...overlapSummary.flatMap(report=>[`### ${report.station_id}`,'',`${report.layer_count} source layers; ${report.pair_count} computed pairs. ${report.method}`,`Mesh catalog coverage: ${JSON.stringify(report.mesh_coverage)}.`,`Conditional R1 bbox containment: ${JSON.stringify(report.r1_bbox_containment)}.`,...report.plateau_pairs.map((pair:any)=>`- ${pair.layer_a} / ${pair.layer_b}: ${pair.bbox_relation}; minimum projected separation ${pair.minimum_separation_m??'UNKNOWN'} m; ${pair.metric_status}.`),'']),'## Independent GSI controls','',...result.crs_controls.map(report=>`- ${report.frame_id}: maximum absolute E/N control error ${report.max_independent_control_error_m} m (required ≤ 0.0005 m).`),'');
lines.push('## POI and rights','','| Source | Format | Rows | Members | Publish gate |','| --- | --- | ---: | ---: | --- |',...result.poi.map(r=>`| ${r.source_id} | ${r.format} | ${r.row_count??'n/a'} | ${r.members?.length??'n/a'} | HOLD |`),'','All resource rights remain HOLD; declaration scopes and hashed evidence are in rights/README.md. All POI candidates are UNVERIFIED / routable:false.','',`2023 vintage result: ${vintage.status}; see vintages/shinjuku-2023.json for exact byte ranges, mesh comparison, validators, hashes and member bboxes.`, '');
await writeFile(join(root,'real-data-summary.md'),lines.join('\n'));
console.log(JSON.stringify({tool_input_sha256:snapshot,acquisitions:acquisitions.length,inventories:inventories.length,conversions:conversions.length,networks:networks.length}));
