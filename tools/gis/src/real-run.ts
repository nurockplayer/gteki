import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageRoot,repoRoot,docsRoot,getStoreRoot,readJson,writeJson } from './common.js';
import type { CityInventory } from './citygml.js';
import { loadInventoryDetail } from './citygml.js';
import { smallestRoom } from './selection.js';
import { toolFingerprint } from './provenance.js';
import { archiveReceipt, archiveStaleConversions } from './history.js';

/** Reproducible ordered CLI receipt. All downloaded and binary logs remain in the external store. */
await archiveReceipt('real-run');
const receipt:{started_at:string;completed_at:string|null;tool_input_sha256:string;commands:Array<{command:string;exit_code:number|null;elapsed_ms:number;log_store_path:string;tool_input_sha256:string;selection_evidence?:unknown}>}={started_at:new Date().toISOString(),completed_at:null,tool_input_sha256:await toolFingerprint(),commands:[]};
const runTag=receipt.started_at.replace(/[:.]/g,'-');
const logDirectory=join(getStoreRoot(),'out','run-logs',runTag);await mkdir(logDirectory,{recursive:true});
async function run(args:string[],selectionEvidence?:unknown){
  const started=performance.now(),relative=`out/run-logs/${runTag}/${String(receipt.commands.length+1).padStart(2,'0')}-${args[0]}-${args[1]??'all'}.log`,fingerprint=await toolFingerprint();
  const process=spawn('pnpm',['--dir',packageRoot,'gis',...args],{cwd:repoRoot,stdio:['ignore','pipe','pipe']});
  let output='';process.stdout.on('data',data=>{output+=String(data);});process.stderr.on('data',data=>{output+=String(data);});
  const exitCode=await new Promise<number|null>((resolve,reject)=>{process.on('error',reject);process.on('close',resolve);});
  await writeFile(join(getStoreRoot(),relative),output);
  receipt.commands.push({command:`pnpm --dir tools/gis gis ${args.join(' ')}`,exit_code:exitCode,elapsed_ms:Math.round(performance.now()-started),log_store_path:relative,tool_input_sha256:fingerprint,...(selectionEvidence?{selection_evidence:selectionEvidence}:{})});
  await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
  console.log(JSON.stringify(receipt.commands.at(-1)));
  if(exitCode!==0)console.error(output.slice(-2000));
  return exitCode===0;
}

await archiveStaleConversions(receipt.tool_input_sha256);
if(!await run(['acquire','--all'])){
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
for(const city of cities){const inventory=inventories.get(city.source);if(!inventory||!framed.has(city.source))continue;const room=smallestRoom(inventory);
  if(room)await run(['citygml-to-glb',city.source,'--frame',city.frame,'--ids',room.gml_id],room);
  else {console.error(`No Room with source polygons in ${city.source}; bounded Room conversion unavailable`);}
  await run(['citygml-to-glb',city.source,'--frame',city.frame]);
}
await run(['inspect-network','hokonavi-ikebukuro-walk-node-csv']);
await run(['inspect-network','hokonavi-oedo-shinjuku-network-geojson']);
await run(['inspect-network','hokonavi-oedo-shinjuku-stationmap-geojson']);
// Derived reports read every inventory/network report on disk; regenerate them only when all inputs were refreshed now.
if(receipt.commands.every(command=>command.exit_code===0)){if(await run(['overlap']))await run(['gap-packet']);}
else console.error('A prerequisite command failed; overlap and gap-packet were not regenerated to avoid mixed-vintage reports.');
receipt.completed_at=new Date().toISOString();await writeJson(join(docsRoot,'gis','real-run.json'),receipt);
if(receipt.commands.some(command=>command.exit_code!==0))process.exitCode=1;
