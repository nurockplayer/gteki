// Ego-browser stdin script, run through job-run. Capture timestamps are ISO UTC.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const repo='/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const root=repo+'/docs/visual/ikebukuro-landmarks-2026-11-22/r5';
await fs.mkdir(root,{recursive:true});
const server=spawn('node',[repo+'/apps/web/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5192','--strictPort'],{cwd:repo+'/apps/web',stdio:['ignore','pipe','inherit']});
process.once('exit',()=>server.kill());
await new Promise((resolve,reject)=>{server.stdout.on('data',c=>{if(c.toString().includes('Local:'))resolve()});server.once('error',reject);server.once('exit',c=>reject(new Error('Capture server exited: '+c)))});
const task=await taskSpace(33),page=task.page('p1'),reference=task.page('p2');
await reference.goto('http://127.0.0.1:5192/?station=shinjuku&next=1&qaTimeBand=morning');
await reference.waitForFunction(()=>Boolean(window.__gteki?.scanProbe().explorer.station?.key==='shinjuku'&&window.__gteki.scanProbe().explorer.stationScene),undefined,{timeout:60000});
const referenceInfo=await reference.evaluate(async()=>{
 const e=window.__gteki.scanProbe().explorer,T=await import('/node_modules/.vite/deps/three.js');window.__gteki.holdFrames(true);
 const poi=e.station.bundle.pois.find(p=>p.id==='poi:exit:1'),node=e.station.bundle.nodes.find(n=>n.id===poi.connectorNodeIds[0]);
 const point=new T.Vector3(node.position.x,node.renderZ??0,-node.position.y);
 const signs=e.minimapSigns.slice().sort((a,b)=>a.face.centre.distanceTo(point)-b.face.centre.distanceTo(point)),s=signs[0],p=s.mesh.geometry.attributes.position,uv=s.mesh.geometry.attributes.uv;
 const first=Array.from({length:p.count},(_,i)=>i).find(i=>new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(s.mesh.matrixWorld).distanceTo(s.corners[0])<.001);
 const w=s.corners[0].distanceTo(s.corners[1]),h=s.corners[0].distanceTo(s.corners[2]);
 const geo=new T.PlaneGeometry(w,h);for(let i=0;i<4;i++)geo.attributes.uv.setXY(i,uv.getX(first+i),uv.getY(first+i));
 const calibration=new T.Mesh(geo,s.mesh.material);calibration.position.set(0,34,0);calibration.frustumCulled=false;
 const hidden=e.scene.children.map(o=>[o,o.visible]);for(const [o] of hidden)o.visible=false;e.scene.add(calibration);
 window.__depatoReference={e,T,calibration,w,h};
 return {station:'shinjuku',poi:poi.id,node:node.id,sourceMesh:s.mesh.name,sourceFaceCentre:s.face.centre.toArray(),widthM:w,heightM:h,method:'Actual exit-1-nearest wayfinding face, rendered alone at the store-sign distance. Calibration FOV magnifies the small reference face for resolved pixel luminance; construction and material are unchanged.'};
});
const frames=[],poses={};
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
   for(const m of e.walkable){const p=m.geometry?.attributes.position,idx=m.geometry?.index;if(!p)continue;
    for(let i=0;i<(idx?.count??p.count);i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+j):i+j).applyMatrix4(m.matrixWorld));
     if(Math.max(...v.map(p=>p.y))>34.5||Math.min(...v.map(p=>p.y))<31.2||Math.abs(v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize().y)<.99)continue;
     const point=v[0].add(v[1]).add(v[2]).multiplyScalar(1/3),road=new T.Raycaster(new T.Vector3(point.x,60,point.z),new T.Vector3(0,-1,0),0,40).intersectObjects(roads,false)[0];
     if(!road||Math.abs(road.point.y-point.y)>1)continue;
     if(new T.Raycaster(point.clone().add(new T.Vector3(0,.4,0)),new T.Vector3(0,1,0),0,5).intersectObjects(meshes,false).length)continue;
     pavement.push(point);
    }
   }
   window.__depato={e,T,meshes,roads,pavement};
  });
  for(const store of ['seibu','tobu','lumine','esola','parco','pparco','sunshine'])for(const kind of ['walk','look',...(store==='sunshine'?['east-exit']:[])]){
   const key=`${device}-${store}-${kind}`;
   const result=await page.evaluate(({store,kind,flag,pose})=>{
    const {e,T,meshes,roads,pavement}=window.__depato,layer=e.scene.getObjectByName('landmarks-next'),sign=layer?.getObjectByName('landmark-sign:'+store),mesh=layer?.getObjectByName('ctx_bldg_landmark_'+store);
    const aim=new T.Vector3(...(pose?.aim??sign.getWorldPosition(new T.Vector3()).toArray())),normal=new T.Vector3(...(pose?.normal??new T.Vector3(0,0,1).applyQuaternion(sign.quaternion).toArray()));
    const signWidth=pose?.signWidth??sign.geometry.parameters.width,signHeight=pose?.signHeight??sign.geometry.parameters.height,tangent=new T.Vector3(normal.z,0,-normal.x);
    const clear=eye=>[-.5,0,.5].every(u=>[-.5,.5].every(v=>{const target=aim.clone().addScaledVector(tangent,signWidth*u);target.y+=signHeight*v;return !new T.Raycaster(eye,target.clone().sub(eye).normalize(),0,eye.distanceTo(target)-.02).intersectObjects(meshes,false).length}));
    const frameTarget=(eye,distance)=>{const top=Math.atan2(aim.y+signHeight/2-eye.y,distance),bottom=Math.atan2(32.5-eye.y,distance),target=aim.clone();target.y=eye.y+distance*Math.tan((top+bottom)/2);return {target,fov:Math.max(45,(top-bottom)*180/Math.PI+10)}};
    let chosen=pose;
    if(!chosen&&kind==='look'){
     const candidates=[];
     for(const distance of [80,100,120,150,60])for(const angle of [0,-.3,.3,-.6,.6,-.9,.9,-1.2,1.2]){
      const eye=aim.clone().addScaledVector(normal.clone().applyAxisAngle(new T.Vector3(0,1,0),angle),distance);eye.y=60;
      const road=new T.Raycaster(eye,new T.Vector3(0,-1,0),0,40).intersectObjects(roads,false)[0];if(!road)continue;eye.y=road.point.y+1.6;
      if(clear(eye))candidates.push({eye,distance,road:road.object.name});
     }
     if(!candidates.length)throw new Error('No clear public-road look camera: '+store);
     const c=candidates[0],f=frameTarget(c.eye,c.distance);chosen={eye:c.eye.toArray(),target:f.target.toArray(),fov:f.fov,facadeDistanceM:c.distance,road:c.road,clearSign:true,eyeHeightM:1.6};
    }else if(!chosen){
     let candidates=pavement.map(p=>({point:p,distance:Math.hypot(p.x-aim.x,p.z-aim.z),clear:clear(p.clone().add(new T.Vector3(0,1.6,0)))}));
     if(kind==='east-exit'){const n=e.station.bundle.nodes.find(n=>n.id==='x35');candidates=[{point:new T.Vector3(n.position.x,n.position.z,-n.position.y),clear:false}];}
     const box=new T.Box3().setFromObject(mesh);candidates.sort((a,b)=>box.distanceToPoint(new T.Vector3(a.point.x,box.min.y,a.point.z))-box.distanceToPoint(new T.Vector3(b.point.x,box.min.y,b.point.z))||a.distance-b.distance);
     const c=candidates[0];if(!c)throw new Error('No modeled walkable public pavement: '+store);
     const heading=-Math.atan2(c.point.x-aim.x,c.point.z-aim.z)*180/Math.PI;
     if(!e.walkFrom({x:c.point.x,y:-c.point.z,z:c.point.y},heading))throw new Error('walkFrom failed: '+store);
     const f=frameTarget(e.pos.clone().add(new T.Vector3(0,1.6,0)),Math.hypot(e.pos.x-aim.x,e.pos.z-aim.z));
     e.setCamera({yaw:Math.atan2(e.pos.x-aim.x,e.pos.z-aim.z),pitch:-Math.atan2(f.target.y-e.pos.y-1.6,Math.hypot(e.pos.x-aim.x,e.pos.z-aim.z)),distance:2.25});e.goldenFrame();
     const eye=e.camera.position.clone();chosen={eye:eye.toArray(),target:f.target.toArray(),fov:Math.max(55,f.fov),avatar:e.pos.toArray(),clearSign:clear(eye),sampledPavementCount:pavement.length,clearPavementCount:candidates.filter(c=>c.clear).length,unseenReason:clear(eye)?null:'No full-sign sightline at the nearest modeled public-pavement point; limited station walkable coverage is retained.'};
    }
    Object.assign(chosen,{aim:aim.toArray(),normal:normal.toArray(),signWidth,signHeight});
    if(chosen.avatar){e.walkFrom({x:chosen.avatar[0],y:-chosen.avatar[2],z:chosen.avatar[1]},0);e.goldenFrame();}
    e.camera.position.fromArray(chosen.eye);e.camera.fov=chosen.fov;e.camera.lookAt(new T.Vector3(...chosen.target));e.camera.updateProjectionMatrix();e.camera.updateMatrixWorld(true);e.stationScene.update?.(0,0,e.camera);
    const draws={},callbacks=[];if(layer)for(const o of layer.children){const old=o.onBeforeRender;callbacks.push([o,old]);o.onBeforeRender=function(...args){draws[o.name]=(draws[o.name]??0)+1;old.apply(this,args)}}
    e.render(0);for(const [o,old]of callbacks)o.onBeforeRender=old;
    const gl=e.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,rect=e.renderer.domElement.getBoundingClientRect(),pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0),avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
    const sample=point=>{const p=point.clone().project(e.camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1||p.z>1)return null;const x=Math.min(w-1,Math.floor((p.x+1)*w/2)),y=Math.min(h-1,Math.floor((p.y+1)*h/2)),k=(y*w+x)*4;return lum(Array.from(pixels.slice(k,k+3)))};
    let metrics={jaCapPx:0,projectedJaCapPx:0,letterContrast:null,signMeanLuminance:null,projectedSignCorners:[]};
    if(sign){const img=sign.material.map.image,data=img.getContext('2d').getImageData(0,0,img.width,img.height).data,local=(u,v)=>new T.Vector3((u/img.width-.5)*signWidth,(.5-v/img.height)*signHeight,0).applyMatrix4(sign.matrixWorld);let minY=128,maxY=0,letters=[],band=[],all=[];
     for(let v=0;v<img.height;v+=2)for(let u=0;u<img.width;u+=2){const alpha=data[(v*img.width+u)*4+3];if(v<78&&alpha>240){minY=Math.min(minY,v);maxY=Math.max(maxY,v)}const value=sample(local(u,v));if(value===null)continue;all.push(value);if(alpha>240)letters.push(value);if(alpha<5)band.push(value)}
     const top=local(img.width/2,minY).project(e.camera),bottom=local(img.width/2,maxY).project(e.camera),cap=Math.hypot((top.x-bottom.x)*rect.width/2,(top.y-bottom.y)*rect.height/2);
     metrics={jaCapPx:chosen.clearSign?cap:0,projectedJaCapPx:cap,letterContrast:chosen.clearSign&&letters.length&&band.length?(avg(letters)+.05)/(avg(band)+.05):null,signMeanLuminance:chosen.clearSign?avg(all):null,projectedSignCorners:[[0,0],[img.width,0],[img.width,img.height],[0,img.height]].map(([u,v])=>{const p=local(u,v).project(e.camera);return [(p.x+1)*rect.width/2,(1-p.y)*rect.height/2,p.z]})};
    }
    const wayfinding=e.minimapSigns.map(s=>({s,distance:s.face.centre.distanceTo(e.camera.position)})).sort((a,b)=>a.distance-b.distance).map(({s,distance})=>{if(s.corners.some(c=>sample(c)===null))return null;const centre=s.face.centre;if(new T.Raycaster(e.camera.position,centre.clone().sub(e.camera.position).normalize(),0,distance-.05).intersectObjects(meshes.filter(m=>m!==s.mesh),false).length)return null;const values=[];for(let u=.1;u<1;u+=.1)for(let v=.1;v<1;v+=.1){const p=s.corners[0].clone().lerp(s.corners[1],u).lerp(s.corners[2].clone().lerp(s.corners[3],u),v),value=sample(p);if(value!==null)values.push(value)}return {mesh:s.mesh.name,centre:centre.toArray(),distanceM:distance,meanLuminance:avg(values)}}).find(Boolean)??null;
    return {pose:chosen,metrics,draws,wayfinding,signDistanceM:e.camera.position.distanceTo(aim),actualAnchor:sign?.position.toArray()??null,flag,store,kind,viewport:[innerWidth,innerHeight],shellHidden:true,capturedAtUTC:new Date().toISOString()};
   },{store,kind,flag,pose:flag==='off'?poses[key]:null});
   if(flag==='next')poses[key]=result.pose;
   if(result.metrics.signMeanLuminance!==null){
    if(!result.wayfinding){result.wayfinding=await reference.evaluate(distance=>{
     const {e,T,calibration,w:sw,h:sh}=window.__depatoReference;e.camera.position.set(0,34,distance);e.camera.lookAt(calibration.position);e.camera.fov=2*Math.atan(sh*1.5/distance)*180/Math.PI;e.camera.updateProjectionMatrix();e.camera.updateMatrixWorld(true);e.render(0);
     const gl=e.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let sum=0,count=0;
     for(let y=-.45;y<=.45;y+=.01)for(let x=-.45;x<=.45;x+=.01){const p=new T.Vector3(x*sw,34+y*sh,0).project(e.camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1)continue;const k=(Math.floor((p.y+1)*h/2)*w+Math.floor((p.x+1)*w/2))*4;const rgb=[0,1,2].map(i=>{const v=pixels[k+i]/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});sum+=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;count++}
     return {reference:'Shinjuku exit 1',distanceM:distance,meanLuminance:sum/count,calibrationFov:e.camera.fov,samples:count};
    },result.signDistanceM);result.wayfinding.source=referenceInfo;}
    result.metrics.signVsWayfinding=result.metrics.signMeanLuminance/result.wayfinding.meanLuminance;
   }else result.metrics.signVsWayfinding=null;
   const file=`${key}-${flag}.png`;await page.screenshot({path:`${root}/${file}`});frames.push({file,...result});await fs.writeFile(root+'/frames.json',JSON.stringify({referenceInfo,frames},null,2)+'\n');
   console.log(`${file}: facade=${result.draws['ctx_bldg_landmark_'+store]??0}, sign=${result.draws['landmark-sign:'+store]??0}, clear=${result.pose.clearSign}, ja=${result.metrics.jaCapPx.toFixed(2)}px, contrast=${result.metrics.letterContrast}, ratio=${result.metrics.signVsWayfinding}`);
  }
 }
}
console.log(`Captured ${frames.length} frames; timestamps labelled UTC in frames.json`);
