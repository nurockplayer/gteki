// 2026-11-24 JST. Run under job-run + tachi-run --heavy --host, after pnpm install --frozen-lockfile.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../../..');
const base = '/tmp/gteki-depato-kit-1534';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const { createServer } = await import(path.join(repo, 'apps/web/node_modules/vite/dist/node/index.js'));
const original = await readFile(path.join(repo, 'docs/visual/evidence/2026-11-23-depato-interior/walk.mjs'), 'utf8');
const budget = `(()=>{
  let triangles=0,draws=0;
  root?.traverseVisible(o=>{
    if(!o.isMesh)return;
    const count=o.isInstancedMesh?o.count:1;
    triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3*count;
    draws+=Array.isArray(o.material)?o.material.length:1;
  });
  return {triangles,draws,atlasPx:root?.userData.depato.atlasPx};
})()`;
const probe = () => {
  const g=window.__gteki,e=g.scanProbe().explorer,root=e.scene.getObjectByName('depato-interior:seibu-ikebukuro');
  if(!root)return {slabHidesUpperRibbon:true,reason:'flag-off; no preview upper floor'};
  const nodes=e.station.bundle.nodes;
  const ids=['depato-seibu-ikebukuro-1F-aisle','depato-seibu-ikebukuro-1F-bypass'];
  const route=ids.map(id=>{const n=nodes.find(n=>n.id===id);return {...n.position,floorId:n.floorId,zKnown:true,stepIndex:0,sceneGap:true};});
  // Actual authored upper aisle edge, with the approximate-guide material reported by the AD.
  e.showRoute(route);
  g.goldenFrame();g.goldenFrame();g.goldenFrame();
  const bands=[];e.routeGroup.traverse(o=>{if(o.name==='route-no-model')bands.push(o);});
  const slab=[root.getObjectByName('retail-floor-1F'),root.getObjectByName('retail-shell-B1')];
  e.scene.updateMatrixWorld(true);
  const fromBelow=e.camera.position.y<route[0].z, samples=[];
  for(let i=0;i<=32;i++){
    const t=i/32,p=e.camera.position.clone().set(route[0].x,route[0].z+0.15,-(route[0].y+(route[1].y-route[0].y)*t));
    const screen=p.clone().project(e.camera),delta=p.clone().sub(e.camera.position),distance=delta.length();
    const inFrame=Math.abs(screen.x)<=1&&Math.abs(screen.y)<=1&&Math.abs(screen.z)<=1;
    e.ray.near=0;e.ray.far=distance-0.01;e.ray.set(e.camera.position,delta.normalize());
    const hits=e.ray.intersectObjects(slab,false);
    samples.push({inFrame,occluded:hits.length>0,occluder:hits[0]?.object.name,pixel:[(screen.x+1)*innerWidth/2,(1-screen.y)*innerHeight/2]});
  }
  const depthTest=bands.length>0&&bands.every(b=>b.material.depthTest);
  const leaks=fromBelow?samples.filter(s=>s.inFrame&&!s.occluded).length:0;
  return {slabHidesUpperRibbon:depthTest&&leaks===0,fromBelow,depthTest,leaks,route,samples};
};
const probeCapture = `const slabProbe=await page.evaluate(${probe.toString()});
  if(slabProbe.route){await page.screenshot({path:base+'/frames/'+profile+'-'+name+'-upper-guide.png'});await page.evaluate(()=>{const g=window.__gteki;g.scanProbe().explorer.clearRoute();g.goldenFrame();});}
  `;
const driver = original
  .replaceAll('/tmp/gteki-depato-1539-ad', base)
  .replaceAll('depato-interior-1534', 'depato-kit-1534')
  .replaceAll('127.0.0.1:5286', '127.0.0.1:5294')
  .replace('depato:root?.userData.depato,', `kitBudget:${budget},depato:root?.userData.depato,`)
  .replace('await page.evaluate(()=>window.__gteki.holdFrames(false));if(info.shaderErrors.length)', probeCapture+'await page.evaluate(()=>window.__gteki.holdFrames(false));if(info.shaderErrors.length)')
  .replace('return {name,...info};','return {name,...info,slabProbe};');
await mkdir(base, { recursive: true });
await writeFile(base + '/walk.mjs', driver);
process.chdir(path.join(repo, 'apps/web'));
const server = await createServer({ server: { host: '127.0.0.1', port: 5294, strictPort: true } });
try {
  await server.listen();
  const code = await new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', resolve);
    child.stdin.end(driver);
  });
  const receipt = JSON.parse(await readFile(base + '/acceptance.json', 'utf8'));
  receipt.sourceSha = sourceSha;
  receipt.timeZone = 'UTC';
  for (const profile of receipt.profiles) {
    for (const frame of profile.frames) {
      frame.sourceSha = sourceSha;
      frame.file = `${profile.device.name}-${frame.name}.png`;
      await copyFile(base + '/frames/' + frame.file, path.join(out, frame.file));
      if(frame.slabProbe.route){
        frame.slabProbe.file=`${profile.device.name}-${frame.name}-upper-guide.png`;
        await copyFile(base+'/frames/'+frame.slabProbe.file,path.join(out,frame.slabProbe.file));
      }
      if(!frame.slabProbe.slabHidesUpperRibbon)receipt.failures.push(`${frame.file}: upper guide leaks through slab`);
      if (profile.device.name === 'phone' && frame.name !== 'flag-off') {
        const b = frame.kitBudget;
        if (b.triangles > 60000 || b.draws > 30 || b.atlasPx > 1024)
          receipt.failures.push(`phone ${frame.name}: kit budget ${JSON.stringify(b)}`);
      }
    }
  }
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ sourceSha, frames: receipt.profiles.reduce((n,p)=>n+p.frames.length,0), failures: receipt.failures }));
  process.exitCode = code || (receipt.failures.length ? 1 : 0);
} finally {
  await server.close();
  const cleanup = `const entry=(await listTaskSpaces()).find(s=>s.name==='depato-kit-1534');if(entry&&entry.ownership!=='user'&&entry.ownership!=='agentDelegatedToUser'){const task=await taskSpace(entry.id);await task.finish({keep:[]});}`;
  await new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject); child.once('exit', resolve); child.stdin.end(cleanup);
  });
}
