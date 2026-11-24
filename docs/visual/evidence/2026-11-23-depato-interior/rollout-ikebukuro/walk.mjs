// 2026-11-23 JST. Ego browser capture, modelled on the accepted pilot walk.mjs.
const fs=await import('node:fs/promises');
const repo=worktree.slice(0,-1);
const base=evidenceDir;
const config=JSON.parse(await fs.readFile(repo+'/stations/ikebukuro/data/depato-rollout.json','utf8'));
const pparco=config.stores.find(s=>s.streetApproach);
const stores=config.stores.filter(s=>g3?s.id==='ikebukuro-parco'||s===pparco:!s.streetApproach);
const entry=(await listTaskSpaces()).find(s=>s.name===spaceName);
const task=await taskSpace(entry?.id??spaceName);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({spaceId:task.spaceId});
const result={runtimeHead,capturedAt:new Date().toISOString(),timeZone:'UTC',spaceId:task.spaceId,profiles:[],seibu:[],skipped:config.skipped,failures:[]};
const save=()=>fs.writeFile(base+'/receipt.json',JSON.stringify(result,null,2)+'\n');
const walk=async(profile,name,points)=>{
  for(const point of points){
    const leg=await page.evaluate(point=>{const g=window.__gteki;g.setCamera(null);return {walk:g.walkPath([point],{speed:'walk',dt:1/30,maxSeconds:120}),avatar:g.avatar()};},point);
    profile.legs.push({name,...leg});
    if(!leg.walk.done)throw Error(`${name}: ${JSON.stringify(leg)}`);
  }
};
const frame=async(profile,name,yaw)=>{
  const annex=profile.store===pparco?.id;
  await page.evaluate(({yaw,name,annex})=>{const g=window.__gteki;g.setCamera({yaw,...(name==='entrance-outside'?(annex?{pitch:0}:{pitch:0,distance:0.5}):{})});g.holdFrames(true);g.goldenFrame();g.goldenFrame();g.goldenFrame();},{yaw,name,annex});
  const state=await page.evaluate(store=>{
    const g=window.__gteki,e=g.scanProbe().explorer;
    const interior=e.stationScene.root.getObjectByName('depato-interior:'+store);
    const metrics=interior?.userData.depato;
    let visibleTriangles=0;
    interior?.traverseVisible(o=>{
      if(o.isMesh)visibleTriangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3*(o.isInstancedMesh?o.count:1);
    });
    const budget=metrics&&{visibleTriangles,drawCallsPerFloor:metrics.drawCallsPerFloor,atlasPx:metrics.atlasPx};
    return {avatar:g.avatar(),camera:g.camera(),scene:g.sceneInfo(),streetContextVisible:e.scene.getObjectByName("street-context")?.visible??false,loaded:e.scene.children.flatMap(o=>{
      const found=[];o.traverse(n=>{if(n.name.startsWith('depato-interior:')&&n.children.length)found.push(n.name);});return found;
    }),budget,shaderErrors:e.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).map(p=>p.diagnostics.fragmentShader.log)};
  },profile.store);
  const file=`${profile.device.name}-${profile.store}-${name}.png`;
  await page.screenshot({path:base+'/'+file});
  await page.evaluate(()=>window.__gteki.holdFrames(false));
  profile.frames.push({name,file,sourceHead:runtimeHead,...state});
  if(state.loaded.length>1)throw Error('Neighbour interiors simultaneously loaded: '+state.loaded.join(', '));
  if(state.shaderErrors.length)throw Error(state.shaderErrors.join('\n'));
  if(annex && name!=='flag-off'){
    if(!state.loaded.includes('depato-interior:'+profile.store))throw Error(name+': P\'PARCO detail is missing');
    const {visibleTriangles,drawCallsPerFloor,atlasPx}=state.budget;
    if(profile.device.mobile && (visibleTriangles>60000 || Math.max(...drawCallsPerFloor)>30 || atlasPx>1024))
      throw Error(name+': '+JSON.stringify(state.budget));
  }
};
const pparcoWalk=async(profile,store)=>{
  const {landing,accessBay,sidewalk,exit}=store.streetApproach;
  const {point,inward}=store.entrances[0];
  const {aisleX:x,from,to}=store.circulation;
  const y=store.elevations['1F'], b1=y-4.5, b2=y-9;
  const pointAt=m=>({x:point[0]+inward[0]*m,z:point[1]+inward[1]*m,y});
  const facing=Math.atan2(-inward[0],-inward[1]);
  const towardDoor=([x,,z])=>Math.atan2(x-point[0],z-point[1]);
  const rendererPoints=points=>points.map(([x,y,z])=>({x,y,z}));
  const west=x-4;
  const placed=await page.evaluate(node=>window.__gteki.setView({node,headingDeg:0}).placed,exit);
  if(!placed)throw Error('Could not stand at '+exit);
  await walk(profile,'exit-22-to-street',rendererPoints([...landing.slice(1),...accessBay,sidewalk[0]]));
  await walk(profile,'street-first-sight',rendererPoints(sidewalk.slice(1,-2)));
  await frame(profile,'street-first-sight',towardDoor(sidewalk.at(-3)));
  await walk(profile,'street-to-entrance',rendererPoints(sidewalk.slice(-2)));
  await frame(profile,'entrance-outside',facing); // The same 7 m street-door-outside pose.
  await walk(profile,'enter-1F',[pointAt(2)]);
  await frame(profile,'first-interior',facing);
  await walk(profile,'1F-aisle',[{x:west,z:pointAt(2).z},{x:west,z:from-2},{x,z:from-2}]);
  await frame(profile,'main-aisle',Math.PI);
  for(const [upper,lower] of [[y,b1],[b1,b2]]){
    const returnToTop=upper===y?[]:[{x:west,z:to+2},{x:west,z:from-2},{x,z:from-2}];
    await walk(profile,upper===y?'1F-to-B1':'B1-to-B2',[
      ...returnToTop,{x:x+0.95,z:from,y:upper},{x:x+0.95,z:to+0.6,y:lower},{x,z:to+2,y:lower},
    ]);
  }
  for(const [lower,upper] of [[b2,b1],[b1,y]]){
    await walk(profile,lower===b2?'board-up-B2':'board-up-B1',[
      {x:west,z:to+2},{x:west,z:from-2},{x,z:from-2},{x:x-0.95,z:from-0.4,y:lower},
    ]);
    if(lower===b2)await frame(profile,'escalator-bottom',Math.PI);
    await walk(profile,lower===b2?'B2-to-B1':'B1-to-1F',[{x:x-0.95,z:to+0.6,y:upper},{x,z:to+2,y:upper}]);
    if(upper===b1)await frame(profile,'escalator-top',0);
  }
  const inside=pointAt(3);
  await walk(profile,'1F-street-door',[{x:west,z:to+2},{x:west,z:inside.z},inside]);
  await frame(profile,'street-door-inside',Math.atan2(...inward));
  await walk(profile,'leave-to-street',rendererPoints(sidewalk.slice(-1)));
  await walk(profile,'clear-detail-radius',rendererPoints(sidewalk.slice(-4,-1).reverse()));
  profile.detailUnloaded=await page.evaluate(id=>
    window.__gteki.scanProbe().explorer.stationScene.root.getObjectByName('depato-interior:'+id).children.length===0,
  store.id);
  if(!profile.detailUnloaded)throw Error("P'PARCO detail stayed loaded after leaving");
};
for(const device of [{name:'desktop',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true}]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,screenWidth:device.width,screenHeight:device.height,deviceScaleFactor:1,mobile:device.mobile});
  await page.cdp('Emulation.setTouchEmulationEnabled',{enabled:device.mobile});
  await page.goto('http://127.0.0.1:5291/?station=ikebukuro&next=1&open=search');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
  console.log({device:device.name,snapshot:(await page.snapshot()).slice(0,400)});
  for(const store of stores){
    const profile={device,store:store.id,frames:[],legs:[]};result.profiles.push(profile);
    try{
      await page.goto('http://127.0.0.1:5291/?station=ikebukuro&next=1&open=search');
      await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
      const first=store.entrances[0],street=store.entrances.find(e=>e.level==='1F'),x=store.circulation.aisleX,from=store.circulation.from,to=store.circulation.to;
      const y=store.elevations.B1,inside={x:first.point[0]+first.inward[0]*2,z:first.point[1]+first.inward[1]*2};
      // Tobu's B1 access fence crosses x - 4 at the landing. Stay on the store side.
      const b1West=store.id==='tobu-ikebukuro'?x-3.55:x-4;
      const yaw=Math.atan2(-first.inward[0],-first.inward[1]);
      const label=await page.evaluate(id=>window.__gteki.scanProbe().explorer.station.bundle.pois.find(p=>p.id===id).names[0].text,store.poiId);
      const query=g3&&store.id==='ikebukuro-parco'?'PARCO 本館':label;
      await page.fill('input[placeholder="Search exits, toilets, platforms…"]',query);
      await page.waitForFunction(label=>[...document.querySelectorAll('[role="option"]')].some(o=>o.textContent.includes(label)),label,{timeout:15000});
      profile.search={query,hits:await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent))};
      await page.fill('input[placeholder="Search exits, toilets, platforms…"]','');
      profile.route=await page.evaluate(({origin,poi})=>{const g=window.__gteki;g.setOrigin(origin);g.setDestination(poi);return g.route();},{origin:'jr-south-gate',poi:store.poiId});
      if(!profile.route?.ok && !store.skippedEntrances)throw Error('Store name route did not succeed');
      if(store.skippedEntrances)profile.stationRouteSkip=store.skippedEntrances;
      if(store===pparco){
        const edge=store.streetApproach.exit+'__'+store.street.id;
        if(!profile.route.steps.some(step=>step.edgeId===edge))throw Error('Search route missed the surface approach');
        const expanded=await page.evaluate(()=>document.querySelector('.minimap')?.dataset.collapsed==='false');
        if(expanded)await page.click('button.minimap-collapse');
        await pparcoWalk(profile,store);
        continue;
      }
      if(store.id==='ikebukuro-parco'){
        profile.northPassage=[];
        for(const detail of ['loaded','unloaded']){
          const proof=await page.evaluate(detail=>{
            const g=window.__gteki,e=g.scanProbe().explorer,scene=e.stationScene;
            const loaded=()=>{const root=scene.root.getObjectByName('depato-interior:ikebukuro-parco');return !!root?.children.length;};
            g.holdFrames(true);
            const update=scene.update;
            try{
              // Hold the real streaming focus at Seibu for the unloaded collision pass.
              if(detail==='unloaded')scene.update=(...args)=>{
                scene.setCameraFocus(null,null,null,{x:15,y:27.7,z:70});update(...args);
              };
              g.setView({node:'n_h',headingDeg:180});g.setCamera(null);g.goldenFrame();g.goldenFrame();
              scene.setCameraFocus(null,null,null,{x:66,y:28.45,z:-113});
              scene.update(0,0,e.camera);
              const before=loaded(),walk=g.walkPath([{x:71.5,z:-116.5,y:28.45}],{speed:'walk',dt:1/30,maxSeconds:120});
              return {detail,streamingFocus:detail==='unloaded'?'seibu-held':'avatar',before,after:loaded(),walk,avatar:g.avatar()};
            }finally{scene.update=update;g.holdFrames(false);}
          },detail);
          profile.northPassage.push(proof);
          if(!proof.walk.done || proof.before!==(detail==='loaded') || proof.after!==(detail==='loaded'))throw Error('North passage: '+JSON.stringify(proof));
        }
      }
      await page.evaluate(node=>{const g=window.__gteki;g.setView({node,headingDeg:180});g.setCamera(null);},first.outsideNode);
      const expanded=await page.evaluate(()=>document.querySelector('.minimap')?.dataset.collapsed==='false');
      if(expanded)await page.click('button.minimap-collapse');
      if(first.level==='B1'){
        // Evidence-only concourse pose, seven metres from the portal; no walk is asserted here.
        await page.evaluate(e=>{const x=window.__gteki.scanProbe().explorer;x.pos.set(e.point[0]-e.inward[0]*7,28.45,e.point[1]-e.inward[1]*7);x.teleported=true;},first);
      }
      await frame(profile,'entrance-outside',yaw);
      if(first.level==='B1'){
        await page.evaluate(node=>{const g=window.__gteki;g.setView({node,headingDeg:180});g.setCamera(null);},first.outsideNode);
        await walk(profile,'enter-B1',[{...inside,y}]);
        await frame(profile,'first-interior',yaw);
      }else{
        await walk(profile,'enter-1F',[{...inside,y:store.elevations['1F']}]);
        await frame(profile,'first-interior',yaw);
        // Split the long 1F aisle so each browser evaluation stays within its execution limit.
        await walk(profile,'1F-to-B1',[{x:x-4,z:inside.z},{x:x-4,z:from+78},{x:x-4,z:from+38},{x:x-4,z:from-2},{x,z:from-2},{x:x+0.95,z:from,y:y+4.5},{x:x+0.95,z:to+0.6,y},{x,z:to+2,y}]);
      }
      await walk(profile,'B1-to-B2',[{x:b1West,z:first.level==='B1'?inside.z:to+2},{x:b1West,z:from-2},{x,z:from-2},{x:x+0.95,z:from,y},{x:x+0.95,z:to+0.6,y:y-4.5},{x,z:to+2,y:y-4.5}]);
      await frame(profile,'food-hall-aisle',Math.PI-0.3);
      for(const [i,levelY] of [y-4.5,y].entries()){
        const west=i===1?b1West:x-4;
        await walk(profile,`board-up-${i}`,[{x:west,z:to+2},{x:west,z:from-2},{x,z:from-2},{x:x-0.95,z:from-0.4,y:levelY}]);
        if(i===0)await frame(profile,'escalator',Math.PI);
        await walk(profile,`ride-up-${i}`,[{x:x-0.95,z:to+0.6,y:levelY+4.5},{x,z:to+2,y:levelY+4.5}]);
      }
      const doorInside={x:street.point[0]+street.inward[0]*3,z:street.point[1]+street.inward[1]*3};
      const doorSide=doorInside.x>x?x+4:x-4;
      const streetAisle=first.level==='1F'?[{x:doorSide,z:to+38},{x:doorSide,z:to+73}]:[];
      await walk(profile,'1F-street-door',[{x:x-4,z:to+3},{x:doorSide,z:to+3},...streetAisle,{x:doorSide,z:doorInside.z},doorInside]);
      await frame(profile,'street-door-inside',Math.atan2(street.inward[0],street.inward[1]));
      await walk(profile,'leave-to-street',[{x:store.street.point[0],z:store.street.point[1],y:store.elevations['1F']}]);
      await frame(profile,'street-door-outside',Math.atan2(-street.inward[0],-street.inward[1]));
      if(store.skippedEntrances){
        await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'c_w',headingDeg:270});g.setCamera(null);});
        await frame(profile,'B1-tie-skipped',Math.PI/2);
      }
    }catch(error){result.failures.push(`${device.name} ${store.id}: ${error.stack??error}`);console.log(String(error));}
    finally{await save();}
  }
  if(!g3){
  const seibu={device,store:'seibu-ikebukuro',frames:[],legs:[]};result.seibu.push(seibu);
  try{
    await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'sp_e',headingDeg:180});g.setCamera(null);});
    await walk(seibu,'entrance-before',[{x:15,z:66}]);
    await frame(seibu,'entrance-before',-Math.PI);
    for(const [name,points] of [
      ['enter',[{x:15,z:72,y:27.7}]],
      ['aisle',[{x:22.9055,z:72},{x:22.9055,z:113.5},{x:26.9055,z:113.5},{x:26.9055,z:128.5}]],
      ['board',[{x:26.9055,z:113.5},{x:22.9055,z:113.5},{x:22.9055,z:94},{x:26.9055,z:94},{x:25.9555,z:95.6}]],
      ['ride',[{x:25.9555,z:108.6,y:32.2},{x:26.9055,z:110.5,y:32.2}]],
      ['street',[{x:26.9055,z:113.5},{x:22.9055,z:113.5},{x:22.9055,z:122.5},{x:45.365,z:122.5}]]
    ]) {
      await walk(seibu,name,points);
      if(name==='aisle')await frame(seibu,'food-hall-aisle',Math.PI-0.26);
      if(name==='board')await frame(seibu,'escalator-boarding',-Math.PI);
      if(name==='street')await frame(seibu,'street-door-inside',-Math.PI/2);
    }
  }catch(error){result.failures.push(`${device.name} seibu: ${error.stack??error}`);console.log(String(error));}
  }
  await page.goto('http://127.0.0.1:5291/?station=ikebukuro');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
  for(const store of stores){
    const profile=result.profiles.find(p=>p.device.name===device.name&&p.store===store.id),first=store.entrances.find(e=>e.level==='B1')??{outsideNode:'c_w',inward:[-1,0]};
    if(store===pparco){
      const pose=profile.frames.find(f=>f.name==='entrance-outside');
      if(pose){
        await page.evaluate(({avatar})=>{
          const g=window.__gteki,e=g.scanProbe().explorer;
          g.setView({node:'x22',headingDeg:0});
          e.pos.set(avatar.x,avatar.z,-avatar.y);e.teleported=true;
          g.setCamera({pitch:0});
        },pose);
        await frame(profile,'flag-off',pose.camera.yaw);
      }
      continue;
    }
    await page.evaluate(node=>{const g=window.__gteki;g.setView({node,headingDeg:180});g.setCamera(null);},first.outsideNode);
    const expanded=await page.evaluate(()=>document.querySelector('.minimap')?.dataset.collapsed==='false');
    if(expanded)await page.click('button.minimap-collapse');
    await frame(profile,'flag-off',Math.atan2(-first.inward[0],-first.inward[1]));
    const streetPose=profile.frames.find(f=>f.name==='street-door-outside')?.avatar;
    if(streetPose){
      // The preview street node does not exist flag-off. Match the evidence camera pose only;
      // this is not a claim of walking on a missing default-route surface.
      await page.evaluate(p=>{const e=window.__gteki.scanProbe().explorer;e.pos.set(p.x,p.z,-p.y);e.teleported=true;},streetPose);
      const street=store.entrances.find(e=>e.level==='1F');
      await frame(profile,'flag-off-street',Math.atan2(-street.inward[0],-street.inward[1]));
    }
  }
  await save();
}
console.log(JSON.stringify({profiles:result.profiles.map(p=>({device:p.device.name,store:p.store,frames:p.frames.length,legs:p.legs.map(l=>({name:l.name,done:l.walk.done}))})),failures:result.failures}));
if(result.failures.length)process.exitCode=1;
