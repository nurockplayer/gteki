// 2026-11-24 JST: collision diagnosis and regression walks; no capture frames.
const fs=await import('node:fs/promises');
const base='/Users/tachikoma/Developer/gteki-wt/depato-rollout-ikebukuro/docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro';
const task=await taskSpace('depato-rollout-ikebukuro');
const page=(await task.pages())[0]??await task.adopt((await task.tabs())[0].page);
await page.goto('http://127.0.0.1:5291/?station=ikebukuro&next=1');
await page.waitForFunction(()=>window.__gteki?.phase()==='ready',undefined,{timeout:120000});
const result={runtimeHead,measuredAt:new Date().toISOString(),timeZone:'UTC',cause:'The c_w__w_c station edge crossed the authored Tobu well at x=-98.72, z=-109.81. Missing station-route floor generated procedural greybox_wall segments through the descending escalator. Tobu circulation moved to z=-140…-128, within the original footprint and clear of that edge.',walks:[]};
const walk=async(store,name,points)=>{
  const leg=await page.evaluate(points=>{const g=window.__gteki;return {walk:g.walkPath(points,{speed:'walk',dt:1/30,maxSeconds:120}),avatar:g.avatar()};},points);
  result.walks.push({store,name,...leg});console.log(JSON.stringify({store,name,...leg}));
  await fs.writeFile(base+'/collision-probe.json',JSON.stringify(result,null,2)+'\n');
  if(!leg.walk.done)throw Error(store+' '+name+' failed');
};
await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'c_w',headingDeg:180});g.setCamera(null);});
await walk('tobu','enter',[{x:-67,z:-82,y:27.91}]);
await walk('tobu','descent',[{x:-104,z:-82},{x:-104,z:-142},{x:-100,z:-142},{x:-99.05,z:-140,y:27.91},{x:-99.05,z:-127.4,y:23.41},{x:-100,z:-126,y:23.41}]);
for(const [i,y] of [23.41,27.91].entries()){
  await walk('tobu','board-up-'+i,[{x:-104,z:-126},{x:-104,z:-142},{x:-100,z:-142},{x:-100.95,z:-140.4,y}]);
  await walk('tobu','ride-up-'+i,[{x:-100.95,z:-127.4,y:y+4.5},{x:-100,z:-126,y:y+4.5}]);
}
await walk('tobu','street',[{x:-104,z:-125},{x:-104,z:-20.142},{x:-115.512,z:-20.142},{x:-124.50228439815906,z:-19.71620055887445,y:32.41}]);
await page.evaluate(()=>{const g=window.__gteki;g.setView({node:'sp_e',headingDeg:180});g.setCamera(null);});
for(const [name,points] of [
  ['enter',[{x:15,z:72,y:27.7}]],
  ['aisle',[{x:22.9055,z:72},{x:22.9055,z:113.5},{x:26.9055,z:113.5},{x:26.9055,z:128.5}]],
  ['board',[{x:26.9055,z:113.5},{x:22.9055,z:113.5},{x:22.9055,z:94},{x:26.9055,z:94},{x:25.9555,z:95.6}]],
  ['ride',[{x:25.9555,z:108.6,y:32.2},{x:26.9055,z:110.5,y:32.2}]],
  ['street',[{x:26.9055,z:113.5},{x:22.9055,z:113.5},{x:22.9055,z:122.5},{x:45.365,z:122.5},{x:53.4,z:122.5,y:32.4}]]
])await walk('seibu',name,points);
