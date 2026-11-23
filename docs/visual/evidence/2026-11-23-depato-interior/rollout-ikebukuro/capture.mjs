// 2026-11-23 JST. Launch through job-run + tachi-run --heavy --host.
import { createServer } from '../../../../../apps/web/node_modules/vite/dist/node/index.js';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const runtimeHead=execFileSync('rtk',['git','-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
process.chdir(repo+'apps/web');
const server=await createServer({server:{host:'127.0.0.1',port:5291,strictPort:true}});
try{
  await server.listen();
  const run=spawn('ego-browser',['nodejs'],{stdio:['pipe','inherit','inherit']});
  run.stdin.end(`const runtimeHead=${JSON.stringify(runtimeHead)};\n`+readFileSync(new URL('./walk.mjs',import.meta.url),'utf8'));
  process.exitCode=await new Promise((resolve,reject)=>{run.on('error',reject);run.on('exit',code=>resolve(code??1));});
  // Close only the task space created for this capture, in a separate final invocation.
  if(process.exitCode===0){
    const receipt=JSON.parse(readFileSync(new URL('./receipt.json',import.meta.url),'utf8'));
    const close=spawn('ego-browser',['nodejs','-e',`const task=await taskSpace(${receipt.spaceId}); await task.finish({keep:[]});`],{stdio:'inherit'});
    process.exitCode=await new Promise((resolve,reject)=>{close.on('error',reject);close.on('exit',code=>resolve(code??1));});
  }
}finally{await server.close();}
