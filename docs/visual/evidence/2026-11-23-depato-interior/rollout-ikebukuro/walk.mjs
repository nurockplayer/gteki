// 2026-11-23 JST. Ego browser capture, modelled on the accepted pilot walk.mjs.
const fs=await import('node:fs/promises');
const repo='/Users/tachikoma/Developer/gteki-wt/depato-rollout-ikebukuro';
const base=repo+'/docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro';
const config=JSON.parse(await fs.readFile(repo+'/stations/ikebukuro/data/depato-rollout.json','utf8'));
const entry=(await listTaskSpaces()).find(s=>s.name==='depato-rollout-ikebukuro');
const task=!entry?await taskSpace('depato-rollout-ikebukuro'):await taskSpace(entry.id);
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
  await page.evaluate(yaw=>{const g=window.__gteki;g.setCamera({yaw,...(name==='entrance-outside'?{pitch:0,distance:0.5}:{})});g.holdFrames(true);g.goldenFrame();g.goldenFrame();g.goldenFrame();},yaw);
  const state=await page.evaluate(()=>{
    const g=window.__gteki,e=g.scanProbe().explorer;
    return {avatar:g.avatar(),camera:g.camera(),scene:g.sceneInfo(),streetContextVisible:e.scene.getObjectByName("street-context")?.visible??false,loaded:e.scene.children.flatMap(o=>{
      const found=[];o.traverse(n=>{if(n.name.startsWith('depato-interior:')&&n.children.length)found.push(n.name);});return found;
    }),shaderErrors:e.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).map(p=>p.diagnostics.fragmentShader.log)};
  });
  const file=`${profile.device.name}-${profile.store}-${name}.png`;
  await page.screenshot({path:base+'/'+file});
  await page.evaluate(()=>window.__gteki.holdFrames(false));
  profile.frames.push({name,file,...state});
  if(state.loaded.length>1)throw Error('Neighbour interiors simultaneously loaded: '+state.loaded.join(', '));
  if(state.shaderErrors.length)throw Error(state.shaderErrors.join('\n'));
};
for(const device of [{name:'desktop',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true}]){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,screenWidth:device.width,screenHeight:device.height,deviceScaleFactor:1,mobile:device.mobile});
  await page.cdp('Emulation.setTouchEmulationEnabled',{enabled:device.mobile});
  await page.goto('http://127.0.0.1:5291/?station=ikebukuro&next=1&open=search');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
  console.log({device:device.name,snapshot:(await page.snapshot()).slice(0,400)});
  for(const store of config.stores){
    const profile={device,store:store.id,frames:[],legs:[]};result.profiles.push(profile);
    try{
      await page.goto('http://127.0.0.1:5291/?station=ikebukuro&next=1&open=search');
      await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
      const first=store.entrances[0],street=store.entrances.find(e=>e.level==='1F'),x=store.circulation.aisleX,from=store.circulation.from,to=store.circulation.to;
      const y=store.elevations.B1,inside={x:first.point[0]+first.inward[0]*2,z:first.point[1]+first.inward[1]*2};
      const yaw=Math.atan2(-first.inward[0],-first.inward[1]);
      const query=await page.evaluate(id=>window.__gteki.scanProbe().explorer.station.bundle.pois.find(p=>p.id===id).names[0].text,store.poiId);
      await page.fill('input[placeholder="Search exits, toilets, platforms…"]',query);
      await page.waitForFunction(id=>[...document.querySelectorAll('[role="option"]')].some(o=>o.textContent.includes(id)),query,{timeout:15000});
      profile.search={query,hits:await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent))};
      await page.fill('input[placeholder="Search exits, toilets, platforms…"]','');
      profile.route=await page.evaluate(({origin,poi})=>{const g=window.__gteki;g.setOrigin(origin);g.setDestination(poi);return g.route();},{origin:'jr-south-gate',poi:store.poiId});
      if(!profile.route?.ok && !store.skippedEntrances)throw Error('Store name route did not succeed');
      if(store.skippedEntrances)profile.stationRouteSkip=store.skippedEntrances;
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
        await walk(profile,'1F-to-B1',[{x:x-4,z:inside.z},{x:x-4,z:from-2},{x,z:from-2},{x:x+0.95,z:from,y:y+4.5},{x:x+0.95,z:to+0.6,y},{x,z:to+2,y}]);
      }
      await walk(profile,'B1-to-B2',[{x:x-4,z:first.level==='B1'?inside.z:to+2},{x:x-4,z:from-2},{x,z:from-2},{x:x+0.95,z:from,y},{x:x+0.95,z:to+0.6,y:y-4.5},{x,z:to+2,y:y-4.5}]);
      await frame(profile,'food-hall-aisle',Math.PI-0.3);
      for(const [i,levelY] of [y-4.5,y].entries()){
        await walk(profile,`board-up-${i}`,[{x:x-4,z:to+2},{x:x-4,z:from-2},{x,z:from-2},{x:x-0.95,z:from-0.4,y:levelY}]);
        if(i===0)await frame(profile,'escalator',Math.PI);
        await walk(profile,`ride-up-${i}`,[{x:x-0.95,z:to+0.6,y:levelY+4.5},{x,z:to+2,y:levelY+4.5}]);
      }
      const doorInside={x:street.point[0]+street.inward[0]*3,z:street.point[1]+street.inward[1]*3};
      const doorSide=doorInside.x>x?x+4:x-4;
      await walk(profile,'1F-street-door',[{x:x-4,z:to+3},{x:doorSide,z:to+3},{x:doorSide,z:doorInside.z},doorInside]);
      await frame(profile,'street-door-inside',Math.atan2(street.inward[0],street.inward[1]));
      await walk(profile,'leave-to-street',[{x:store.street.point[0],z:store.street.point[1],y:store.elevations['1F']}]);
      await frame(profile,'street-door-outside',Math.atan2(-street.inward[0],-street.inward[1]));
      if(store.skippedEntrances){
        await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'c_w',headingDeg:270});g.setCamera(null);});
        await frame(profile,'B1-tie-skipped',Math.PI/2);
      }
    }catch(error){result.failures.push(`${device.name} ${store.id}: ${error.stack??error}`);console.log(String(error));}
    await save();
  }
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
  await page.goto('http://127.0.0.1:5291/?station=ikebukuro');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(async()=>{await window.__gteki.scanProbe().explorer.stationScene.settled?.();});
  for(const store of config.stores){
    const profile=result.profiles.find(p=>p.device.name===device.name&&p.store===store.id),first=store.entrances.find(e=>e.level==='B1')??{outsideNode:'c_w',inward:[-1,0]};
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
