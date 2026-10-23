import { inspectPoi } from './poi.js';
import { loadLiteralAllowlistFile } from './poi-literals.js';
import { checkLiterals, scrubLiterals } from './literals.js';
import { writeLiteralClassification } from './literal-classes.js';
import { rightsReport } from './rights.js';
import { inspectVintages } from './vintage.js';
import { parseArgs } from 'node:util';
import { acquireSources, loadSources, acquisitionExitCode } from './acquire.js';
import { inspectCityGml } from './citygml.js';
import { crsRoundtrip, frameFromEnvelope } from './crs.js';
import { citygmlToGlb } from './convert.js';
import { inspectNetwork } from './network.js';
import { gapPacket } from './gaps.js';
import { parseBboxLocal } from './filters.js';
import { generateOverlapReports } from './overlap.js';
import { ensurePrivateStore, docsRoot } from './common.js';
import { join } from 'node:path';
import { invalidateRealRunReceipt } from './history.js';
import { createStationEnuFrame } from './station-enu.js';
import { contextGlb } from './context.js';
import { contextOverlay, parseOverlayKinds } from './context-overlay.js';

async function main() {
  ensurePrivateStore();
  const argv=process.argv.slice(2);
  // A negative EN bbox is one explicit string value, rather than another CLI option.
  for(let i=0;i<argv.length-1;i++)if(argv[i]==='--bbox-local'&&argv[i+1].startsWith('-')&&!argv[i+1].startsWith('--'))argv.splice(i,2,`--bbox-local=${argv[i+1]}`);
  const { values, positionals } = parseArgs({ args:argv,allowPositionals:true, options:{offline:{type:'boolean'},all:{type:'boolean'},frame:{type:'string'},'bbox-local':{type:'string'},ids:{type:'string'},'max-polygons':{type:'string'},radius:{type:'string'},'clip-radius':{type:'string'},'exit-radius':{type:'string'},merge:{type:'string'},variant:{type:'string'},kinds:{type:'string'},'no-glb':{type:'boolean'},sources:{type:'string'},help:{type:'boolean'}} });
  const [command,...args]=positionals;
  if(values.help || !command){console.log('sources | acquire <source_id...> [--all] [--offline] | inspect-citygml <source_id> | frame-from-envelope <source_id> <frame_id> | crs-roundtrip <frame_id> | citygml-to-glb <source_id> --frame <frame_id> [--bbox-local minE,minN,maxE,maxN] [--ids id1,id2] [--max-polygons N] | station-frame <station> [frame_id] | context-glb <station> [--radius M] [--exit-radius M] [--merge none|kind|tiles:<size_m>] [--variant high|low] [--kinds bldg,tran] [--sources id1,id2] | context-overlay <station> [--radius M] [--exit-radius M] [--kinds station,railway] [--clip-radius M|0|none] [--no-glb] | inspect-network <source_id> | inspect-poi <source_id> | check-literals (alias check-poi-literals) | literals-report | scrub-literals <path...> | inspect-vintages | rights-report | overlap | gap-packet');return;}
  const requireArg=(index:number):string=>{if(!args[index])throw new Error(`Missing argument ${index+1} for ${command}`);return args[index];};
  const writesReports=['inspect-citygml','frame-from-envelope','station-frame','crs-roundtrip','citygml-to-glb','inspect-network','inspect-poi','inspect-vintages','rights-report','literals-report','scrub-literals','overlap','gap-packet'].includes(command)||(command==='acquire'&&!values.offline);
  if(writesReports&&process.env.GTEKI_GIS_REAL_RUN!=='1')await invalidateRealRunReceipt(`gis ${positionals.join(' ')}`);
  let result:unknown;
  switch(command){
    case 'sources': result=loadSources();break;
    case 'acquire': {
      const ids=values.all?loadSources().map(s=>s.source_id):args;if(!ids.length)throw new Error('Provide source IDs or --all');
      const acquired=await acquireSources(ids,{offline:values.offline});
      result=acquired.map(({source_id,ok,record,error})=>({source_id,ok,record,error}));
      process.exitCode=acquisitionExitCode(acquired);break;
    }
    case 'inspect-citygml':{const inv=await inspectCityGml(requireArg(0));result={source_id:inv.source_id,source_sha256:inv.source_sha256,totals:inv.totals,report:`docs/gis/inventory/${inv.source_id}.inventory.json`};break;}
    case 'frame-from-envelope': result=await frameFromEnvelope(requireArg(0),requireArg(1));break;
    case 'station-frame': result=await createStationEnuFrame(requireArg(0),args[1]);break;
    case 'context-glb': {
      const radius=values.radius===undefined?undefined:Number(values.radius);
      if(radius!==undefined&&(!Number.isFinite(radius)||radius<=0))throw new Error('--radius must be a positive number of metres');
      const exitRadius=values['exit-radius']===undefined?undefined:Number(values['exit-radius']);
      if(exitRadius!==undefined&&(!Number.isFinite(exitRadius)||exitRadius<0))throw new Error('--exit-radius must be a non-negative number of metres (0 disables the exit discs)');
      if(values.variant!==undefined&&values.variant!=='high'&&values.variant!=='low')throw new Error('--variant must be high or low');
      result=await contextGlb(requireArg(0),{...(radius!==undefined?{radiusM:radius}:{}),...(exitRadius!==undefined?{exitRadiusM:exitRadius}:{}),...(values.merge!==undefined?{merge:values.merge}:{}),...(values.variant!==undefined?{variant:values.variant}:{}),...(values.kinds!==undefined?{kinds:values.kinds}:{}),...(values.sources?{sourceIds:values.sources.split(',').filter(Boolean)}:{})});break;
    }
    case 'context-overlay': {
      const radius=values.radius===undefined?undefined:Number(values.radius);
      if(radius!==undefined&&(!Number.isFinite(radius)||radius<=0))throw new Error('--radius must be a positive number of metres');
      const exitRadius=values['exit-radius']===undefined?undefined:Number(values['exit-radius']);
      if(exitRadius!==undefined&&(!Number.isFinite(exitRadius)||exitRadius<0))throw new Error('--exit-radius must be a non-negative number of metres (0 disables the exit discs)');
      const clipArg=values['clip-radius'];
      const clipRadius=clipArg===undefined?undefined:clipArg==='none'?0:Number(clipArg);
      if(clipRadius!==undefined&&(!Number.isFinite(clipRadius)||clipRadius<0))throw new Error('--clip-radius must be a non-negative number of metres, 0 or none (disables clipping)');
      if(values.kinds!==undefined)parseOverlayKinds(values.kinds);
      if(values.merge!==undefined||values.variant!==undefined||values.sources!==undefined)throw new Error('context-overlay takes only --radius, --exit-radius, --kinds, --clip-radius and --no-glb');
      result=await contextOverlay(requireArg(0),{...(radius!==undefined?{radiusM:radius}:{}),...(clipRadius!==undefined?{clipRadiusM:clipRadius}:{}),...(exitRadius!==undefined?{exitRadiusM:exitRadius}:{}),...(values.kinds!==undefined?{kinds:values.kinds}:{}),...(values['no-glb']?{glb:false}:{})});break;
    }
    case 'crs-roundtrip': result=await crsRoundtrip(requireArg(0));break;
    case 'citygml-to-glb': {
      if(!values.frame)throw new Error('--frame is required');
      const bbox=values['bbox-local']===undefined?undefined:parseBboxLocal(values['bbox-local']);
      result=await citygmlToGlb(requireArg(0),values.frame,{...(values.ids?{ids:values.ids.split(',')}:{ }),...(bbox?{bboxLocal:bbox as [number,number,number,number]}:{}),...(values['max-polygons']?{maxPolygons:Number(values['max-polygons'])}:{})});break;
    }
    case 'inspect-network':{const report=await inspectNetwork(requireArg(0));result={source_id:args[0],report:`docs/gis/networks/${args[0]}.json`,verification:'UNVERIFIED'};break;}
    case 'inspect-poi': { const report=await inspectPoi(requireArg(0)); result={source_id:report.source_id,member_count:report.members.length,report:`docs/gis/poi/${report.source_id}.json`}; break; }
    case 'check-literals': case 'check-poi-literals': {
      // Read-only leak guard (alias keeps the #128 name): no literal POI or class (b) non-POI source value may appear under docs/gis.
      const allowlist=await loadLiteralAllowlistFile();
      const checked=await checkLiterals(join(docsRoot,'gis'),undefined,allowlist.terms,{structural:allowlist.structural});
      result=checked;
      if(checked.status!=='PASS')process.exitCode=1;break;
    }
    case 'literals-report': result=await writeLiteralClassification();break;
    case 'scrub-literals': {if(!args.length)throw new Error('Provide paths under docs/gis');const allowlist=await loadLiteralAllowlistFile();result=await scrubLiterals(join(docsRoot,'gis'),args,allowlist.terms,undefined,allowlist.structural);break;}
    case 'inspect-vintages': {
      const report=await inspectVintages();
      const relations=report.comparison.bbox_relations.reduce<Record<string,number>>((counts,row)=>({...counts,[row.relation]:(counts[row.relation]??0)+1}),{});
      result={status:report.status,verification:report.verification,routable:report.routable,rights:report.rights,tool_input_sha256:report.tool_input_sha256,package_sha256:report.package_sha256,
        archives:report.archives.map(a=>({archive:a.archive,total_bytes:a.total_bytes,etag:a.etag,entries:a.total_entry_count,ubld_members:a.members.filter(m=>m.mesh).map(m=>m.name)})),
        selected_members:report.selected_member_records.map(m=>({archive:m.archive,member:m.member,bytes:m.bytes,crc32:m.crc32,sha256:m.sha256})),
        bbox_relations:relations,byte_totals:report.byte_totals,report:'docs/gis/vintages/shinjuku-2023.json'};break;
    }
    case 'rights-report': { const reports=await rightsReport(); result={sources:reports.length,records:reports.reduce((n,r)=>n+r.records.length,0),report:'docs/gis/rights/README.md'}; break; }
    case 'overlap':result=await generateOverlapReports();break;
    case 'gap-packet':result=await gapPacket();break;
    default:throw new Error(`Unknown command: ${command}`);
  }
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(JSON.stringify({status:'FAIL',error:error instanceof Error?error.message:String(error)}));process.exitCode=1;});
