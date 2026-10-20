import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot,getStoreRoot,packageRoot,repoRoot,writeJson } from './common.js';
import { toolFingerprint } from './provenance.js';
import { archiveReceipt } from './history.js';
await archiveReceipt('validation');
const startedAt=new Date().toISOString(),tag=startedAt.replace(/[:.]/g,'-'),logRoot=`out/validation-logs/${tag}`,fingerprint=await toolFingerprint();
await mkdir(join(getStoreRoot(),logRoot),{recursive:true});
const commands=[];
for(const args of [['install','--frozen-lockfile'],['typecheck'],['test'],['test:real'],['gis','acquire','--all','--offline']]){
  const started=performance.now(),child=spawn('pnpm',['--dir',packageRoot,...args],{cwd:repoRoot,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',data=>{output+=String(data);});child.stderr.on('data',data=>{output+=String(data);});
  const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const logPath=`${logRoot}/${args[0].replaceAll(':','-')}.log`;await writeFile(join(getStoreRoot(),logPath),output);
  const tests=/Tests\s+(\d+) passed/.exec(output);
  const entry={command:`pnpm --dir tools/gis ${args.join(' ')}`,exit_code:exitCode,elapsed_ms:Math.round(performance.now()-started),tests_passed:tests?Number(tests[1]):null,log_store_path:logPath,tool_input_sha256:fingerprint};commands.push(entry);console.log(JSON.stringify(entry));
  if(exitCode!==0){console.error(output.slice(-4000));process.exitCode=1;break;}
}
await writeJson(join(docsRoot,'gis','validation.json'),{started_at:startedAt,completed_at:new Date().toISOString(),tool_input_sha256:fingerprint,commands});
