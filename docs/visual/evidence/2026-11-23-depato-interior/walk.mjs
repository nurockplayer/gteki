// 2026-11-23 JST. Run against pnpm dev -- --host 127.0.0.1 --port 5286.
// nice -n 15 ego-browser nodejs < docs/visual/evidence/2026-11-23-depato-interior/walk.mjs
const fs=await import('node:fs/promises');
const base='/tmp/gteki-depato-walk';
await fs.mkdir(base+'/frames',{recursive:true});
const entry=(await listTaskSpaces()).find(s=>s.name==='depato-interior-1510');
const task=!entry?await taskSpace('depato-interior-1510'):entry.ownership==='user'?await claimTaskSpace(entry.id):entry.ownership==='agentDelegatedToUser'?await takeOverTaskSpace(entry.id):await taskSpace(entry.id);
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
console.log({spaceId:task.spaceId});
const result={measuredAt:new Date().toISOString(),timeZone:'UTC',spaceId:task.spaceId,profiles:[],failures:[]};
await fs.writeFile(base+'/space.json',JSON.stringify({spaceId:task.spaceId}));
const frame=async(profile,name,yaw)=>{
  if(yaw!==undefined)await page.evaluate(y=>window.__gteki.setCamera({yaw:y}),yaw);
  await page.evaluate(()=>{const g=window.__gteki;g.holdFrames(true);g.goldenFrame();g.goldenFrame();g.goldenFrame();});
  const info=await page.evaluate(()=>{
    const g=window.__gteki,e=g.scanProbe().explorer,root=e.scene.getObjectByName('depato-interior:seibu-ikebukuro');
    return {shaderErrors:e.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).map(p=>p.diagnostics.fragmentShader.log),visibleFloorGroups:root?.children.map(o=>o.visible),avatar:g.avatar(),camera:g.camera(),scene:g.sceneInfo(),depato:root?.userData.depato,render:e.renderer.info.render,
      wayfinding:g.signFaces(),
      wayfindingPolygon:g.projectEnu((()=>{const nx=0.9863939238321437,nz=0.1643989873053573,f=g.signFaces().find(f=>f.id==='sign-s38_w-sp_e__s38_w-r');return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:15.709329938456975+a*nz*f.widthM/2,y:-65.5393598676684+a*nx*f.widthM/2,z:30.35+b*f.heightM/2}));})()),
      boards:g.projectEnu([{x:13.1,y:-70,z:29.85},{x:16.9,y:-70,z:29.85},{x:16.9,y:-70,z:30.45},{x:13.1,y:-70,z:30.45}]),
      streetDoor:g.projectEnu([{x:49.365,y:-120.7,z:32.21},{x:49.365,y:-124.3,z:32.21},{x:49.365,y:-124.3,z:34.9},{x:49.365,y:-120.7,z:34.9}]),
      nearestCap:g.projectEnu([{x:25.1855,y:-131,z:29.9},{x:25.1855,y:-131,z:30.05}])};
  });
  await page.screenshot({path:`${base}/frames/${profile}-${name}.png`});await page.evaluate(()=>window.__gteki.holdFrames(false));if(info.shaderErrors.length)result.failures.push(`${profile} ${name}: ${info.shaderErrors.join(" / ")}`);return {name,...info};
};
const walk=async(profile,name,points)=>{
  const leg=await page.evaluate(points=>{const g=window.__gteki;g.setCamera(null);return {walk:g.walkPath(points,{speed:'walk',dt:1/30,maxSeconds:120}),avatar:g.avatar()};},points);
  console.log(JSON.stringify({profile,name,...leg}));
  if(!leg.walk.done)result.failures.push(`${profile} ${name}: ${JSON.stringify(leg)}`);
  return {name,...leg};
};
for(const device of [{name:'desktop',width:1440,height:900,mobile:false},{name:'phone',width:390,height:844,mobile:true}]){
 try{
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,screenWidth:device.width,screenHeight:device.height,deviceScaleFactor:1,mobile:device.mobile});
  await page.cdp('Emulation.setTouchEmulationEnabled',{enabled:device.mobile});
  await page.goto('http://127.0.0.1:5286/?station=ikebukuro&open=search&next=1');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  const p={device,frames:[],legs:[]};result.profiles.push(p);
  console.log({profile:device.name,snapshot:(await page.snapshot()).slice(0,250)});
  await page.waitForSelector('input[placeholder="Search exits, toilets, platforms…"]',{state:'visible',timeout:30000});
  p.searchHits=[];
  for(const query of ['西武池袋本店','デパ地下']){
    await page.fill('input[placeholder="Search exits, toilets, platforms…"]',query);
    await page.waitForFunction(()=>[...document.querySelectorAll('[role="option"]')].some(o=>/西武池袋本店|Seibu Ikebukuro/.test(o.textContent)),undefined,{timeout:15000});
    p.searchHits.push({query,text:await page.evaluate(()=>[...document.querySelectorAll('[role="option"]')].map(o=>o.textContent))});
  }
  await page.fill('input[placeholder="Search exits, toilets, platforms…"]','');
  p.search=await page.evaluate(()=>{const g=window.__gteki;const from=g.setOrigin('jr-south-gate'),to=g.setDestination('shop-ikb-seibu-honten');return {from,to,route:g.route(),endpoints:g.routeEndpoints(),aliases:g.scanProbe().explorer.station.bundle.pois.find(p=>p.id==='shop-ikb-seibu-honten').aliases};});
  if(!p.search.route?.ok)result.failures.push(`${device.name} search route did not succeed`);
  await page.goto('http://127.0.0.1:5286/?station=ikebukuro&next=1');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'sp_e',headingDeg:180});g.setCamera(null);});
  p.legs.push(await walk(device.name,'four-metres-before',[{x:15,z:66}]));
  const expanded=await page.evaluate(()=>document.querySelector('.minimap')?.dataset.collapsed==='false');
  if(expanded)await page.click('button.minimap-collapse');
  p.frames.push(await frame(device.name,'entrance-before',-Math.PI));
  p.legs.push(await walk(device.name,'wayfinding-context',[{x:8,z:62}]));
  p.frames.push(await frame(device.name,'entrance-context',device.mobile?-2.28:-2.50));
  p.legs.push(await walk(device.name,'return-to-door',[{x:15,z:66}]));
  p.legs.push(await walk(device.name,'through-station-door',[{x:15,z:72,y:27.7}]));
  p.frames.push(await frame(device.name,'entrance-inside',-Math.PI));
  p.legs.push(await walk(device.name,'food-hall-main-aisle',[{x:22.9055,z:72},{x:22.9055,z:113.5},{x:26.9055,z:113.5},{x:26.9055,z:128.5}]));
  p.frames.push(await frame(device.name,'food-hall-aisle',Math.PI-0.26));
  p.legs.push(await walk(device.name,'counter-close',[{x:26.7,z:131}]));
  p.frames.push(await frame(device.name,'counter',Math.PI/2));
  p.legs.push(await walk(device.name,'escalator-board',[{x:26.9055,z:113.5},{x:22.9055,z:113.5},{x:22.9055,z:94},{x:26.9055,z:94},{x:25.9555,z:95.6}]));
  p.frames.push(await frame(device.name,'escalator-boarding',-Math.PI));
  await page.evaluate(()=>window.__gteki.setCamera(null));
  p.legs.push(await walk(device.name,'ride-to-1F',[{x:25.9555,z:108.6,y:32.2},{x:26.9055,z:110.5,y:32.2}]));
  p.frames.push(await frame(device.name,'arrival-1F',-Math.PI));
  p.legs.push(await walk(device.name,'wide-1F',[{x:26.9055,z:113.5}]));
  p.frames.push(await frame(device.name,'wide-1F',Math.PI-0.4));
  p.legs.push(await walk(device.name,'street-door-inside',[{x:22.9055,z:113.5},{x:22.9055,z:122.5},{x:45.365,z:122.5}]));
  p.frames.push(await frame(device.name,'street-door-inside',-Math.PI/2));
  p.legs.push(await walk(device.name,'through-street-door',[{x:53.4,z:122.5,y:32.4}]));
  p.frames.push(await frame(device.name,'street-door-outside',Math.PI/2));
  p.performance={status:"AD measurement required",reason:"Two CDP CPU profiles showed approximately 1 Hz browser scheduling with most time idle, including after focus emulation. These natural-frame samples cannot certify the J12 foreground GPU bar."};
  // Supplementary AD views; the original twelve-leg route above is unchanged.
  p.additionalLegs=[];
  await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'depato-seibu-ikebukuro-B1-upper',headingDeg:180});g.setCamera(null);});
  p.additionalLegs.push(await walk(device.name,'far-end-B1',[{x:26.9055,z:162}]));
  p.frames.push(await frame(device.name,'far-end-B1',0));
  await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'depato-seibu-ikebukuro-1F-upper',headingDeg:0});g.setCamera({pitch:-0.25});});
  p.frames.push(await frame(device.name,'well-from-1F',0));
  await page.goto('http://127.0.0.1:5286/?station=ikebukuro');
  await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
  await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'sp_e',headingDeg:180});g.setCamera(null);});
  p.legs.push(await walk(device.name,'flag-off-same-pose',[{x:15,z:66}]));
  p.frames.push(await frame(device.name,'flag-off',-Math.PI));
 }catch(error){result.failures.push(`${device.name}: ${error.stack??error}`);console.log(String(error));}
 await fs.writeFile(base+'/acceptance.json',JSON.stringify(result,null,2));
}
console.log(JSON.stringify({profiles:result.profiles.map(p=>({device:p.device,legs:p.legs,performance:p.performance,frames:p.frames.map(f=>f.name)})),failures:result.failures}));
await fs.writeFile(base+'/acceptance.json',JSON.stringify(result,null,2));
if(result.failures.length)process.exitCode=1;
