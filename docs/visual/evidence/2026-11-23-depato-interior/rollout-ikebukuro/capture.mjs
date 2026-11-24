// 2026-11-23 JST. Launch through job-run + tachi-run --heavy --host.
import { createServer } from '../../../../../apps/web/node_modules/vite/dist/node/index.js';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const runtimeHead=execFileSync('rtk',['git','-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const adR3=process.argv[2]==='ad-r3';
process.chdir(repo+'apps/web');
const server=await createServer({server:{host:'127.0.0.1',port:5291,strictPort:true}});
try{
  await server.listen();
  const run=spawn('ego-browser',['nodejs'],{stdio:['pipe','inherit','inherit']});
  run.stdin.end(`const runtimeHead=${JSON.stringify(runtimeHead)}, worktree=${JSON.stringify(repo)};\n`
    +readFileSync(new URL(adR3?'./ad-r3.mjs':'./walk.mjs',import.meta.url),'utf8'));
  process.exitCode=await new Promise((resolve,reject)=>{run.on('error',reject);run.on('exit',code=>resolve(code??1));});
  if(process.exitCode===0){
    const base=new URL('./',import.meta.url),receipt=JSON.parse(readFileSync(new URL('receipt.json',base),'utf8'));
    const blackPixelPct=png=>{
      let black=0;for(let i=0;i<png.data.length;i+=4)if(Math.max(png.data[i],png.data[i+1],png.data[i+2])<=16)black++;
      return 100*black/(png.width*png.height);
    };
    const blackPixels=[];
    for(const profile of receipt.profiles){
      const frames=profile.frames.filter(f=>adR3?f.sourceHead===runtimeHead:f.name==='street-door-inside');
      for(const frame of frames){
        const png=PNG.sync.read(readFileSync(new URL(frame.file,base)));
        if(png.width!==profile.device.width || png.height!==profile.device.height)
          receipt.failures.push(`${frame.file}: expected ${profile.device.width}×${profile.device.height}, got ${png.width}×${png.height}`);
        if(frame.name!=='street-door-inside' && frame.name!=='flag-off' && frame.name!=='B1-tie-skipped')continue;
        frame.blackPixelPct=blackPixelPct(png);
        blackPixels.push({file:frame.file,pct:frame.blackPixelPct});
        if(frame.name==='street-door-inside' && frame.blackPixelPct>0.1)
          receipt.failures.push(`${frame.file}: black pixels ${frame.blackPixelPct}% > 0.1%`);
      }
      if(adR3 && profile.store==='tobu-ikebukuro'){
        const on=frames.find(f=>f.name==='B1-tie-skipped'),off=frames.find(f=>f.name==='flag-off');
        if(Math.abs(on.blackPixelPct-off.blackPixelPct)>0.5)
          receipt.failures.push(`${profile.device.name} Tobu B1: ${on.blackPixelPct}% vs flag-off ${off.blackPixelPct}% black exceeds 0.5 points`);
      }
    }
    writeFileSync(new URL('receipt.json',base),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({blackPixels,failures:receipt.failures}));
    if(receipt.failures.length)process.exitCode=1;
  }
}finally{
  // The capture can fail before writing its receipt, so look up its task space by name.
  const close=spawn('ego-browser',['nodejs','-e',`const space=(await listTaskSpaces()).find(s=>s.name==='depato-rollout-ikebukuro'); if(space){const task=await taskSpace(space.id); await task.finish({keep:[]});}`],{stdio:'inherit'});
  const closeCode=await new Promise((resolve,reject)=>{close.on('error',reject);close.on('exit',code=>resolve(code??1));});
  if(closeCode!==0)process.exitCode=closeCode;
  await server.close();
}
