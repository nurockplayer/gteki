// 2026-11-23 JST. Launch through job-run + tachi-run --heavy --host.
import { createServer } from '../../../../../apps/web/node_modules/vite/dist/node/index.js';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
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
  if(process.exitCode===0){
    const base=new URL('./',import.meta.url),receipt=JSON.parse(readFileSync(new URL('receipt.json',base),'utf8'));
    for(const profile of receipt.profiles)for(const frame of profile.frames.filter(f=>f.name==='street-door-inside')){
      const png=PNG.sync.read(readFileSync(new URL(frame.file,base)));
      let black=0;for(let i=0;i<png.data.length;i+=4)if(Math.max(png.data[i],png.data[i+1],png.data[i+2])<=16)black++;
      frame.blackPixelPct=100*black/(png.width*png.height);
      if(frame.blackPixelPct>0.1)receipt.failures.push(`${frame.file}: black pixels ${frame.blackPixelPct}% > 0.1%`);
    }
    writeFileSync(new URL('receipt.json',base),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({blackPixels:receipt.profiles.flatMap(p=>p.frames.filter(f=>f.name==='street-door-inside').map(f=>({file:f.file,pct:f.blackPixelPct}))),failures:receipt.failures}));
    if(receipt.failures.length)process.exitCode=1;
  }
}finally{
  // The capture can fail before writing its receipt, so look up its task space by name.
  const close=spawn('ego-browser',['nodejs','-e',`const space=(await listTaskSpaces()).find(s=>s.name==='depato-rollout-ikebukuro'); if(space){const task=await taskSpace(space.id); await task.finish({keep:[]});}`],{stdio:'inherit'});
  const closeCode=await new Promise((resolve,reject)=>{close.on('error',reject);close.on('exit',code=>resolve(code??1));});
  if(closeCode!==0)process.exitCode=closeCode;
  await server.close();
}
