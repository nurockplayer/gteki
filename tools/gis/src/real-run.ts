import { POI_SOURCES } from './poi.js';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot,repoRoot,docsRoot,getStoreRoot,readJson,writeJson } from './common.js';
import type { CityInventory } from './citygml.js';
import { loadInventoryDetail } from './citygml.js';
import { smallestRoom } from './selection.js';
import { toolFingerprint } from './provenance.js';
import { ensurePrivateStore } from './common.js';
import { archiveReceipt, archivePriorConversions } from './history.js';

/** Reproducible ordered CLI receipt. All downloaded and binary logs remain in the external store. */
ensurePrivateStore();
await archiveReceipt('real-run');
const receipt:{started_at:string;completed_at:string|null;tool_input_sha256:string;commands:Array<{command:string;exit_code:number|null;elapsed_ms:number;log_store_path:string;tool_input_sha256:string;selection_evidence?:unknown;conversion_run_id?:string|null}>}={started_at:new Date().toISOString(),completed_at:null,tool_input_sha256:await toolFingerprint(),commands:[]};
const runTag=receipt.started_at.replace(/[:.]/g,'-');
const logDirectory=join(getStoreRoot(),'out','run-logs',runTag);await mkdir(logDirectory,{recursive:true});
async function run(args:string[],selectionEvidence?:unknown){
  const started=performance.now(),relative=`out/run-logs/${runTag}/${String(receipt.commands.length+1).padStart(2,'0')}-${args[0]}-${args[1]??'all'}.log`,fingerprint=await toolFingerprint();
  const child=spawn('pnpm',['--dir',packageRoot,'gis',...args],{cwd:repoRoot,stdio:['ignore','pipe','pipe'],env:{...process.env,GTEKI_GIS_REAL_RUN:'1'}});
  let output='';child.stdout.on('data',data=>{output+=String(data);});child.stderr.on('data',data=>{output+=String(data);});
  const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  await writeFile(join(getStoreRoot(),relative),output);
  receipt.commands.push({command:`pnpm --dir tools/gis gis ${args.join(' ')}`,exit_code:exitCode,elapsed_ms:Math.round(performance.now()-started),log_store_path:relative,tool_input_sha256:fingerprint,...(selectionEvidence?{selection_evidence:selectionEvidence}:{}),
    // Bind each conversion command to the receipt it wrote so summarize can select exactly this run's conversions.
    ...(args[0]==='citygml-to-glb'?{conversion_run_id:exitCode===0?(/"run_id":\s*"([^"]+)"/.exec(output)?.[1]??null):null}:{})});
  await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
  console.log(JSON.stringify(receipt.commands.at(-1)));
  if(exitCode!==0){console.error(output.slice(-2000));receipt.completed_at=new Date().toISOString();await writeJson(join(docsRoot,'gis','real-run.json'),receipt);process.exit(1);}
  return exitCode===0;
}

if(!await run(['acquire','--all',...(process.env.GTEKI_GIS_OFFLINE==='1'?['--offline']:[])])){
  // Every later step reads the acquisition records; never mix a failed refresh with older stored records.
  console.error('Acquisition failed; dependent inspections, conversions and reports were not run.');
  receipt.completed_at=new Date().toISOString();await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
  process.exit(1);
}
const cities=[{source:'plateau-13116-ubld-53394576',frame:'ikebukuro-plateau-ubld-v0'},{source:'plateau-13104-ubld-53394536',frame:'shinjuku-plateau-ubld-v0'}];
const inventories=new Map<string,CityInventory>();
for(const city of cities)if(await run(['inspect-citygml',city.source]))inventories.set(city.source,await loadInventoryDetail(city.source));
const framed=new Set<string>();
for(const city of cities)if(inventories.has(city.source)&&await run(['frame-from-envelope',city.source,city.frame])&&await run(['crs-roundtrip',city.frame]))framed.add(city.source);
// Frame files are fingerprint inputs and may have just been rewritten: rebind the receipt to the post-frame
// fingerprint that conversions will record, and archive every prior conversion receipt.
receipt.tool_input_sha256=await toolFingerprint();await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
await archivePriorConversions();
for(const city of cities){const inventory=inventories.get(city.source);if(!inventory||!framed.has(city.source))continue;const room=smallestRoom(inventory);
  if(room)await run(['citygml-to-glb',city.source,'--frame',city.frame,'--ids',room.gml_id],room);
  else {
    // The bounded Room conversion is a required step; its absence must fail the run rather than pass silently.
    console.error(`No Room with source polygons in ${city.source}; bounded Room conversion unavailable`);
    receipt.commands.push({command:`pnpm --dir tools/gis gis citygml-to-glb ${city.source} --frame ${city.frame} --ids <smallest Room>`,exit_code:1,elapsed_ms:0,log_store_path:'',tool_input_sha256:receipt.tool_input_sha256,selection_evidence:{status:'NO_ROOM_WITH_SOURCE_POLYGONS'}});
    await writeJson(join(docsRoot,'gis','real-run.json'),receipt);process.exit(1);
  }
  await run(['citygml-to-glb',city.source,'--frame',city.frame]);
}
await run(['inspect-network','hokonavi-ikebukuro-walk-node-csv']);
await run(['inspect-network','hokonavi-ikebukuro-walk-node-geojson']);
await run(['inspect-network','hokonavi-oedo-shinjuku-network-geojson']);
await run(['inspect-network','hokonavi-oedo-shinjuku-stationmap-geojson']);
// Range-reads the 2023 archives; it needs the E27 network reports just regenerated above, so a cached replay skips it.
if(process.env.GTEKI_GIS_OFFLINE!=='1')await run(['inspect-vintages']);
// Derived reports read every inventory/network report on disk; regenerate them only when all inputs were refreshed now.
if(receipt.commands.every(command=>command.exit_code===0)){
  await run(['overlap']);
  for(const source of POI_SOURCES)await run(['inspect-poi',source]);
  await run(['rights-report']);
  await run(['gap-packet']);
}
else console.error('A prerequisite command failed; overlap and gap-packet were not regenerated to avoid mixed-vintage reports.');
receipt.completed_at=new Date().toISOString();await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
if(receipt.commands.some(command=>command.exit_code!==0))process.exitCode=1;
