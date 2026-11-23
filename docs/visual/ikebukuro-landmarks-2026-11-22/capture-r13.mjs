// origin/main connector baseline, 2026-11-24 JST. Same runtime walk hook and devices as candidate.
{
const fs=await import('node:fs/promises');
const {spawn,execFileSync}=await import('node:child_process');
const work='/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const repo=work+'/node_modules/.cache/depato-main';
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
// Package A-I captures, 2026-11-24 JST. Run through job-run + tachi-run --heavy --host.
{
const fs=await import('node:fs/promises');
const {spawn,execFileSync}=await import('node:child_process');
const repo='/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const evidence=repo+'/docs/visual/ikebukuro-landmarks-2026-11-22',root=evidence+'/r13';
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const graph=JSON.parse(await fs.readFile(repo+'/stations/ikebukuro/gteki/graph.json','utf8'));
const walks=[];
await fs.mkdir(root,{recursive:true});
const previous=JSON.parse(await fs.readFile(evidence+'/r8/frames.json','utf8'));
const recent=JSON.parse(await fs.readFile(evidence+'/r11/frames.json','utf8'));
for(const frame of recent.frames){const i=previous.frames.findIndex(f=>f.file===frame.file);if(i>=0)previous.frames[i]=frame;}
const sourceRoad=JSON.parse(await fs.readFile(evidence+'/r10-sunshine-road-candidates.json','utf8'));
const server=spawn('nice',['-n','15','/Users/tachikoma/.local/share/fnm/aliases/default/bin/node',repo+'/apps/web/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5192','--strictPort'],{cwd:repo+'/apps/web',stdio:['ignore','pipe','inherit']});
try{
await new Promise((resolve,reject)=>{server.stdout.on('data',c=>{if(c.toString().includes('Local:'))resolve()});server.once('error',reject);server.once('exit',c=>reject(new Error('Capture server exited: '+c)))});
const entry=(await listTaskSpaces()).find(s=>s.id===50||s.name==='Ikebukuro Package A-I follow-up');
const task=entry?await taskSpace(entry.id):await taskSpace('Ikebukuro Package A-I follow-up'),page=task.page('p1'),frames=[];
console.log({taskSpaceId:task.spaceId,page:page.label});
const poses=Object.fromEntries(previous.frames.filter(f=>f.flag==='next').map(f=>[f.file.replace(/-next\.png$/,''),f.pose]));
for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 for(const flag of ['next','off']){
  await page.goto(`http://127.0.0.1:5192/?station=ikebukuro&qaTimeBand=morning${flag==='next'?'&next=1':''}`);
  await page.waitForFunction(()=>Boolean(window.__gteki?.scanProbe().explorer.stationScene),undefined,{timeout:60000});
  await page.evaluate(()=>window.__gteki.setView({node:'x38',headingDeg:90}));
  await page.waitForFunction(()=>Boolean(window.__gteki.scanProbe().explorer.scene.getObjectByName('street-context')),undefined,{timeout:60000});
  if(flag==='next')await page.waitForFunction(()=>Boolean(window.__gteki.scanProbe().explorer.scene.getObjectByName('landmark-sign:sunshine')),undefined,{timeout:60000});
  await page.evaluate(()=>{window.__gteki.setView({node:'x38',headingDeg:90});window.__gteki.simulate(2)});
  if(flag==='next'){
   const budget=await page.evaluate(()=>{
    const layer=window.__gteki.scanProbe().explorer.scene.getObjectByName('landmarks-next');
    return ['seibu','tobu','lumine','esola','parco','pparco','sunshine'].map(store=>{
     const objects=[layer.getObjectByName('ctx_bldg_landmark_'+store),layer.getObjectByName('landmark-sign:'+store)];
     return {store,draws:objects.reduce((sum,o)=>sum+(Array.isArray(o.material)?o.geometry.groups.length:1),0),textures:objects.flatMap(o=>(Array.isArray(o.material)?o.material:[o.material]).flatMap(m=>m.map?[{width:m.map.image.width,height:m.map.image.height}]:[]))};
    });
   });
   await fs.writeFile(root+'/budget-'+device+'.json',JSON.stringify({sourceSha,device,recordedAtUTC:new Date().toISOString(),sharedGroundDraws:1,stores:budget},null,2)+'\n');
  }
  await page.evaluate(async()=>{
   const e=window.__gteki.scanProbe().explorer,T=await import('/node_modules/three/build/three.module.js');window.__gteki.holdFrames(true);
   const style=document.createElement('style');style.textContent='#app > :not(.viewport), .gteki-labels {visibility:hidden!important}';document.head.append(style);
   const meshes=[];e.scene.traverse(o=>{let visible=true;for(let p=o;p;p=p.parent)visible&&=p.visible;if(o.isMesh&&visible&&!o.name.startsWith('landmark-sign:'))meshes.push(o)});
   window.__depato={e,T,meshes,pavement:[]};
  });
  for(const exit of ['x18','x22','x37','x38']){
   const edge=graph.edges.find(e=>e.mode==='stairs'&&(e.from===exit||e.to===exit));
   const start=edge.from===exit?edge.to:edge.from;
   const connector=await page.evaluate(id=>window.__gteki.scanProbe().explorer.connectorRoutePaths().get(id),edge.id);
   if(!connector)throw new Error('Missing runtime connector path: '+edge.id);
   const path=edge.from===exit?[...connector].reverse():connector;
   const placed=await page.evaluate(node=>{window.__gteki.setCamera(null);return window.__gteki.setView({node,headingDeg:0}).placed},start);
   const legs=[];
   for(const point of path)legs.push(await page.evaluate(p=>({...window.__gteki.walkPath([{x:p.x,y:p.z,z:-p.y}],{maxSeconds:20}),target:p,avatar:window.__gteki.avatar()}),point));
   for(const point of [...path].reverse())legs.push(await page.evaluate(p=>({...window.__gteki.walkPath([{x:p.x,y:p.z,z:-p.y}],{maxSeconds:20}),target:p,avatar:window.__gteki.avatar()}),point));
   const file=`${device}-${exit}-return-${flag}.png`;
   await page.screenshot({path:`${root}/${file}`});
   walks.push({file,sourceSha,device,flag,exit,edge:edge.id,pathSource:'runtime connectorRoutePaths (ENU)',path,placed,legs,done:placed&&legs.every(l=>l.done),capturedAtUTC:new Date().toISOString()});
   await fs.writeFile(root+'/walks.json',JSON.stringify({sourceSha,walks},null,2)+'\n');
   console.log(`${device} ${flag} ${exit}: done=${walks.at(-1).done}`);
  }
  await page.evaluate(()=>{window.__gteki.setView({node:'x38',headingDeg:90});window.__gteki.simulate(2)});
  for(const store of ['seibu','pparco','sunshine'])for(const kind of ['walk','look',...(store==='sunshine'?['east-exit']:[])]){
   const key=`${device}-${store}-${kind}`,old=previous.frames.find(f=>f.file===`${key}-next.png`);
   if(frames.some(f=>f.file===`${key}-${flag}.png`))continue;
   if(kind==='east-exit'){
    const follow=await page.evaluate(()=>{
     const placed=window.__gteki.setView({node:'x35',headingDeg:86}).placed;
     if(!placed)throw new Error('Cannot place cat at exit x35');
     window.__gteki.setCamera({pitch:0.42});
     window.__gteki.simulate(3);
     const {e,T}=window.__depato;
     return {eye:e.camera.position.toArray(),target:e.camera.position.clone().add(e.camera.getWorldDirection(new T.Vector3())).toArray(),fov:e.camera.fov,exit:'x35',captureOnly:false};
    });
    if(flag==='next')poses[key]={...poses[key],...follow};
   }
   const result=await page.evaluate(({store,kind,flag,pose,oldPose,sourceRoad})=>{
    const {e,T,meshes,pavement}=window.__depato;
    e.camera.position.fromArray(pose.eye);e.stationScene.update?.(0,0,e.camera);
    const layer=e.scene.getObjectByName('landmarks-next'),sign=layer?.getObjectByName('landmark-sign:'+store),mesh=layer?.getObjectByName('ctx_bldg_landmark_'+store);
    if(flag==='next'&&!sign)throw new Error('Landmark sign missing from capture: '+store);
    const aim=new T.Vector3(...(sign?sign.getWorldPosition(new T.Vector3()).toArray():pose.aim)),normal=new T.Vector3(...(pose?.normal??new T.Vector3(0,0,1).applyQuaternion(sign.quaternion).toArray()));
    const signWidth=sign?.geometry.parameters.width??pose.signWidth,signHeight=sign?.geometry.parameters.height??pose.signHeight,tangent=new T.Vector3(normal.z,0,-normal.x);
    const targets=[-.5,0,.5].flatMap(u=>[-.5,.5].map(v=>aim.clone().addScaledVector(tangent,signWidth*u).add(new T.Vector3(0,signHeight*v,0))));
    if(sign&&store==='sunshine'&&targets.some(p=>!new T.Raycaster(p.clone().addScaledVector(normal,1),normal.clone().negate(),0,1.2).intersectObject(mesh).length))throw new Error('Sunshine top-band sign is not fully backed by its facade');
    const clear=eye=>normal.dot(eye.clone().sub(aim).normalize())>=.25&&targets.every(target=>!new T.Raycaster(eye,target.clone().sub(eye).normalize(),0,eye.distanceTo(target)-.02).intersectObjects(meshes,false).length);
    let chosen=pose;
    if(!chosen&&kind==='walk'){
     let candidates;
     if(store==='sunshine')candidates=sourceRoad.points.map(c=>({point:new T.Vector3(...c.point),road:sourceRoad.sourceId,sourceSha256:sourceRoad.sourceSha256}));
     else{
      const desired=[25,45,60].map(d=>aim.clone().addScaledVector(normal,d));
      // A barycentric ctx_road_t01_01 sample clears Parco's neighbour; normal-only samples miss it.
      if(store==='parco')desired.push(new T.Vector3(93.536956,32.230625,-201.178255));
      candidates=pavement.flatMap(({triangle,road})=>[triangle.getMidpoint(new T.Vector3()),...desired.map(p=>triangle.closestPointToPoint(p,new T.Vector3()))].map(point=>({point,road})));
     }
     candidates=candidates.map(c=>({...c,horizontalSignDistanceM:Math.hypot(c.point.x-aim.x,c.point.z-aim.z)}));
     const inBand=candidates.filter(c=>c.horizontalSignDistanceM>=25&&c.horizontalSignDistanceM<=60).sort((a,b)=>b.horizontalSignDistanceM-a.horizontalSignDistanceM);
     let c=inBand.find(c=>clear(c.point.clone().add(new T.Vector3(0,1.6,0)))),distanceException;
     if(!c){
      if(store==='pparco'){
       const point=new T.Vector3(...oldPose.eye).add(new T.Vector3(0,-1.6,0));
       c={point,road:oldPose.road,horizontalSignDistanceM:Math.hypot(point.x-aim.x,point.z-aim.z)};
       if(!clear(new T.Vector3(...oldPose.eye)))throw new Error('Approved PPARCO pose no longer sees the full sign');
       distanceException='Approved 74.86 m pose: no public pavement point within 25–60 m faces the sign; nearest sampled front-facing point is 70.05 m (2026-11-22 JST).';
      }else{
       candidates.sort((a,b)=>a.horizontalSignDistanceM-b.horizontalSignDistanceM);
       c=candidates.find(c=>clear(c.point.clone().add(new T.Vector3(0,1.6,0))));
       if(!c)throw new Error('No clear public pavement pose: '+store);
       distanceException='Nearest clear sampled public-pavement pose; no qualifying full-sign pose within 25–60 m (approved rule, 2026-11-22 JST).';
      }
     }
     const eye=c.point.clone().add(new T.Vector3(0,1.6,0)),target=new T.Vector3(aim.x,eye.y+c.horizontalSignDistanceM*Math.tan(15*Math.PI/180),aim.z);
     chosen={eye:eye.toArray(),target:target.toArray(),fov:60,road:c.road,sourceSha256:c.sourceSha256,horizontalSignDistanceM:c.horizontalSignDistanceM,eyeHeightM:1.6,captureOnly:true,clearSign:true,...(distanceException?{distanceException}:{})};
    }else if(!chosen){
     // The inset Sunshine sign needs this adjacent public-road centroid to clear the foreground.
     const eye=kind==='east-exit'?new T.Vector3(144.95953369140625,32.85900014241536,2.7981765270233154):new T.Vector3(...oldPose.eye);
     if(!clear(eye))throw new Error('Retained look/east-exit eye no longer sees the full sign: '+store+'/'+kind);
     chosen={...oldPose,eye:eye.toArray(),target:aim.toArray(),fov:oldPose.fov,clearSign:true,...(kind==='east-exit'?{exitOffsetM:23.137466465736164}:{})};
    }
    Object.assign(chosen,{aim:aim.toArray(),normal:normal.toArray(),signWidth,signHeight});
    e.camera.position.fromArray(chosen.eye);e.camera.lookAt(new T.Vector3(...chosen.target));e.camera.fov=chosen.fov;e.camera.updateProjectionMatrix();e.camera.updateMatrixWorld(true);
    const corners=targets.map(p=>p.clone().project(e.camera));
    const scale=Math.max(...corners.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)]))/.85;
    if(kind!=='east-exit'&&scale>1){e.camera.fov=2*Math.atan(Math.tan(e.camera.fov*Math.PI/360)*scale)*180/Math.PI;e.camera.updateProjectionMatrix();}
    chosen.fov=e.camera.fov;
    const direction=e.camera.getWorldDirection(new T.Vector3());chosen.pitchDeg=Math.asin(direction.y)*180/Math.PI;
    e.render(0);e.stationScene.update?.(0,0,e.camera);e.render(0);
    const gl=e.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,rect=e.renderer.domElement.getBoundingClientRect(),pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0),avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
    const pixel=(x,y)=>{const k=(Math.floor(y)*w+Math.floor(x))*4;return lum(Array.from(pixels.slice(k,k+3)))};
    const sample=point=>{const p=point.clone().project(e.camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1||p.z>1)return null;return pixel(Math.min(w-1,(p.x+1)*w/2),Math.min(h-1,(p.y+1)*h/2))};
    let metrics={jaCapPx:0,letterContrast:null,facadeVsSky:null,projectedSignCorners:[]};
    if(sign){const img=sign.material.map.image,data=img.getContext('2d').getImageData(0,0,img.width,img.height).data,local=(u,v)=>new T.Vector3((u/img.width-.5)*signWidth,(.5-v/img.height)*signHeight,0).applyMatrix4(sign.matrixWorld);let minY=128,maxY=0,letters=[],band=[];
     for(let v=0;v<img.height;v+=2)for(let u=0;u<img.width;u+=2){const alpha=data[(v*img.width+u)*4+3];if(v<78&&alpha>240){minY=Math.min(minY,v);maxY=Math.max(maxY,v)}const value=sample(local(u,v));if(value===null)continue;if(alpha>240)letters.push(value);if(alpha<5)band.push(value)}
     const top=local(img.width/2,minY).project(e.camera),bottom=local(img.width/2,maxY).project(e.camera);
     metrics={jaCapPx:Math.hypot((top.x-bottom.x)*rect.width/2,(top.y-bottom.y)*rect.height/2),letterContrast:(avg(letters)+.05)/(avg(band)+.05),facadeVsSky:null,projectedSignCorners:[[0,0],[img.width,0],[img.width,img.height],[0,img.height]].map(([u,v])=>{const p=local(u,v).project(e.camera);return [(p.x+1)*rect.width/2,(1-p.y)*rect.height/2,p.z]})};
     if(kind==='look'){
      // Pair a visible upper-facade pixel with the nearest unobstructed sky pixel on its row.
      // Rays distinguish real facade/sky from foreground buildings and the sign itself.
      const p=mesh.geometry.attributes.position,idx=mesh.geometry.index,probes=[];
      for(let i=0;i<(idx?.count??p.count);i+=3){
       const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
       const n=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize(),point=vs[0].clone().add(vs[1]).add(vs[2]).multiplyScalar(1/3);
       if(Math.abs(n.y)>.2||point.y<aim.y-12)continue;
       const q=point.clone().project(e.camera);if(Math.abs(q.x)>.95||Math.abs(q.y)>.9)continue;
       probes.push({qx:q.x,qy:q.y,x:(q.x+1)*w/2,y:(q.y+1)*h/2});
      }
      window.__facadeMeasure={probes,next:0,probe:null,mesh,objects:[...meshes,sign],pixel,w,h,facade:[],sky:[],pairs:[],store};
     }
    }
    const street=window.__gteki.sceneInfo().street;
    const towerTop=store==='sunshine'?new T.Box3().setFromObject(mesh??e.scene.getObjectByName('street-context')).max.y:null;
    const topEdge=store==='sunshine'&&flag==='next'?(()=>{
     const box=new T.Box3().setFromObject(mesh);
     return [box.min.x,box.max.x].flatMap(x=>[box.min.z,box.max.z].map(z=>new T.Vector3(x,towerTop,z).project(e.camera).toArray()));
    })():null;
    return {pose:chosen,metrics,street,towerTop,topEdge,signDistanceM:e.camera.position.distanceTo(aim),actualAnchor:sign?.position.toArray()??null,landmarkCount:layer?.children.length??0,flag,store,kind,viewport:[innerWidth,innerHeight],capturedAtUTC:new Date().toISOString()};
   },{store,kind,flag,pose:poses[key],oldPose:old.pose,sourceRoad});
   if(flag==='next'&&kind==='look'){
    let measurement;
    do{
     measurement=await page.evaluate(()=>{
      const {T,e}=window.__depato,m=window.__facadeMeasure,ray=new T.Raycaster();let rays=0;
      // Bound ray work per call; a single facade row may need many sky probes.
      while(m.pairs.length<12&&(m.probe||m.next<m.probes.length)&&rays<8){
       if(!m.probe){
        const p=m.probes[m.next++];ray.setFromCamera(new T.Vector2(p.qx,p.qy),e.camera);rays++;
        if(ray.intersectObjects(m.objects,false)[0]?.object!==m.mesh)continue;
        m.probe={...p,offset:8,side:-1};
       }
       if(rays>=8)break;
       const p=m.probe,sx=p.x+p.offset*p.side;
       if(p.side===-1)p.side=1;else{p.side=-1;p.offset+=8;}
       if(sx>=0&&sx<m.w){
        ray.setFromCamera(new T.Vector2(sx/m.w*2-1,p.qy),e.camera);rays++;
        const hit=ray.intersectObjects(m.objects,false)[0];
        if(!hit||(hit.object.parent?.name==='street-backdrop'&&hit.object.geometry.type==='SphereGeometry')){
         m.facade.push(m.pixel(p.x,p.y));m.sky.push(m.pixel(sx,p.y));m.pairs.push({facade:[p.x,m.h-p.y],sky:[sx,m.h-p.y]});m.probe=null;
        }
       }
       if(m.probe&&p.offset>=m.w/2)m.probe=null;
      }
      const done=m.pairs.length>=12||(!m.probe&&m.next>=m.probes.length);
      if(!done)return {done:false};
      if(!m.pairs.length)throw new Error('No visible facade/adjacent sky measurement pair: '+m.store);
      const avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
      return {done:true,metrics:{facadeVsSky:avg(m.facade)/avg(m.sky),facadeMeanLuminance:avg(m.facade),skyMeanLuminance:avg(m.sky),facadeSkySamplePairs:m.pairs}};
     });
    }while(!measurement.done);
    Object.assign(result.metrics,measurement.metrics);
   }
   if(flag==='next')poses[key]=result.pose;
   const file=`${key}-${flag}.png`;await page.screenshot({path:`${root}/${file}`});frames.push({file,sourceSha,...result});await fs.writeFile(root+'/frames.json',JSON.stringify({recordedAt:'2026-11-24 JST',sourceSha,frames},null,2)+'\n');
   console.log(`${file}: pitch=${result.pose.pitchDeg.toFixed(2)}, horizontal=${result.pose.horizontalSignDistanceM}, contrast=${result.metrics.letterContrast}, facade/sky=${result.metrics.facadeVsSky}`);
  }
 }
}
console.log(`Captured ${frames.length} frames; source SHA ${sourceSha}; walk failures ${walks.filter(w=>!w.done).length}; timestamps labelled UTC in frames.json`);

}finally{server.kill();}
}
