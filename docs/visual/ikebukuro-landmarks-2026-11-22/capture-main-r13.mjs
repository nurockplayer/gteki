// origin/main connector baseline, 2026-11-24 JST. Same runtime walk hook and devices as candidate.
{
const fs=await import('node:fs/promises');
const {spawn,execFileSync}=await import('node:child_process');
const work='/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const repo=work+'/.cache/depato-main';
const root=work+'/docs/visual/ikebukuro-landmarks-2026-11-22/r13-main';
const sourceSha=execFileSync('git',['rev-parse','origin/main'],{cwd:work,encoding:'utf8'}).trim();
const graph=JSON.parse(await fs.readFile(repo+'/stations/ikebukuro/gteki/graph.json','utf8')),walks=[];
await fs.mkdir(root,{recursive:true});
const server=spawn('nice',['-n','15','/Users/tachikoma/.local/share/fnm/aliases/default/bin/node',repo+'/apps/web/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5193','--strictPort'],{cwd:repo+'/apps/web',env:{...process.env,GITHUB_SHA:sourceSha},stdio:['ignore','pipe','inherit']});
try{
await new Promise((resolve,reject)=>{server.stdout.on('data',c=>{if(c.toString().includes('Local:'))resolve()});server.once('error',reject);server.once('exit',c=>reject(new Error('Main baseline server exited: '+c)))});
const entry=(await listTaskSpaces()).find(s=>s.id===50||s.name==='Ikebukuro Package A-I follow-up');
const task=entry?await taskSpace(entry.id):await taskSpace('Ikebukuro Package A-I follow-up'),page=task.page('p1');
console.log({taskSpaceId:task.spaceId,page:page.label,sourceSha,baseline:'origin/main'});
for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 await page.goto('http://127.0.0.1:5193/?station=ikebukuro&qaTimeBand=morning');
 await page.waitForFunction(()=>Boolean(window.__gteki?.scanProbe().explorer.stationScene),undefined,{timeout:60000});
 await page.evaluate(()=>window.__gteki.setView({node:'x38',headingDeg:90}));
 await page.waitForFunction(()=>Boolean(window.__gteki.scanProbe().explorer.scene.getObjectByName('street-context')),undefined,{timeout:60000});
 await page.evaluate(()=>{window.__gteki.holdFrames(true);window.__gteki.simulate(2)});
 for(const exit of ['x18','x22']){
  const edge=graph.edges.find(e=>e.mode==='stairs'&&(e.from===exit||e.to===exit)),start=edge.from===exit?edge.to:edge.from;
  const connector=await page.evaluate(id=>window.__gteki.scanProbe().explorer.connectorRoutePaths().get(id),edge.id);
  if(!connector)throw new Error('Missing main runtime connector: '+edge.id);
  const path=edge.from===exit?[...connector].reverse():connector;
  const placed=await page.evaluate(node=>{window.__gteki.setCamera(null);return window.__gteki.setView({node,headingDeg:0}).placed},start),legs=[];
  const pose=await page.evaluate(()=>({avatar:window.__gteki.avatar(),camera:window.__gteki.scanProbe().explorer.camera.position.toArray(),cameraInfo:window.__gteki.scanProbe().explorer.cameraInfo()}));
  for(const point of path)legs.push(await page.evaluate(p=>({...window.__gteki.walkPath([{x:p.x,y:p.z,z:-p.y}],{maxSeconds:20}),target:p,avatar:window.__gteki.avatar()}),point));
  for(const point of [...path].reverse())legs.push(await page.evaluate(p=>({...window.__gteki.walkPath([{x:p.x,y:p.z,z:-p.y}],{maxSeconds:20}),target:p,avatar:window.__gteki.avatar()}),point));
  const file=`${device}-${exit}-return-main-off.png`;await page.screenshot({path:root+'/'+file});
  walks.push({file,sourceSha,baseline:'origin/main',device,flag:'off',exit,edge:edge.id,pathSource:'runtime connectorRoutePaths (ENU)',path,placed,pose,legs,done:placed&&legs.every(l=>l.done),capturedAtUTC:new Date().toISOString()});
  await fs.writeFile(root+'/walks.json',JSON.stringify({sourceSha,walks},null,2)+'\n');
  console.log(`${device} main off ${exit}: done=${walks.at(-1).done}`);
 }
}
}finally{server.kill();}
}
