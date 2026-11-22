// r8 art-direction correction, 2026-11-22 JST. Run through job-run; timestamps are UTC.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const repo='/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const evidence=repo+'/docs/visual/ikebukuro-landmarks-2026-11-22',root=evidence+'/r8';
await fs.mkdir(root,{recursive:true});
const previous=JSON.parse(await fs.readFile(evidence+'/r6/frames.json','utf8'));
const sourceRoad=JSON.parse(await fs.readFile(evidence+'/r8-road-candidates.json','utf8'));
const server=spawn('nice',['-n','15','node',repo+'/apps/web/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5192','--strictPort'],{cwd:repo+'/apps/web',stdio:['ignore','pipe','inherit']});
process.once('exit',()=>server.kill());
await new Promise((resolve,reject)=>{server.stdout.on('data',c=>{if(c.toString().includes('Local:'))resolve()});server.once('error',reject);server.once('exit',c=>reject(new Error('Capture server exited: '+c)))});
const task=await taskSpace(44),page=task.page('p1'),frames=JSON.parse(await fs.readFile(root+'/frames.json','utf8')).frames;
const poses=Object.fromEntries(frames.filter(f=>f.flag==='next').map(f=>[f.file.replace(/-next\.png$/,''),f.pose]));
for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
 for(const flag of ['next','off']){
  await page.goto(`http://127.0.0.1:5192/?station=ikebukuro&qaTimeBand=morning${flag==='next'?'&next=1':''}`);
  await page.waitForFunction(()=>Boolean(window.__gteki?.scanProbe().explorer.stationScene),undefined,{timeout:60000});
  await page.evaluate(()=>window.__gteki.setView({node:'x38',headingDeg:90}));
  await page.waitForFunction(()=>Boolean(window.__gteki.scanProbe().explorer.scene.getObjectByName('street-context')),undefined,{timeout:60000});
  await page.evaluate(async()=>{
   const e=window.__gteki.scanProbe().explorer,T=await import('/node_modules/.vite/deps/three.js');window.__gteki.holdFrames(true);
   const style=document.createElement('style');style.textContent='#app > :not(.viewport), .gteki-labels {visibility:hidden!important}';document.head.append(style);
   const meshes=[],roads=[];e.scene.traverse(o=>{let visible=true;for(let p=o;p;p=p.parent)visible&&=p.visible;if(o.isMesh&&visible&&!o.name.startsWith('landmark-sign:'))meshes.push(o);if(o.isMesh&&o.name.startsWith('ctx_road_'))roads.push(o)});
   const pavement=[];
   for(const m of roads){const p=m.geometry.attributes.position,idx=m.geometry.index;
    for(let i=0;i<(idx?.count??p.count);i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(m.matrixWorld));
     if(Math.abs(v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize().y)>.9)pavement.push({triangle:new T.Triangle(...v),road:m.name});
    }
   }
   window.__depato={e,T,meshes,roads,pavement};
  });
  for(const store of ['seibu','tobu','lumine','esola','parco','pparco','sunshine'])for(const kind of ['walk','look',...(store==='sunshine'?['east-exit']:[])]){
   const key=`${device}-${store}-${kind}`,old=previous.frames.find(f=>f.file===`${key}-next.png`);
   if(frames.some(f=>f.file===`${key}-${flag}.png`))continue;
   const result=await page.evaluate(({store,kind,flag,pose,oldPose,sourceRoad})=>{
    const {e,T,meshes,pavement}=window.__depato,layer=e.scene.getObjectByName('landmarks-next'),sign=layer?.getObjectByName('landmark-sign:'+store),mesh=layer?.getObjectByName('ctx_bldg_landmark_'+store);
    const aim=new T.Vector3(...(pose?.aim??sign.getWorldPosition(new T.Vector3()).toArray())),normal=new T.Vector3(...(pose?.normal??new T.Vector3(0,0,1).applyQuaternion(sign.quaternion).toArray()));
    const signWidth=pose?.signWidth??sign.geometry.parameters.width,signHeight=pose?.signHeight??sign.geometry.parameters.height,tangent=new T.Vector3(normal.z,0,-normal.x);
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
     candidates=candidates.map(c=>({...c,horizontalSignDistanceM:Math.hypot(c.point.x-aim.x,c.point.z-aim.z)})).filter(c=>c.horizontalSignDistanceM>=25&&c.horizontalSignDistanceM<=60);
     candidates.sort((a,b)=>b.horizontalSignDistanceM-a.horizontalSignDistanceM);
     const c=candidates.find(c=>clear(c.point.clone().add(new T.Vector3(0,1.6,0))));
     if(!c)throw new Error('No full-sign public pavement pose at 25–60 m: '+store);
     const eye=c.point.clone().add(new T.Vector3(0,1.6,0)),target=new T.Vector3(aim.x,eye.y+c.horizontalSignDistanceM*Math.tan(15*Math.PI/180),aim.z);
     chosen={eye:eye.toArray(),target:target.toArray(),fov:60,road:c.road,sourceSha256:c.sourceSha256,horizontalSignDistanceM:c.horizontalSignDistanceM,eyeHeightM:1.6,captureOnly:true,clearSign:true};
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
    if(scale>1){e.camera.fov=2*Math.atan(Math.tan(e.camera.fov*Math.PI/360)*scale)*180/Math.PI;e.camera.updateProjectionMatrix();}
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
      const p=mesh.geometry.attributes.position,idx=mesh.geometry.index,facade=[],sky=[],pairs=[];
      for(let i=0;i<(idx?.count??p.count)&&pairs.length<12;i+=3){
       const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
       const n=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize(),point=vs[0].clone().add(vs[1]).add(vs[2]).multiplyScalar(1/3);
       if(Math.abs(n.y)>.2||point.y<aim.y-12)continue;
       const q=point.clone().project(e.camera);if(Math.abs(q.x)>.95||Math.abs(q.y)>.9)continue;
       const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(q.x,q.y),e.camera);const first=ray.intersectObjects([...meshes,sign],false)[0];
       if(first?.object!==mesh)continue;
       const x=(q.x+1)*w/2,y=(q.y+1)*h/2;
       let found;
       for(let offset=8;offset<w/2&&!found;offset+=8)for(const side of [-1,1]){
        const sx=x+offset*side;if(sx<0||sx>=w)continue;
        ray.setFromCamera(new T.Vector2(sx/w*2-1,q.y),e.camera);
        const hit=ray.intersectObjects([...meshes,sign],false)[0];
        if(!hit||(hit.object.parent?.name==='street-backdrop'&&hit.object.geometry.type==='SphereGeometry')){found={x:sx,y};break;}
       }
       if(found){facade.push(pixel(x,y));sky.push(pixel(found.x,found.y));pairs.push({facade:[x,h-y],sky:[found.x,h-y]});}
      }
      if(!pairs.length)throw new Error('No visible facade/adjacent sky measurement pair: '+store);
      metrics.facadeVsSky=avg(facade)/avg(sky);metrics.facadeMeanLuminance=avg(facade);metrics.skyMeanLuminance=avg(sky);metrics.facadeSkySamplePairs=pairs;
     }
    }
    return {pose:chosen,metrics,signDistanceM:e.camera.position.distanceTo(aim),actualAnchor:sign?.position.toArray()??null,landmarkCount:layer?.children.length??0,flag,store,kind,viewport:[innerWidth,innerHeight],capturedAtUTC:new Date().toISOString()};
   },{store,kind,flag,pose:flag==='off'?poses[key]:null,oldPose:old.pose,sourceRoad});
   if(flag==='next')poses[key]=result.pose;
   const file=`${key}-${flag}.png`;await page.screenshot({path:`${root}/${file}`});frames.push({file,...result});await fs.writeFile(root+'/frames.json',JSON.stringify({recordedAt:'2026-11-22 JST',frames},null,2)+'\n');
   console.log(`${file}: pitch=${result.pose.pitchDeg.toFixed(2)}, horizontal=${result.pose.horizontalSignDistanceM}, contrast=${result.metrics.letterContrast}, facade/sky=${result.metrics.facadeVsSky}`);
  }
 }
}
console.log(`Captured ${frames.length} frames; timestamps labelled UTC in frames.json`);
server.kill();
